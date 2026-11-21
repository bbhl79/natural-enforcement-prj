// PROTOTYPE（#13）— 生命周期 CLI（devenv e2e 子命令的容器侧实现）。
// 纯决策引擎：stdin tar 进来的树只读；全部写盘/删文件/校验运行以 op 协议输出，由 devenv 原子执行。
// 退出码（与 devenv 联合定型）：
//   0 成功 | 2 用法 | 7 生命周期校验失败（verify）| 8 状态转移/前置条件不合法 | 10 缺陷不存在/schema 不符
import * as process from 'node:process'
import {
  MECHANICAL_ENGINES,
  minGateAttempts,
  validateRecordInvariants,
  type DefectId,
  type DefectRecord,
} from './defect/schema.js'
import { emit, end, human } from './ops.js'
import {
  activateDraft,
  stripFailLine,
  transcribeDraft,
  transcribeMechanical,
} from './transcribe.js'
import {
  defectJsonRel,
  draftRel,
  loadTree,
  readIfExists,
  replayRel,
  specRel,
  type DefectTree,
} from './tree.js'
import { rebuildRegistry, REGISTRY_FILE, verifyTree } from './verify.js'

const argv = process.argv.slice(2)
let root = '.'
let jsonOut = false
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root') {
    root = argv[i + 1] ?? '.'
    argv.splice(i, 2)
    i--
  } else if (argv[i] === '--json') {
    jsonOut = true
    argv.splice(i, 1)
    i--
  }
}

function usage(): number {
  human(`用法：cli [--root DIR] [--json] <子命令>…
  defect list                        缺陷清单（stdout 人读/JSON）
  defect show <ID>                   摘要 + 证据路径
  replay-plan <ID>                   输出 CMD/ATTEMPTS 行（devenv 执行复现门禁）
  report <ID> --outcomes 0,0,0 --key-space <runId> [--by WHO]   登记回填门禁（全复现才落账）
  graduate <ID> [--fixed] [--by WHO]  预检→转写→校验运行载荷→落账（op 输出）
  confirm-fix <ID> [--by WHO]        摘除 expected-fail → fixed（先真跑验证已修复）
  retire <ID> --reason "…" [--issue N] [--by WHO]  退役（同事务删测试，记录永久留档）
  renumber [--by WHO]                撞号/断号机械重排（连带 spec/draft/replay 改名改引用）
  verify [--write-registry]          全量防降级校验`)
  return end('error', 2, '用法错误')
}

function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

function getDefect(tree: DefectTree, idRaw: string): { tree: DefectTree; id: DefectId; record: DefectRecord; file: string } | number {
  if (!/^DEF-\d{4}$/.test(idRaw)) return end('error', 10, `ID 格式应为 DEF-NNNN：${idRaw}`)
  const id = idRaw as DefectId
  const loaded = tree.defects.get(id)
  if (!loaded) return end('error', 10, `缺陷不存在：${id}（defects/ 下无对应 JSON）`)
  return { tree, id, record: loaded.record, file: loaded.file }
}

function operator(): string {
  return argValue('--by') ?? process.env.NE_AGENT ?? process.env.USER ?? 'unknown'
}

function writeJson(record: DefectRecord): void {
  emit({ op: 'W', path: defectJsonRel(record.id), content: JSON.stringify(record, null, 2) + '\n' })
}

function cmdDefect(): number {
  const sub = argv[1]
  const tree = loadTree(root)
  if (sub === 'list') {
    if (jsonOut) {
      process.stdout.write(JSON.stringify([...tree.defects.values()].map((d) => d.record), null, 2) + '\n')
      return 0
    }
    if (tree.defects.size === 0) human('（无缺陷记录）')
    for (const d of [...tree.defects.values()].sort((a, b) => (a.record.id < b.record.id ? -1 : 1))) {
      const r = d.record
      human(
        `${r.id}  [${r.status}]  ${r.severity}  ${r.engine}/${r.layer}  ${r.title}  (replay×${r.reproducibility.gate.attempts})`,
      )
    }
    return 0
  }
  if (sub === 'show') {
    const got = getDefect(tree, argv[2] ?? '')
    if (typeof got === 'number') return got
    const r = got.record
    if (jsonOut) {
      process.stdout.write(JSON.stringify(r, null, 2) + '\n')
      return 0
    }
    human(`${r.id} — ${r.title}`)
    human(`  状态：${r.status}｜引擎：${r.engine}/${r.layer}｜严重度：${r.severity}`)
    human(`  摘要：${r.summary}`)
    human(`  charter：${r.charter}`)
    human(`  复现：kind=${r.reproducibility.kind} replayCommand=${r.reproducibility.replayCommand}`)
    human(`  门禁：attempts=${r.reproducibility.gate.attempts} keySpaces=${r.reproducibility.gate.keySpaces.join(',')} allFailed=${r.reproducibility.gate.allFailed}`)
    for (const e of r.evidence) human(`  证据：[${e.type}] ${e.uri}`)
    if (r.graduation) human(`  毕业：${r.graduation.mode} → ${r.graduation.specPath}（verifiedRun ${r.graduation.verifiedRun.expect}=${r.graduation.verifiedRun.outcome}）`)
    if (r.fix) human(`  修复：${r.fix.at} by ${r.fix.by}`)
    if (r.retirement) human(`  退役：${r.retirement.reason}`)
    return 0
  }
  return usage()
}

