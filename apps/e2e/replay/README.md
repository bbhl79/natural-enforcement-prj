# replay/ — 零第三方依赖复现脚本（Spec-e2e §4）

每个已登记缺陷一个脚本 `replay/<DEF-NNNN>.mjs`，**随缺陷记录入库**（记录永不删除、
脚本永不删除）——这是缺陷的**长期重建依据**：证据产物有保留窗（#113），脚本没有。

`devenv e2e replay <ID>` 起隔离栈，在 per-run 执行器内执行记录里的 `replayCommand`
（约定形态 `node apps/e2e/replay/<ID>.mjs`）。执行器注入 `E2E_API_BASE_URL=http://api:3000`
（本 run 的 API，服务绑定见 `devenv/compose.e2e.yaml`）。

## 硬约定

1. **零第三方依赖**：只用 node 内建能力（`fetch` / `process` / `node:crypto` …）。
   不 import `@playwright/test`、不 import  workspace 包——脚本要能在任何未来的
   执行器镜像里裸跑，不随依赖升级而失效。
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

> 本目录当前无入库脚本：绿地无缺陷记录是合法状态。真实缺陷登记归 #109（report 实测
> 门禁）与 #117（毕业演练）；#108 验收用**临时**夹具脚本真跑两路（复现 / 语义反转），
> 跑完即删，不入仓库。