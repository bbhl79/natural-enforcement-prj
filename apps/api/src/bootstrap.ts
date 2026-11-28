import 'reflect-metadata'
import {
  Logger,
  StandardSchemaSerializerInterceptor,
  type INestApplication,
} from '@nestjs/common'
import { NestFactory, Reflector } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { EVIDENCE_BODY_PARSER_LIMIT_BYTES, EVIDENCE_CONTENT_TYPE } from '@ne/contracts'
import { AppModule } from './app.module.js'
import { buildOpenApiDocument } from './openapi.js'

/** 统一装配：main / 集成测试 / OpenAPI 派生共用（保证测试与运行时同构） */
export async function createApp(opts: { logger?: Logger | false } = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: opts.logger ?? new Logger('api'),
  })
  // 证据上传是原始字节（application/octet-stream）：默认 JSON parser 不解析该类型。
  // 上限略高于契约上限，让 413 由服务层以契约声明的载荷返回（解析层默认 413 同构）。
  app.useBodyParser('raw', {
    type: EVIDENCE_CONTENT_TYPE,
    limit: EVIDENCE_BODY_PARSER_LIMIT_BYTES,
  })
  // 运行时响应契约校验：消费 @SerializeOptions({ schema })（含 create 类 {id} 响应，Spec §9 / #66）
  app.useGlobalInterceptors(new StandardSchemaSerializerInterceptor(app.get(Reflector)))

  // 挂在底层 HTTP adapter 而非 Controller：供消费者/Schemathesis 拉取，同时不污染 OpenAPI paths
  let cachedDoc: ReturnType<typeof buildOpenApiDocument> | undefined
  app.getHttpAdapter().get('/openapi.json', (_req: unknown, res: { json: (body: unknown) => void }) => {
    cachedDoc ??= buildOpenApiDocument(app)
    res.json(cachedDoc)
  })

  return app
}