function cmdReplayPlan(): number {
  const tree = loadTree(root)
  const got = getDefect(tree, argv[1] ?? '')
  if (typeof got === 'number') return got
  const r = got.record
  process.stdout.write(`CMD\t${r.reproducibility.replayCommand}\n`)
  process.stdout.write(`ATTEMPTS\t${minGateAttempts(r.reproducibility.kind)}\n`)
  return end('ok', 0, `${r.id} 复现计划已输出`)
}

/** 登记回填：入参形态允许 gate 占位；outcomes 全 0（全部复现）才落账 */
function cmdReport(): number {
  const tree = loadTree(root)
  const got = getDefect(tree, argv[1] ?? '')
  if (typeof got === 'number') return got
  const r = got.record
  const outcomes = (argValue('--outcomes') ?? '')
    .split(',')
    .filter((x) => x !== '')
    .map((x) => Number.parseInt(x, 10))
  const keySpace = argValue('--key-space')
  if (outcomes.length === 0 || keySpace === undefined)
    return end('error', 2, 'report 需要 --outcomes 0,0,… 与 --key-space <runId>')
  const allFailed = outcomes.length > 0 && outcomes.every((c) => c === 0)
  if (!allFailed)
    return end(
      'error',
      8,
      `复现门禁未过：${outcomes.length} 次重放存在未复现（退出码 ${outcomes.join(',')}；0=复现）`,
    )
  const min = minGateAttempts(r.reproducibility.kind)
  if (outcomes.length < min)
    return end('error', 8, `复现门禁未过：${r.reproducibility.kind} 需 ≥${min} 次，实得 ${outcomes.length}`)
  const updated: DefectRecord = {
    ...r,
    status: 'reported',
    reproducibility: {
      ...r.reproducibility,
      gate: { attempts: outcomes.length, keySpaces: [keySpace], allFailed: true },
    },
  }
  const errs = validateRecordInvariants(updated)
  if (errs.length > 0) return end('error', 10, `${r.id} 记录不完整：${errs.join('；')}`)
  writeJson(updated)
  human(`已登记 ${r.id}（reported）：门禁 ${outcomes.length}/${outcomes.length} 复现 @${keySpace}`)
  return end('ok', 0, `${r.id} 登记完成`)
}

