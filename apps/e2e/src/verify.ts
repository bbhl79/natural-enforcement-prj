// PROTOTYPE（#13）— 防降级校验器（#10 §7；devenv verify 与 CI 同一校验器）：
//   1 索引一致性：graduated/fixed ⇔ tests/repro/def-<id>.spec.ts 有且仅一、文件头双向匹配；
//     reported 仅允许 _drafts 草稿；retired 不得残留测试（含草稿）。
//   2 注解纪律：test.fail() 当且仅当 status=graduated；tests/repro 全禁 test.skip/test.fixme。
//   3 编号纪律：DEF 唯一 + 连续无洞。
//   4 门禁证据：attempts ≥ 门禁下限且 allFailed。
//   5 注册表（派生缓存）：与事实源重建结果漂移即红。
//   6 replay 脚本存在（缺陷记录永不删除的复现面）。
// diff 级检查（repro 删除⇒伴随 retire；删缺陷 JSON⇒无条件红）在 devenv 侧用 git 做（CI 传基线分支）。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { minGateAttempts, MECHANICAL_ENGINES, type DefectId } from './defect/schema.js'
import { countFailLines, headerDefectId } from './transcribe.js'
import { loadTree, readIfExists, type DefectTree } from './tree.js'

export interface Violation {
  rule: string
  detail: string
}

export const REGISTRY_FILE = '.registry.json' // apps/e2e/.registry.json（派生缓存，不入库）

