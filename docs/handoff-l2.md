# L2 语料驱动套件 · 交接

> 分支：`cursor/l2-phase2b-edge-samples-d09b`
> 状态：Phase 0–2 已合入 `dev`（#343/#344）；Phase 2b（NELC-14）E1/E2/E3 各 1 条抽样。
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
| L2-GAP-0 及 Phase2 happy 根 | `ledger/cases/L2-CASE-*-happy-register.json`（21 条） |
| mineral/planning 缺口 | `ledger/gaps/*-register-unwired.json` |
| 生成器 | `tools/l2-gen-phase2-happy.mjs`、`tools/l2-gen-phase2b-edges.mjs` |
| Phase2b 边界抽样 | E1 no-filing / E2 suspend-resume / E3 reassign 各 1；缺口 latent/missing |

## 门禁

```bash
./dev lint l2
```

## 刻意未做

- **未宣称 Min**（X5 阈值未跑通；用例量未达 Min 档）
- **未横铺** E2/E3（仍各 1 条；X5b scaleGate）
- 未改产品业务代码；未把 API_SUITE 整包贴 L2
- 未引入外部抽检

## 下一步

1. 产品跑次接 harness；关闭/开票缺口
2. E1 按法域谨慎扩展（E2/E3 待 wired|partial）
3. 达 X5 后再宣称 Min
