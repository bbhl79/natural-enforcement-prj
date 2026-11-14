# L2 语料驱动套件 · 交接

> 分支：`cursor/l2-min-e1-wave-d09b`（基于 `origin/dev`）
> 状态：Phase0–4 已合入 `dev`；本波冲 Min（admit-ok ∈ [40,60]）。
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
| Phase0–4 | #343/#344/#345/#346/#348/#350 |
| Min-wave E1 | `tools/l2-gen-min-e1-wave.mjs`；+10 E1（无孪生种子）→ admit-ok **42** |
| X5 claimMin | `tools/l2-report-x5.mjs`：无 blocker 时 `claimMin=true` |

## 门禁

```bash
./dev lint l2
node tools/l2-report-x5.mjs
```

## 刻意未做

- **未横铺 E2/E3**（能力仍 latent/missing）
- 未冲 Target 120–200
- 未删 `e2e/verify`；未假接 UNWIRED

## 下一步

1. 产品接线后关 #347（filing-decline / terminate-unfounded 等 latent）
2. E2/E3 能力 wired/partial 后再横铺
3. 再评估 Target 矩阵发散
