// 生命周期 CLI（#106；Spec-e2e §10）——**纯决策引擎**：
//   - 宿主树经 stdin tar 只读进容器（--root 指向解包目录），本进程不落盘；
//   - 查询数据走协议通道（容器 stdout，宿主转发给调用者）；
//   - 写盘/删文件/校验运行以 op 行协议输出（W/D/V），由 devenv 宿主侧原子应用；
//   - 每次调用恰一行 END 终值（最后输出），退出码与 END 的 code 一致。
// 退出码：0 成功 | 2 用法/输入契约 | 8 门禁未过或前置不符（#109 report）|
//   10 缺陷不存在或 schema 不符（7/9 由 #116 校验器 / #110 毕业校验判定）。
// 后续票（#110 graduate / #116 retire·renumber·verify）在本骨架上追加子命令；
// 未知子命令一律用法错误 2。
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { minGateAttempts, type DefectRecord } from './defect/schema.js'
import { nextDefectId, type NextDefectId } from './numbering.js'
import { emit, end, human, type OpSink } from './ops.js'
import { REGISTRY_FILE, rebuildRegistry, registryDrifted } from './registry.js'
import { extractPropertyFinding, normalizeReportFinding } from './report/finding.js'
import { judgeGate, GateRoundInputSchema } from './report/gate.js'
import { buildReportRecord, resolveReplayCommand } from './report/record.js'
import { compareSignatureSet } from './signature/compare.js'
import { extractPlaywrightSignatures, extractReplaySignature } from './signature/extract.js'
import { FailureSignatureSchema, type FailureSignature } from './signature/model.js'
import { loadTree, replayRel, defectJsonRel, type DefectTree } from './tree.js'
import { z } from 'zod'

const USAGE = `用法：cli [--root DIR] [--json] <子命令>…
  defect list                 缺陷清单（事实源 apps/e2e/defects/*.json）
  defect show <DEF-NNNN>      缺陷摘要 + 证据 URI
  next-id [--remote-max N]    DEF-NNNN 取号（本地 max+1，可叠读远端已有编号）
  registry rebuild            重建注册表（派生缓存，始终重建；漂移仅 WARN）
  replay-plan <DEF-NNNN>      重放计划（CMD/KIND/ATTEMPTS/SCRIPT/TITLE 数据行）
  signature extract --source <replay|playwright>
                              失败签名提取（载荷走 stdin；结果单行 JSON）
  signature compare           多轮签名比对（stdin {baseline,candidates}；#109/#112 共用）
  report finding-from-results [--property NAME]
                              从 Playwright results.json 提取属性发现（stdin；#107 附件）
  report plan                 登记计划（stdin {finding,remoteMax?}；取号 + 门禁下限 + 脚本字节）
  report register             实测门禁判定 + 登记（stdin {finding,id,gate,remoteMax?}）
                              门禁不过 → END error 8 零 op；过 → 记录 + 脚本 + 缓存同一事务`

function usage(sink: OpSink): number {
  human(sink, USAGE)
  return end(sink, 'error', 2, '用法错误')
}

