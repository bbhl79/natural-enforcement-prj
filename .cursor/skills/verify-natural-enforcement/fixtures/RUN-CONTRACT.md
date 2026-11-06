# 跑次证据与闭环契约

## 目录

`.run/verify-<runId>/`（根 `.gitignore` 已忽略 `.run/`）

```text
manifest.json
summary.json
steps/<scenarioId>/<nn>-<stepId>.json
evidence/<scenarioId>/...
```

## manifest.json

```json
{
  "runId": "20261105T120000Z-abcd",
  "startedAt": "…",
  "endedAt": null,
  "environment": "verify-local",
  "scenarios": ["vf-sc-register-survey-report"]
}
```

## step 记录

```json
{
  "scenarioId": "vf-sc-register-survey-report",
  "stepId": "submit",
  "pass": false,
  "expected": { "httpStatus": [200, 201] },
  "actual": { "httpStatus": 500, "bodySnippet": "…" },
  "evidence": ["evidence/vf-sc-register-survey-report/submit-response.json"]
}
```

## 结构化 oracle（机器可判）

Scenario 废止人话断言为主。`driver: "api"` 时使用：

```json
"oracle": {
  "kind": "machine",
  "assert": [
    { "path": "http.status", "op": "in", "value": [201] },
    { "path": "body.result", "op": "eq", "value": "registered" },
    { "path": "body.status", "op": "in", "value": ["in_pool", "pending_decision"] },
    { "path": "body.rules", "op": "includes", "value": "clue.narrative" }
  ]
}
```

| 字段 | 说明 |
| ---- | ---- |
| `path` | 点分路径，根为步骤观测：`http.status`、`body.*` |
| `op` | `eq` / `in` / `includes` / `gt` / `lt`（后两个只比有限数字） |
| `value` | 期望标量、列表（`in`）或成员（`includes` 对数组） |

Harness 对**该 scenario 最后一步**的观测评 `assert`；任一条失败则 step `pass: false`，summary `failed`。

负例绿 = 产品正确拒绝（如 400 + `rules` 命中），不是业务写入成功。

## summary.json

`passed` | `failed` | `blocked`（环境/登录不可用）。
`failed` 时列出失败 `scenarioId/stepId`。

## 闭环规则

1. 修复 Agent 必须以失败包为输入，不得要求人再贴截图。
2. 修复后必须用**同一 scenario 列表**再跑；未变绿不得宣称完成。
3. `latent` scenario 出现在跑批中只能记 `blocked`/`skipped`，不得记 `passed`。
4. Feature Map 选择器导致的失败：先改地图再改断言。
5. 故意改坏 oracle 或产品字段名 → 出红包 → 改回 → 同 scenario 再跑必须变绿。
