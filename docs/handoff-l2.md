# L2 语料驱动套件 · 交接

> 分支：`cursor/l2-phase3-gaps-ticketed-d09b`（叠在 #346 Phase2b-scale 之上）
> 状态：Phase 0–2b 抽样已合入 `dev`；scale 扩 E1/会办；Phase 3 缺口已开票 #347。
> 定位：能力缺口发现；种子→发散；承接并最终替代 `e2e/verify`。

## 先读

1. `e2e/l2/README.md`
2. Project store `docs/l2-implementation-plan.md`
3. `e2e/l2/capability/harvest-capability.json`
4. `tools/l2-lint.mjs`

## 本轮已完成

| 项 | 位置 |
|---|---|
| Phase0–2 / 2b 抽样 | #343/#344/#345 |
| Phase2b-scale | E1 四法域 + consult-dissent；terminate 独立能力 |
| Phase3 | 缺口全部 `ticketed` → #347；`l2-report-x5.mjs`（仅 admit-ok；deferred 占比闸） |

## 门禁

```bash
./dev lint l2
node tools/l2-report-x5.mjs
```

## 刻意未做

- **未宣称 Min**（admit-ok 用例数未进 40–60）
- **未横铺 E2/E3**
- 未改产品业务代码

## 下一步

1. Phase 4 succession
2. 用例量补到 40–60 后再评估 Min 宣称
3. 产品接线后关 #347
