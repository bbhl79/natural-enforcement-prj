// 集成测试共享装配：每文件独立 boot（vitest forks 隔离），随机端口 + 唯一命名免重置
import { afterAll, beforeAll } from 'vitest'
import type { INestApplication } from '@nestjs/common'
import { createApp } from '../src/bootstrap.js'

export interface TestContext {
  app: INestApplication
  baseUrl: string
}

export function setupApp(): TestContext {
  const ctx = {} as TestContext
  beforeAll(async () => {
    ctx.app = await createApp({ logger: false })
    await ctx.app.listen(0)
    ctx.baseUrl = await ctx.app.getUrl()
  })
  afterAll(async () => {
    await ctx.app.close()
  })
  return ctx
}
