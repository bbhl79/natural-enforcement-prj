// PROTOTYPE（#13）— 探索轨道配置（#10 §1）：tests/explore 专用，不进 PR CI；
// 失败是产出（证据 → 缺陷报告），不重试不掩盖；录屏/trace 全开供归因。
import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const ARTIFACTS = process.env.E2E_ARTIFACTS_DIR ?? fileURLToPath(new URL('./.artifacts-run', import.meta.url))

export default defineConfig({
  testDir: 'tests/explore',
  fullyParallel: false, // charter 会话按序执行（探索=编排与归因，不抢吞吐）
  forbidOnly: true,
  workers: 1,
  retries: 0, // 探索失败即证据；复现门禁在登记时另行重放
  globalTimeout: 20 * 60_000,
  outputDir: `${ARTIFACTS}/test-results`,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `${ARTIFACTS}/html-report` }],
    ['json', { outputFile: `${ARTIFACTS}/results.json`, onlyFailures: true }],
  ],
  use: {
    baseURL: process.env.E2E_API_BASE_URL ?? 'http://e2e-api:3000',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
})