function sortedRecords(tree: DefectTree): DefectRecord[] {
  return [...tree.defects.values()]
    .map((d) => d.record)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** 事实源损坏即拒绝（exit 10）：不派生半成品，也不让查询静默跳过坏记录 */
function refuseParseErrors(tree: DefectTree, sink: OpSink): number | null {
  const first = tree.parseErrors[0]
  if (!first) return null
  return end(sink, 'error', 10, `${first.file}: ${first.error}`)
}

function showHuman(sink: OpSink, r: DefectRecord): void {
  const out = (s: string): void => sink.protocol(s)
  out(`${r.id} — ${r.title}`)
  out(`  状态：${r.status}｜引擎：${r.engine}/${r.layer}｜严重度：${r.severity}`)
  out(`  摘要：${r.summary}`)
  out(`  探索任务书：${r.charter}`)
  out(`  疑似位置：${r.suspectedArea}`)
  out(`  发现：${r.discoveredAt} by ${r.discoveredBy}`)
  out(`  复现：kind=${r.reproducibility.kind} replayCommand=${r.reproducibility.replayCommand}`)
  const g = r.reproducibility.gate
  out(`  门禁：attempts=${g.attempts} keySpaces=${g.keySpaces.join(',')} allFailed=${g.allFailed}`)
  for (const e of r.evidence) out(`  证据：[${e.type}] ${e.uri}`)
  if (r.issue !== undefined) out(`  issue：#${r.issue}`)
  if (r.graduation) {
    out(`  毕业：${r.graduation.mode} → ${r.graduation.specPath}（verifiedRun ${r.graduation.verifiedRun.expect}=${r.graduation.verifiedRun.outcome}）`)
    if (r.graduation.failureSignature) {
      const s = r.graduation.failureSignature
      out(`  失败签名：${s.errorClass}｜${s.assertionId}｜${s.semanticMarkers.map((m) => `${m.key}=${m.value}`).join(',')}`)
    }
    if (r.graduation.confirmation) {
      out(`  确认：${r.graduation.confirmation.at} by ${r.graduation.confirmation.by}（令牌 verifyRun=${r.graduation.confirmation.token.verifyRunId}）`)
    }
  }
  if (r.fix) out(`  修复：${r.fix.at} by ${r.fix.by}`)
  if (r.retirement) out(`  退役：${r.retirement.at} by ${r.retirement.by} — ${r.retirement.reason}`)
}

function cmdDefect(args: string[], root: string, json: boolean, sink: OpSink): number {
  const action = args[0]
  if (action === 'list') {
    const tree = loadTree(root)
    const refused = refuseParseErrors(tree, sink)
    if (refused !== null) return refused
    const records = sortedRecords(tree)
    if (json) {
      sink.protocol(JSON.stringify(records))
    } else if (records.length === 0) {
      sink.protocol('（无缺陷记录）')
    } else {
      for (const r of records) {
        sink.protocol(
          `${r.id}  [${r.status}]  ${r.severity}  ${r.engine}/${r.layer}  ${r.title}  (replay×${r.reproducibility.gate.attempts})`,
        )
      }
    }
    return end(sink, 'ok', 0, `缺陷清单：${records.length} 条`)
  }
  if (action === 'show') {
    const id = args[1]
    if (id === undefined) return usage(sink)
    if (!/^DEF-\d{4}$/.test(id)) {
      return end(sink, 'error', 10, `ID 格式应为 DEF-NNNN：${id}`)
    }
    const tree = loadTree(root)
    const bad = tree.parseErrors.find((e) => e.file === `defects/${id}.json`)
    if (bad) return end(sink, 'error', 10, `${bad.file}: ${bad.error}`)
    const loaded = tree.defects.get(id)
    if (!loaded) {
      return end(sink, 'error', 10, `缺陷不存在：${id}（defects/ 下无对应 JSON）`)
    }
    if (json) sink.protocol(JSON.stringify(loaded.record))
    else showHuman(sink, loaded.record)
    return end(sink, 'ok', 0, `${id} 摘要已输出`)
  }
  return usage(sink)
}

function cmdNextId(args: string[], root: string, json: boolean, sink: OpSink): number {
  let remoteMax = 0
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--remote-max') return usage(sink)
    const raw = args[i + 1]
    if (raw === undefined || !/^\d+$/.test(raw)) return usage(sink)
    remoteMax = Number.parseInt(raw, 10)
    i++
  }
  const tree = loadTree(root)
  let next: NextDefectId
  try {
    next = nextDefectId(tree, remoteMax)
  } catch (e) {
    return end(sink, 'error', 10, String(e instanceof Error ? e.message : e))
  }
  if (json) sink.protocol(JSON.stringify(next))
  else sink.protocol(next.id)
  return end(sink, 'ok', 0, `下一个编号：${next.id}（本地 max=${next.localMax}，远端 max=${next.remoteMax}）`)
}

