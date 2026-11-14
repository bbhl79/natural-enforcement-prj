# L2 语料驱动套件 · 交接

> 分支：`cursor/l2-phase0-gap0-d09b`
> 状态：Phase 0 规矩落地 + Phase 1 首切片 `L2-GAP-0` 准入账。
> 定位：能力缺口发现；种子→发散；承接并最终替代 `e2e/verify`。

## 先读

1. `e2e/l2/README.md`
2. Project store `docs/l2-implementation-plan.md` / `docs/l2-plan-review.md`
3. `e2e/l2/capability/harvest-capability.json`
4. `tools/l2-lint.mjs`

## 本轮已完成

| 项 | 位置 |
|---|---|
| 字段 schema | `e2e/l2/schema/*.schema.json` |
| 合法出口词表 | `e2e/l2/vocabulary/legal-exits.json`（含 `EXIT-REGISTERED` / `PROC-REGISTER`） |
| X5 Min/Target 配置 | `e2e/l2/config/x5-*.json`、`limits.json` |
| harness 能力盘点 | `e2e/l2/capability/harvest-capability.json` |
| verify 承接初稿 | `e2e/l2/succession/verify-inventory.md` |
| 机器闸 | `./dev lint l2` → `tools/l2-lint.mjs` + `tools/l2-lint.test.mjs` |
| X2b 负例 | `e2e/l2/fixtures/negatives/` |
| L2-GAP-0 | `ledger/cases/L2-CASE-vf-case-01-happy-register.json` + Oracle + 纪要 + 矩阵格 |

## 门禁

```bash
./dev lint l2
```

## 刻意未做

- 未宣称 Min；未横铺 E2/E3（能力盘点为 latent/missing）
- 未改产品业务代码；未把 API_SUITE 整包贴 L2
- 未引入外部抽检

## 下一步

1. Phase 2：其余种子 happy（先 land 登记环）
2. Phase 2b：E1–E3 仅在能力闸允许后横铺
3. 产品跑次接 harness 出缺口账
