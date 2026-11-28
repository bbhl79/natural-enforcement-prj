// 失败签名提取器（#108；Spec-e2e §7 两个签名来源）：
//   1. replay 脚本失败输出约定（本文件 extractReplaySignature）；
//   2. Playwright 结果 JSON（extractPlaywrightSignatures）。
// 提取只取**结构化证据**（错误类别 / 断言标识 / 语义维度取值），不取完整消息文本——
// 合法重构改措辞不进签名，断言弱化（预期状态码变化）进签名。
// 纯函数、零基础设施：#109 门禁多轮重放与 #112 CI 判定共用同一份实现。
import { z } from 'zod'
import {
  FailureErrorClassSchema,
  SemanticMarkerSchema,
  canonicalizeSignature,
  type FailureSignature,
} from './model.js'

/**
 * replay 脚本失败输出约定的哨兵前缀：脚本在 stdout 打**一行**
 * `NE-E2E-SIGNATURE <compact JSON>`，JSON 形态见 ReplayMarkerSchema。
 * 约定要点（脚本随缺陷记录入库，是长期重建依据）：
 *   - 零第三方依赖（node 内建 fetch）；exit 0 = 复现、1 = 未复现、2 = 基础设施错误；
 *   - 无论复现与否都打标记：复现时标记承载缺陷的语义取值（供门禁逐轮比对），
 *     未复现时标记承载实际观测值（比对不符即语义反转「环境漂移或已修复？」）；
 *   - 标记只放语义维度（http.status.expected / http.status.actual / error.code …），
 *     **不放完整响应体或错误消息文本**。
 */
export const REPLAY_SIGNATURE_SENTINEL = 'NE-E2E-SIGNATURE'

/** 脚本自述结果（判定权威仍是退出码；此字段只作证据留痕） */
export type ReplayOutcome = 'reproduced' | 'not-reproduced' | 'unknown'

export interface ReplayExtraction {
  found: boolean
  signature: FailureSignature | null // 规范化形态；未找到/非法一律 null（不编造）
  outcome: ReplayOutcome
  error?: string // 标记在场但非法时的原因（供诊断，不静默判成功）
}

/** 约定标记的 JSON 形态（strictObject：未知字段一律拒绝，防拼写错误静默通过） */
export const ReplayMarkerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  assertionId: z.string().min(1),
  errorClass: FailureErrorClassSchema,
  outcome: z.enum(['reproduced', 'not-reproduced', 'unknown']).optional(),
  semanticMarkers: z.array(SemanticMarkerSchema),
})
export type ReplayMarker = z.infer<typeof ReplayMarkerSchema>

const SENTINEL_RE = new RegExp(`^${REPLAY_SIGNATURE_SENTINEL}\\s+(.+)$`)

/**
 * 从 replay 脚本输出提取签名。只认哨兵前缀行（其它输出是噪声）；多条标记取
 * **最后一条**（脚本终态）。无标记 → found=false；标记非法 → found=false + error。
 */
export function extractReplaySignature(output: string): ReplayExtraction {
  let payload: string | null = null
  for (const raw of output.split('\n')) {
    const m = SENTINEL_RE.exec(raw.replace(/\r$/, '').trim())
    if (m && m[1] !== undefined) payload = m[1]
  }
  if (payload === null) return { found: false, signature: null, outcome: 'unknown' }

  let raw: unknown
  try {
    raw = JSON.parse(payload)
  } catch (e) {
    return {
      found: false,
      signature: null,
      outcome: 'unknown',
      error: `约定标记 JSON 解析失败：${String(e instanceof Error ? e.message : e)}`,
    }
  }
  const parsed = ReplayMarkerSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      found: false,
      signature: null,
      outcome: 'unknown',
      error: `约定标记 schema 不符：${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
    }
  }
  const marker = parsed.data
  return {
    found: true,
    signature: canonicalizeSignature({
      errorClass: marker.errorClass,
      assertionId: marker.assertionId,
      semanticMarkers: marker.semanticMarkers,
    }),
    outcome: marker.outcome ?? 'unknown',
  }
}