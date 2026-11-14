# L2 · 语料驱动用例与 Oracle（能力缺口发现）

L2 从约 21 份种子卷宗**生成**用例与 Oracle，目的是发现产品能力缺口，不是证明 runtime ≡ 卷宗。

权威定位与闭阻补丁见 Project store：`docs/l2-implementation-plan.md`（会话落点）。本目录是仓库内可机检落地。

## 目录

| 路径 | 作用 |
|---|---|
| `schema/` | §2.1 字段级 JSON Schema |
| `vocabulary/legal-exits.json` | §1.4 合法出口 / PROC·STATE 白名单 |
| `config/x5-*.json` | §8.3 Min/Target 必选单元格 |
| `capability/harvest-capability.json` | §5.1 harness 能力盘点 |
| `succession/verify-inventory.md` | verify 承接/退役初稿 |
| `ledger/` | 已准入用例、Oracle、缺口、矩阵格、面板纪要 |
| `fixtures/negatives/` | X2b 故意非法夹具 |

## 门禁

```bash
./dev lint l2
```

机器闸：合法词表、schema、X1–X4 / X2b / X5b 骨架、Mock 占比、纪要准入。产品跑次红记缺口，不挡本 lint。

## 首切片与 Phase 2

- Phase 1：`L2-GAP-0` 登记 happy（已合入 `dev`）。
- Phase 2：21 种子登记 happy 根（`L2-CASE-*-happy-register`）；mineral/planning 为 `unwired` 并记缺口。
- Phase 2b（NELC-14）：E1/E2/E3 **各 1 条**抽样；E2/E3 能力仍 latent/missing，**不横铺**。
- Phase 2b-scale：E1 扩至四法域；补 `approval+consult` 会办档；仍 **不横铺 E2/E3**、**不宣称 Min**。
- Phase 3：缺口 `ticketed` → [#347](https://github.com/bbhl79/natural-enforcement-prj/issues/347)；`node tools/l2-report-x5.mjs`（仅 admit-ok）。
