// 缺陷报告 schema（#106；Spec-e2e §4 全字段，ADR 2026-11-19 双轨生命周期 §7）。
//
// 事实源分层：每缺陷一个入库 JSON（apps/e2e/defects/DEF-NNNN.json）是生命周期唯一
// 事实源；本 schema 是其唯一校验口径（非法记录 → devenv 退出码 10）。schema 归 e2e
// 包，不入共享契约包（生命周期制度不是应用传输契约）。
//
// 按引擎判别联合（z.discriminatedUnion('engine', …)）：机械转写引擎
// （fast-check / schemathesis）必须携带 counterexample（毕业直通转写的输入）；
// 非机械引擎（visual / model-journey / monkey / agent-session）走草稿区，反例可选。
//
// 字段口径说明：
//   - reproducibility.kind 按**被测路径**分类（ADR §3，取代原型按引擎分类的
//     deterministic/nondeterministic）：pure = 纯函数/无外部状态（重放 1 次）；
//     external-state = 依赖外部状态/并发（独立键空间 ≥3 次）。门禁证据由 report
//     命令实测回填（#109），报告期允许 attempts=0 占位。
//   - evidence 只存 URI（指向 .artifacts/e2e/<run-id>/…，证据本体不入库）：
//     strictObject 拒绝内嵌内容字段。
//   - graduation 含失败签名（ADR §5：错误类别 + 断言标识 + 关键语义标记，不含
//     完整消息文本）与确认记录（ADR §4：确认者/时间/证据快照/令牌六元组）。
//     二者在 schema 中留位：expected-fail 毕业的签名必填性由校验器判定（#116），
//     确认记录由两段式落账写入（#111）。
import { FailureSignatureSchema, type FailureSignature } from '../signature/model.js'
import { z } from 'zod'

export const DEFECT_SCHEMA_VERSION = 1

export const DefectIdSchema = z.string().regex(/^DEF-\d{4}$/)
export type DefectId = z.infer<typeof DefectIdSchema>

/** 四站状态机（ADR §1）：reported → graduated → fixed；retired 终态（记录永久留档） */
export const DefectStatusSchema = z.enum(['reported', 'graduated', 'fixed', 'retired'])
export type DefectStatus = z.infer<typeof DefectStatusSchema>

/** 探索引擎（docs/research/exploratory-testing.md 五层；v1 只装 P0 + agent charter 会话） */
export const DefectEngineSchema = z.enum([
  'fast-check', // P0 属性测试（反例 = seed/path + 最小输入）
  'schemathesis', // P1 契约探索（反例 = curl 重现器）
  'visual', // P2 视觉回归（反例 = 基线/diff/实际三图）
  'model-journey', // P3 模型化随机旅程（反例 = 最小命令序列）
  'monkey', // P4 UI monkey
  'agent-session', // P4 agent charter 会话
])
export type DefectEngine = z.infer<typeof DefectEngineSchema>

export const DefectLayerSchema = z.enum(['api', 'ui', 'package'])
export type DefectLayer = z.infer<typeof DefectLayerSchema>
export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical'])
export type Severity = z.infer<typeof SeveritySchema>

/** 机械转写能力表：决定毕业走直通转写还是 _drafts 草稿区（#110） */
export const MECHANICAL_ENGINES: ReadonlySet<DefectEngine> = new Set<DefectEngine>([
  'fast-check',
  'schemathesis',
])

/** 被测路径分类（ADR §3）：门禁次数是检查预算不是证明 */
export const ReproducibilityKindSchema = z.enum(['pure', 'external-state'])
export type ReproducibilityKind = z.infer<typeof ReproducibilityKindSchema>

/** 复现门禁下限：纯函数/无外部状态 1 次；依赖外部状态/并发 ≥3 次（独立键空间） */
export function minGateAttempts(kind: ReproducibilityKind): number {
  return kind === 'pure' ? 1 : 3
}

