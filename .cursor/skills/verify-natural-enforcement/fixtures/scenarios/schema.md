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
| `featureMapRefs` | Feature Map 节点 id 数组，可空。uncovered 的 `featureMapRef` 取首元素；见 `../RUN-CONTRACT.md` |
| `steps` | 见下 |
| `oracle.assert` | 结构化断言；见 `../RUN-CONTRACT.md` |

## steps

| 字段 | 说明 |
| ---- | ---- |
| `action` | `register-clue`／`poll-verification`／`read-dispatch`／`read-side-effects`／`read-dispatch-buttons`／`retry-verification`／`decide`／`assign-org`／`assign-people` |
| `fromProfile` + `path` | register-clue 投影 profile 上的 `system` 对象 |
| `identityRef` | 本步登录身份；缺省沿用上一步 |
| `viewIdentityRef` | 读分派视图用的身份；写动作仍用 `identityRef`。未派机构时承办机构内勤读不到录入机构视图，可改用录入人。已派到该承办机构后，承办机构内勤自己能读。 |
| `idempotencyKey` | 可选；固定幂等键 |
| `mutate` | 可选：`omitValues`、`setValues`、`setConfirm`、`overrideSpatial`、`isolateSpatial` |
| `pollAttempts` / `pollIntervalMs` | poll-verification：次数（默认 10，上限 60）与间隔（默认 500ms） |
| `expectVerificationStatus` | poll-verification：收紧到 `done` 或 `failed` 才算过。缺省时 running 也算观测到 |
| `dispatchIdentityRef` / `listIdentityRef` | read-side-effects：另用该身份读分派视图或待分派列表 |
| `strictSteps` | scenario 级。为 true 时任一步失败则整条失败 |
| `decision` / `acknowledged` | decide：`dispatch`／`hold` 与已知晓 |
| `expectedStatus` | 写动作并发前置状态；缺省沿用上下文 |
| `orgUnitCode` | assign-org：按机构编码解析 id（如 `ORG-STATION-A`） |
| `orgUnitFrom` | assign-org：从分派视图取机构，目前支持 `assignment` |
| `mainFrom` / `assistFrom` | assign-people：按工号从候选解析主办／协办；`mainFrom` 缺省取第一人 |
| `matrix` | read-dispatch-buttons：每个身份直接读 `GET /api/clues/:id/dispatch`。核对 `http`、`reason`、`mayDecide`、`mayAssignOrg`、`mayAssignPeople`、`mayReassignOrg`。未写的开关不核，记为 uncovered `switch-unchecked`；见 `../RUN-CONTRACT.md`。 |
| `expectClueStatus` | read-dispatch-buttons：200 响应里的线索主状态 |
| `isolateSpatial` | register-clue 的 `mutate`。为 true 时按 `VERIFY_SPATIAL_SALT` 平移 `overrideSpatial`。同一跑次内相对位置不变。 |

多步链上下文：`register-clue` 成功后把响应 `body.id` 作为后续步骤的 `clueId`，把 `body.status` 作为 `expectedStatus` 缺省值。

负例 JSON 与 runnable 同形，存放于 `fixtures/negatives/`（`status: runnable`，`driver: api`，`kind: negative`）。

scenario 不写登录重试、换源、清库、改密或重启。
这些失败由 harness 记 `blocked` 并停止。
见 `../RUN-CONTRACT.md`。
