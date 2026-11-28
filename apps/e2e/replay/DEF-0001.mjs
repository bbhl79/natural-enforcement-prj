// defect: DEF-0001
// 点位名称纯空白被接受入库（契约 nonblank 规则缺席）。
//
// 缺陷：POST /enforcement-points 接受 name="   "（纯空白）并入库，返回 201 + 数字 id。
// 契约 nameSchema 只有 min(1)/max(200)/regex 排除 U+0000，无 trim/nonblank；对照证据
// 展示名 validateOriginalName **有**纯空白拒绝——两模块口径不一致。原型 DEF-0002 同类
// spec 债务（原型内走退役出口留档），dev 至今未收紧；是否收紧契约属业务决策。
//
// 零第三方依赖（node 内建 fetch）；退出码约定：**0=复现 / 1=未复现 / 2=基础设施错误**。
// 失败输出约定（#108）：stdout 一行 `NE-E2E-SIGNATURE <compact JSON>`，只放语义维度
// （http.status.expected = 规则要求的取值；http.status.actual = 实际观测），不放消息文本。
// 修复后语义自动反转：契约收紧 → actual=400 → 签名不符 → exit 1（走 confirm-fix 确认）。
//
// 门禁前置状态（每轮独立键空间）：空库 + migrate deploy + 空 bucket + 空队列，无种子数据；
// 固定纯空白名（#107 收缩后最小反例 " "）在该轮库内不存在，故 name 唯一约束不撞（同库重复重放会 409 伪装成未复现）。
// 坐标用广州（市政府一带），与项目地理背景一致。
const base = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3000'
const AID = 'post-enforcement-points.whitespace-name'
const mark = (errorClass, outcome, markers) =>
  console.log('NE-E2E-SIGNATURE ' + JSON.stringify({
    schemaVersion: 1, assertionId: AID, errorClass, outcome, semanticMarkers: markers,
  }))

let resp
let body
try {
  resp = await fetch(`${base}/enforcement-points`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: ' ', lat: 23.1291, lng: 113.2644 }),
  })
  body = await resp.json().catch(() => ({}))
} catch (e) {
  // 连接失败/超时/服务不健康 = 基础设施档，**不是**「未复现」
  mark('infrastructure', 'unknown', [
    { key: 'error.code', value: String(e?.cause?.code ?? 'FETCH_FAILED') },
  ])
  process.exit(2)
}

// 规则要求：纯空白名应被契约拒绝（400）。实际 201 + 数字 id = 规则缺席，缺陷复现。
const reproduced = resp.status === 201 && typeof body.id === 'number'
mark('assertion', reproduced ? 'reproduced' : 'not-reproduced', [
  { key: 'http.status.expected', value: '400' },
  { key: 'http.status.actual', value: String(resp.status) },
  { key: 'body.id', value: typeof body.id },
])
process.exit(reproduced ? 0 : 1)