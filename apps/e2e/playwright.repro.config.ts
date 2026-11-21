// PROTOTYPE（#13）— 复现轨道配置（#10 §1）：tests/repro 专用，CI 逐 PR 只跑这条轨；
// _drafts/ 草稿区不收集（毕业不改 CI 文件，目录约定自动生效）。
// 基线取自 docs/research/playwright-e2e.md §4.1（CI：failures + JSON(onlyFailures) + blob；本地：list + html）。
import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const ARTIFACTS = process.env.E2E_ARTIFACTS_DIR ?? fileURLToPath(new URL('./.artifacts-run', import.meta.url))
const CI = !!process.env.CI

export default defineConfig({
  testDir: 'tests/repro',
  testIgnore: /_drafts\//, // 草稿区：毕业补完前的过渡位，CI 不收集（#10 §6）
  fullyParallel: false,
  forbidOnly: CI,
  workers: CI ? 1 : undefined, // 官方建议 CI 从 1 起步（playwright-e2e.md §2.1）
  retries: CI ? 1 : 0,
  globalTimeout: 10 * 60_000,
  outputDir: `${ARTIFACTS}/test-results`,
  reporter: CI
    ? [
        ['failures'],
        ['json', { outputFile: `${ARTIFACTS}/results.json`, onlyFailures: true }],
        ['blob', { outputDir: `${ARTIFACTS}/blob` }],
      ]
    : [
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
