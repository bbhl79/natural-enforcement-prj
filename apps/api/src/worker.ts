// 独立 worker 进程入口（#69）：Nest 应用上下文（无 HTTP 端口），消费证据队列。
import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { WorkerModule } from './worker/worker.module.js'

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new Logger('worker'),
  })
  let closing = false
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return
    closing = true
    new Logger('worker').log(`收到 ${signal}，正在关闭…`)
    await app.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

void main()