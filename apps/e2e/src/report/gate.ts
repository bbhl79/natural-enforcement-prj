// 复现门禁判定（#109；Spec-e2e §5 / GLOSSARY「复现门禁」/ ADR 双轨 §3）。
//
// **次数是检查预算不是证明**：门禁不是「跑够 N 次」就过，而是每一轮都须
//   ① 从明确前置状态开始（独立键空间，#70 机制实测建立）；
//   ② 真的复现（replayCommand exit 0）；
//   ③ 在同一断言处因同一原因失败（失败签名逐轮比对，#108 同一原语）。
// 按**被测路径**分类（取代原型按引擎分类）：pure 1 轮；external-state ≥3 轮。
//
// 保守档纪律（#108 定型，本模块消费）：errorClass=unknown **永不过门禁**——
// 证据不足以分类时不得伪装成确定事实；infrastructure 同样不过（那不是缺陷复现，
// 是环境故障）。二者一律门禁失败 → devenv exit 8、零登记。
//
// 本模块是**纯函数**：输入是重放轮次结果（宿主实测；单测以 mock 轮次注入），
// 零基础设施、零副作用。判定与登记落盘分离——落盘经 op 协议由 devenv 原子应用。
import {
  GateKeySpaceSchema,
  minGateAttempts,
  type GateRound,
  type GateKeySpace,
  type ReproducibilityKind,
} from '../defect/schema.js'
import { compareSignatureSet } from '../signature/compare.js'
import { FailureSignatureSchema, type FailureSignature } from '../signature/model.js'
import { z } from 'zod'

/** 一轮实测结果（宿主在 per-run 隔离栈内跑 replayCommand 后采集） */
export interface GateRoundInput {
  attempt: number // 1 基轮次号
  runId: string // 本轮 run id（运行登记册键）
  keySpace?: GateKeySpace // 本轮实际资源坐标（独立性证据）
  precondition?: string // 本轮实际建立的前置状态
  scriptExitCode: number // 0=复现 / 1=未复现 / 2=基础设施错误
  signature: FailureSignature | null // 约定哨兵行提取；无标记 → null（不编造）
}

/** 宿主实测轮次的校验口径（report register 载荷；非法形态 → 用法错误 2） */
export const GateRoundInputSchema = z.strictObject({
  attempt: z.number().int().min(1),
  runId: z.string().min(1),
  keySpace: GateKeySpaceSchema.optional(),
  precondition: z.string().min(1).optional(),
  scriptExitCode: z.number().int(),
  signature: FailureSignatureSchema.nullable(),
})

export type GateReason =
  | 'passed'
  | 'no-rounds'
  | 'insufficient-rounds'
  | 'missing-precondition'
  | 'keyspace-not-independent'
  | 'infrastructure-error'
  | 'unknown-error-class'
  | 'missing-signature'
  | 'round-not-reproduced'
  | 'signature-mismatch'

export interface GateVerdict {
  passed: boolean
  reason: GateReason
  message: string // 人类可读收口原因（stderr / 终值 hint）
  attempts: number
  minAttempts: number
  keySpaces: string[] // 每轮 run id
  allFailed: boolean // 每轮都在同一断言处因同一原因失败（= 门禁通过）
  signatureMatched: boolean | null // 单轮无从跨轮比对 → null（不是 true，#108 口径）
  compareReason: string
  baselineSignature: FailureSignature | null
  needsHumanJudgment: boolean // 任一轮 locator → 需人判断 UI 改版还是缺陷（Spec §7）
  rounds: GateRound[] // 逐轮证据（含比对结果），回填 reproducibility.gate.rounds
}

function roundVerdict(r: GateRoundInput): GateRound['verdict'] {
  if (r.scriptExitCode === 2 || r.signature?.errorClass === 'infrastructure') return 'infrastructure'
  return r.scriptExitCode === 0 ? 'reproduced' : 'not-reproduced'
}

/** 键空间独立性：run id 互异；坐标在场时库/桶/队列亦互异（external-state 的硬要求） */
function keySpacesIndependent(rounds: GateRoundInput[]): boolean {
  const ids = new Set(rounds.map((r) => r.runId))
  if (ids.size !== rounds.length) return false
  const withSpace = rounds.filter((r) => r.keySpace !== undefined)
  if (withSpace.length !== rounds.length) return true // 坐标未提供：只核 run id（pure 路径可无外部状态）
  for (const dim of ['database', 'bucket', 'queue'] as const) {
    const vals = new Set(withSpace.map((r) => r.keySpace?.[dim]))
    if (vals.size !== rounds.length) return false
  }
  return true
}

