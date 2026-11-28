import { createHash } from 'node:crypto'
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { Worker, type Job } from 'bullmq'
import { Redis } from 'ioredis'
import { PrismaService } from '../prisma/prisma.service.js'
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

/**
 * 后台证据 worker（独立进程；#69）：
 * 上传入队 → 本服务取对象（经服务间 presigned GET，真实 HTTP）→ 计算 sha256/字节数
 * → 回写 ready；失败回写 failed（浏览器可见原因固定、不含内部地址）。
 * worker 通过 Redis 心跳让 compose 健康检查可判定「已进入消费循环」。
 */
@Injectable()
export class EvidenceWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EvidenceWorkerService.name)
  private connection?: Redis
  private worker?: Worker
  private heartbeat?: NodeJS.Timeout

  constructor(
    private readonly prisma: PrismaService,
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
    this.worker.on('failed', (job, err) => {
      this.logger.warn(`任务失败（job=${job?.id ?? '?'}）：${err.message}`)
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
    const { recordId } = parseProcessEvidenceJob(job.data)
    const record = await this.prisma.evidenceRecord.findUnique({ where: { id: recordId } })
    if (!record) throw new Error(`证据记录不存在：${recordId}`)

    try {
      // 服务间 presigned GET：worker 不直接使用裸 bucket/key 访问（#69 AC）
      const url = await this.storage.presignGet(record.objectKey, 60)
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) throw new Error(`presigned GET 失败（HTTP ${res.status}）`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      await this.prisma.evidenceRecord.update({
        where: { id: recordId },
        data: { status: 'ready', bytes: bytes.byteLength, sha256, error: null },
      })
    } catch (err) {
      // 完整异常只进服务端日志；浏览器可见的 error 字段保持通用文案（不含内部地址）
      this.logger.warn(`证据处理失败（record=${recordId}）：${err instanceof Error ? err.message : String(err)}`)
      await this.prisma.evidenceRecord
        .update({
          where: { id: recordId },
          data: { status: 'failed', error: EVIDENCE_PROCESSING_FAILED_MESSAGE },
        })
        .catch(() => undefined)
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