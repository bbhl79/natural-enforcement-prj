# discover（发现器，spec #322）

发现器把跑次证据转成结构化缺口。验证期只写报告，不自动开票。
契约细节见 `../fixtures/RUN-CONTRACT.md` 的 discover 小节。

## 模块与写边界

| 文件 | 职责 | I/O |
| ---- | ---- | ---- |
| `uncovered.ts` | 步骤记录 → `uncovered[]`（五类缺口） | 纯函数 |
| `diff-runs.ts` | 跨跑次 diff、基线选择、ack 过滤 | 纯函数 |
| `report.ts` | 唯一写口：`.run/discover/<runId>/diff-report.json` | 写文件 |
| `enumerate-capabilities.ts` | 静态枚举控制器、router、菜单、Feature Map | 纯函数 |
| `reconcile.ts` | 四环对账与 proposal 数据结构 | 纯函数 |
| `cluster-failures.ts` | 失败聚类与 GitHub 动作计划 | 纯函数 |
| `source-check.ts` | 应然节点出处校验（seam⑥） | 纯函数 |

只有 `report.ts` 可 import `node:fs` 与写文件。其余模块零 I/O，由
`integration/verify-discover-boundary.test.ts` 守卫。不得把写盘、开票或网络请求塞进纯函数模块。
写口拒绝 `runId` 路径穿越，也拒绝 `.run` 内指向外部的符号链接。
日常收口另写 `discover-report.json`。验证期仍不开票。
源码读取（含递归读取控制器子目录）在 `../discover-sources.ts`；证据读取在
`../load-failure-records.ts`；`gh` 动作在 `../apply-failure-clusters.ts`。

## 出处纪律（seam⑥，spec #322 Q13）

每条应然节点必须带两样东西：

1. 法规出处：法规标识（文件编号或法规名，至少一个）+ 条款号。与
   `.github/ISSUE_TEMPLATE/feedback.md` 的「法规名 + 条款号」字段口径一致；
   文件编号经 ADR 0019 文件表解析，法规名只作人读副本。
2. 角色依据：角色标签，对照 `fixtures/identities/`。

缺任一即 `pending-authority`（待权威）：

- 只产决策票草案，`labels` 恒为 `['needs-triage']`；开票由人按 `docs/agents/issue-tracker.md` 执行；
- 不进实现方向：`admittedNodeIds(results)` 只放行 `ok` 节点；
- 不计入对账缺口。

`checkNodeSources(nodes)` 输入 `AssertedNode[]`，输出同序 `SourceCheckResult[]`：

| 字段 | 说明 |
| ---- | ---- |
| `nodeId` | 环节 id |
| `verdict` | `ok` 或 `pending-authority` |
| `reason` | 人读：齐备条数，或缺失项（缺法规出处／缺法规标识／缺条款号／缺角色依据） |
| `decisionTicket` | 待权威项的决策票草案；`ok` 项恒为 `null` |

客观/主观两通道按有无权威出处分流，不按比例预设。

## 标准推导器（文档流程，非代码自动化）

标准推导器回答「系统应有的环节、每环节输入产出、环节间协作关系从哪来」。
推导权放开，钉死权在人：推导产出应然模型草案，主管批准后才落 profiles `stages` 与 feature map。

流程：

1. 法规查证：按 `docs/research/` 既有格式收集文件与条款，出处写法规标识（文件编号或法规名）+ 条款号。
2. 角色群体分析：对照 `fixtures/identities/` 的角色与机构，写每环节角色依据。
3. 填下表，每个环节一行；缺出处不删环节，标待权威。
4. 自检：用 `checkNodeSources` 逐节点校验，待权威节点整理成决策票要点。
5. 提案：由人或上层流程开 issue（草案 + 决策票）；方案经人审 PR 后才进 fixtures 与地图。

### 应然模型草案模板

| 环节 | 输入 | 产出 | 协作关系 | 法规出处链 | 角色依据 | 状态 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| 环节 id 与名称 | 上游交付物 | 本环节交付物 | 上下游与呈批链 | 法规标识（文件编号或法规名）+ 条款号，逐条列 | 角色标签 + identity id | `待主管钉死` 或 `已批准（票号）` |

规则：

- 状态只有两种，默认 `待主管钉死`；未批准草案一律标「等权威」，不进对账缺口。
- 出处链每条写「法规标识 + 条款号」；有文件编号时法规名经文件表解析，避免自由文本漂移。
- 角色依据写角色标签，并注明对照的 identity id；无身份夹具的写「试用组织外部角色」。
- 无法规出处的环节保留并标待权威，只产决策票，不进实现方向。

样例（格式演示，未批准）：[`asserted-model-draft.sample.md`](asserted-model-draft.sample.md)。

## 能力枚举与四环对账

- 控制器：递归读取 `backend/server/src/**/*.controller.ts`，再按 `app.module.ts`
  的 `controllers:` 注册项过滤；未注册文件不计能力。
- UI 能力：router 页面路由 + 菜单一级/二级入口。`frontend/src/router.tsx` 的 path
  不含 query（测试锁定）；query 只出现在菜单与地图的视图键，按基路径归一后与路由同键。
- 「等权威」：由 `checkNodeSources` / `admittedNodeIds` 判定；待权威节点不进实现方向，
  也不计对账缺口（`reconcile.ts` 只消费 `assertedNodes` 的判定结果，不另设键表）。
- API 双向：scenario → 端点已判（`ACTION_ENDPOINTS` 与 runStep 分派字面量由测试对齐）。
  端点 → scenario 方向只对 `register.mappedEndpoints` 显式登记的标准链端点产
  `api-uncovered` 提案；184 条全量 route→scenario 缺覆盖不入提案（多数为内部接口，
  全量产票会压垮信噪比，Q15）。
- runnable 能力消失：地图节点不存在、action 端点不存在、或节点 UI 路由/菜单不在能力清单
  均产 `runnable-regression` 提案。UI 输入为空表示无数据，不判 UI 消失（避免误报）。
- 提案只是内存数据；不建 issue、不改地图/fixtures、不写盘。

## 失败聚类票 marker

人工票（如 #319）要参与同键归并，票体必须带 marker：

```html
<!-- verify-failure-key: KEY -->
```

`KEY` 为 `JSON.stringify([scenarioId, stepId, failureKind])`。计划器只匹配该 marker：
同键有开放票则评论补证据，同键仅关闭票则重开最近一张；无 marker 的人工票不触碰，
聚类另立一张 `needs-triage` 新票（不解析中文正文）。
