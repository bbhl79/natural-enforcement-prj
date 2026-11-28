// 生命周期 CLI 的 #108 子命令（replay-plan / signature extract / signature compare）。
// 接缝 = 决策引擎公开入口 runCli(argv, sink, readStdin)：mkdtemp 临时树 + 注入 stdin，
// 零基础设施（不碰容器）。宿主侧编排由 devenv 离线测试与真跑冒烟覆盖。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../cli.js'
import type { OpSink } from '../ops.js'
import { REPLAY_SIGNATURE_SENTINEL } from './extract.js'

const temps: string[] = []
function tempTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'e2e-signature-cli-'))
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

function record(id: string, kind = 'external-state'): string {
  return JSON.stringify({
    schemaVersion: 1,
    id,
    title: `缺陷 ${id}`,
    summary: '摘要',
    status: 'reported',
    engine: 'agent-session',
    layer: 'api',
    discoveredAt: '2026-11-28T00:00:00Z',
    discoveredBy: 'agent',
    charter: '创建点位输入空间全量安全',
    suspectedArea: 'packages/contracts',
    severity: 'low',
    reproducibility: {
      kind,
      replayPath: `apps/e2e/replay/${id}.mjs`,
      replayCommand: `node apps/e2e/replay/${id}.mjs`,
      gate: { attempts: 0, keySpaces: [], allFailed: false },
    },
    evidence: [],
    sanitized: true,
  })
}

function run(root: string, args: string[], stdin = ''): { code: number; protocol: string[]; data: string[]; end: string } {
  const protocol: string[] = []
  const humanLines: string[] = []
  const sink: OpSink = { protocol: (l) => protocol.push(l), human: (l) => humanLines.push(l) }
  const code = runCli(['--root', root, ...args], sink, () => stdin)
  const data = protocol.filter((l) => !/^(W|D|V|END)\t/.test(l))
  const end = protocol.find((l) => l.startsWith('END\t')) ?? ''
  return { code, protocol, data, end }
}

/** 协议数据行 → key/value（tab 分字段） */
function fields(data: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of data) {
    const [k, ...rest] = line.split('\t')
    if (k) out[k] = rest.join('\t')
  }
  return out
}

describe('replay-plan：重放计划（宿主据此执行记录内 replayCommand）', () => {
  it('合法记录 → CMD/KIND/ATTEMPTS/SCRIPT/TITLE 数据行 + END ok 0', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0002.json', record('DEF-0002'))
    put(root, 'replay/DEF-0002.mjs', 'process.exit(0)\n')
    const r = run(root, ['replay-plan', 'DEF-0002'])
    expect(r.code).toBe(0)
    const f = fields(r.data)
    expect(f.CMD).toBe('node apps/e2e/replay/DEF-0002.mjs')
    expect(f.KIND).toBe('external-state')
    expect(f.ATTEMPTS).toBe('3') // 依赖外部状态：独立键空间 ≥3 次（门禁下限）
    expect(f.SCRIPT).toBe('replay/DEF-0002.mjs')
    expect(f.TITLE).toBe('缺陷 DEF-0002')
    expect(r.end).toBe('END\tok\t0\t重放计划已输出（DEF-0002）')
  })

  it('纯函数/无外部状态 → ATTEMPTS=1（门禁按被测路径分类，不按引擎）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', record('DEF-0001', 'pure'))
    put(root, 'replay/DEF-0001.mjs', 'process.exit(0)\n')
    expect(fields(run(root, ['replay-plan', 'DEF-0001']).data).ATTEMPTS).toBe('1')
  })

  it('未知 ID / 非法记录 / ID 形态非法 → exit 10（零数据行）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0002.json', record('DEF-0002'))
    put(root, 'replay/DEF-0002.mjs', 'process.exit(0)\n')
    expect(run(root, ['replay-plan', 'DEF-9999']).code).toBe(10)
    expect(run(root, ['replay-plan', 'DEF-1']).code).toBe(10)
    put(root, 'defects/DEF-0003.json', '{"schemaVersion":1,"id":"DEF-0003"')
    expect(run(root, ['replay-plan', 'DEF-0003']).code).toBe(10)
  })

  it('复现脚本缺失 → exit 10（脚本随记录入库是长期重建依据）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0002.json', record('DEF-0002'))
    const r = run(root, ['replay-plan', 'DEF-0002'])
    expect(r.code).toBe(10)
    expect(r.end).toContain('复现脚本缺失')
  })

  it('replayCommand 含 tab/换行 → 拒绝（行协议不可被注入截断）', () => {
    const root = tempTree()
    const bad = JSON.parse(record('DEF-0002')) as Record<string, unknown>
    const repro = bad.reproducibility as Record<string, unknown>
    repro.replayCommand = 'node apps/e2e/replay/DEF-0002.mjs\tevil'
    put(root, 'defects/DEF-0002.json', JSON.stringify(bad))
    put(root, 'replay/DEF-0002.mjs', 'process.exit(0)\n')
    expect(run(root, ['replay-plan', 'DEF-0002']).code).toBe(10)
  })

  it('缺 ID → 用法错误 2', () => {
    expect(run(tempTree(), ['replay-plan']).code).toBe(2)
  })
})

