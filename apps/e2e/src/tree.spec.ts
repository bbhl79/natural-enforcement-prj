// 生命周期树装载（#106）：宿主树经 stdin tar 只读进容器，CLI 以 --root 指向该目录。
// 单测用 mkdtemp 临时目录树，零基础设施（不碰容器/数据库）。
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defectJsonRel,
  draftRel,
  loadTree,
  readIfExists,
  replayRel,
  specRel,
} from './tree.js'

const temps: string[] = []
function tempTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'e2e-lifecycle-tree-'))
  temps.push(root)
  return root
}
afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function put(root: string, rel: string, content: string): void {
  const abs = join(root, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

const reported = (id: string, engine = 'agent-session'): string =>
  JSON.stringify({
    schemaVersion: 1,
    id,
    title: `缺陷 ${id}`,
    summary: '摘要',
    status: 'reported',
    engine,
    layer: 'api',
    discoveredAt: '2026-11-28T00:00:00Z',
    discoveredBy: 'agent',
    charter: '创建点位输入空间全量安全',
    suspectedArea: 'packages/contracts',
    severity: 'low',
    reproducibility: {
      kind: 'pure',
      replayCommand: `node apps/e2e/replay/${id}.mjs`,
      gate: { attempts: 1, keySpaces: ['rep-1'], allFailed: true },
      ...(engine === 'fast-check'
        ? { counterexample: { request: { method: 'POST', path: '/enforcement-points' } } }
        : {}),
    },
    evidence: [],
    sanitized: true,
  })

describe('生命周期树装载（只读）', () => {
  it('空目录 → 空树（绿地无缺陷记录是合法状态）', () => {
    const root = tempTree()
    const tree = loadTree(root)
    expect(tree.defects.size).toBe(0)
    expect(tree.parseErrors).toEqual([])
    expect(tree.defectFiles).toEqual([])
    expect(tree.replayScripts.size).toBe(0)
  })

  it('装载缺陷记录 / replay 脚本 / 复现用例 / 草稿（目录表达轨道归属）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', reported('DEF-0001', 'fast-check'))
    put(root, 'defects/DEF-0002.json', reported('DEF-0002'))
    put(root, 'replay/DEF-0001.mjs', 'process.exit(0)\n')
    put(root, 'replay/DEF-0002.mjs', 'process.exit(0)\n')
    put(root, 'tests/repro/def-0001.spec.ts', '// defect: DEF-0001\n')
    put(root, 'tests/repro/_drafts/def-0002.draft.spec.ts', '// defect: DEF-0002\n')
    const tree = loadTree(root)
    expect([...tree.defects.keys()].sort()).toEqual(['DEF-0001', 'DEF-0002'])
    expect(tree.defects.get('DEF-0001')?.file).toBe('defects/DEF-0001.json')
    expect([...tree.replayScripts].sort()).toEqual(['DEF-0001.mjs', 'DEF-0002.mjs'])
    expect(tree.reproSpecs.get('DEF-0001')).toEqual(['tests/repro/def-0001.spec.ts'])
    expect(tree.draftSpecs.get('DEF-0002')).toEqual(['tests/repro/_drafts/def-0002.draft.spec.ts'])
    expect(tree.parseErrors).toEqual([])
  })

  it('非法记录进 parseErrors（可定位），合法记录仍装载——不因一条坏记录崩溃', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', reported('DEF-0001'))
    put(root, 'defects/DEF-0002.json', '{"schemaVersion":1,')
    put(root, 'defects/DEF-0003.json', JSON.stringify({ schemaVersion: 1, id: 'DEF-0003' }))
    const tree = loadTree(root)
    expect(tree.defects.size).toBe(1)
    expect(tree.parseErrors.map((e) => e.file)).toEqual(['defects/DEF-0002.json', 'defects/DEF-0003.json'])
    expect(tree.parseErrors[0]?.error).toContain('JSON 解析失败')
    expect(tree.parseErrors[1]?.error).toContain('schema 不符')
    expect(tree.defectFiles).toHaveLength(3)
  })

  it('路径约定：defects/<ID>.json、tests/repro/def-<n>.spec.ts、_drafts、replay/<ID>.mjs', () => {
    expect(defectJsonRel('DEF-0001')).toBe('defects/DEF-0001.json')
    expect(specRel('DEF-0001')).toBe('tests/repro/def-0001.spec.ts')
    expect(draftRel('DEF-0001')).toBe('tests/repro/_drafts/def-0001.draft.spec.ts')
    expect(replayRel('DEF-0001')).toBe('replay/DEF-0001.mjs')
  })

  it('readIfExists 读相对路径内容；不存在返回 undefined', () => {
    const root = tempTree()
    put(root, 'replay/DEF-0001.mjs', 'process.exit(0)\n')
    const tree = loadTree(root)
    expect(readIfExists(tree, 'replay/DEF-0001.mjs')).toBe('process.exit(0)\n')
    expect(readIfExists(tree, 'replay/DEF-9999.mjs')).toBeUndefined()
  })

  it('装载只读：不创建/修改树内任何文件（写盘只能经 op 协议由宿主执行）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', reported('DEF-0001'))
    const before = readdirSync(root).sort()
    loadTree(root)
    expect(readdirSync(root).sort()).toEqual(before)
    expect(readdirSync(join(root, 'defects'))).toEqual(['DEF-0001.json'])
  })
})