function cmdGraduate(): number {
  const tree = loadTree(root)
  const got = getDefect(tree, argv[1] ?? '')
  if (typeof got === 'number') return got
  const { id, record: r } = got
  const fixed = argv.includes('--fixed')
  if (r.status === 'graduated' || r.status === 'fixed')
    return end('error', 8, `${id} 已是 ${r.status}；重复毕业被拒（重验证用 replay，修复确认用 confirm-fix）`)
  if (r.status === 'retired') return end('error', 8, `${id} 已退役；退役是终态（缺陷记录永久留档）`)

  const now = new Date().toISOString()
  const expect: 'fail' | 'pass' = fixed ? 'pass' : 'fail'
  const drafts = tree.draftSpecs.get(id) ?? []
  const mechanical = MECHANICAL_ENGINES.has(r.engine)

  // 前置：replay 脚本在场（长期重建面）
  if (!tree.replayScripts.has(`${id}.mjs`))
    return end('error', 8, `${id} 缺 replay/${id}.mjs（replayCommand 的脚本草案必须随记录入库）`)

  let specContent: string
  let verifyContent: string
  if (mechanical) {
    // 路径占用：正式位不得已有用例
    if ((tree.reproSpecs.get(id) ?? []).length > 0)
      return end('error', 8, `${id} 已存在 ${specRel(id)}（毕业是唯一合法写入路径，禁止手工占用）`)
    try {
      specContent = transcribeMechanical(r, !fixed)
      verifyContent = transcribeMechanical(r, false)
    } catch (e) {
      return end('error', 10, `${id} 转写失败：${String(e)}`)
    }
  } else {
    // 非机械引擎：无草稿 → 生成草稿即返回（不落状态）；有草稿 → 校验转正
    if ((tree.reproSpecs.get(id) ?? []).length > 0)
      return end('error', 8, `${id} 已存在 ${specRel(id)}（毕业是唯一合法写入路径，禁止手工占用）`)
    if (drafts.length === 0) {
      emit({ op: 'W', path: draftRel(id), content: transcribeDraft(r) })
      human(`${id}（${r.engine}）无机械转写：草稿已生成 ${draftRel(id)}（CI 不收集）。补完断言后重跑 graduate 转正。`)
      return end('ok', 0, `${id} 草稿已生成（mode=draft，状态保持 reported）`)
    }
    const draftPath = drafts[0]!
    const draftContent = readIfExists(tree, draftPath)
    if (draftContent === undefined) return end('error', 10, `${id} 草稿读取失败：${draftPath}`)
    const act = activateDraft(draftContent, !fixed)
    if (!act.ok) return end('error', 8, `${id} 草稿不可转正：${act.error}`)
    specContent = act.content
    const actNofail = activateDraft(draftContent, false)
    if (!actNofail.ok) return end('error', 8, `${id} 草稿不可转正：${actNofail.error}`)
    verifyContent = actNofail.content
    emit({ op: 'D', path: draftPath })
  }

  // 校验运行载荷（真跑一次：未修必须失败 / 已修必须通过——翻译质量把关）
  emit({ op: 'V', id: id.slice(4), expect, content: verifyContent })
  emit({ op: 'W', path: specRel(id), content: specContent })

  const updated: DefectRecord = {
    ...r,
    status: 'graduated',
    graduation: {
      at: now,
      by: operator(),
      specPath: specRel(id),
      mode: fixed ? 'fixImmediate' : 'expected-fail',
      verifiedRun: { expect, outcome: expect, at: now },
    },
  }
  writeJson(updated)
  human(
    `${id} 毕业事务就绪：${r.engine} → ${specRel(id)}（${fixed ? 'fixImmediate，用例生来绿' : 'expected-fail，未修缺陷 CI 判绿'}）。` +
      `校验运行 expect=${expect}；通过后由 devenv 原子落账（测试与缺陷记录同一 commit）。`,
  )
  return end('ok', 0, `${id} 毕业计划已输出`)
}

function cmdConfirmFix(): number {
  const tree = loadTree(root)
  const got = getDefect(tree, argv[1] ?? '')
  if (typeof got === 'number') return got
  const { id, record: r } = got
  if (r.status !== 'graduated')
    return end('error', 8, `${id} 状态为 ${r.status}；confirm-fix 仅适用于 graduated（修复确认）`)
  const specPath = r.graduation?.specPath ?? specRel(id)
  const spec = readIfExists(tree, specPath)
  if (spec === undefined) return end('error', 10, `${id} 复现用例缺失：${specPath}（先排查 verify）`)
  const stripped = stripFailLine(spec)
  if (!stripped.ok) return end('error', 10, `${id} ${stripped.error}`)
  emit({ op: 'V', id: id.slice(4), expect: 'pass', content: stripped.content })
  emit({ op: 'W', path: specPath, content: stripped.content })
  const now = new Date().toISOString()
  const updated: DefectRecord = { ...r, status: 'fixed', fix: { at: now, by: operator() } }
  writeJson(updated)
  human(`${id} 修复确认就绪：校验运行（无 fail 标记）必须通过；通过后摘除 expected-fail → fixed。`)
  return end('ok', 0, `${id} confirm-fix 计划已输出`)
}

