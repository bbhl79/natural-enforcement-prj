# replay/ — 零第三方依赖复现脚本（Spec-e2e §4）

每个已登记缺陷一个脚本 `replay/<DEF-NNNN>.mjs`，**随缺陷记录入库**（记录永不删除、
脚本永不删除）——这是缺陷的**长期重建依据**：证据产物有保留窗（#113），脚本没有。

`devenv e2e replay <ID>` 起隔离栈，在 per-run 执行器内执行记录里的 `replayCommand`
（约定形态 `node apps/e2e/replay/<ID>.mjs`）。执行器注入 `E2E_API_BASE_URL=http://api:3000`
（本 run 的 API，服务绑定见 `devenv/compose.e2e.yaml`）。

## 硬约定

1. **零第三方依赖**：只用 node 内建能力（`fetch` / `process` / `node:crypto` …）。
   不 import `@playwright/test`、不 import workspace 包——脚本要能在任何未来的
   执行器镜像里裸跑，不随依赖升级而失效。
   **例外（#109，pure 路径白盒）**：`reproducibility.kind=pure` 且被测路径就是**共享包
   导出的纯函数/schema** 时（Spec-e2e §1 允许的白盒复现），import 该被测包本身是复现的
   一部分，不算第三方依赖；此时脚本随该包的导出面演进而维护。依赖外部状态/API 的脚本
   （`kind=external-state`）仍严格只用 node 内建能力。
2. **退出码**：`0` = 复现（缺陷在场）；`1` = 未复现（语义反转：环境漂移或已修复）；
   `2` = 基础设施错误（连接失败/超时/服务不健康——**路径根本没被行使**，不是未复现）。
3. **失败输出约定（签名可机械提取）**：无论复现与否，在 **stdout** 打**一行**

   ```
   NE-E2E-SIGNATURE {"schemaVersion":1,"assertionId":"<稳定断言标识>","errorClass":"assertion|infrastructure|locator|unknown","outcome":"reproduced|not-reproduced|unknown","semanticMarkers":[{"key":"<语义维度>","value":"<规范化取值>"}]}
   ```

   - `assertionId`：作者选定的**稳定结构标识**（如 `post-enforcement-points.whitespace-name`）。
     不含消息措辞、不含行号——合法重构不得让它漂移。
   - `semanticMarkers`：只放**关键语义维度**，不放完整响应体或错误消息文本。
     常用 key：`http.status.expected` / `http.status.actual` / `body.id` / `error.code`。
   - **复现时**标记承载缺陷的语义取值（供门禁逐轮比对「同一断言处因同一原因失败」）；
     **未复现时**承载实际观测值（比对不符即语义反转，`devenv e2e replay` 据此 exit 4
     并提示「环境漂移或已修复？」）。
   - 多条标记取**最后一条**（脚本终态）。不打标记也合法（旧式裸退出码脚本仍可单轮
     诊断），但**多轮重放无法机器判定同一原因** → exit 4。
4. **每轮独立键空间**：replay 会写数据。`devenv e2e replay --attempts N` 每轮一个独立
   run（独立库/bucket/队列 + 幂等重建 + migrate），所以脚本**可以用固定业务标识**；
   但不要依赖「上一次 attempt 留下的数据」——每轮前置状态都是明确的空库。
   故意验证幂等/唯一约束的脚本除外（那类断言本身就要复用同一标识）。
5. **地理背景**：坐标/地名一律广州（如 `lat: 23.1291, lng: 113.2644`）。

## 模板

```js
// defect: DEF-NNNN（标题与事实源记录一致）
// 零第三方依赖；exit 0=复现 / 1=未复现 / 2=基础设施错误
const base = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3000'
const AID = 'post-enforcement-points.whitespace-name'
const mark = (errorClass, outcome, markers) =>
  console.log('NE-E2E-SIGNATURE ' + JSON.stringify({
    schemaVersion: 1, assertionId: AID, errorClass, outcome, semanticMarkers: markers,
  }))

let resp, body
try {
  resp = await fetch(`${base}/enforcement-points`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '   ', lat: 23.1291, lng: 113.2644 }),
  })
  body = await resp.json().catch(() => ({}))
} catch (e) {
  mark('infrastructure', 'unknown', [{ key: 'error.code', value: String(e?.cause?.code ?? 'FETCH_FAILED') }])
  process.exit(2)
}

const reproduced = resp.status === 201 && typeof body.id === 'number'
mark('assertion', reproduced ? 'reproduced' : 'not-reproduced', [
  { key: 'http.status.expected', value: '201' },
  { key: 'http.status.actual', value: String(resp.status) },
  { key: 'body.id', value: typeof body.id },
])
process.exit(reproduced ? 0 : 1)
```

## 签名模型与比对（#109 门禁 / #112 CI 共用）

签名 = **错误类别 + 断言标识 + 关键语义标记**，不绑定完整消息文本。提取器与比对
原语在 `apps/e2e/src/signature/`（纯函数库、零基础设施单测）；错误类别四档：
`infrastructure`（直接红）/ `locator`（红 + 需人判断 UI 改版还是缺陷）/ `assertion`
（普通断言失败）/ `unknown`（证据不足以分类，保守档不得判绿）。

命令面与退出码场景见 `devenv/COMMANDS.md`「e2e replay 重放与失败签名原语（#108）」；
决策与已声明差距见 `docs/adr/2026-11-28-23-00-replay重放与失败签名原语.md`。

## 入库脚本

- **`DEF-0001.mjs`**（#109 登记，dev 首条入库缺陷记录）：点位名称纯空白被接受入库
  （契约 nonblank 规则缺席；原型 DEF-0002 同类 spec 债务，dev 未收紧）。
  `kind=external-state`，门禁 3 轮独立键空间实测通过，签名逐轮一致。
  发现由 #107 缺口探针 `GAP-PT-NAME-01` 产出（seed=1590727704，收缩后最小反例 `" "`）。
  它是下游 #110（毕业转写）/#112（CI 预期失败判定）/#116（校验器）/#117（演练）的稳定夹具。
  `devenv e2e replay DEF-0001 --attempts 3` 可随时复核。

登记入口是 `devenv e2e report --finding <file.json>`（#109）：门禁由命令**实测**回填
`reproducibility.gate`（轮次/键空间/逐轮签名比对/前置状态声明），**非自查申报**；
门禁不过 exit 8、**零登记**。输入契约、门禁分类与并发缺陷保留触发时序的约定见
`devenv/COMMANDS.md`「e2e report 实测复现门禁与缺陷登记（#109）」；决策见
`docs/adr/2026-11-28-23-59-report实测复现门禁与缺陷登记.md`。

> 验收夹具（#108/#109 冒烟）用**临时**载荷真跑，跑完即删、不入仓库；「记录永不删除」
> 的不变量锚在**已入库**记录与 git 历史（Spec-e2e §3）。