/** 契约反例的请求形态（机械转写输入：契约 curl → API 测试） */
export const CounterexampleRequestSchema = z.strictObject({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
})
export type CounterexampleRequest = z.infer<typeof CounterexampleRequestSchema>

/** 机械引擎反例：契约请求形态或纯函数输入形态（二者至少其一） */
export const CounterexampleSchema = z
  .strictObject({
    property: z.string().min(1).optional(),
    request: CounterexampleRequestSchema.optional(),
    input: z.unknown().optional(),
  })
  .refine((v) => v.request !== undefined || v.input !== undefined, {
    message: 'counterexample 需含 request（契约反例）或 input（纯函数反例）',
  })
export type Counterexample = z.infer<typeof CounterexampleSchema>

/** 门禁证据（report 命令实测回填，非自查申报；#109） */
export const GateSchema = z.strictObject({
  attempts: z.number().int().min(0), // 报告期可为 0 占位；登记后 ≥ minGateAttempts(kind)
  keySpaces: z.array(z.string().min(1)), // 每轮独立键空间（run id）
  allFailed: z.boolean(), // 每轮都在同一断言处因同一原因失败
  signatureMatched: z.boolean().optional(), // 逐轮失败签名比对结果（#109 回填）
})
export type Gate = z.infer<typeof GateSchema>

export const ReproducibilitySchema = z.strictObject({
  kind: ReproducibilityKindSchema,
  seed: z.string().min(1).optional(), // 属性引擎反例种子
  path: z.string().min(1).optional(), // 属性引擎反例路径
  replayPath: z.string().min(1).optional(), // 复现脚本仓库相对路径
  curl: z.string().min(1).optional(), // 契约引擎 curl 重现器
  replayCommand: z.string().min(1), // 零第三方依赖复现脚本（node 内建 fetch）；exit 0 = 复现
  counterexample: z.unknown().optional(), // 非机械引擎的引擎工件位（机械引擎分支必填）
  gate: GateSchema,
})
export type Reproducibility = z.infer<typeof ReproducibilitySchema>

/** 机械引擎分支：counterexample 必填（判别联合的判别载荷） */
export const MechanicalReproducibilitySchema = ReproducibilitySchema.extend({
  counterexample: CounterexampleSchema,
})

/** 证据只存 URI（strictObject：内嵌内容字段一律拒绝——证据本体不入库） */
export const EvidenceSchema = z.strictObject({
  type: z.enum(['trace', 'video', 'diff', 'json-report', 'log', 'screenshot', 'other']),
  uri: z.string().min(1), // 指向 .artifacts/e2e/<run-id>/…
})
export type Evidence = z.infer<typeof EvidenceSchema>

/**
 * 失败签名（ADR §5）：错误类别 + 断言标识 + 关键语义标记；不绑定完整消息文本。
 * 形状权威在 `signature/model.ts`（#108 定型：语义标记为 {key,value} 结构，错误类别
 * 含证据不足档 unknown）——提取器/比对原语与入库记录共用同一形态，此处再导出保持
 * 「schema 归 defect/schema.ts」的既有引用面。
 */
export { FailureSignatureSchema, type FailureSignature }

/** 确认令牌六元组（ADR §4）：绑定具体一次 verify 运行 + 其证据 + 被测版本 */
export const ConfirmationTokenSchema = z.strictObject({
  verifyRunId: z.string().min(1),
  evidenceHash: z.string().min(1),
  sourceTreeHash: z.string().min(1),
  appImageDigest: z.string().min(1),
  executorImageDigest: z.string().min(1),
  migrationVersion: z.string().min(1),
})
export type ConfirmationToken = z.infer<typeof ConfirmationTokenSchema>

/** 确认记录（确认者须为人类是制度约定，CLI 不鉴别本地操作者；ADR §4） */
export const ConfirmationSchema = z.strictObject({
  at: z.string().min(1),
  by: z.string().min(1),
  evidenceSnapshot: z.string().min(1), // 人核对的那份证据（URI 或内容哈希）
  token: ConfirmationTokenSchema,
})
export type Confirmation = z.infer<typeof ConfirmationSchema>

