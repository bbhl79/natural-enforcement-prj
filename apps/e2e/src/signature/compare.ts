// 失败签名比对原语（#108；Spec-e2e §5 / §7，ADR 双轨 §3/§5）。
//
// 机器判定「**同一断言处因同一原因失败**」：
//   同一断言处 = errorClass 相同 + assertionId 相同；
//   同一原因   = 关键语义标记集合（key→value）相同。
// **不比对完整消息文本**——合法重构改措辞不判红；断言弱化（预期状态码 500→400）
// 因语义标记不符而红。本库是纯函数、零基础设施，为 #109 复现门禁多轮重放与
// #112 CI 预期失败判定共用（本地与 CI 同一判定器）；判定矩阵（绿/红/待判断）
// 归判定引擎（#112），本原语只回答「是否同一失败」并给出可机器消费的差异。
import { canonicalizeSignature, type FailureSignature } from './model.js'

export type ComparisonReason =
  | 'matched'
  | 'missing-signature'
  | 'error-class-differs'
  | 'assertion-id-differs'
  | 'semantic-markers-differ'

/** 一处差异（dimension + 语义标记 key + 两侧取值；缺侧为 null） */
export interface SignatureDifference {
  dimension: 'errorClass' | 'assertionId' | 'semanticMarkers'
  key?: string
  a: string | null
  b: string | null
}

export interface SignatureComparison {
  matched: boolean
  reason: ComparisonReason
  differences: SignatureDifference[]
}

export interface SignatureSetComparison {
  allMatched: boolean
  reason: ComparisonReason | 'no-candidates'
  results: (SignatureComparison & { index: number })[]
}

function markerMap(sig: FailureSignature): Map<string, string> {
  const m = new Map<string, string>()
  for (const marker of sig.semanticMarkers) m.set(marker.key, marker.value)
  return m
}

/**
 * 比对两个签名。任一侧缺失 → matched=false（无证据不得当同一失败）。
 * reason 取首个决定性的差异维度（类别 → 断言标识 → 语义标记）；differences 列出
 * **全部**差异供诊断。两侧都先规范化（书写顺序/首尾空白不影响身份）。
 */
export function compareSignatures(
  a: FailureSignature | null | undefined,
  b: FailureSignature | null | undefined,
): SignatureComparison {
  if (!a || !b) {
    return {
      matched: false,
      reason: 'missing-signature',
      differences: [{ dimension: 'errorClass', a: a ? a.errorClass : null, b: b ? b.errorClass : null }],
    }
  }
  const ca = canonicalizeSignature(a)
  const cb = canonicalizeSignature(b)
  const differences: SignatureDifference[] = []
  if (ca.errorClass !== cb.errorClass) {
    differences.push({ dimension: 'errorClass', a: ca.errorClass, b: cb.errorClass })
  }
  if (ca.assertionId !== cb.assertionId) {
    differences.push({ dimension: 'assertionId', a: ca.assertionId, b: cb.assertionId })
  }
  const ma = markerMap(ca)
  const mb = markerMap(cb)
  const keys = [...new Set([...ma.keys(), ...mb.keys()])].sort()
  for (const key of keys) {
    const va = ma.get(key) ?? null
    const vb = mb.get(key) ?? null
    if (va !== vb) differences.push({ dimension: 'semanticMarkers', key, a: va, b: vb })
  }
  if (differences.length === 0) return { matched: true, reason: 'matched', differences: [] }
  const first = differences[0]
  const reason: ComparisonReason =
    first?.dimension === 'errorClass'
      ? 'error-class-differs'
      : first?.dimension === 'assertionId'
        ? 'assertion-id-differs'
        : 'semantic-markers-differ'
  return { matched: false, reason, differences }
}

/**
 * 多轮比对（门禁口径：次数是检查预算不是证明，每轮都须与基线同一断言同一原因）。
 * 基线缺失或零轮次 → allMatched=false（无证据不得判通过）。index 是 candidates
 * 的 0 基下标（调用方映射到轮次号）。
 */
export function compareSignatureSet(
  baseline: FailureSignature | null | undefined,
  candidates: (FailureSignature | null | undefined)[],
): SignatureSetComparison {
  if (candidates.length === 0) {
    return { allMatched: false, reason: 'no-candidates', results: [] }
  }
  const results = candidates.map((c, index) => ({ index, ...compareSignatures(baseline, c) }))
  const allMatched = baseline != null && results.every((r) => r.matched)
  const firstFail = results.find((r) => !r.matched)
  return {
    allMatched,
    reason: allMatched ? 'matched' : (firstFail?.reason ?? 'missing-signature'),
    results,
  }
}