/**
 * 门禁判定。rounds 按轮次升序；首轮签名为比对基线。
 * precondition 是**声明**（每轮从此状态开始），rounds[].precondition 是宿主实测
 * 建立的状态；声明缺失即前置不符（Spec §5「每次须从明确前置状态开始」）。
 */
export function judgeGate(
  kind: ReproducibilityKind,
  rounds: GateRoundInput[],
  precondition: string | undefined,
): GateVerdict {
  const minAttempts = minGateAttempts(kind)
  const attempts = rounds.length
  const baseline = rounds[0]?.signature ?? null
  const cmp = compareSignatureSet(
    baseline,
    rounds.map((r) => r.signature),
  )
  // 单轮无从跨轮比对 → null（与 #108 replay 同口径，不自证同一）
  const crossRound = attempts > 1
  const signatureMatched = crossRound ? cmp.allMatched : null
  const compareReason = crossRound ? cmp.reason : 'single-round-no-cross-check'
  const needsHumanJudgment = rounds.some((r) => r.signature?.errorClass === 'locator')

  const evidence: GateRound[] = rounds.map((r, i) => {
    const c = cmp.results[i]
    return {
      attempt: r.attempt,
      runId: r.runId,
      ...(r.keySpace === undefined ? {} : { keySpace: r.keySpace }),
      ...(r.precondition === undefined ? {} : { precondition: r.precondition }),
      scriptExitCode: r.scriptExitCode,
      verdict: roundVerdict(r),
      signature: r.signature,
      ...(c === undefined
        ? {}
        : { comparison: { matched: c.matched, reason: c.reason, differences: c.differences } }),
    }
  })

  const base: GateVerdict = {
    passed: false,
    reason: 'passed',
    message: '',
    attempts,
    minAttempts,
    keySpaces: rounds.map((r) => r.runId),
    allFailed: false,
    signatureMatched,
    compareReason,
    baselineSignature: baseline,
    needsHumanJudgment,
    rounds: evidence,
  }

  const fail = (reason: GateReason, message: string): GateVerdict => ({ ...base, reason, message })

  if (attempts === 0) {
    return fail('no-rounds', '门禁零轮次：无实测证据不得判过（次数是检查预算不是证明）')
  }
  if (attempts < minAttempts) {
    return fail(
      'insufficient-rounds',
      `门禁轮次不足：kind=${kind} 需 ≥${minAttempts} 轮，实测 ${attempts} 轮（独立键空间）`,
    )
  }
  if (precondition === undefined || precondition.trim() === '') {
    return fail('missing-precondition', '缺明确前置状态声明：每轮须从同一明确前置状态开始（Spec-e2e §5）')
  }
  if (!keySpacesIndependent(rounds)) {
    return fail(
      'keyspace-not-independent',
      '键空间不独立：各轮 run id / 库 / bucket / 队列须互异（同库重复重放会撞唯一约束，伪装成未复现）',
    )
  }

  // 逐轮扫描（按轮次序）：环境档与证据不足档先于「未复现」——归因不得混淆
  for (const r of rounds) {
    const at = `第 ${r.attempt} 轮（run=${r.runId}）`
    if (r.scriptExitCode === 2 || r.signature?.errorClass === 'infrastructure') {
      return fail(
        'infrastructure-error',
        `${at}基础设施错误（连接失败/超时/服务不健康）——不是缺陷复现，门禁不过；先按证据修运行环境再重报`,
      )
    }
    if (r.signature === null) {
      return fail(
        'missing-signature',
        `${at}无失败签名（脚本未按约定打 NE-E2E-SIGNATURE 哨兵行）：无证据不得判同一断言同一原因`,
      )
    }
    if (r.signature.errorClass === 'unknown') {
      return fail(
        'unknown-error-class',
        `${at}错误类别 unknown（证据不足以分类）——保守档永不过门禁，不得伪装成确定分类`,
      )
    }
    if (r.scriptExitCode !== 0) {
      return fail(
        'round-not-reproduced',
        `${at}未复现（replayCommand exit ${r.scriptExitCode}，约定 exit 0 = 复现）：环境漂移或已修复？`,
      )
    }
  }

  if (crossRound && !cmp.allMatched) {
    const firstBad = cmp.results.find((c) => !c.matched)
    return fail(
      'signature-mismatch',
      `多轮失败签名不一致（${cmp.reason}，首个不符轮次 index=${firstBad?.index ?? -1}）：不是在同一断言处因同一原因失败`,
    )
  }

  return {
    ...base,
    passed: true,
    allFailed: true,
    reason: 'passed',
    message: `门禁通过：kind=${kind}，${attempts}/${minAttempts} 轮独立键空间全复现${crossRound ? '且逐轮签名一致' : '（单轮路径，无跨轮比对）'}`,
  }
}