function cmdRegistry(args: string[], root: string, _json: boolean, sink: OpSink): number {
  if (args[0] !== 'rebuild' || args.length !== 1) return usage(sink)
  const tree = loadTree(root)
  const refused = refuseParseErrors(tree, sink)
  if (refused !== null) return refused
  // 漂移仅 WARN，不硬门禁（原型实证「漂移即红」死锁）；完整性锚在入库记录与 git 历史
  const drifted = registryDrifted(tree)
  if (drifted) {
    human(sink, 'WARN: 注册表缓存过期或被手改（漂移），已自动重建；完整性以入库缺陷记录（apps/e2e/defects/*.json）与 git 历史为准')
  }
  const content = rebuildRegistry(tree)
  emit(sink, { op: 'W', path: REGISTRY_FILE, content })
  const count = tree.defects.size
  return end(sink, 'ok', 0, `注册表已重建（${count} 条；漂移：${drifted ? '是' : '否'}）`)
}

/**
 * 重放计划（#108）：宿主据此在 per-run 隔离栈内执行记录内 replayCommand。
 * 只读事实源——不改记录（门禁回填归 #109 report，修复确认归 #111 confirm-fix）。
 * 数据行：CMD（容器内可执行命令）/ KIND（被测路径分类）/ ATTEMPTS（门禁下限）/
 * SCRIPT（脚本仓库相对路径）/ TITLE。未知 ID、非法记录、脚本缺失、协议字段含
 * tab/换行一律 exit 10（事实源完整性）。
 */
function cmdReplayPlan(args: string[], root: string, sink: OpSink): number {
  const id = args[0]
  if (id === undefined || args.length !== 1) return usage(sink)
  if (!/^DEF-\d{4}$/.test(id)) return end(sink, 'error', 10, `ID 格式应为 DEF-NNNN：${id}`)
  const tree = loadTree(root)
  const bad = tree.parseErrors.find((e) => e.file === `defects/${id}.json`)
  if (bad) return end(sink, 'error', 10, `${bad.file}: ${bad.error}`)
  const loaded = tree.defects.get(id)
  if (!loaded) return end(sink, 'error', 10, `缺陷不存在：${id}（defects/ 下无对应 JSON）`)
  const r = loaded.record
  const script = replayRel(id)
  if (!tree.replayScripts.has(`${id}.mjs`)) {
    return end(sink, 'error', 10, `复现脚本缺失：apps/e2e/${script}（脚本随记录入库，是长期重建依据）`)
  }
  const cmd = r.reproducibility.replayCommand
  if (/[\t\r\n]/.test(cmd)) {
    return end(sink, 'error', 10, `replayCommand 含 tab/换行（行协议不可被注入截断）：${id}`)
  }
  const out = (s: string): void => sink.protocol(s)
  out(`CMD\t${cmd}`)
  out(`KIND\t${r.reproducibility.kind}`)
  out(`ATTEMPTS\t${minGateAttempts(r.reproducibility.kind)}`)
  out(`SCRIPT\t${script}`)
  out(`TITLE\t${r.title.replace(/[\t\r\n]+/g, ' ')}`)
  return end(sink, 'ok', 0, `重放计划已输出（${id}）`)
}

/** stdin 读取边界（可注入以便零基础设施单测）：签名命令的载荷走 stdin，不走树 tar */
export type StdinReader = () => string

function readProcessStdin(): string {
  // fd 0 同步读（宿主以管道喂载荷，compose run -T 不分配 TTY）
  return readFileSync(0, 'utf8')
}

/**
 * 签名原语的引擎入口（#108）：提取覆盖两个来源（replay 脚本失败输出约定 /
 * Playwright 结果 JSON），比对判定「同一断言处因同一原因失败」。结果恒为**单行
 * 紧凑 JSON** 数据行（JSONL 结果流不被多行文档破坏），供 #109 门禁与 #112 CI
 * 判定共用同一份实现（本地与 CI 同一判定器）。
 */
