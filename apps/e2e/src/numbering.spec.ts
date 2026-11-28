// DEF-NNNN 取号（#106；Spec-e2e §4）：本地 max+1，可叠读远端已有编号（经 devenv gh，
// best-effort）。撞号由后合入方机械重排（#116 renumber）；取号不填洞（断号由校验器报）。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatDefectId, localMaxNumber, nextDefectId } from './numbering.js'
import { loadTree } from './tree.js'

const temps: string[] = []
function tempTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'e2e-lifecycle-numbering-'))
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

describe('DEF-NNNN 取号', () => {
  it('空树从 DEF-0001 起', () => {
    const root = tempTree()
    expect(localMaxNumber(loadTree(root))).toBe(0)
    expect(nextDefectId(loadTree(root))).toEqual({ id: 'DEF-0001', localMax: 0, remoteMax: 0 })
  })

  it('本地 max+1（不是计数 +1）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', '{}')
    put(root, 'defects/DEF-0002.json', '{}')
    expect(nextDefectId(loadTree(root)).id).toBe('DEF-0003')
  })

  it('断号不填洞：取 max+1（洞由校验器报，#116）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', '{}')
    put(root, 'defects/DEF-0003.json', '{}')
    expect(localMaxNumber(loadTree(root))).toBe(3)
    expect(nextDefectId(loadTree(root)).id).toBe('DEF-0004')
  })

  it('编号按文件名集合：非法内容的记录仍占号（事实源永不删除）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0005.json', '{broken')
    put(root, 'defects/notes.json', '{}')
    expect(localMaxNumber(loadTree(root))).toBe(5)
    expect(nextDefectId(loadTree(root)).id).toBe('DEF-0006')
  })

  it('远端叠读取 max(本地, 远端)+1（多 agent 并发取号不互相阻塞）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0002.json', '{}')
    expect(nextDefectId(loadTree(root), 7)).toEqual({ id: 'DEF-0008', localMax: 2, remoteMax: 7 })
    // 远端落后于本地时用本地
    expect(nextDefectId(loadTree(root), 1)).toEqual({ id: 'DEF-0003', localMax: 2, remoteMax: 1 })
  })

  it('编号格式补零四位；容量耗尽明确报错（不静默产出非法 ID）', () => {
    expect(formatDefectId(1)).toBe('DEF-0001')
    expect(formatDefectId(42)).toBe('DEF-0042')
    expect(formatDefectId(9999)).toBe('DEF-9999')
    expect(() => formatDefectId(10000)).toThrow()
    expect(() => formatDefectId(0)).toThrow()
  })
})