# discover（发现器，spec #322）

发现器把跑次证据转成结构化缺口。验证期只写报告，不自动开票。
契约细节见 `../fixtures/RUN-CONTRACT.md` 的 discover 小节。

## 模块与写边界

| 文件 | 职责 | I/O |
| ---- | ---- | ---- |
| `uncovered.ts` | 步骤记录 → `uncovered[]`（五类缺口） | 纯函数 |
| `diff-runs.ts` | 跨跑次 diff、基线选择、ack 过滤 | 纯函数 |
| `report.ts` | 唯一写口：`.run/discover/<runId>/diff-report.json` | 写文件 |
| `source-check.ts` | 应然节点出处校验（seam⑥） | 纯函数 |

只有 `report.ts` 可 import `node:fs` 与写文件。其余模块零 I/O，由
`integration/verify-discover-boundary.test.ts` 守卫。不得把写盘、开票或网络请求塞进纯函数模块。

## 出处纪律（seam⑥，spec #322 Q13）

每条应然节点必须带两样东西：

1. 法规出处：文件表编号 + 条款号（ADR 0019，法规名由文件表解析，不写自由文本）。
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
| `reason` | 人读：齐备条数，或缺失项（缺法规出处／缺条款号／缺角色依据） |
| `decisionTicket` | 待权威项的决策票草案；`ok` 项恒为 `null` |

客观/主观两通道按有无权威出处分流，不按比例预设。

## 标准推导器（文档流程，非代码自动化）

标准推导器回答「系统应有的环节、每环节输入产出、环节间协作关系从哪来」。
推导权放开，钉死权在人：推导产出应然模型草案，主管批准后才落 profiles `stages` 与 feature map。

流程：

1. 法规查证：按 `docs/research/` 既有格式收集文件与条款，出处只写文件编号 + 条款号。
2. 角色群体分析：对照 `fixtures/identities/` 的角色与机构，写每环节角色依据。
3. 填下表，每个环节一行；缺出处不删环节，标待权威。
4. 自检：用 `checkNodeSources` 逐节点校验，待权威节点整理成决策票要点。
5. 提案：由人或上层流程开 issue（草案 + 决策票）；方案经人审 PR 后才进 fixtures 与地图。

### 应然模型草案模板

| 环节 | 输入 | 产出 | 协作关系 | 法规出处链 | 角色依据 | 状态 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| 环节 id 与名称 | 上游交付物 | 本环节交付物 | 上下游与呈批链 | 文件编号 + 条款号，逐条列 | 角色标签 + identity id | `待主管钉死` 或 `已批准（票号）` |

规则：

- 状态只有两种，默认 `待主管钉死`；未批准草案一律标「等权威」，不进对账缺口。
- 出处链每条写「文件编号 + 条款号」；法规名经文件表解析，避免自由文本漂移。
- 角色依据写角色标签，并注明对照的 identity id；无身份夹具的写「试用组织外部角色」。
- 无法规出处的环节保留并标待权威，只产决策票，不进实现方向。

样例（格式演示，未批准）：[`asserted-model-draft.sample.md`](asserted-model-draft.sample.md)。