export const GraduationSchema = z.strictObject({
  at: z.string().min(1),
  by: z.string().min(1),
  specPath: z.string().min(1), // tests/repro/def-NNNN.spec.ts（相对 apps/e2e）
  mode: z.enum(['expected-fail', 'fixImmediate']),
  verifiedRun: z.strictObject({
    expect: z.enum(['fail', 'pass']),
    outcome: z.enum(['fail', 'pass']),
    at: z.string().min(1),
    runId: z.string().min(1).optional(), // 与 run 登记册互查（#111）
  }),
  failureSignature: FailureSignatureSchema.optional(), // expected-fail 必填性由校验器判定（#116）
  confirmation: ConfirmationSchema.optional(), // 两段式落账写入（#111）
})
export type Graduation = z.infer<typeof GraduationSchema>

export const FixSchema = z.strictObject({
  at: z.string().min(1),
  by: z.string().min(1),
  commit: z.string().min(1).optional(),
})
export type Fix = z.infer<typeof FixSchema>

export const RetirementSchema = z.strictObject({
  at: z.string().min(1),
  by: z.string().min(1),
  reason: z.string().min(1), // 必填：误报/spec 债务/功能下线共用此出口（ADR §9）
  issue: z.number().int().positive().optional(),
})
export type Retirement = z.infer<typeof RetirementSchema>

/** 判别联合之外的公共字段（六个引擎分支共用） */
const commonShape = {
  schemaVersion: z.literal(DEFECT_SCHEMA_VERSION),
  id: DefectIdSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  status: DefectStatusSchema,
  layer: DefectLayerSchema,
  discoveredAt: z.string().min(1),
  discoveredBy: z.string().min(1),
  charter: z.string().min(1), // 探索任务书（五要素认领单位，#114）
  suspectedArea: z.string().min(1),
  severity: SeveritySchema,
  evidence: z.array(EvidenceSchema),
  issue: z.number().int().positive().optional(), // tracker 回链（过门禁 → needs-triage）
  graduation: GraduationSchema.optional(),
  fix: FixSchema.optional(),
  retirement: RetirementSchema.optional(),
  sanitized: z.boolean(), // 证据/记录已脱敏（不含凭据与个人数据）
}

/** 缺陷报告：zod 按引擎判别联合（机械引擎 counterexample 必填） */
export const DefectRecordSchema = z.discriminatedUnion('engine', [
  z.strictObject({
    ...commonShape,
    engine: z.literal('fast-check'),
    reproducibility: MechanicalReproducibilitySchema,
  }),
  z.strictObject({
    ...commonShape,
    engine: z.literal('schemathesis'),
    reproducibility: MechanicalReproducibilitySchema,
  }),
  z.strictObject({
    ...commonShape,
    engine: z.literal('visual'),
    reproducibility: ReproducibilitySchema,
  }),
  z.strictObject({
    ...commonShape,
    engine: z.literal('model-journey'),
    reproducibility: ReproducibilitySchema,
  }),
  z.strictObject({
    ...commonShape,
    engine: z.literal('monkey'),
    reproducibility: ReproducibilitySchema,
  }),
  z.strictObject({
    ...commonShape,
    engine: z.literal('agent-session'),
    reproducibility: ReproducibilitySchema,
  }),
])
export type DefectRecord = z.infer<typeof DefectRecordSchema>

/** 解析入库记录：非法 JSON / schema 不符都给出可定位错误（devenv 据此 exit 10） */
export function parseDefectJson(
  text: string,
): { ok: true; record: DefectRecord } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${String(e)}` }
  }
  const r = DefectRecordSchema.safeParse(raw)
  if (!r.success) {
    const first = r.error.issues[0]
    const path = first?.path.join('.') ?? ''
    return { ok: false, error: `schema 不符：${path} ${first?.message ?? ''}`.trim() }
  }
  return { ok: true, record: r.data }
}