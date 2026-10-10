// integration 层 Vitest 配置（需库用例，容器内经 compose 网络连 db）。
// 与 unit 层隔离：unit 层跑 packages/*/test、backend/*/test（pnpm -r test），无库；
// 本层只收 integration/ 下的 *.test.ts，DATABASE_URL 由 dev 脚本注入。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
