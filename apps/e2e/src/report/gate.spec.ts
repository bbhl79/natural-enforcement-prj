// 复现门禁判定单测（#109；Spec-e2e §5「次数是检查预算不是证明」）。
//
// 接缝 = judgeGate 纯函数：**mock 重放轮次结果**（runId/退出码/签名），零基础设施。
// 期望值来自规格而非实现：pure 1 轮 / external-state ≥3 轮、每轮独立键空间、
// 明确前置状态、同一断言处因同一原因失败；unknown/infrastructure 永不过门禁。
import { describe, expect, it } from 'vitest'
import type { FailureSignature } from '../signature/model.js'
import { judgeGate, type GateRoundInput } from './gate.js'

const SIG: FailureSignature = {
  errorClass: 'assertion',
  assertionId: 'post-enforcement-points.whitespace-name',
  semanticMarkers: [
    { key: 'http.status.expected', value: '201' },
    { key: 'http.status.actual', value: '201' },
    { key: 'body.id', value: 'number' },
  ],
}

const PRECONDITION = '每轮：空库（DROP FORCE + CREATE）+ migrate deploy 至最新 + 空 bucket + 空队列键空间，无种子数据'

function round(attempt: number, over: Partial<GateRoundInput> = {}): GateRoundInput {
  return {
    attempt,
    runId: `rep109-c1eed7bc-1700000000-a${attempt}`,
    keySpace: {
      database: `e2e_rep109_c1eed7bc_1700000000_a${attempt}`,
      bucket: `e2e-rep109-c1eed7bc-1700000000-a${attempt}`,
      queue: `e2e-rep109-c1eed7bc-1700000000-a${attempt}-evidence-processing`,
    },
    precondition: PRECONDITION,
    scriptExitCode: 0,
    signature: SIG,
    ...over,
  }
}

describe('judgeGate（按被测路径分类的实测门禁）', () => {
  it('external-state：3 轮独立键空间全复现且签名一致 → 过门禁', () => {
    const v = judgeGate('external-state', [round(1), round(2), round(3)], PRECONDITION)
    expect(v.passed).toBe(true)
    expect(v.attempts).toBe(3)
    expect(v.minAttempts).toBe(3)
    expect(v.allFailed).toBe(true)
    expect(v.signatureMatched).toBe(true)
    expect(v.keySpaces).toHaveLength(3)
  })
})