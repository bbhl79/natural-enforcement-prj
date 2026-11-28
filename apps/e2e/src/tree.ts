// 生命周期树装载（#106）：devenv 经 stdin tar 把 apps/e2e/{defects,replay,tests}
// 打进容器解包到 /tmp/in，CLI 以 --root 指向该目录**只读**工作（无 bind 架构的
// 读取通道）。写盘一律经 op 行协议由 devenv 宿主侧原子应用——本模块不落盘。
//
// 目录表达轨道归属（Spec-e2e §3）：defects/ 是事实源；tests/repro/ 是复现轨道；
// tests/repro/_drafts/ 是草稿区（CI 不收集）；replay/ 是零依赖复现脚本。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseDefectJson, type DefectRecord } from './defect/schema.js'

export interface LoadedDefect {
  file: string // defects/DEF-NNNN.json（相对 root）
  record: DefectRecord
}

export interface DefectTree {
  root: string
  defects: Map<string, LoadedDefect>
  defectFiles: string[] // defects/ 下全部 .json 文件名（含解析失败的，供报错定位）
  replayScripts: Set<string> // replay/DEF-NNNN.mjs 文件名
  reproSpecs: Map<string, string[]> // tests/repro/def-NNNN.spec.ts（相对 root）
  draftSpecs: Map<string, string[]> // tests/repro/_drafts/def-NNNN.draft.spec.ts
  parseErrors: { file: string; error: string }[]
}

function listFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort()
}

export function loadTree(root: string): DefectTree {
  const defects = new Map<string, LoadedDefect>()
  const parseErrors: { file: string; error: string }[] = []
  const defectFiles = listFiles(join(root, 'defects'), '.json')
  for (const f of defectFiles) {
    const rel = `defects/${f}`
    const parsed = parseDefectJson(readFileSync(join(root, rel), 'utf8'))
    if (!parsed.ok) {
      parseErrors.push({ file: rel, error: parsed.error })
      continue
    }
    // 同号文件（撞号）由校验器报 numbering:duplicate（#116）；这里后读覆盖先读，
    // 保证查询命令不至于崩溃。
    defects.set(parsed.record.id, { file: rel, record: parsed.record })
  }

  const replayScripts = new Set<string>(listFiles(join(root, 'replay'), '.mjs'))

  const reproSpecs = new Map<string, string[]>()
  for (const f of listFiles(join(root, 'tests/repro'), '.spec.ts')) {
    const m = /^def-(\d{4})\.spec\.ts$/.exec(f)
    if (!m) continue
    const id = `DEF-${m[1]}`
    const list = reproSpecs.get(id) ?? []
    list.push(`tests/repro/${f}`)
    reproSpecs.set(id, list)
  }

  const draftSpecs = new Map<string, string[]>()
  for (const f of listFiles(join(root, 'tests/repro/_drafts'), '.spec.ts')) {
    const m = /^def-(\d{4})\.draft\.spec\.ts$/.exec(f)
    if (!m) continue
    const id = `DEF-${m[1]}`
    const list = draftSpecs.get(id) ?? []
    list.push(`tests/repro/_drafts/${f}`)
    draftSpecs.set(id, list)
  }

  return { root, defects, defectFiles, replayScripts, reproSpecs, draftSpecs, parseErrors }
}

export function readIfExists(tree: DefectTree, relPath: string): string | undefined {
  const abs = join(tree.root, relPath)
  return existsSync(abs) ? readFileSync(abs, 'utf8') : undefined
}

export function defectJsonRel(id: string): string {
  return `defects/${id}.json`
}

export function specRel(id: string): string {
  return `tests/repro/def-${id.slice(4)}.spec.ts`
}

export function draftRel(id: string): string {
  return `tests/repro/_drafts/def-${id.slice(4)}.draft.spec.ts`
}

export function replayRel(id: string): string {
  return `replay/${id}.mjs`
}