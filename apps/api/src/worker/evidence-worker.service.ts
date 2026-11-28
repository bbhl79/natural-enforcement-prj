import { createHash } from 'node:crypto'
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { Worker, type Job } from 'bullmq'
import { Redis } from 'ioredis'
import { EvidenceRepo } from '../evidence/evidence.repo.js'
import { StorageService } from '../storage/storage.service.js'
import {
  EVIDENCE_PROCESSING_FAILED_MESSAGE,
  evidenceQueueName,
  redisUrl,
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_HEARTBEAT_TTL_SECONDS,
  workerHeartbeatKey,
} from '../queue/evidence-queue.constants.js'
import { parseProcessEvidenceJob } from '../queue/payload.js'
import { isFinalAttempt } from './attempts.js'

/**
 * 后台证据 worker（独立进程；#69）：
 * 上传入队 → 本服务取对象（经服务间 presigned GET，真实 HTTP）→ 计算 sha256/字节数
 * → 回写 ready；**重试期间保持 pending，仅 BullMQ 最后一次尝试失败才写 failed**
 * （浏览器可见原因固定、不含内部地址；避免 failed→ready 时 UI 停在 failed）。
 * worker 通过 Redis 心跳让 compose 健康检查可判定「已进入消费循环」。
 */
@Injectable()
export class EvidenceWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EvidenceWorkerService.name)
  private connection?: Redis
  private worker?: Worker
  private heartbeat?: NodeJS.Timeout

  constructor(
    private readonly repo: EvidenceRepo,
    private readonly storage: StorageService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const queueName = evidenceQueueName()
    this.connection = new Redis(redisUrl(), { maxRetriesPerRequest: null })
    this.connection.on('error', (err: Error) => {
      this.logger.error(`worker 队列连接错误：${err.message}`)
    })

    this.worker = new Worker(queueName, (job) => this.process(job), {
      connection: this.connection,
    })
    this.worker.on('error', (err: Error) => {
      this.logger.error(`worker 错误：${err.message}`)
    })

    await this.beat(queueName)
    this.heartbeat = setInterval(() => {
      void this.beat(queueName)
    }, WORKER_HEARTBEAT_INTERVAL_MS)
    this.logger.log(`证据 worker 已就绪（queue=${queueName}）`)
  }

  private async beat(queueName: string): Promise<void> {
    try {
      await this.connection?.set(
        workerHeartbeatKey(queueName),
        String(Date.now()),
        'EX',
        WORKER_HEARTBEAT_TTL_SECONDS,
      )
    } catch (err) {
      this.logger.warn(`worker 心跳写入失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async process(job: Job<unknown>): Promise<void> {
    const attempts = job.opts.attempts
    const attemptNumber = job.attemptsMade + 1
    let recordId: string | undefined
    try {
      recordId = parseProcessEvidenceJob(job.data).recordId
      const record = await this.repo.findById(recordId)
      if (!record) throw new Error(`证据记录不存在：${recordId}`)

      // 服务间 presigned GET：worker 不直接使用裸 bucket/key 访问（#69 AC）
      const url = await this.storage.presignGet(record.objectKey, 60)
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) throw new Error(`presigned GET 失败（HTTP ${res.status}）`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      await this.repo.markReady(recordId, bytes.byteLength, sha256)
    } catch (err) {
      const final = isFinalAttempt(attemptNumber, attempts)
      // 重试期间不写最终失败态：BullMQ 会继续重试，状态保持 pending（前端继续轮询）。
      // 只有当前就是最后一次尝试才在抛出前同步写 failed（避免 fire-and-forget 丢失）。
      // 完整异常只进服务端日志；浏览器可见的 error 字段保持通用文案（不含内部地址）。
      this.logger.warn(
        `证据处理失败（record=${recordId ?? '?'}，attempt ${attemptNumber}/${attempts ?? 1}，final=${final}）：${err instanceof Error ? err.message : String(err)}`,
      )
      if (final && recordId) {
        await this.repo.markFailed(recordId, EVIDENCE_PROCESSING_FAILED_MESSAGE).catch((markErr: unknown) => {
          this.logger.error(
            `写入 failed 状态失败（record=${recordId}）：${markErr instanceof Error ? markErr.message : String(markErr)}`,
          )
        })
      }
      throw err
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = undefined
    await this.worker?.close()
    this.worker = undefined
    this.connection?.disconnect()
    this.connection = undefined
  }
}
