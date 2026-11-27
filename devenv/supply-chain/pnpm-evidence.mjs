#!/usr/bin/env node
// ============================================================================
// pnpm ndjson → 下载证据摘要（#64 新增包闭环的「未变更依赖零网络下载」核验）
//
// 输入：pnpm install --reporter=ndjson 的完整事件流（stdin）。
// 输出：单 JSON（stdout）：
//   - fetchedPackages：实际发起网络下载的包数（pnpm:fetching-progress/
//     status=started 的 packageId 去重）；0 = 零包内容下载。
//   - complete：流中是否出现 pnpm:summary（截断/无 reporter 时不得判通过）。
//   - errors：level=error/fatal 或 pnpm:error 的事件数。
//   - nonJsonLines：被忽略的非 JSON 行（lifecycle 脚本输出等）。
//   - lifecycleEvents：pnpm:lifecycle / pnpm:ignored-scripts 事件数（报告用）。
//
// 判定口径（与 docs/research/deps-cache-reuse.md 一致）：不用日志文本猜测，
// 只认结构化事件；证据缺失（complete=false）判「无法验收」，不默认通过。
// 本脚本只做摘要，不因 install 成功但无事件而失败（由运行器判定）。
// ============================================================================
import fs from 'node:fs'
import process from 'node:process'

let input = ''
try {
  input = fs.readFileSync(0, 'utf8')
} catch (e) {
  process.stderr.write(`[pnpm-evidence] 读取 stdin 失败：${e.message}\n`)
  process.exit(2)
}

const ids = new Set()
let complete = false
let errors = 0
let nonJsonLines = 0
let lifecycleEvents = 0
let events = 0

for (const line of input.split('\n')) {
  if (!line.trim()) continue
  let e
  try {
    e = JSON.parse(line)
  } catch {
    nonJsonLines++
    continue
  }
  events++
  if (e && e.name === 'pnpm:fetching-progress' && e.status === 'started' && e.packageId) {
    ids.add(String(e.packageId))
  }
  if (e && e.name === 'pnpm:summary') complete = true
  if (e && (e.level === 'error' || e.level === 'fatal' || e.name === 'pnpm:error')) errors++
  if (e && (e.name === 'pnpm:lifecycle' || e.name === 'pnpm:ignored-scripts')) lifecycleEvents++
}

const out = {
  version: 1,
  fetchedPackages: ids.size,
  fetchedIds: [...ids].sort(),
  resolved: null,
  complete,
  errors,
  nonJsonLines,
  lifecycleEvents,
  events,
}
process.stdout.write(JSON.stringify(out, null, 2) + '\n')