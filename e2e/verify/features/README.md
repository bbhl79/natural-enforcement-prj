# Feature Map

Verification Skill 的 **UI 导航说明书**（Lauren Tan）：功能层级、到达路径、快捷键、DOM 选择器。
让 Agent 按图操作，而不是在界面里瞎转。

## 文件

| 文件 | 用途 |
| ---- | ---- |
| `feature-map.md` | 主地图（初版可由 Agent 探索生成，人补强） |
| `maintenance.md` | 地图漂移时如何更新 |

## 与夹具关系

- Scenario 通过 `featureMapRefs` 挂到地图节点。
- 案卷 / case-profiles **不**替代 Feature Map；程序节点只用来核对地图是否漏能力。

## 选择器策略

1. 优先 `role` + accessible name / label。
2. 稳定 `data-testid`（若产品已挂）。
3. 脆弱 CSS/xpath 必须在条目上标 `fragile: true` 与风险说明。
