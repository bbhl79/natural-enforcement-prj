import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { Queue, Worker, type Job } from 'bullmq'
import { Redis } from 'ioredis'
// 注意：构造器注入的类必须值导入（import type 会擦除 → design:paramtypes 退化成 Function，DI 报错）
import { PrismaService } from '../prisma/prisma.service.js'
import { StorageService } from '../storage/storage.service.js'
import { parseJob, type ProcessEvidenceJob } from './payload.js'

// 队列名带可选键空间前缀（#13 e2e 数据级隔离：run 级独立 Redis 键空间；
// dev 默认无前缀，e2e 栈经 QUEUE_NAMESPACE=e2e-<run_id>- 注入。
// BullMQ 6 实测：队列名不得含 ":"（bull 保留为 Redis 键分隔符）→ 前缀用 "-"）
export const EVIDENCE_QUEUE = process.env.QUEUE_NAMESPACE
  ? `${process.env.QUEUE_NAMESPACE}evidence-processing`
  : 'evidence-processing'

/**
 * BullMQ 6 语义：ioredis 显式安装（v6 起是可选 peer）；Worker 必须
 * maxRetriesPerRequest=null。队列与 Worker 同进程（原型简化；SPEC 可拆独立 worker 服务）。
 */
@Injectable()
export class EvidenceQueueService implements OnModuleDestroy {
  private readonly connection: Redis
  private readonly queue: Queue
  private readonly worker: Worker

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    this.connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    })
    this.queue = new Queue(EVIDENCE_QUEUE, { connection: this.connection })
    this.worker = new Worker(
      EVIDENCE_QUEUE,
      (job) => this.process(job),
      { connection: this.connection },
    )
  }

  async enqueueProcessEvidence(recordId: string): Promise<void> {
    await this.queue.add('process', { recordId }, { attempts: 3, backoff: { type: 'exponential', delay: 500 } })
  }

  private async process(job: Job<unknown>): Promise<{ sha256: string; bytes: number }> {
    const { recordId } = parseJob(job.data) as ProcessEvidenceJob
    const record = await this.prisma.evidenceRecord.findUnique({ where: { id: recordId } })
    if (!record) throw new Error(`证据记录不存在：${recordId}`)
    try {
      const content = await this.storage.get(record.objectKey)
      const sha256 = createHash('sha256').update(content).digest('hex')
      await this.prisma.evidenceRecord.update({
        where: { id: recordId },
        data: { status: 'ready', bytes: content.byteLength, sha256 },
      })
      return { sha256, bytes: content.byteLength }
    } catch (err) {
      await this.prisma.evidenceRecord
        .update({ where: { id: recordId }, data: { status: 'failed', error: String(err) } })
        .catch(() => undefined)
      throw err
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close()
    await this.queue.close()
    this.connection.disconnect()
  }
}
