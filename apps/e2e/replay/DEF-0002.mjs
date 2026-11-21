// PROTOTYPE（#13）— DEF-0002 复现脚本草案（spec 债务类：现象在 = 契约接受纯空白名）。
// 退出码 0 = 现象复现（201 接受）；1 = 未复现（契约已收紧——spec 债务已偿）。
const base = process.env.E2E_API_BASE_URL ?? 'http://e2e-api:3000'
const resp = await fetch(`${base}/enforcement-points`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: '   ', lat: 0, lng: 0 }),
})
const body = await resp.json().catch(() => ({}))
if (resp.status === 201 && typeof body.id === 'number') {
  console.error(`DEF-0002 现象复现：纯空白名被接受（201, id=${body.id}）——spec 债务在场`)
  process.exit(0)
}
console.error(`DEF-0002 未复现：status=${resp.status}（契约可能已收紧）`)
process.exit(1)
