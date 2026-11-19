// Prisma 7 配置（配置迁到 prisma.config.ts；Prisma 不再自动加载 .env——env 由 devenv 容器注入）
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
})
