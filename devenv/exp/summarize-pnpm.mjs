#!/usr/bin/env node
// 实验工具（#54）：把 pnpm --reporter=ndjson 事件流归纳成一行机器可读证据。
// 用法：pnpm install ... --reporter=ndjson 2>&1 | node summarize-pnpm.mjs
// 输出：EVIDENCE <json>（stdout 一行；不含包管理器日志格式解析之外的推断）
//
// 关键口径（Spec-工程基座 §强制验收 8）：未变更依赖的包内容是否**命中本地存储**、
// 是否**重新进行网络下载**。pnpm 对每个实际下载的包发出 pnpm:fetching-progress
// （status=started，含 packageId/size）；命中 store 的包不发该事件，只发
// pnpm:progress（status=resolved/imported）。因此：
//   fetchedPackages == 0  ⇒ 本次 install 未发起任何包内容下载。
// 版本/安全元数据查询不在 fetching-progress 事件内，允许联网（见 SPEC 口径）。
import fs from 'node:fs'

/**
 * @param {string} raw ndjson 文本
 * @returns {{
 *   fetchedPackages: number, fetchedBytes: number, fetchedIds: string[],
 *   fetchedSample: string[], imported: Record<string, number>,
 *   resolved: number, executionMs: number|null, events: number,
 *   parseErrors: number
 * }}
 */
export function summarize(raw) {
  const fetchedIds = new Set()
  let fetchedBytes = 0
  let resolved = 0
  let executionMs = null
  let startedAt = null
  let endedAt = null
  let events = 0
  let parseErrors = 0
  let hasSummary = false
  const errors = []
  const scripts = new Map() // `${depPath}|${stage}` -> {dep, stage, exitCode}
  const imported = {}

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let e
    try {
      e = JSON.parse(line)
    } catch {
      parseErrors += 1
      continue
    }
    events += 1
    if (e.level === 'error') errors.push(e.code ?? 'UNKNOWN')
    if (e.name === 'pnpm:summary') hasSummary = true
    if (e.name === 'pnpm:lifecycle' && e.depPath && e.stage) {
      const key = `${e.depPath}|${e.stage}`
      const entry = scripts.get(key) ?? { dep: e.depPath, stage: e.stage, exitCode: null }
      if (Number.isInteger(e.exitCode)) entry.exitCode = e.exitCode
      scripts.set(key, entry)
    }
    if (e.name === 'pnpm:fetching-progress' && e.status === 'started' && e.packageId) {
      if (!fetchedIds.has(e.packageId)) {
        fetchedIds.add(e.packageId)
        fetchedBytes += Number.isFinite(e.size) ? e.size : 0
      }
    } else if (e.name === 'pnpm:progress' && e.status === 'imported') {
      imported[e.method ?? 'unknown'] = (imported[e.method ?? 'unknown'] ?? 0) + 1
    } else if (e.name === 'pnpm:progress' && e.status === 'resolved') {
      resolved += 1
    } else if (e.name === 'pnpm:execution-time' && Number.isFinite(e.startedAt) && Number.isFinite(e.endedAt)) {
      executionMs = e.endedAt - e.startedAt
      startedAt = e.startedAt
      endedAt = e.endedAt
    }
  }

  const lifecycleScripts = [...scripts.values()]

  // 判定顺序即防“静默通过”：只有流完整、无错误、零下载、且无脚本执行才是 zero-download。
  // 脚本（如 @prisma/engines postinstall）可在 pnpm 记账之外联网，零下载+脚本执行须另证。
  let verdict
  if (events === 0) verdict = 'no-evidence'
  else if (errors.length > 0) verdict = 'failed'
  else if (!hasSummary || executionMs === null) verdict = 'incomplete'
  else if (fetchedIds.size > 0) verdict = 'downloaded'
  else if (lifecycleScripts.length > 0) verdict = 'zero-fetch-scripts-ran'
  else verdict = 'zero-download'

  const ids = [...fetchedIds]
  return {
    verdict,
    errors,
    lifecycleScripts,
    fetchedPackages: ids.length,
    fetchedBytes,
    fetchedIds: ids,
    fetchedSample: ids.slice(0, 20),
    imported,
    resolved,
    executionMs,
    startedAt,
    endedAt,
    events,
    parseErrors,
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (isMain) {
  // 可选 argv[2] = 阶段标签（lockgen / deps）。--target deps 构建时两个阶段都会打印 EVIDENCE 行，
  // 带标签后消费方按 stage 选取，而不是取“最后一行”。
  const stage = process.argv[2]
  const summary = summarize(fs.readFileSync(0, 'utf8'))
  process.stdout.write(`EVIDENCE ${JSON.stringify(stage ? { stage, ...summary } : summary)}\n`)
}