// report 输入契约单测（#109；Spec-e2e §4 记录 schema / §5 门禁前置）。
//
// 接缝 = 发现载荷的解析/归一化纯函数（零基础设施）。期望值取自规格：
// 属性发现（#107 results.json 的 property-finding 附件）必须无损携带
// seed/counterexamplePath/counterexample 进 reproducibility；并发缺陷必属
// 依赖外部状态路径；每轮前置状态必须显式声明。
import { describe, expect, it } from 'vitest'
import { normalizeReportFinding } from './finding.js'

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
})