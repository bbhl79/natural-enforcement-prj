import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // src/**=单元（纯函数，无基础设施）；test/**=集成（连真实 PostGIS）
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
