# L2 语料驱动套件 · 交接

> 分支：`cursor/l2-phase2b-scale-e1-d09b`
> 状态：Phase 0–2b 抽样已合入 `dev`（#343/#344/#345）；本分支扩 E1 法域点 + 会办档。
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
| 合法出口词表 | `e2e/l2/vocabulary/legal-exits.json` |
| X5 Min/Target 配置 | `e2e/l2/config/x5-*.json`、`limits.json` |
| harness 能力盘点 | `e2e/l2/capability/harvest-capability.json` |
| verify 承接初稿 | `e2e/l2/succession/verify-inventory.md` |
| 机器闸 | `./dev lint l2` |
| Phase2 happy 根 | 21 条 `*-happy-register` |
| Phase2b 抽样 | E1/E2/E3 各 1（#345） |
| Phase2b-scale | E1 扩至四法域；land/survey/mineral/planning；+ `approval+consult` happy |
| 生成器 | `l2-gen-phase2-happy.mjs`、`l2-gen-phase2b-edges.mjs`、`l2-gen-phase2b-e1-scale.mjs` |

## 门禁

```bash
./dev lint l2
```

## 刻意未做

- **未宣称 Min**（用例 ~32，未进 40–60；未跑正式 X5 宣称闸）
- **未横铺 E2/E3**（仍各 1；能力 latent/missing）
- 未改产品业务代码；未把 API_SUITE 整包贴 L2
- 未引入外部抽检

## 下一步

1. Phase 3：缺口开票（ticketed）+ 复跑交叉校验
2. Phase 4：verify succession 清单推进（重建/退役标记）
3. E2/E3 待 wired|partial 后再横铺；达量级后再宣称 Min
