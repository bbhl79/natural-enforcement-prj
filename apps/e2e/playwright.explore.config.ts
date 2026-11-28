// 探索轨道配置（#70）：tests/explore 专用，不进常规 CI；失败是产出（证据 → 缺陷报告），
// 不重试不掩盖；录屏/trace/JSON/HTML 报告全部按 run 导出到宿主证据目录。
// P0 属性探索引擎（#107）在 tests/explore/properties/ 内运行（同一轨道、同一失败语义）；
// 违规的结构化反例经 property-finding 附件进入 results.json（口径见 devenv/COMMANDS.md）。
import { defineConfig } from '@playwright/test'

const ARTIFACTS = process.env.E2E_ARTIFACTS_DIR ?? './.artifacts-run'

export default defineConfig({
  testDir: 'tests/explore',
  fullyParallel: false, // charter 会话按序执行（探索=归因，不抢吞吐）
  forbidOnly: true,
  workers: 1,
  retries: 0, // 探索失败即证据；复现门禁在登记时另行重放（后续票）
  timeout: 120_000,
  globalTimeout: 15 * 60_000,
  outputDir: `${ARTIFACTS}/test-results`,
  reporter: [
    ['list'],
    ['json', { outputFile: `${ARTIFACTS}/results.json` }],
    ['html', { open: 'never', outputFolder: `${ARTIFACTS}/html-report` }],
  ],
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})