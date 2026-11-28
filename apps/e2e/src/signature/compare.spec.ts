// 失败签名比对原语（#108；Spec-e2e §5 门禁「同一断言处因同一原因失败」/ §7 判定矩阵）。
// 本原语为 #109 复现门禁多轮重放与 #112 CI 预期失败判定**共用**（本地与 CI 同一判定器）。
// 零基础设施单测：构造样本 + 真实证据形态，不碰容器。
import { describe, expect, it } from 'vitest'
import { compareSignatureSet, compareSignatures } from './compare.js'
import { extractPlaywrightSignatures, extractReplaySignature, REPLAY_SIGNATURE_SENTINEL } from './extract.js'
import type { FailureSignature } from './model.js'

const base: FailureSignature = {
  errorClass: 'assertion',
  assertionId: 'tests/repro/def-0001.spec.ts#DEF-0001 NUL 名引发 500#a1',
  semanticMarkers: [
    { key: 'matcher', value: 'toBeLessThan' },
    { key: 'expected', value: '< 500' },
    { key: 'actual', value: '500' },
  ],
}

const ESC = String.fromCharCode(27)
const dim = (s: string): string => `${ESC}[2m${s}${ESC}[22m`
const red = (s: string): string => `${ESC}[31m${s}${ESC}[39m`
const green = (s: string): string => `${ESC}[32m${s}${ESC}[39m`
function expectMessage(custom: string, expected: string, actual: string): string {
  const nl = '\n'
  return `Error: ${custom}${nl}${nl}` + dim('expect(') + red('received') + dim(').') + 'toBeLessThan' + dim('(') + green('expected') + dim(')') +
    `${nl}${nl}Expected: < ${green(expected)}${nl}Received:   ${red(actual)}`
}
function pwSignature(custom: string, expected: string, actual: string): FailureSignature {
  const report = {
    suites: [{
      title: 'def-0001.spec.ts', file: 'def-0001.spec.ts',
      specs: [{
        title: 'DEF-0001 NUL 名引发 500', file: 'def-0001.spec.ts',
        tests: [{
          status: 'unexpected', expectedStatus: 'passed', annotations: [],
          results: [{ status: 'failed', retry: 0, errors: [{ message: expectMessage(custom, expected, actual) }] }],
        }],
      }],
    }],
    stats: { expected: 0, unexpected: 1, flaky: 0, skipped: 0 },
  }
  const r = extractPlaywrightSignatures(report)
  const sig = r.failures[0]?.signature
  if (!sig) throw new Error('构造样本未提取到签名')
  return sig
}

