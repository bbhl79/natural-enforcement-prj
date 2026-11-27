import 'reflect-metadata'
import {
  Logger,
  StandardSchemaSerializerInterceptor,
  type INestApplication,
} from '@nestjs/common'
import { NestFactory, Reflector } from '@nestjs/core'
import { AppModule } from './app.module.js'
import { buildOpenApiDocument } from './openapi.js'

/** 统一装配：main / 集成测试 / OpenAPI 派生共用（保证测试与运行时同构） */
export async function createApp(opts: { logger?: Logger | false } = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    logger: opts.logger ?? new Logger('api'),
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
