# case-profiles

飞书案卷是**终局成功种子**。本目录在种子之上做脱敏广州化，并按《自然资源违法行为立案查处工作规程（试行）》发散中间过程与特殊出口。

## 两类文件

| role | 命名 | 含义 |
| ---- | ---- | ---- |
| `canonical` | `vf-case-NN-<slug>.json` | 终局成功样板，含完整 `processEvents`（呈批/会办/法审等） |
| `variant` | `vf-case-NN-<slug>.<branch>.json` | 改一条规程主分支；`derivedFrom` + `procedureRef` |

字段约定见 [`schema.md`](schema.md)。清单见 [`index.json`](index.json)。

## 已加深家族（本轮）

- `vf-case-01-map-review-missing` + 分支：`suspend-resume`、`no-filing`、`legal-review-reject-then-pass`、`hearing-then-adjust`
- `vf-case-02-occupy-without-approval` + 分支：`suspend-resume`、`no-filing`、`terminate-unfounded`、`hearing-then-adjust`、`consult-dissent-then-pass`

其余 `vf-case-03`…`21` 仍为薄 canonical，待按同一模式铺开。

原文缓存：`e2e/results/verify-case-seeds/`（不进 git）。