function cmdRetire(): number {
  const tree = loadTree(root)
  const got = getDefect(tree, argv[1] ?? '')
  if (typeof got === 'number') return got
  const { id, record: r } = got
  const reason = argValue('--reason')
  if (reason === undefined || reason.length === 0) return end('error', 2, 'retire 需要 --reason "…"（必填）')
  if (r.status === 'retired') return end('error', 8, `${id} 已退役（终态）`)
  const issue = argValue('--issue')
  const now = new Date().toISOString()
  const updated: DefectRecord = {
    ...r,
    status: 'retired',
    retirement: { at: now, by: operator(), reason, ...(issue ? { issue: Number.parseInt(issue, 10) } : {}) },
  }
  // 同事务删测试（含草稿）——退役是唯一合法的用例移除出口
  for (const p of tree.reproSpecs.get(id) ?? []) emit({ op: 'D', path: p })
  for (const p of tree.draftSpecs.get(id) ?? []) emit({ op: 'D', path: p })
  writeJson(updated)
  human(`${id} 退役就绪：reason="${reason}"；测试/草稿同步移除；缺陷记录永久留档。`)
  return end('ok', 0, `${id} retire 计划已输出`)
}

/** 撞号/断号机械重排：升序遍历收敛为 1..n（只向下改名，目标位必空），连带 spec/draft/replay 改引用 */
function cmdRenumber(): number {
  const tree = loadTree(root)
  const loaded = [...tree.defects.values()].sort((a, b) => (a.record.id < b.record.id ? -1 : 1))
  if (loaded.length === 0) return end('ok', 0, '无缺陷记录，无事可做')
  let next = 1
  let changed = 0
  for (const d of loaded) {
    const newId = `DEF-${String(next).padStart(4, '0')}` as DefectId
    next++
    if (newId === d.record.id) continue
    changed++
    const rewrite = (content: string): string =>
      content.split(d.record.id).join(newId)
    // spec/draft/replay 改引用 + 改名（W 新名在前，D 旧名在后）
    for (const p of tree.reproSpecs.get(d.record.id) ?? []) {
      const c = readIfExists(tree, p)
      if (c !== undefined)
        emit({ op: 'W', path: specRel(newId), content: rewrite(c).replace(/defect:\s*DEF-\d{4}/, `defect: ${newId}`) })
      emit({ op: 'D', path: p })
    }
    for (const p of tree.draftSpecs.get(d.record.id) ?? []) {
      const c = readIfExists(tree, p)
      if (c !== undefined)
        emit({ op: 'W', path: draftRel(newId), content: rewrite(c).replace(/defect:\s*DEF-\d{4}/, `defect: ${newId}`) })
      emit({ op: 'D', path: p })
    }
    const replay = readIfExists(tree, replayRel(d.record.id))
    if (replay !== undefined) emit({ op: 'W', path: replayRel(newId), content: rewrite(replay) })
    if (tree.replayScripts.has(`${d.record.id}.mjs`)) emit({ op: 'D', path: replayRel(d.record.id) })
    emit({ op: 'W', path: defectJsonRel(newId), content: rewrite(JSON.stringify({ ...d.record, id: newId }, null, 2) + '\n') })
    emit({ op: 'D', path: d.file })
    human(`${d.record.id} → ${newId}`)
  }
  if (changed === 0) return end('ok', 0, '编号已连续，无事可做')
  return end('ok', 0, `重排 ${changed} 条（renumber 仅机械改名改引用；内容不变）`)
}

function cmdVerify(): number {
  const tree = loadTree(root)
  const vs = verifyTree(tree)
  if (vs.length > 0) {
    human(`生命周期校验失败（${vs.length} 项）：\n${vs.map((x) => `  [${x.rule}] ${x.detail}`).join('\n')}`)
    return end('error', 7, `生命周期校验失败：${vs.length} 项违规`)
  }
  if (argv.includes('--write-registry'))
    emit({ op: 'W', path: REGISTRY_FILE, content: rebuildRegistry(tree) })
  human(`生命周期校验通过：${tree.defects.size} 条记录，索引/注解/编号/门禁全绿`)
  return end('ok', 0, 'verify 全绿')
}

// ---------------------------------------------------------------------------
const cmd = argv[0]
switch (cmd) {
  case 'defect':
    process.exit(cmdDefect())
    break // eslint 不识别 process.exit 的 never 返回
  case 'replay-plan':
    process.exit(cmdReplayPlan())
    break
  case 'report':
    process.exit(cmdReport())
    break
  case 'graduate':
    process.exit(cmdGraduate())
    break
  case 'confirm-fix':
    process.exit(cmdConfirmFix())
    break
  case 'retire':
    process.exit(cmdRetire())
    break
  case 'renumber':
    process.exit(cmdRenumber())
    break
  case 'verify':
    process.exit(cmdVerify())
    break
  default:
    process.exit(usage())
}
