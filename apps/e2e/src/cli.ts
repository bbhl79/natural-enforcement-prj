// 生命周期 CLI（#106；Spec-e2e §10）——**纯决策引擎**：
//   - 宿主树经 stdin tar 只读进容器（--root 指向解包目录），本进程不落盘；
//   - 查询数据走协议通道（容器 stdout，宿主转发给调用者）；
//   - 写盘/删文件/校验运行以 op 行协议输出（W/D/V），由 devenv 宿主侧原子应用；
//   - 每次调用恰一行 END 终值（最后输出），退出码与 END 的 code 一致。
// 退出码：0 成功 | 2 用法 | 10 缺陷不存在或 schema 不符（7/8/9 由后续票的引擎判定）。
// 后续票（#108 replay / #109 report / #110 graduate / #116 retire·renumber·verify）
// 在本骨架上追加子命令；未知子命令一律用法错误 2。
import type { DefectRecord } from './defect/schema.js'
import { nextDefectId, type NextDefectId } from './numbering.js'
import { emit, end, human, type OpSink } from './ops.js'
import { REGISTRY_FILE, rebuildRegistry, registryDrifted } from './registry.js'
import { loadTree, type DefectTree } from './tree.js'

const USAGE = `用法：cli [--root DIR] [--json] <子命令>…
  defect list                 缺陷清单（事实源 apps/e2e/defects/*.json）
  defect show <DEF-NNNN>      缺陷摘要 + 证据 URI
  next-id [--remote-max N]    DEF-NNNN 取号（本地 max+1，可叠读远端已有编号）
  registry rebuild            重建注册表（派生缓存，始终重建；漂移仅 WARN）`

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
 * 决策引擎入口（可单测）：argv → 退出码；输出全部经 sink（协议/人类两通道）。
 * 全局旗标 --root DIR（宿主树解包目录）与 --json 位置无关。
 */
export function runCli(argv: string[], sink: OpSink): number {
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
    default:
      return usage(sink)
  }
}