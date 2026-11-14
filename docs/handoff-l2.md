# L2 语料驱动套件 · 交接

> 分支：`cursor/l2-phase4-succession-d09b`（叠 #346 → #348）
> 状态：Phase0–2b 抽样已合入 `dev`；scale/Phase3/Phase4 叠链推进。
> 定位：能力缺口发现；种子→发散；承接并最终替代 `e2e/verify`。

## 先读

1. `e2e/l2/README.md`
2. Project store `docs/l2-implementation-plan.md`
3. `e2e/l2/capability/harvest-capability.json`
4. `e2e/l2/succession/rebuild-map.json`
5. `tools/l2-lint.mjs`

## 本轮已完成

| 项 | 位置 |
|---|---|
| Phase0–2 / 2b 抽样 | #343/#344/#345 |
| Phase2b-scale (#346) | E1 四法域；`terminate-unfounded` / `consult-dissent` 独立能力 |
| Phase3 (#348) | 缺口 ticketed → #347；X5 报告仅 admit-ok + deferred 占比 |
| Phase4 (#350) | rebuild-map；X6 禁 rebuilt→unwired/latent/missing |

## 门禁

```bash
./dev lint l2
node tools/l2-report-x5.mjs
```

## 刻意未做

- **未宣称 Min**
- **未横铺 E2/E3**
- 未删 `e2e/verify`；未假接 UNWIRED

## 下一步

1. 叠链 CI 绿后合并 #346 → #348 → #350
2. 用例量到 40–60 再评估 Min 宣称
3. 产品接线后关 #347
