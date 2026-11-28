// 毕业校验运行配置（#106 起用；Spec-e2e §6 / ADR §4）：testDir 是宿主生成、经 tar
// 注入执行器的 `.verify-run/`——**在 repro/explore 目录树之外**，因此校验运行既不会
// 被复现轨道收集，也不污染探索轨道。devenv 真跑一次后按 expect=fail|pass 判定，
// 判定不符 → exit 9 零落盘（op 协议 V 行）。
// JSON 报告不加 onlyFailures：失败签名提取需要全量结果（#108/#112 在此之上判定）。
import { defineConfig } from '@playwright/test'

const ARTIFACTS = process.env.E2E_ARTIFACTS_DIR ?? './.artifacts-run'

export default defineConfig({
  testDir: '.verify-run',
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0, // 校验运行只跑一次：判定要的是「这一次」的事实
  timeout: 120_000,
  globalTimeout: 5 * 60_000,
  outputDir: `${ARTIFACTS}/verify-test-results`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${ARTIFACTS}/verify-results.json` }],
  ],
  use: {
    baseURL: process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
})