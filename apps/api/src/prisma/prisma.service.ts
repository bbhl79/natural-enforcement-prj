import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
// 生成入口是目录内文件 client.ts（nodenext 必须带全路径 + .js）
import { PrismaClient } from '../generated/client/client.js'

/**
 * Prisma 7 Rust-free 架构：prisma-client generator（生成到 src/generated/client）
 * + queryCompiler + @prisma/adapter-pg 驱动适配器。
 */
/**
 * 连接池上限显式可注入（Spec-e2e §11：池 × 并发 run < max_connections）：
 * e2e per-run API/worker 由编排层注入 DATABASE_POOL_MAX（默认 2）；
 * 未设置时保持 pg.Pool 默认值（开发栈行为不变）。
 */
function prismaPgConfig(): { connectionString: string | undefined; max?: number } {
  const rawMax = process.env.DATABASE_POOL_MAX
  const max = rawMax === undefined || rawMax === '' ? undefined : Number(rawMax)
  if (max !== undefined && (!Number.isInteger(max) || max <= 0)) {
    throw new Error(`DATABASE_POOL_MAX 必须是正整数（当前：${rawMax}）`)
  }
  return {
    connectionString: process.env.DATABASE_URL,
    ...(max === undefined ? {} : { max }),
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg(prismaPgConfig()) })
  }

  async onModuleInit(): Promise<void> {
    // 启动即连：数据库不可用时 fail-fast（compose 健康检查会拉起重启）
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
