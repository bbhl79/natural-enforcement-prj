import 'reflect-metadata'
import express from 'express'
import { Logger, type INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'

/** 统一装配：main / 集成测试 / OpenAPI 派生共用（保证测试与运行时同构） */
export async function createApp(opts: { logger?: Logger | false } = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    logger: opts.logger ?? new Logger('api'),
    bodyParser: false, // 自管 body parser：octet-stream 原始字节（证据上传）必须走 express.raw
  })
  // 顺序敏感：raw 先注册，仅匹配 application/octet-stream
  app.use(express.raw({ type: 'application/octet-stream', limit: '64mb' }))
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false }))
  return app
}
