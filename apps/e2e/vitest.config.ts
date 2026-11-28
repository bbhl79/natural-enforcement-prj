import { defineConfig } from 'vitest/config'

// 生命周期决策引擎单测（#106）：mkdtemp 临时目录树、零基础设施——不碰容器/数据库，
// 与 apps/api、packages/contracts 同款 vitest 载体，经 devenv test:unit / verify 运行。
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
  },
})