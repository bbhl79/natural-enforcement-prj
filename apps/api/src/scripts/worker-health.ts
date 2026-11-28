// worker 健康探针（compose healthcheck 调用）：Redis 心跳键存在 = worker 在消费循环中。
// 独立脚本避免 healthcheck 依赖 shell/redis-cli；连接失败按不健康处理。
import { Redis } from 'ioredis'
import { evidenceQueueName, redisUrl, workerHeartbeatKey } from '../queue/evidence-queue.constants.js'

async function main(): Promise<void> {
  const redis = new Redis(redisUrl(), {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
  })
  redis.on('error', () => undefined) // 连接失败由 catch/exitCode 表达，避免未处理 error 事件
  try {
    await redis.connect()
    process.exitCode = (await redis.exists(workerHeartbeatKey(evidenceQueueName()))) === 1 ? 0 : 1
  } catch {
    process.exitCode = 1
  } finally {
    redis.disconnect()
  }
}

void main()