# verify 承接 / 退役初稿（Phase 0）

依据：`e2e/verify/harness/suites.ts` 与场景夹具。L2 承接后业务口径以 L2 账为准。

## 收割（保留 harness）

| 资产 | 处置 |
|---|---|
| `harness/run-api-scenario.ts` / `oracle.ts` / `evidence.ts` | 收割为 L2 执行面 |
| `fixtures/case-profiles/` | 种子库；L2 lineage 指回 |
| `API_SUITE` 登记/派发环 | 过渡期作 L3 回归；有价值者按 L2 规则重建 |

## 重建候选（须过 X6 + 面板）

| scenario | 备注 |
|---|---|
| `vf-sc-verify-loop-survey-register` | 已作 `L2-GAP-0` 谱系重建起点 |
| `vf-sc-verify-loop-land-register` | 后续 land happy |
| `vf-sc-verify-loop-land-verify-dispatch` | 派发环 |

## 降级纯 L3 / 禁业务口径

| 清单 | 原因 |
|---|---|
| `UNWIRED_SCENARIOS` 八条 | 驱动未接 + 人话 oracle，直接入会假绿 |
| latent 场景 | 产品能力未映射；可生成 L2 用例记缺口，不得标「已承接」 |

## 退役门（Phase 4）

未重建的作者 oracle 退出业务看板；文档禁止「verify 绿 = 业务真实」。
