// integration 层 Vitest 配置（需库用例，容器内经 compose 网络连 db）。
// 与 unit 层隔离：unit 层跑 packages/*/test、backend/*/test（pnpm -r test），无库；
// 本层只收 integration/ 下的 *.test.ts，DATABASE_URL 由 dev 脚本注入。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['integration/**/*.test.ts'],
    // 两套用例都从 it_template 复制。源库上不能有别的会话。
    // 文件并行会让两套用例同时复制同一个源。
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
