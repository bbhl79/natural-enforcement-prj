import 'reflect-metadata'
import { Logger, type INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'

/** 统一装配：main / 集成测试共用（保证测试与运行时同构） */
export async function createApp(opts: { logger?: Logger | false } = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    logger: opts.logger ?? new Logger('api'),
  })
  return app
}
