import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
// 生成入口是目录内文件 client.ts（nodenext 必须带全路径 + .js）
import { PrismaClient } from '../generated/client/client.js'

/**
 * Prisma 7 Rust-free 架构：prisma-client generator（生成到 src/generated/client）
 * + queryCompiler + @prisma/adapter-pg 驱动适配器（node-pg 默认无连接超时——由
 * 外层健康检查/重启策略兜底，事实记录于 #11）。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    })
  }

  async onModuleInit(): Promise<void> {
    // 启动即连：数据库不可用时 fail-fast（compose 健康检查会拉起重启）
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