function cmdSignature(args: string[], sink: OpSink, readStdin: StdinReader): number {
  const action = args[0]
  if (action === 'extract') {
    let source = ''
    for (let i = 1; i < args.length; i++) {
      if (args[i] !== '--source') return usage(sink)
      const v = args[i + 1]
      if (v === undefined) return usage(sink)
      source = v
      i++
    }
    if (source !== 'replay' && source !== 'playwright') {
      return end(sink, 'error', 2, `--source 需为 replay|playwright（当前：${source || '缺'}）`)
    }
    const payload = readStdin()
    if (source === 'replay') {
      const r = extractReplaySignature(payload)
      sink.protocol(JSON.stringify({ schemaVersion: 1, source, ...r }))
      return end(sink, 'ok', 0, `replay 签名提取：found=${r.found}`)
    }
    let report: unknown
    try {
      report = JSON.parse(payload)
    } catch (e) {
      return end(sink, 'error', 2, `Playwright 结果 JSON 解析失败：${String(e instanceof Error ? e.message : e)}`)
    }
    const r = extractPlaywrightSignatures(report)
    if (r.error !== undefined) return end(sink, 'error', 2, r.error)
    sink.protocol(JSON.stringify({ schemaVersion: 1, source, failures: r.failures, stats: r.stats }))
    return end(sink, 'ok', 0, `Playwright 签名提取：${r.failures.length} 条失败断言`)
  }
  if (action === 'compare') {
    if (args.length !== 1) return usage(sink)
    let raw: unknown
    try {
      raw = JSON.parse(readStdin())
    } catch (e) {
      return end(sink, 'error', 2, `比对载荷 JSON 解析失败：${String(e instanceof Error ? e.message : e)}`)
    }
    const obj = raw as { baseline?: unknown; candidates?: unknown }
    const parseSig = (v: unknown): FailureSignature | null | undefined => {
      if (v === null || v === undefined) return null
      const p = FailureSignatureSchema.safeParse(v)
      return p.success ? p.data : undefined
    }
    const baseline = parseSig(obj?.baseline)
    if (baseline === undefined || !Array.isArray(obj?.candidates)) {
      return end(sink, 'error', 2, '比对载荷需为 {baseline:签名|null, candidates:[签名|null,…]}')
    }
    const candidates: (FailureSignature | null)[] = []
    for (const c of obj.candidates) {
      const s = parseSig(c)
      if (s === undefined) return end(sink, 'error', 2, 'candidates 含非法签名（三要素/错误类别/标记形态不符）')
      candidates.push(s)
    }
    const r = compareSignatureSet(baseline, candidates)
    sink.protocol(JSON.stringify({ schemaVersion: 1, ...r }))
    return end(sink, 'ok', 0, `签名比对：allMatched=${r.allMatched}（${candidates.length} 轮）`)
  }
  return usage(sink)
}

/** 协议数据行压平（tab/换行会截断行协议；记录内保留原文，数据线只作宿主消费） */
function flat(s: string): string {
  return s.replace(/[\t\r\n]+/g, ' ')
}

/** report 载荷信封（plan 与 register 同一形态；register 另需 id + gate 实测证据） */
interface ReportEnvelope {
  finding?: unknown
  remoteMax?: unknown
  id?: unknown
  gate?: { rounds?: unknown; measuredAt?: unknown; scriptSha256?: unknown }
}

function readEnvelope(readStdin: StdinReader): { ok: true; env: ReportEnvelope } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(readStdin())
  } catch (e) {
    return { ok: false, error: `report 载荷 JSON 解析失败：${String(e instanceof Error ? e.message : e)}` }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'report 载荷需为对象 {finding, remoteMax?, id?, gate?}' }
  }
  return { ok: true, env: raw as ReportEnvelope }
}

function remoteMaxOf(env: ReportEnvelope): number {
  const n = env.remoteMax
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0
}

