// PROTOTYPE（#13）— 防降级校验器单测：verify 是 CI 门禁，自身先过单测（临时树驱动，零基础设施）
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DefectRecord } from './defect/schema.js'
import { loadTree } from './tree.js'
import { rebuildRegistry, REGISTRY_FILE, registryDrifted, verifyTree } from './verify.js'
import { PLACEHOLDER_ASSERT, transcribeDraft, transcribeMechanical } from './transcribe.js'

const dirs: string[] = []
function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ne-verify-'))
  dirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

const def = (over: Partial<DefectRecord>): DefectRecord => ({
  schemaVersion: 1,
  id: 'DEF-0001',
  title: 't',
  summary: 's',
  status: 'reported',
  engine: 'fast-check',
  layer: 'api',
  discoveredAt: '2026-11-21T00:00:00Z',
  discoveredBy: 'a',
  charter: 'c',
  suspectedArea: 'x',
  severity: 'medium',
  reproducibility: {
    kind: 'deterministic',
    replayCommand: 'node apps/e2e/replay/DEF-0001.mjs',
    counterexample: { request: { method: 'POST', path: '/p', body: { a: 1 } } },
    gate: { attempts: 1, keySpaces: ['r1'], allFailed: true },
  },
  evidence: [],
  sanitized: true,
  ...over,
})

const reported = def({})

describe('verifyTree：干净树', () => {
  it('reported（含 replay 脚本 + 达标门禁）全绿', () => {
    const root = makeTree({
      'defects/DEF-0001.json': JSON.stringify(reported),
      'replay/DEF-0001.mjs': 'export {}',
    })
    expect(verifyTree(loadTree(root))).toEqual([])
  })
})