export function rebuildRegistry(tree: DefectTree): string {
  const defects = [...tree.defects.values()]
    .map((d) => ({
      id: d.record.id,
      status: d.record.status,
      engine: d.record.engine,
      specPath: (tree.reproSpecs.get(d.record.id) ?? [])[0] ?? null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  return JSON.stringify({ defects }, null, 2) + '\n'
}

export function verifyTree(tree: DefectTree): Violation[] {
  const v: Violation[] = []
  const push = (rule: string, detail: string) => v.push({ rule, detail })

  // 0 schema/解析
  for (const p of tree.parseErrors) push('schema', `${p.file}: ${p.error}`)

  // 3 编号纪律：唯一（loadTree 已按 id 去重——用文件名集合查重）+ 连续无洞
  const fileIds = tree.defectFiles
    .map((f) => /^DEF-(\d{4})\.json$/.exec(f)?.[1])
    .filter((x): x is string => x !== undefined)
    .map((n) => Number.parseInt(n, 10))
  const seen = new Set<number>()
  for (const n of fileIds) {
    if (seen.has(n)) push('numbering:duplicate', `DEF-${String(n).padStart(4, '0')} 出现多个文件`)
    seen.add(n)
  }
  const max = fileIds.length > 0 ? Math.max(...fileIds) : 0
  for (let n = 1; n <= max; n++) {
    if (!seen.has(n)) push('numbering:hole', `DEF-${String(n).padStart(4, '0')} 缺号（连续无洞是审计底线）`)
  }

  // 0/1/2/4/6 逐缺陷
  for (const { file, record: d } of tree.defects.values()) {
    // 状态条件字段（schema 之上的语义校验）
    for (const e of invariantErrors(d)) push('status', `${d.id}: ${e}`)

    // 4 门禁证据（登记后常态：report 已实测回填；未回填=未过门禁的裸文件，理应红）
    const min = minGateAttempts(d.reproducibility.kind)
    if (d.reproducibility.gate.attempts < min)
      push('gate', `${d.id}: attempts=${d.reproducibility.gate.attempts} < ${min}（${d.reproducibility.kind}）`)
    if (!d.reproducibility.gate.allFailed) push('gate', `${d.id}: allFailed=false`)

    // 6 replay 脚本存在（全部状态——永久留档）
    if (!tree.replayScripts.has(`${d.id}.mjs`)) push('replay', `${d.id}: replay/${d.id}.mjs 缺失`)

    // 机械转写引擎必须带反例
    if (MECHANICAL_ENGINES.has(d.engine) && d.reproducibility.counterexample === undefined)
      push('transcribe', `${d.id}: engine=${d.engine} 需 counterexample（机械转写输入）`)

    // 1 索引一致性
    const specs = tree.reproSpecs.get(d.id) ?? []
    const drafts = tree.draftSpecs.get(d.id) ?? []
    if (d.status === 'graduated' || d.status === 'fixed') {
      if (specs.length === 0) push('index', `${d.id}: ${d.status} 缺 tests/repro/def-*.spec.ts（降级或丢失）`)
      if (specs.length > 1) push('index', `${d.id}: 复现用例多于一个（${specs.join(', ')}）`)
      if (drafts.length > 0) push('index', `${d.id}: 已毕业仍残留草稿（${drafts.join(', ')}）`)
    } else if (d.status === 'reported') {
      if (specs.length > 0) push('index', `${d.id}: reported 状态出现正式用例（毕业是唯一合法写入路径）`)
    } else if (d.status === 'retired') {
      if (specs.length > 0) push('index', `${d.id}: retired 残留正式用例（退役必须同事务删测试）`)
      if (drafts.length > 0) push('index', `${d.id}: retired 残留草稿`)
    }

    // 2 注解纪律（正式用例 + 草稿都查）
    for (const rel of [...specs, ...drafts]) {
      const content = readIfExists(tree, rel)
      if (content === undefined) continue
      if (/test\.skip\(|test\.fixme\(|\.fixme\(/.test(content))
        push('annotation', `${rel}: 禁用 test.skip/test.fixme（降级后门；偶发失败=新缺陷或退役）`)
      const fails = countFailLines(content)
      if (rel.includes('/_drafts/')) {
        if (fails > 0) push('annotation', `${rel}: 草稿不得启用 test.fail（转正时由 graduate 启用）`)
      } else if (d.status === 'graduated') {
        if (fails !== 1) push('annotation', `${rel}: graduated 必须（且仅）1 个 test.fail()（实际 ${fails}）`)
      } else {
        if (fails > 0) push('annotation', `${rel}: test.fail() 仅限 graduated（当前 ${d.status}）`)
      }
      const headerId = headerDefectId(content)
      if (headerId !== d.id) push('index', `${rel}: 文件头 defect 链接 ${headerId ?? '缺失'} ≠ ${d.id}（双向匹配）`)
    }
  }

  // 1 反向：无缺陷记录背书的用例/草稿（绕过 graduate 的私搭用例）
  const known = new Set(tree.defects.keys())
  for (const [id, rels] of [...tree.reproSpecs, ...tree.draftSpecs]) {
    if (!known.has(id)) push('index', `${rels.join(',')}: 无 ${id} 缺陷记录（毕业是唯一合法写入路径）`)
  }

  // 5 注册表派生缓存：漂移即红（防手改注册表造第二本账）
  const regPath = join(tree.root, REGISTRY_FILE)
  if (existsSync(regPath)) {
    try {
      const existing = JSON.parse(readFileSync(regPath, 'utf8')) as { defects?: unknown }
      const rebuilt = JSON.parse(rebuildRegistry(tree)) as { defects?: unknown }
      if (JSON.stringify(existing) !== JSON.stringify(rebuilt))
        push('registry:drift', '.registry.json 与事实源重建结果不一致（注册表是派生缓存，禁止手改）')
    } catch {
      push('registry:drift', '.registry.json 解析失败')
    }
  }

  return v
}

// 状态条件字段（与 schema.ts validateRecordInvariants 同口径；独立导出供 verify 用）
function invariantErrors(d: {
  status: string
  graduation?: unknown
  fix?: unknown
  retirement?: unknown
}): string[] {
  const errs: string[] = []
  const has = (x: unknown) => x !== undefined
  if (d.status === 'reported') {
    if (has(d.graduation) || has(d.fix) || has(d.retirement)) errs.push('reported 不得带生命周期字段')
  } else if (d.status === 'graduated') {
    if (!has(d.graduation)) errs.push('缺 graduation')
    if (has(d.fix)) errs.push('graduated 不得带 fix')
    if (has(d.retirement)) errs.push('graduated 不得带 retirement')
  } else if (d.status === 'fixed') {
    if (!has(d.graduation)) errs.push('缺 graduation')
    if (!has(d.fix)) errs.push('缺 fix')
    if (has(d.retirement)) errs.push('fixed 不得带 retirement')
  } else if (d.status === 'retired') {
    if (!has(d.retirement)) errs.push('缺 retirement')
    // graduation/fix 保留为历史（retired 是从任意状态的合法终态，记录永不删除）
  }
  return errs
}

export function formatViolations(vs: Violation[]): string {
  return vs.map((x) => `  [${x.rule}] ${x.detail}`).join('\n')
}

export type { DefectId }
