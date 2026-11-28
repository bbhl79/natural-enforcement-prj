// 注册表 = 派生缓存（#106；Spec-e2e §3 / ADR §2）：不入库、始终重建、漂移仅 WARN。
// 原型实证「漂移即红」会死锁（verify 失败时不重写缓存 → 下次必报 drift → 永远红）；
// 完整性锚在入库缺陷记录与 git 历史，缓存只证「派生可重建」。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { REGISTRY_FILE, rebuildRegistry, registryDrifted } from './registry.js'
import { loadTree } from './tree.js'

const temps: string[] = []
function tempTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'e2e-lifecycle-registry-'))
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

function record(id: string, status: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    id,
    title: `缺陷 ${id}`,
    summary: '摘要',
    status,
    engine: 'agent-session',
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
    },
    evidence: [],
    sanitized: true,
    ...(status === 'graduated'
      ? {
          graduation: {
            at: '2026-11-28T01:00:00Z',
            by: 'human',
            specPath: `tests/repro/def-${id.slice(4)}.spec.ts`,
            mode: 'expected-fail',
            verifiedRun: { expect: 'fail', outcome: 'fail', at: '2026-11-28T01:00:00Z' },
          },
        }
      : {}),
  })
}

describe('注册表（派生缓存）', () => {
  it('重建与事实源同构：按 id 排序，含 status/engine/specPath', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0002.json', record('DEF-0002', 'reported'))
    put(root, 'defects/DEF-0001.json', record('DEF-0001', 'graduated'))
    put(root, 'tests/repro/def-0001.spec.ts', '// defect: DEF-0001\n')
    const rebuilt = JSON.parse(rebuildRegistry(loadTree(root))) as {
      defects: { id: string; status: string; engine: string; specPath: string | null }[]
    }
    expect(rebuilt.defects.map((d) => d.id)).toEqual(['DEF-0001', 'DEF-0002'])
    expect(rebuilt.defects[0]).toEqual({
      id: 'DEF-0001',
      status: 'graduated',
      engine: 'agent-session',
      specPath: 'tests/repro/def-0001.spec.ts',
    })
    expect(rebuilt.defects[1]?.specPath).toBeNull()
  })

  it('空树重建为空索引（绿地合法）', () => {
    const root = tempTree()
    expect(JSON.parse(rebuildRegistry(loadTree(root)))).toEqual({ defects: [] })
  })

  it('缓存不存在 → 不算漂移（首次重建）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', record('DEF-0001', 'reported'))
    expect(registryDrifted(loadTree(root))).toBe(false)
  })

  it('缓存与事实源一致 → 不漂移；被手改/过期 → 漂移', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', record('DEF-0001', 'reported'))
    const tree = loadTree(root)
    put(root, REGISTRY_FILE, rebuildRegistry(tree))
    expect(registryDrifted(loadTree(root))).toBe(false)
    // 手改缓存（原型工作树里的活样本：status 与事实源不符）
    put(root, REGISTRY_FILE, '{"defects":[{"id":"DEF-0001","status":"retired","engine":"agent-session","specPath":null}]}\n')
    expect(registryDrifted(loadTree(root))).toBe(true)
    // 非法 JSON 缓存也算漂移（可重建即自愈）
    put(root, REGISTRY_FILE, '{broken')
    expect(registryDrifted(loadTree(root))).toBe(true)
  })

  it('漂移不阻断重建：始终重建出与事实源同构的缓存（WARN-only 语义的根据）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', record('DEF-0001', 'reported'))
    put(root, REGISTRY_FILE, '{"defects":[]}')
    expect(registryDrifted(loadTree(root))).toBe(true)
    const rebuilt = rebuildRegistry(loadTree(root))
    expect(JSON.parse(rebuilt).defects).toHaveLength(1)
    // 重建结果落盘后即不再漂移（缓存自愈，无需人工干预）
    put(root, REGISTRY_FILE, rebuilt)
    expect(registryDrifted(loadTree(root))).toBe(false)
    expect(readFileSync(join(root, REGISTRY_FILE), 'utf8')).toBe(rebuilt)
  })

  it('注册表只是索引：不复制标题/摘要/证据（事实源唯一）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', record('DEF-0001', 'reported'))
    const text = rebuildRegistry(loadTree(root))
    expect(text).not.toContain('摘要')
    expect(text).not.toContain('replayCommand')
    expect(text.endsWith('\n')).toBe(true)
  })
})