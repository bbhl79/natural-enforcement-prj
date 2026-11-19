// Prisma 7 配置（配置迁到 prisma.config.ts；Prisma 不再自动加载 .env——env 由 devenv 容器注入）
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Prisma 7：migrate 用连接串在顶层 datasource.url（schema 内 url 已禁用）
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://ne:ne-dev-only@localhost:5432/natural_enforcement_dev',
  },
  migrations: {
    path: 'prisma/migrations',
  },
})
