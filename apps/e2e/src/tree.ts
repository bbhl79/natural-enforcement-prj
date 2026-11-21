// PROTOTYPE（#13）— 生命周期树装载：devenv 经 stdin tar 把 apps/e2e/{defects,replay,tests}
// 打进容器解包到 /tmp/in，CLI 以 --root 指向该目录只读工作（无 bind 架构的读取通道）。
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseDefectJson, type DefectId, type DefectRecord } from './defect/schema.js'

export interface LoadedDefect {
  file: string // defects/DEF-NNNN.json
  record: DefectRecord
}

export interface DefectTree {
  root: string
  defects: Map<DefectId, LoadedDefect>
  defectFiles: string[] // defects/ 下全部 .json（含解析失败的，供报错定位）
  replayScripts: Set<string> // replay/DEF-NNNN.mjs 文件名（不含路径）
  reproSpecs: Map<DefectId, string[]> // tests/repro/def-NNNN.spec.ts（相对 root）
  draftSpecs: Map<DefectId, string[]> // tests/repro/_drafts/def-NNNN.draft.spec.ts
  parseErrors: { file: string; error: string }[]
}

function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
}

export function loadTree(root: string): DefectTree {
  const defects = new Map<DefectId, LoadedDefect>()
  const parseErrors: { file: string; error: string }[] = []
  const defectFiles = listJsonFiles(join(root, 'defects'))
  for (const f of defectFiles) {
    const rel = `defects/${f}`
    const parsed = parseDefectJson(readFileSync(join(root, rel), 'utf8'))
    if (!parsed.ok) {
      parseErrors.push({ file: rel, error: parsed.error })
      continue
    }
    // 同号文件（DEF-0001.json 与 DEF-0001-2.json 类撞号）由 verify 报 numbering:duplicate；
    // 这里后读覆盖先读，保证 CLI 不至于崩溃。
    defects.set(parsed.record.id, { file: rel, record: parsed.record })
  }

  const replayDir = join(root, 'replay')
  const replayScripts = new Set<string>(
    existsSync(replayDir) ? readdirSync(replayDir).filter((f) => f.endsWith('.mjs')) : [],
  )

  const reproSpecs = new Map<DefectId, string[]>()
  const reproDir = join(root, 'tests/repro')
  if (existsSync(reproDir)) {
    for (const f of readdirSync(reproDir)) {
      const m = /^def-(\d{4})\.spec\.ts$/.exec(f)
      if (!m) continue
      const id = `DEF-${m[1]}` as DefectId
      const list = reproSpecs.get(id) ?? []
      list.push(`tests/repro/${f}`)
      reproSpecs.set(id, list)
    }
  }

  const draftSpecs = new Map<DefectId, string[]>()
  const draftDir = join(root, 'tests/repro/_drafts')
  if (existsSync(draftDir)) {
    for (const f of readdirSync(draftDir)) {
      const m = /^def-(\d{4})\.draft\.spec\.ts$/.exec(f)
      if (!m) continue
      const id = `DEF-${m[1]}` as DefectId
      const list = draftSpecs.get(id) ?? []
      list.push(`tests/repro/_drafts/${f}`)
      draftSpecs.set(id, list)
    }
  }

  return { root, defects, defectFiles, replayScripts, reproSpecs, draftSpecs, parseErrors }
}

export function readIfExists(tree: DefectTree, relPath: string): string | undefined {
  const abs = join(tree.root, relPath)
  return existsSync(abs) ? readFileSync(abs, 'utf8') : undefined
}

export function defectJsonRel(id: DefectId): string {
  return `defects/${id}.json`
}

export function specRel(id: DefectId): string {
  return `tests/repro/def-${id.slice(4)}.spec.ts`
}

export function draftRel(id: DefectId): string {
  return `tests/repro/_drafts/def-${id.slice(4)}.draft.spec.ts`
}

export function replayRel(id: DefectId): string {
  return `replay/${id}.mjs`
}
