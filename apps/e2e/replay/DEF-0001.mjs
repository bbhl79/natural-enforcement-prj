// PROTOTYPE（#13）— DEF-0001 复现脚本草案（缺陷记录 replayCommand 的落地形态；零第三方依赖）。
// 约定：在 e2e 容器内执行（E2E_API_BASE_URL 注入隔离栈）；退出码 0 = 缺陷复现（5xx），1 = 未复现。
const base = process.env.E2E_API_BASE_URL ?? 'http://e2e-api:3000'
const resp = await fetch(`${base}/enforcement-points`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'a\0b', lat: 0, lng: 0 }),
})
if (resp.status >= 500) {
  console.error(`DEF-0001 复现：POST /enforcement-points（name 含 NUL）→ ${resp.status}`)
  process.exit(0)
}
console.error(`DEF-0001 未复现：status=${resp.status}（可能已修复——确认后走 confirm-fix）`)
process.exit(1)
