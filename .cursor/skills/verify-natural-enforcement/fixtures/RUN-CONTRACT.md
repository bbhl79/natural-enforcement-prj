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
`switch-unchecked` 按矩阵身份各报一条。by-design 确认过滤见下节 coverage-acks。
跨跑次 diff 键 = `kind+scenarioId+stepId+featureMapRef+identityRef`。

## discover 报告与 coverage-acks（发现器信号源 1，spec #322 T2）

### 跨跑次 diff 与基线（纯函数）

`harness/discover/diff-runs.ts` 是确定性纯函数，无 I/O：

| 函数 | 职责 |
| ---- | ---- |
| `selectBaseline(runs)` | 基线 = 最近一次入账（非 `blocked`）跑次。时间戳取 `endedAt`，缺省回退 `startedAt`。无入账跑次返回 `null` |
| `diffUncovered(baseline, current)` | 两份 `uncovered[]` 跨跑次 diff，产出 `{added, removed}`。`added` = 本跑次新增缺口；`removed` = 基线有、本跑次消失的缺口 |
| `filterAcked(items, acks)` | 过滤已确认 by-design 的缺口，见下 coverage-acks |

diff 键 = `kind+scenarioId+stepId+featureMapRef` 四元组。optional 字段缺省归一为空串，键稳定。`reason` 不进键。
基线为 `null`（首跑或无入账跑次）时，本跑次全部缺口入 `added`。

### diff 报告写口

`harness/discover/report.ts` 是 discover 报告唯一写口。
只写 `.run/discover/<runId>/diff-report.json`（根 `.gitignore` 已忽略 `.run/`）。
`<runId>` = 被 diff 的当前跑次 id。
写前校验目标路径必须在 `.run/` 下，越界抛错，不静默。
报告形态：

```json
{
  "runId": "20261105T120000Z-abcd",
  "baselineRunId": "20261104T120000Z-efgh",
  "added": [],
  "removed": []
}
```

`added`／`removed` 项 shape 同 `uncovered[]`，写前经 `filterAcked` 过滤已 ack 键。
验证期只写报告，不自动开票：不建 GitHub issue，不写提案出口。
信噪比达标后才开自动开票（spec #322 Q15），属后续票。

### coverage-acks（by-design 确认态）

`fixtures/coverage-acks.json` 是 by-design 确认清单，初始为空：

```json
{ "acks": [] }
```

确认权归 Lei Hu，代理只提案。代理不得自动写入 ack 值；落 ack 走人审 PR。
每条 ack 形状：

```json
{ "key": "nav.workbench.dispatch.buttons", "keyType": "feature-map-node" }
```

| 字段 | 说明 |
| ---- | ---- |
| `key` | 地图节点 id 或路由 |
| `keyType` | `feature-map-node`（地图节点）或 `route`（路由） |

过滤语义（`filterAcked`）：ack 必须同时写 `kind`、`scenarioId`、`key`，并且 `stepId` 与 `identityRef` 与缺口一致。
只写地图节点、不写步骤或身份的粗键不匹配任何缺口，并记入 `coarseAcksIgnored`。
命中精确 ack 的缺口不再出现在 diff 报告，`added` 与 `removed` 都过滤。
`route` 类 ack 不参与这份 uncovered 过滤。
无 `featureMapRef` 的缺口不被 ack 过滤。
真实 `fixtures/coverage-acks.json` 保持 `{ "acks": [] }`。代理不写入确认项。过滤行为只用测试夹具证明。

## 出处纪律校验（source-check，spec #322 二期 T7）

`harness/discover/source-check.ts` 是确定性纯函数，无 I/O：不写文件、不建 issue。
输入应然模型草案节点 `AssertedNode[]`，输出同序 `SourceCheckResult[]`。

| 输入字段 | 说明 |
| ---- | ---- |
| `nodeId` | 环节 id |
| `legalBasis` | 法规出处：`{ documentCode, articleNo }`，文件表编号 + 条款号（ADR 0019） |
| `roleBasis` | 角色依据：角色标签数组，对照 `fixtures/identities/` |

| 输出字段 | 说明 |
| ---- | ---- |
| `verdict` | `ok` 仅当字段齐并且 `authority.verified === true` 且指针非空。字段齐但未确认仍是 `pending-authority` |
| `fieldPresence` | `present` 或 `missing`。字段存在不等于权威已确认 |
| `authority` | `confirmed` 或 `unconfirmed` |
| `reason` | 人读：齐备条数，或缺失项（缺法规出处／缺条款号／缺角色依据） |
| `decisionTicket` | 待权威项的决策票草案，`labels` 恒为 `['needs-triage']`；`ok` 项为 `null` |

待权威节点只产决策票，不进实现方向（`admittedNodeIds` 只放行 `ok` 节点），不计入对账缺口。
开票由人按 `docs/agents/issue-tracker.md` 执行，发现器不自动开票。
草案模板与样例见 `../harness/discover/README.md` 与 `../harness/discover/asserted-model-draft.sample.md`。

## 闭环规则

1. 修复 Agent 必须以失败包为输入，不得要求人再贴截图。
2. 修复后必须用**同一 scenario 列表**再跑；未变绿不得宣称完成。
3. `latent` scenario 记未验证，不记环境 `blocked`，不提拔为 `runnable`，步骤本身不得记产品通过。
4. Feature Map 选择器导致的失败：先改地图再改断言。
5. 故意改坏 oracle 或产品字段名 → 出红包 → 改回 → 同 scenario 再跑必须变绿。
6. 认证失败、来源受限、传输不可达记 `blocked`。
7. `blocked` 的跑次不得入账。
8. 不得在同一次跑里遍历口令、更换来源、清 Redis、用 SQL 改密或重启进程后继续。
9. 业务步骤只消费已声明口令。
10. 业务步骤不改人员记录，不清锁定。
11. 登录已成功且产品要求更换口令时，只允许这一次产品更换。
12. 身份准备必须单独执行，并保留前后快照。见 `../harness/IDENTITY-PREP.md`。