/**
 * report 登记（#109；Spec-e2e §5 复现门禁由命令**实测**回填，非自查申报）。
 *
 * 三段式（宿主编排见 devenv/lib/e2e-report.sh）：
 *   plan     只读事实源 → 取号（本地 max+1，可叠远端）+ 门禁下限 + 脚本字节；零落盘。
 *   （宿主在 per-run 隔离栈内跑 N 轮，每轮独立键空间，采集签名）
 *   register 携实测轮次 → judgeGate 判定；不过 → END error 8 **零 op**（不登记）；
 *            过 → 记录 JSON（reported）+ 复现脚本 + 派生缓存同一事务 W 出。
 *   finding-from-results  从 Playwright results.json 提取 #107 属性发现附件。
 *
 * 退出码：0 成功 | 2 输入契约/用法 | 8 门禁未过或前置不符（含编号被占用、实测脚本
 * 与登记脚本字节不符）| 10 事实源损坏。
 */
function cmdReport(args: string[], root: string, sink: OpSink, readStdin: StdinReader): number {
  const action = args[0]

  if (action === 'finding-from-results') {
    let property: string | undefined
    for (let i = 1; i < args.length; i++) {
      if (args[i] !== '--property') return usage(sink)
      const v = args[i + 1]
      if (v === undefined) return usage(sink)
      property = v
      i++
    }
    const r = extractPropertyFinding(readStdin(), property)
    if (!r.ok) return end(sink, 'error', 2, r.error)
    sink.protocol(`FINDING\t${JSON.stringify(r.finding)}`)
    return end(sink, 'ok', 0, `属性发现已提取：${r.finding.property}（候选 ${r.candidates} 个）`)
  }

  if (action !== 'plan' && action !== 'register') return usage(sink)

  const envResult = readEnvelope(readStdin)
  if (!envResult.ok) return end(sink, 'error', 2, envResult.error)
  const env = envResult.env
  const norm = normalizeReportFinding(env.finding)
  if (!norm.ok) return end(sink, 'error', 2, norm.error)
  const f = norm.value

  const tree = loadTree(root)
  const refused = refuseParseErrors(tree, sink)
  if (refused !== null) return refused

  if (action === 'plan') {
    let next: NextDefectId
    try {
      next = nextDefectId(tree, remoteMaxOf(env))
    } catch (e) {
      return end(sink, 'error', 10, String(e instanceof Error ? e.message : e))
    }
    const id = next.id
    const cmd = resolveReplayCommand(f.reproducibility.replayCommand, id)
    if (/[\t\r\n]/.test(cmd)) {
      return end(sink, 'error', 2, 'replayCommand 含 tab/换行（行协议不可被注入截断）')
    }
    const out = (s: string): void => sink.protocol(s)
    out(`ID\t${id}`)
    out(`KIND\t${f.reproducibility.kind}`)
    out(`ATTEMPTS\t${minGateAttempts(f.reproducibility.kind)}`)
    out(`CMD\t${cmd}`)
    out(`SCRIPT\t${replayRel(id)}`)
    out(`SCRIPT_B64\t${Buffer.from(f.reproducibility.replayScript, 'utf8').toString('base64')}`)
    out(`TITLE\t${flat(f.title)}`)
    out(`PRECONDITION\t${flat(f.reproducibility.precondition)}`)
    out(`CONCURRENCY\t${f.reproducibility.concurrency === undefined ? '' : JSON.stringify(f.reproducibility.concurrency)}`)
    return end(sink, 'ok', 0, `report 计划：${id}（kind=${f.reproducibility.kind}，门禁下限 ${minGateAttempts(f.reproducibility.kind)} 轮；本地 max=${next.localMax}，远端 max=${next.remoteMax}）`)
  }

  // --- register：实测门禁判定 → 过则登记，不过则零 op -------------------------
  const id = env.id
  if (typeof id !== 'string' || !/^DEF-\d{4}$/.test(id)) {
    return end(sink, 'error', 2, 'register 需携计划取号 id（DEF-NNNN）')
  }
  if (tree.defectFiles.includes(`${id}.json`)) {
    return end(sink, 'error', 8, `编号已被占用：${id}（另一会话已登记？重跑 report 重新取号；跨 worktree 撞号由 #116 renumber 收敛）`)
  }
  if (tree.replayScripts.has(`${id}.mjs`)) {
    return end(sink, 'error', 8, `复现脚本位已被占用：replay/${id}.mjs（重跑 report 重新取号）`)
  }

  const gate = env.gate
  const roundsParsed = z.array(GateRoundInputSchema).safeParse(gate?.rounds)
  if (!roundsParsed.success) {
    const first = roundsParsed.error.issues[0]
    return end(sink, 'error', 2, `gate.rounds 形态不符：${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim())
  }
  const measuredAt =
    typeof gate?.measuredAt === 'string' && gate.measuredAt !== '' ? gate.measuredAt : new Date().toISOString()
  const scriptSha256 = typeof gate?.scriptSha256 === 'string' && gate.scriptSha256 !== '' ? gate.scriptSha256 : undefined
  // 实测所用脚本必须与登记脚本是**同一份字节**（否则门禁证的不是入库的那份复现面）
  if (scriptSha256 !== undefined) {
    const actual = createHash('sha256').update(f.reproducibility.replayScript, 'utf8').digest('hex')
    if (actual !== scriptSha256) {
      return end(sink, 'error', 8, `实测脚本与登记脚本字节不符（sha256 ${scriptSha256.slice(0, 12)}… ≠ ${actual.slice(0, 12)}…）——前置不符，零登记`)
    }
  }

  const verdict = judgeGate(f.reproducibility.kind, roundsParsed.data, f.reproducibility.precondition)
  // 判定证据走数据线（过与不过都输出）：宿主终值据此回填机器可消费的门禁摘要
  sink.protocol(`GATE\t${JSON.stringify(verdict)}`)
  if (!verdict.passed) {
    return end(sink, 'error', 8, `门禁未过（${verdict.reason}）：${verdict.message}`)
  }
  const built = buildReportRecord(id, f, verdict, { measuredAt, scriptSha256 })
  if (!built.ok) return end(sink, 'error', 2, built.error)

  emit(sink, { op: 'W', path: defectJsonRel(id), content: `${JSON.stringify(built.record, null, 2)}\n` })
  emit(sink, { op: 'W', path: replayRel(id), content: f.reproducibility.replayScript })
  // 派生缓存同事务重建（含新记录）；漂移仅 WARN 的口径不变（#106）
  const withNew: DefectTree = {
    ...tree,
    defects: new Map([...tree.defects, [id, { file: defectJsonRel(id), record: built.record }]]),
  }
  emit(sink, { op: 'W', path: REGISTRY_FILE, content: rebuildRegistry(withNew) })
  return end(sink, 'ok', 0, `已登记 ${id}（reported；门禁 ${verdict.attempts} 轮独立键空间实测通过，签名比对 ${verdict.compareReason}）`)
}

/**
 * 决策引擎入口（可单测）：argv → 退出码；输出全部经 sink（协议/人类两通道）。
 * 全局旗标 --root DIR（宿主树解包目录）与 --json 位置无关。
 * readStdin 可注入（签名命令的载荷通道）；缺省同步读进程 stdin。
 */
export function runCli(argv: string[], sink: OpSink, readStdin: StdinReader = readProcessStdin): number {
  let root = '.'
  let json = false
  const args: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue
    if (a === '--root') {
      const v = argv[i + 1]
      if (v === undefined) return usage(sink)
      root = v
      i++
    } else if (a === '--json') {
      json = true
    } else {
      args.push(a)
    }
  }
  switch (args[0]) {
    case 'defect':
      return cmdDefect(args.slice(1), root, json, sink)
    case 'next-id':
      return cmdNextId(args.slice(1), root, json, sink)
    case 'registry':
      return cmdRegistry(args.slice(1), root, json, sink)
    case 'replay-plan':
      return cmdReplayPlan(args.slice(1), root, sink)
    case 'signature':
      return cmdSignature(args.slice(1), sink, readStdin)
    case 'report':
      return cmdReport(args.slice(1), root, sink, readStdin)
    default:
      return usage(sink)
  }
}