describe('signature extract：两个来源的提取走同一决策引擎入口', () => {
  it('--source replay：stdin 是脚本输出 → 单行 JSON 结果（found/signature/outcome）', () => {
    const payload = `噪声\n${REPLAY_SIGNATURE_SENTINEL} {"schemaVersion":1,"assertionId":"a","errorClass":"assertion","outcome":"reproduced","semanticMarkers":[{"key":"http.status.actual","value":"201"}]}\n`
    const r = run(tempTree(), ['signature', 'extract', '--source', 'replay'], payload)
    expect(r.code).toBe(0)
    expect(r.data).toHaveLength(1)
    const out = JSON.parse(r.data[0] ?? '{}') as Record<string, unknown>
    expect(out.source).toBe('replay')
    expect(out.found).toBe(true)
    expect(out.outcome).toBe('reproduced')
    expect((out.signature as Record<string, unknown>).assertionId).toBe('a')
    // 结果必须是单行紧凑 JSON（JSONL 结果流不被多行文档破坏）
    expect(r.data[0]).not.toContain('\n')
  })

  it('--source replay：无标记 → found=false（不编造签名），仍 END ok 0', () => {
    const r = run(tempTree(), ['signature', 'extract', '--source', 'replay'], '普通日志\n')
    expect(r.code).toBe(0)
    expect(JSON.parse(r.data[0] ?? '{}').found).toBe(false)
  })

  it('--source playwright：stdin 是结果 JSON → failures 数组（逐断言签名）', () => {
    const report = {
      suites: [{
        title: 'def-0001.spec.ts', file: 'def-0001.spec.ts',
        specs: [{
          title: 'DEF-0001', file: 'def-0001.spec.ts',
          tests: [{
            status: 'unexpected', expectedStatus: 'passed', annotations: [],
            results: [{ status: 'failed', retry: 0, errors: [{ message: 'Error: expect(received).toBe(expected)\n\nExpected: 500\nReceived: 200' }] }],
          }],
        }],
      }],
      stats: { expected: 0, unexpected: 1, flaky: 0, skipped: 0 },
    }
    const r = run(tempTree(), ['signature', 'extract', '--source', 'playwright'], JSON.stringify(report))
    expect(r.code).toBe(0)
    const out = JSON.parse(r.data[0] ?? '{}') as { source: string; failures: { signature: { errorClass: string; semanticMarkers: { key: string; value: string }[] } }[] }
    expect(out.source).toBe('playwright')
    expect(out.failures).toHaveLength(1)
    expect(out.failures[0]?.signature.errorClass).toBe('assertion')
    expect(out.failures[0]?.signature.semanticMarkers).toContainEqual({ key: 'expected', value: '500' })
  })

  it('--source playwright：结果 JSON 非法 → END error 2（不静默判成功）', () => {
    const r = run(tempTree(), ['signature', 'extract', '--source', 'playwright'], '{不是 JSON')
    expect(r.code).toBe(2)
    expect(r.data).toHaveLength(0)
  })

  it('--source 非法/缺失 → 用法错误 2', () => {
    expect(run(tempTree(), ['signature', 'extract', '--source', 'bogus']).code).toBe(2)
    expect(run(tempTree(), ['signature', 'extract']).code).toBe(2)
    expect(run(tempTree(), ['signature', 'bogus']).code).toBe(2)
  })
})

describe('signature compare：多轮比对原语的引擎入口（#109/#112 共用）', () => {
  const sig = (expected: string): unknown => ({
    errorClass: 'assertion',
    assertionId: 'tests/repro/def-0001.spec.ts#DEF-0001#a1',
    semanticMarkers: [{ key: 'expected', value: expected }, { key: 'actual', value: '500' }],
  })

  it('全部轮次匹配 → allMatched=true + 逐轮 results', () => {
    const payload = JSON.stringify({ baseline: sig('< 500'), candidates: [sig('< 500'), sig('< 500')] })
    const r = run(tempTree(), ['signature', 'compare'], payload)
    expect(r.code).toBe(0)
    const out = JSON.parse(r.data[0] ?? '{}') as { allMatched: boolean; results: { index: number; matched: boolean }[] }
    expect(out.allMatched).toBe(true)
    expect(out.results.map((x) => x.index)).toEqual([0, 1])
  })

  it('断言弱化（500→400）→ allMatched=false + 差异定位到语义标记', () => {
    const payload = JSON.stringify({ baseline: sig('< 500'), candidates: [sig('< 400')] })
    const r = run(tempTree(), ['signature', 'compare'], payload)
    const out = JSON.parse(r.data[0] ?? '{}') as { allMatched: boolean; results: { reason: string; differences: { key?: string; a: string | null; b: string | null }[] }[] }
    expect(out.allMatched).toBe(false)
    expect(out.results[0]?.reason).toBe('semantic-markers-differ')
    expect(out.results[0]?.differences).toContainEqual({ dimension: 'semanticMarkers', key: 'expected', a: '< 500', b: '< 400' })
  })

  it('基线为 null（无证据）→ allMatched=false；payload 非法 → END error 2', () => {
    const ok = run(tempTree(), ['signature', 'compare'], JSON.stringify({ baseline: null, candidates: [sig('< 500')] }))
    expect(ok.code).toBe(0)
    expect(JSON.parse(ok.data[0] ?? '{}').allMatched).toBe(false)
    expect(run(tempTree(), ['signature', 'compare'], '{坏').code).toBe(2)
    expect(run(tempTree(), ['signature', 'compare'], JSON.stringify({ baseline: { errorClass: 'bogus' }, candidates: [] })).code).toBe(2)
  })
})