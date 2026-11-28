// report 输入契约单测（#109；Spec-e2e §4 记录 schema / §5 门禁前置）。
//
// 接缝 = 发现载荷的解析/归一化纯函数（零基础设施）。期望值取自规格：
// 属性发现（#107 results.json 的 property-finding 附件）必须无损携带
// seed/counterexamplePath/counterexample 进 reproducibility；并发缺陷必属
// 依赖外部状态路径；每轮前置状态必须显式声明。
import { describe, expect, it } from 'vitest'
import { extractPropertyFinding, normalizeReportFinding } from './finding.js'

const PROPERTY_FINDING = {
  schemaVersion: 1,
  engine: 'fast-check',
  property: 'P0/GAP-PT-NAME-01/point-name-nonblank',
  rule: 'GAP-PT-NAME-01',
  charter: 'point-input-safety',
  seed: 123456789,
  counterexample: ['   '],
  counterexamplePath: '0:1:0',
  numRuns: 10,
  numShrinks: 3,
  request: {
    method: 'post',
    path: '/enforcement-points',
    body: { name: '   ', lat: 23.1291, lng: 113.2644 },
  },
}

function payload(over: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    source: 'property-finding',
    title: '点位名称纯空白被接受入库',
    summary: '契约 min(1) 只查长度，纯空白名过校验并入库（201）',
    suspectedArea: 'packages/contracts/src/enforcement-point.ts',
    layer: 'api',
    severity: 'low',
    finding: PROPERTY_FINDING,
    reproducibility: {
      kind: 'external-state',
      precondition: '每轮：空库 + migrate deploy + 空 bucket + 空队列键空间',
      replayScript: 'process.exit(0)\n',
    },
    ...over,
  }
}

describe('normalizeReportFinding（发现载荷 → 登记输入）', () => {
  it('属性发现：engine/charter/seed/path/counterexample 无损归一化', () => {
    const r = normalizeReportFinding(payload())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.engine).toBe('fast-check')
    expect(r.value.charter).toBe('point-input-safety')
    expect(r.value.reproducibility.seed).toBe('123456789')
    expect(r.value.reproducibility.path).toBe('0:1:0')
    expect(r.value.reproducibility.counterexample).toEqual({
      property: 'P0/GAP-PT-NAME-01/point-name-nonblank',
      request: {
        method: 'POST',
        path: '/enforcement-points',
        body: { name: '   ', lat: 23.1291, lng: 113.2644 },
      },
      input: ['   '],
    })
  })

  it('并发声明在场却 kind=pure → 拒绝（并发必然依赖外部状态）', () => {
    const r = normalizeReportFinding(
      payload({
        reproducibility: {
          kind: 'pure',
          precondition: '单轮：无外部状态',
          replayScript: 'process.exit(0)\n',
          concurrency: { triggerOrder: ['先上传', '再重复入队'], timing: '两操作间隔 <50ms' },
        },
      }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('external-state')
  })

  it('并发声明 + external-state → 保留 triggerOrder/timing（第三方可独立复验）', () => {
    const concurrency = { triggerOrder: ['先上传', '再重复入队'], timing: '两操作间隔 <50ms', preservedBy: '脚本按序 await，不省略等待' }
    const r = normalizeReportFinding(
      payload({
        reproducibility: {
          kind: 'external-state',
          precondition: '每轮：空库 + migrate deploy',
          replayScript: 'process.exit(0)\n',
          concurrency,
        },
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.reproducibility.concurrency).toEqual(concurrency)
  })

  it('自查申报被输入契约结构性拒绝：载荷含 gate/attempts → schema 不符', () => {
    const gate = { attempts: 3, keySpaces: ['a', 'b', 'c'], allFailed: true }
    const withGate = { ...(payload() as Record<string, unknown>), gate }
    expect(normalizeReportFinding(withGate).ok).toBe(false)
    const base = payload() as { reproducibility: Record<string, unknown> }
    const withReproGate = { ...base, reproducibility: { ...base.reproducibility, gate } }
    expect(normalizeReportFinding(withReproGate).ok).toBe(false)
  })

  it('缺明确前置状态声明 → 拒绝（Spec-e2e §5 每轮须从明确前置状态开始）', () => {
    const r = normalizeReportFinding(
      payload({ reproducibility: { kind: 'external-state', replayScript: 'process.exit(0)\n' } }),
    )
    expect(r.ok).toBe(false)
  })

  it('source=property-finding 但缺 finding → 拒绝（属性发现必须可机械归因）', () => {
    const p = payload() as Record<string, unknown>
    delete p['finding']
    expect(normalizeReportFinding(p).ok).toBe(false)
  })
})

describe('extractPropertyFinding（results.json → 属性发现）', () => {
  const attachment = (f: unknown): unknown => ({
    suites: [
      { specs: [{ tests: [{ results: [{ attachments: [{ name: 'property-finding', body: Buffer.from(JSON.stringify(f), 'utf8').toString('base64'), contentType: 'application/json' }] }] }] }] },
    ],
  })
  const F1 = { ...PROPERTY_FINDING }
  const F2 = { ...PROPERTY_FINDING, property: 'P0/EV-STATE/terminal-absorption', rule: 'EV-STATE' }

  it('单个发现：base64 附件无损解码', () => {
    const r = extractPropertyFinding(JSON.stringify(attachment(F1)))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.finding.seed).toBe(123456789)
    expect(r.finding.counterexamplePath).toBe('0:1:0')
  })

  it('多个发现未选定 → 拒绝（不静默取第一个）', () => {
    const report = { suites: [{ specs: [{ tests: [{ results: [{ attachments: [
      { name: 'property-finding', body: Buffer.from(JSON.stringify(F1), 'utf8').toString('base64') },
      { name: 'property-finding', body: Buffer.from(JSON.stringify(F2), 'utf8').toString('base64') },
    ] }] }] }] }] }
    const r = extractPropertyFinding(JSON.stringify(report))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('--property')
  })

  it('多个发现以 --property 选定 → 命中该条', () => {
    const report = { suites: [{ specs: [{ tests: [{ results: [{ attachments: [
      { name: 'property-finding', body: Buffer.from(JSON.stringify(F1), 'utf8').toString('base64') },
      { name: 'property-finding', body: Buffer.from(JSON.stringify(F2), 'utf8').toString('base64') },
    ] }] }] }] }] }
    const r = extractPropertyFinding(JSON.stringify(report), 'P0/EV-STATE/terminal-absorption')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.finding.rule).toBe('EV-STATE')
  })

  it('无发现附件 → 拒绝（探索未产出发现）', () => {
    expect(extractPropertyFinding(JSON.stringify({ suites: [] })).ok).toBe(false)
  })
})