# scenario 字段说明

## 对象形状（摘要）

```json
{
  "id": "vf-sc-verify-loop-land-register",
  "status": "runnable",
  "driver": "api",
  "kind": "happy",
  "title": "土地巡查登记（Verification 环 happy）",
  "profileRefs": ["vf-case-02-occupy-without-approval"],
  "identityRefs": ["clerk-a"],
  "featureMapRefs": [],
  "steps": [
    {
      "id": "register",
      "action": "register-clue",
      "fromProfile": "vf-case-02-occupy-without-approval",
      "path": "stages.register.system",
      "identityRef": "clerk-a"
    }
  ],
  "oracle": {
    "kind": "machine",
    "assert": [
      { "path": "http.status", "op": "in", "value": [200, 201] },
      { "path": "body.result", "op": "eq", "value": "registered" }
    ]
  }
}
```

## 字段

| 字段 | 说明 |
| ---- | ---- |
| `status` | `runnable` / `latent` |
| `driver` | `api`（本轮 Verification 环）或省略（旧 UI 向；本轮 harness 只跑 `api`） |
| `kind` | `happy` / `negative` / 省略 |
| `profileRefs` | case-profile id |
| `identityRefs` | identities id |
| `steps` | 见下 |
| `oracle.assert` | 结构化断言；见 `../RUN-CONTRACT.md` |

## steps

| 字段 | 说明 |
| ---- | ---- |
| `action` | 本轮 API harness：`register-clue`（登录隐式） |
| `fromProfile` + `path` | 投影 profile 上的 `system` 对象 |
| `identityRef` | 覆盖默认登记身份 |
| `idempotencyKey` | 可选；固定幂等键 |
| `mutate` | 可选：`omitValues`、`setValues`、`setConfirm`、`overrideSpatial` |

负例 JSON 与 runnable 同形，存放于 `fixtures/negatives/`（`status: runnable`，`driver: api`，`kind: negative`）。
