// 用途：单点定义各执行面消费的场景清单，供驱动入口与覆盖自检共用。
// 各执行面消费的 scenario 清单。清单单点定义在这里，驱动入口与覆盖自检共用。
// 自检见 integration/verify-suites.test.ts：每个 driver=api 的 scenario 必须被某个执行面消费。

/**
 * e2e 层稳定用例（e2e/cases/08-verify-api.sh 经 run-api-suite.ts 调用）。
 * 整栈上经 nginx 跑，不依赖图层 overlay。
 */
export const API_SUITE: readonly string[] = [
  'vf-sc-verify-loop-survey-register',
  'vf-sc-verify-loop-land-register',
  'vf-sc-verify-loop-land-verify-dispatch',
  'vf-sc-next-todo-buttons',
  'vf-sc-neg-type-unconfirmed',
  'vf-sc-neg-missing-narrative',
  'vf-sc-neg-idempotency-conflict',
  'vf-sc-neg-land-point-geometry',
  'vf-sc-neg-supervisor-register',
];

/**
 * 已知未接驱动的旧稿（状态是 runnable，但没有任何执行面消费）。
 * 两条原因同时成立，所以不能直接塞进 API_SUITE：
 * 1. 步骤用了 API 驱动没实现的动作（login、navigate、collaborate-handoff、dispatch-full、
 *    dispatch-assign-*、filing-*、assert-visible），runStep 遇到会抛错。
 * 2. oracle 写的是人读的 assertions 字符串，没有机器可判的 assert 数组。
 *    evaluateOracle 对空 assert 判过，接进去会得到假绿。
 * 接驱动的做法：补动作实现，并把 oracle 改写成 assert 数组，再从本清单移到某个执行面。
 * integration/verify-suites.test.ts 把本清单当棘轮：新增的旧稿必须登记，接入后必须移出。
 */
export const UNWIRED_SCENARIOS: readonly string[] = [
  'vf-sc-collaborate-handoff',
  'vf-sc-duplicate-land-overlap',
  'vf-sc-filing-after-dispatch',
  'vf-sc-register-dispatch-land-patrol',
  'vf-sc-register-mineral-transfer',
  'vf-sc-register-planning',
  'vf-sc-register-survey-report',
  'vf-sc-workbench-after-filing',
];

/**
 * 需要假图层 overlay 的场景（harness/run-auto-verification.sh 调用）。
 * overlay 会重建 server 与 nginx，只在开发环境手工跑，不进 CI。
 */
export const LAYER_OVERLAY_SUITE: readonly string[] = [
  'vf-sc-auto-verify-land-empty-failed',
  'vf-sc-auto-verify-land-success',
  'vf-sc-auto-verify-land-partial',
  'vf-sc-auto-verify-land-duplicate',
  'vf-sc-auto-verify-mineral-success',
];