describe('比对原语：同一断言处因同一原因失败', () => {
  it('同一签名 → matched（reason=matched，无差异）', () => {
    const r = compareSignatures(base, { ...base, semanticMarkers: [...base.semanticMarkers] })
    expect(r).toEqual({ matched: true, reason: 'matched', differences: [] })
  })

  it('语义敏感性（AC 实证）：合法重构只改错误消息措辞 → 仍判同一失败（不红）', () => {
    const a = pwSignature('契约内输入不应引发服务器错误', '500', '500')
    const b = pwSignature('重构后的措辞：服务器错误不得发生', '500', '500')
    const r = compareSignatures(a, b)
    expect(r.matched).toBe(true)
    expect(r.reason).toBe('matched')
  })

  it('语义敏感性（AC 实证）：预期状态码 500 → 400（断言弱化）→ 不匹配（红）', () => {
    const a = pwSignature('契约内输入不应引发服务器错误', '500', '500')
    const b = pwSignature('契约内输入不应引发服务器错误', '400', '400')
    const r = compareSignatures(a, b)
    expect(r.matched).toBe(false)
    expect(r.reason).toBe('semantic-markers-differ')
    expect(r.differences).toContainEqual({ dimension: 'semanticMarkers', key: 'expected', a: '< 500', b: '< 400' })
  })

  it('错误类别不同（断言失败 vs 基础设施错误）→ 不匹配，类别差异可机器消费', () => {
    const infra: FailureSignature = { ...base, errorClass: 'infrastructure', semanticMarkers: [{ key: 'error.code', value: 'ECONNREFUSED' }] }
    const r = compareSignatures(base, infra)
    expect(r.matched).toBe(false)
    expect(r.reason).toBe('error-class-differs')
    expect(r.differences[0]).toEqual({ dimension: 'errorClass', a: 'assertion', b: 'infrastructure' })
  })

  it('断言标识不同（不同断言处）→ 不匹配，即使语义标记相同', () => {
    const other: FailureSignature = { ...base, assertionId: 'tests/repro/def-0001.spec.ts#DEF-0001 NUL 名引发 500#a2' }
    const r = compareSignatures(base, other)
    expect(r.matched).toBe(false)
    expect(r.reason).toBe('assertion-id-differs')
  })

  it('语义标记书写顺序无关（规范化后按 key→value 集合比对）', () => {
    const reordered: FailureSignature = {
      ...base,
      semanticMarkers: [...base.semanticMarkers].reverse(),
    }
    expect(compareSignatures(base, reordered).matched).toBe(true)
  })

  it('标记缺失/多出都是语义差异（逐 key 报 a/b，缺侧为 null）', () => {
    const fewer: FailureSignature = { ...base, semanticMarkers: base.semanticMarkers.filter((m) => m.key !== 'actual') }
    const r = compareSignatures(base, fewer)
    expect(r.matched).toBe(false)
    expect(r.differences).toContainEqual({ dimension: 'semanticMarkers', key: 'actual', a: '500', b: null })
  })

  it('任一侧签名缺失 → 不匹配（不得把「无证据」当「同一失败」）', () => {
    for (const [a, b] of [[null, base], [base, null], [null, null]] as [FailureSignature | null, FailureSignature | null][]) {
      const r = compareSignatures(a, b)
      expect(r.matched).toBe(false)
      expect(r.reason).toBe('missing-signature')
    }
  })

  it('replay 来源逐轮比对：同一约定标记 → 匹配；实际观测值变化（语义反转）→ 不匹配', () => {
    const line = (actual: string): string => `${REPLAY_SIGNATURE_SENTINEL} {"schemaVersion":1,"assertionId":"post-enforcement-points.whitespace-name","errorClass":"assertion","outcome":"reproduced","semanticMarkers":[{"key":"http.status.expected","value":"201"},{"key":"http.status.actual","value":"${actual}"}]}`
    const round1 = extractReplaySignature(`${line('201')}\n`).signature
    const round2 = extractReplaySignature(`${line('201')}\n`).signature
    const drifted = extractReplaySignature(`${line('409')}\n`).signature
    expect(compareSignatures(round1, round2).matched).toBe(true)
    const r = compareSignatures(round1, drifted)
    expect(r.matched).toBe(false)
    expect(r.differences).toContainEqual({ dimension: 'semanticMarkers', key: 'http.status.actual', a: '201', b: '409' })
  })
})

describe('多轮比对（门禁预算：每轮都须同一断言同一原因）', () => {
  it('全部轮次匹配 → allMatched=true，逐轮结果可机器消费', () => {
    const r = compareSignatureSet(base, [base, base, base])
    expect(r.allMatched).toBe(true)
    expect(r.results).toHaveLength(3)
    expect(r.results.every((x) => x.matched && x.index >= 0)).toBe(true)
    expect(r.results.map((x) => x.index)).toEqual([0, 1, 2])
  })

  it('任一轮不匹配 → allMatched=false，并定位到具体轮次与差异', () => {
    const weakened: FailureSignature = {
      ...base,
      semanticMarkers: base.semanticMarkers.map((m) => (m.key === 'expected' ? { key: m.key, value: '< 400' } : m)),
    }
    const r = compareSignatureSet(base, [base, weakened, base])
    expect(r.allMatched).toBe(false)
    expect(r.results[1]?.matched).toBe(false)
    expect(r.results[1]?.reason).toBe('semantic-markers-differ')
    expect(r.results[0]?.matched).toBe(true)
    expect(r.results[2]?.matched).toBe(true)
  })

  it('基线缺失或零轮次 → allMatched=false（无证据不得判通过）', () => {
    expect(compareSignatureSet(null, [base]).allMatched).toBe(false)
    expect(compareSignatureSet(base, []).allMatched).toBe(false)
    expect(compareSignatureSet(base, []).reason).toBe('no-candidates')
  })
})