# verify 承接 / 退役清单（Phase 4 推进）

依据：`e2e/verify/harness/suites.ts` 与 `e2e/l2/succession/rebuild-map.json`。
**业务语料叙事以 L2 账为准。** `verify` 绿 ≠ 业务能力具备。

## 口径

| 口径 | 含义 |
|---|---|
| 业务主跑 | L2 ledger + `./dev lint l2` |
| L3 烟雾/负例 | `API_SUITE` 中未重建项与负例；可挡回归，不证业务真实 |
| 缺口跟踪 | `ledger/gaps` + [#347](https://github.com/bbhl79/natural-enforcement-prj/issues/347) |

## 收割（保留 harness 执行面）

| 资产 | 处置 |
|---|---|
| `harness/run-api-scenario.ts` / `oracle.ts` / `evidence.ts` | 收割为 L2 执行面候选 |
| `fixtures/case-profiles/` | 种子库；L2 lineage 指回 |
| 地名重映射 / API 驱动 | 过渡期共用 |

## 重建状态（摘要；权威见 `rebuild-map.json`）

| disposition | 含义 | 示例 |
|---|---|---|
| `rebuilt` | 已按 L2 规则重建并过 X*+面板 | survey/land 登记 happy |
| `pending-rebuild` | 仍有价值、待谱系重建 | land verify-dispatch |
| `gap-tracked` | L2 已记账+缺口；产品未具备 | mineral/planning 登记、E1/E2 latent、会办 |
| `l3-smoke` / `l3-negative` | 退出业务口径，留作 L3 | next-todo、neg-* |
| `l3-hold-unwired` | UNWIRED 禁直接承接 | filing/workbench |

## 退役门（本阶段已做）

- 文档与交接明确：**禁止**「verify 绿 = 业务真实」
- UNWIRED / 人话 oracle **不得**标「已承接」
- 机读映射：`rebuild-map.json`；lint 校验引用的 `l2CaseIds` 存在

## 刻意未做

- 未删除 `e2e/verify` 目录（执行面仍收割）
- 未改产品驱动把 UNWIRED 接进 API_SUITE
- 未宣称 Min / 未在 latent 上宣称能力具备
