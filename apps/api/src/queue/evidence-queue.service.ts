import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { evidenceQueueName, redisUrl } from './evidence-queue.constants.js'

/**
 * 证据队列生产者（API 侧）：只入队，不消费。
 *
 * 惰性连接：OpenAPI 派生/单测 createApp 不触发 Redis 连接；首个上传才建立。
 */
@Injectable()
export class EvidenceQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(EvidenceQueueService.name)
  private connection?: Redis
  private queue?: Queue

  private getQueue(): Queue {
    if (this.queue) return this.queue
    // 生产者要求快速失败：Redis 不可用时让 enqueue 尽快 reject（服务层转 503），
    // 而不是无限重连挂住上传请求。`maxRetriesPerRequest: null` 只用于 worker 的
    // 长连接消费语义。
    this.connection = new Redis(redisUrl(), {
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
    })
    this.connection.on('error', (err: Error) => {
      this.logger.error(`队列连接错误：${err.message}`)
    })
    this.queue = new Queue(evidenceQueueName(), { connection: this.connection })
    return this.queue
  }

  async enqueueProcessEvidence(recordId: string): Promise<void> {
    await this.getQueue().add(
      'process',
      { recordId },
      { attempts: 3, backoff: { type: 'exponential', delay: 500 } },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close()
    this.queue = undefined
    this.connection?.disconnect()
    this.connection = undefined
  }
}
