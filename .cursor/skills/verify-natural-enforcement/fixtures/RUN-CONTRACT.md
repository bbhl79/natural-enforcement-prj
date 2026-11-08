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

`passed` | `failed` | `blocked`（认证失败、来源受限或传输不可达）。
`blocked` 不得改记为业务 `failed` 后继续。
`failed` 时列出失败 `scenarioId/stepId`。
summary 写出时挂 `uncovered[]`，见下节。

## uncovered[]（发现器信号源 1，spec #322 T1）

`summary.json` 增 `uncovered[]`：harness 从步骤记录机械推导的结构化缺口清单。
项禁人手写。它只增信息，不改 `status` 与 `failed`。
`passed`／`failed`／`blocked` 语义不变。`latent` 仍不得记 `passed`，`blocked` 不得改记。

项 shape：

```json
{
  "kind": "latent-skipped",
  "scenarioId": "vf-sc-latent-decision",
  "featureMapRef": "nav.case.validity",
  "reason": "scenario 状态=latent，期望 runnable，跳过未覆盖"
}
```

| 字段 | 说明 |
| ---- | ---- |
| `kind` | 缺口类别，枚举见下表 |
| `scenarioId` | 相关 scenario id，五类都带 |
| `stepId` | 步骤级缺口带（`step-skipped`／`switch-unchecked`）；场景级缺口省略 |
| `featureMapRef` | 取 scenario `featureMapRefs` 首元素（非空时）；空数组或无元数据则省略 |
| `reason` | harness 生成的简体中文说明，含触发缺口的观测值 |

`kind` 枚举与推导来源：

| kind | 触发条件 | 推导来源 |
| ---- | ---- | ---- |
| `latent-skipped` | scenario 非 runnable（latent 等）被跳过 | `skip` 记录 `expected.status=runnable` 且 `actual.status≠runnable` |
| `driver-mismatch` | scenario driver 非 api 被跳过 | `skip` 记录 `expected.driver=api` |
| `step-skipped` | 步骤自身跳过（如 decide 非 pending_decision） | 记录 `actual.note.skipped=true` 或 `actual.body.result=skipped` |
| `switch-unchecked` | read-dispatch-buttons 矩阵行省略开关 | scenario `steps[].matrix` 行未写的四个开关；按步骤聚合一条 |
| `scenario-not-run` | 应跑全集登记但本跑次无步骤记录 | `manifest.scenarios` 减实跑 `scenarioId` 集合 |

四个开关指 `mayDecide`／`mayAssignOrg`／`mayAssignPeople`／`mayReassignOrg`。
推导是确定性纯函数 `harness/discover/uncovered.ts`，无 I/O。
应跑全集取本跑次意图跑的集合 `manifest.scenarios`，不扫目录。
登记与实有漂移对账属后续票，不在 T1。
`switch-unchecked` 机械报告矩阵省略；by-design 确认过滤（coverage-acks）属 T2。
跨跑次 diff 键 = `kind+scenarioId+stepId+featureMapRef`，属 T2。

## 闭环规则

1. 修复 Agent 必须以失败包为输入，不得要求人再贴截图。
2. 修复后必须用**同一 scenario 列表**再跑；未变绿不得宣称完成。
3. `latent` scenario 出现在跑批中只能记 `blocked`/`skipped`，不得记 `passed`。
4. Feature Map 选择器导致的失败：先改地图再改断言。
5. 故意改坏 oracle 或产品字段名 → 出红包 → 改回 → 同 scenario 再跑必须变绿。
6. 认证失败、来源受限、传输不可达记 `blocked`。
7. `blocked` 的跑次不得入账。
8. 不得在同一次跑里遍历口令、更换来源、清 Redis、用 SQL 改密或重启进程后继续。
9. 业务步骤只消费已声明口令。
10. 业务步骤不改人员记录，不清锁定。
11. 登录已成功且产品要求更换口令时，只允许这一次产品更换。
12. 身份准备必须单独执行，并保留前后快照。见 `../harness/IDENTITY-PREP.md`。
