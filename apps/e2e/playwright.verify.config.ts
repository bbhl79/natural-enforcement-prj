// PROTOTYPE（#13）— 毕业校验运行配置（#10 §6 真跑一次）：
// graduate/confirm-fix 把转写用例（无 expected-fail 标记形态）写进 .verify-run/ 由 devenv 触发本配置执行。
// 未修必须失败 / 已修必须通过——翻译质量的把关门；产物并入同 run 的 artifacts。
import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const ARTIFACTS = process.env.E2E_ARTIFACTS_DIR ?? fileURLToPath(new URL('./.artifacts-run', import.meta.url))

export default defineConfig({
  testDir: '.verify-run',
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  globalTimeout: 5 * 60_000,
  outputDir: `${ARTIFACTS}/verify-out`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${ARTIFACTS}/verify-results.json` }],
  ],
  use: {
    baseURL: process.env.E2E_API_BASE_URL ?? 'http://e2e-api:3000',
    trace: 'off',
    video: 'off',
  },
})
