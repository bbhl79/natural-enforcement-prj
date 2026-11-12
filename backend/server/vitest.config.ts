// 用途：启动包的 Vitest 配置：node 环境，只收 src 下的测试文件。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});