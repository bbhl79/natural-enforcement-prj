// PROTOTYPE（#13）— 缺陷报告 schema：zod 判别字段 engine（#10 决议 §4 的原型定型版）。
// 每缺陷一个 JSON 文件（apps/e2e/defects/DEF-NNNN.json）是生命周期唯一事实源；
// 本 schema 同时是 `devenv e2e report` 的入参校验与 `devenv verify` 的常态校验对象。
import { z } from 'zod'

export const DEFECT_SCHEMA_VERSION = 1

export const DefectIdSchema = z.string().regex(/^DEF-\d{4}$/)
export type DefectId = z.infer<typeof DefectIdSchema>

export const DefectStatusSchema = z.enum(['reported', 'graduated', 'fixed', 'retired'])
export type DefectStatus = z.infer<typeof DefectStatusSchema>

// 探索引擎（exploratory-testing.md §3 五层；#10 §4 判别联合）
export const DefectEngineSchema = z.enum([
  'fast-check', // P0 属性测试（反例 = seed/path + 最小输入）
  'schemathesis', // P1 契约探索（反例 = curl 重现器）
  'visual', // P2 视觉回归（反例 = 基线/diff/实际三图）
  'model-journey', // P3 模型化随机旅程（反例 = 最小命令序列）
  'monkey', // P4 UI monkey
  'agent-session', // P4 agent charter 会话（SBTM 变体）
])
export type DefectEngine = z.infer<typeof DefectEngineSchema>

export const DefectLayerSchema = z.enum(['api', 'ui', 'package'])
export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical'])

// 机械转写能力表（#10 §6）：决定 graduate 走直通转写还是 _drafts 草稿区
export const MECHANICAL_ENGINES: ReadonlySet<DefectEngine> = new Set(['fast-check', 'schemathesis'])

/** 反例的机器形态：引擎无关的请求描述（fast-check/schemathesis 反例统一收敛为「一个请求」） */
export const CounterexampleRequestSchema = z.object({
  method: z.string().min(1),
  path: z.string().min(1),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
})
export type CounterexampleRequest = z.infer<typeof CounterexampleRequestSchema>

export const GateSchema = z.object({
  attempts: z.number().int().min(0), // 报告期可为 0（占位，由 report 实测回填）；登记后 ≥ 复现门禁下限
  keySpaces: z.array(z.string()),
  allFailed: z.boolean(),
})

export const ReproducibilitySchema = z.object({
  kind: z.enum(['deterministic', 'nondeterministic']),
  seed: z.string().optional(),
  path: z.string().optional(),
  replayPath: z.string().optional(),
  curl: z.string().optional(),
  replayCommand: z.string().min(1), // 可复现脚本草案的机器形态：容器内可执行、退出 0 = 缺陷复现
  counterexample: z.unknown().optional(), // 机械转写输入（MECHANICAL_ENGINES 必填，verify 校验）
  gate: GateSchema,
})

export const EvidenceSchema = z.object({
  type: z.enum(['trace', 'video', 'diff', 'json-report', 'log', 'screenshot', 'other']),
  uri: z.string().min(1), // 指向 .artifacts/e2e/<run-id>/…，不入库
})

export const GraduationSchema = z.object({
  at: z.string(),
  by: z.string(),
  specPath: z.string(), // tests/repro/def-NNNN.spec.ts（相对 apps/e2e）
  mode: z.enum(['expected-fail', 'fixImmediate']),
  verifiedRun: z.object({
    expect: z.enum(['fail', 'pass']),
    outcome: z.enum(['fail', 'pass']),
    at: z.string(),
  }),
})

export const FixSchema = z.object({ at: z.string(), by: z.string(), commit: z.string().optional() })
export const RetirementSchema = z.object({
  at: z.string(),
  by: z.string(),
  reason: z.string().min(1), // 必填（#10 §8）
  issue: z.number().int().optional(),
})

export const DefectRecordSchema = z.object({
  schemaVersion: z.literal(DEFECT_SCHEMA_VERSION),
  id: DefectIdSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  status: DefectStatusSchema,
  engine: DefectEngineSchema,
  layer: DefectLayerSchema,
  discoveredAt: z.string(),
  discoveredBy: z.string(),
  charter: z.string().min(1),
  suspectedArea: z.string().min(1),
  severity: SeveritySchema,
  reproducibility: ReproducibilitySchema,
  evidence: z.array(EvidenceSchema),
  issue: z.number().int().optional(),
  graduation: GraduationSchema.optional(),
  fix: FixSchema.optional(),
  retirement: RetirementSchema.optional(),
  sanitized: z.boolean(),
})
export type DefectRecord = z.infer<typeof DefectRecordSchema>

/** report 入参形态：gate 允许占位（attempts=0 / allFailed=false），登记时由实测回填 */
export const DefectReportInputSchema = DefectRecordSchema
export type DefectReportInput = z.infer<typeof DefectReportInputSchema>

/** 复现门禁下限（#10 §4 / exploratory-testing.md §4.2）：确定性 1 次；非确定 ≥3 次 */
export function minGateAttempts(kind: 'deterministic' | 'nondeterministic'): number {
  return kind === 'deterministic' ? 1 : 3
}

/** 登记后的完整记录校验（verify 常态口径）：状态条件字段 + 门禁证据 */
export function validateRecordInvariants(d: DefectRecord): string[] {
  const errs: string[] = []
  const min = minGateAttempts(d.reproducibility.kind)
  if (d.reproducibility.gate.attempts < min)
    errs.push(`gate.attempts=${d.reproducibility.gate.attempts} < 门禁下限 ${min}`)
  if (!d.reproducibility.gate.allFailed) errs.push('gate.allFailed=false（门禁要求全部复现）')
  if (MECHANICAL_ENGINES.has(d.engine) && d.reproducibility.counterexample === undefined)
    errs.push(`engine=${d.engine} 属机械转写引擎，counterexample 必填`)
  switch (d.status) {
    case 'reported':
      if (d.graduation) errs.push('reported 不得带 graduation')
      if (d.fix) errs.push('reported 不得带 fix')
      if (d.retirement) errs.push('reported 不得带 retirement')
      break
    case 'graduated':
    case 'fixed':
      if (!d.graduation) errs.push(`${d.status} 缺 graduation`)
      if (d.retirement) errs.push(`${d.status} 不得带 retirement`)
      if (d.status === 'fixed' && !d.fix) errs.push('fixed 缺 fix')
      if (d.status === 'graduated' && d.fix) errs.push('graduated 不得带 fix（修复确认走 confirm-fix）')
      break
    case 'retired':
      if (!d.retirement) errs.push('retired 缺 retirement')
      // graduation/fix 保留为历史（缺陷记录永不删除；retired 是从任意状态的合法终态）
      break
  }
  return errs
}

export function parseDefectJson(text: string): { ok: true; record: DefectRecord } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${String(e)}` }
  }
  const r = DefectRecordSchema.safeParse(raw)
  if (!r.success) {
    const first = r.error.issues[0]
    return { ok: false, error: `schema 不符：${first?.path.join('.') ?? ''} ${first?.message ?? ''}` }
  }
  return { ok: true, record: r.data }
}