describe('verifyTree：防降级规则逐条触发', () => {
  it('索引一致性：graduated 缺用例 / 文件头链接失配 / 用例无记录', () => {
    const root = makeTree({
      'defects/DEF-0001.json': JSON.stringify(def({ status: 'graduated', graduation: gradBlock() })),
      'replay/DEF-0001.mjs': 'export {}',
    })
    expect(verifyTree(loadTree(root)).some((v) => v.rule === 'index' && v.detail.includes('缺 tests/repro'))).toBe(true)

    const root2 = makeTree({
      'defects/DEF-0001.json': JSON.stringify(def({ status: 'graduated', graduation: gradBlock() })),
      'replay/DEF-0001.mjs': 'export {}',
      'tests/repro/def-0001.spec.ts': transcribeMechanical(reported, true).replace('// defect: DEF-0001', '// defect: DEF-0002'),
    })
    expect(verifyTree(loadTree(root2)).some((v) => v.detail.includes('双向匹配'))).toBe(true)

    const root3 = makeTree({
      'replay/DEF-0009.mjs': 'export {}',
      'tests/repro/def-0009.spec.ts': '// defect: DEF-0009\n',
    })
    expect(verifyTree(loadTree(root3)).some((v) => v.detail.includes('无 DEF-0009 缺陷记录'))).toBe(true)
  })

  it('注解纪律：skip/fixme 全禁；test.fail 当且仅当 graduated', () => {
    const spec = transcribeMechanical(reported, true)
    const root = makeTree({
      'defects/DEF-0001.json': JSON.stringify(def({ status: 'graduated', graduation: gradBlock() })),
      'replay/DEF-0001.mjs': 'export {}',
      'tests/repro/def-0001.spec.ts': spec.replace('test.fail()', 'test.skip()'),
    })
    expect(verifyTree(loadTree(root)).some((v) => v.rule === 'annotation' && v.detail.includes('test.skip'))).toBe(true)

    const root2 = makeTree({
      'defects/DEF-0001.json': JSON.stringify(def({ status: 'graduated', graduation: gradBlock() })),
      'replay/DEF-0001.mjs': 'export {}',
      'tests/repro/def-0001.spec.ts': transcribeMechanical(reported, false), // graduated 却无 fail 行
    })
    expect(verifyTree(loadTree(root2)).some((v) => v.detail.includes('必须（且仅）1 个 test.fail'))).toBe(true)

    const fixed = def({ status: 'fixed', graduation: gradBlock(), fix: { at: '2026-11-21T01:00:00Z', by: 'a' } })
    const root3 = makeTree({
      'defects/DEF-0001.json': JSON.stringify(fixed),
      'replay/DEF-0001.mjs': 'export {}',
      'tests/repro/def-0001.spec.ts': spec, // fixed 却带 fail 行（修复确认未摘标记）
    })
    expect(verifyTree(loadTree(root3)).some((v) => v.detail.includes('仅限 graduated'))).toBe(true)
  })

  it('编号纪律：断号即红；retired 残留测试即红', () => {
    const root = makeTree({
      'defects/DEF-0001.json': JSON.stringify(reported),
      'defects/DEF-0003.json': JSON.stringify(def({ id: 'DEF-0003', status: 'retired', retirement: { at: '2026-11-21T01:00:00Z', by: 'a', reason: 'r' }, reproducibility: { ...reported.reproducibility, replayCommand: 'node apps/e2e/replay/DEF-0003.mjs' } })),
      'replay/DEF-0001.mjs': 'export {}',
      'replay/DEF-0003.mjs': 'export {}',
      'tests/repro/def-0003.spec.ts': '// defect: DEF-0003\n',
    })
    const vs = verifyTree(loadTree(root))
    expect(vs.some((v) => v.rule === 'numbering:hole' && v.detail.includes('DEF-0002'))).toBe(true)
    expect(vs.some((v) => v.rule === 'index' && v.detail.includes('retired 残留'))).toBe(true)
  })

  it('门禁证据：非确定引擎 <3 次 / allFailed=false 即红', () => {
    const root = makeTree({
      'defects/DEF-0001.json': JSON.stringify(
        def({ reproducibility: { ...reported.reproducibility, kind: 'nondeterministic', gate: { attempts: 2, keySpaces: ['r1'], allFailed: false }, counterexample: undefined }, engine: 'monkey' }),
      ),
      'replay/DEF-0001.mjs': 'export {}',
    })
    const vs = verifyTree(loadTree(root))
    expect(vs.some((v) => v.rule === 'gate' && v.detail.includes('attempts=2 < 3'))).toBe(true)
    expect(vs.some((v) => v.rule === 'gate' && v.detail.includes('allFailed=false'))).toBe(true)
  })

  it('草稿纪律：reported 允许草稿但不得启用 fail；占位断言草稿在场不红', () => {
    const draft = transcribeDraft(reported)
    expect(draft).toContain(PLACEHOLDER_ASSERT)
    const root = makeTree({
      'defects/DEF-0001.json': JSON.stringify(reported),
      'replay/DEF-0001.mjs': 'export {}',
      'tests/repro/_drafts/def-0001.draft.spec.ts': draft,
    })
    expect(verifyTree(loadTree(root))).toEqual([])
  })

  it('注册表漂移不作硬门禁（缓存自愈；实测 #13 死锁修复）', () => {
    const root = makeTree({
      'defects/DEF-0001.json': JSON.stringify(reported),
      'replay/DEF-0001.mjs': 'export {}',
      [REGISTRY_FILE]: JSON.stringify({ defects: [{ id: 'DEF-0001', status: 'fixed', engine: 'fast-check', specPath: null }] }),
    })
    expect(verifyTree(loadTree(root))).toEqual([]) // 事实源干净 → 缓存漂移不红（CLI WARN + 重建）
    expect(registryDrifted(loadTree(root))).toBe(true) // 但漂移可被检测（供 WARN）
  })
})

function gradBlock(): DefectRecord['graduation'] {
  return {
    at: '2026-11-21T01:00:00Z',
    by: 'a',
    specPath: 'tests/repro/def-0001.spec.ts',
    mode: 'expected-fail',
    verifiedRun: { expect: 'fail', outcome: 'fail', at: '2026-11-21T01:00:00Z' },
  }
}

describe('rebuildRegistry', () => {
  it('与事实源同构（排序、状态、spec 路径）', () => {
    const root = makeTree({
      'defects/DEF-0001.json': JSON.stringify(reported),
      'replay/DEF-0001.mjs': 'export {}',
    })
    const reg = JSON.parse(rebuildRegistry(loadTree(root)))
    expect(reg.defects).toEqual([{ id: 'DEF-0001', status: 'reported', engine: 'fast-check', specPath: null }])
  })
})
