// report 输入契约（#109；Spec-e2e §4 记录 schema / §5 门禁 / §16 探索发现登记）。
//
// 发现载荷（finding payload）是 report 命令的唯一输入面，两个来源同一契约：
//   1. **属性发现**（source=property-finding）：#107 harness 写入 Playwright
//      results.json 的 `property-finding` 附件（base64 JSON），经
//      extractPropertyFinding 提取；seed/counterexamplePath/counterexample 无损
//      携带进 reproducibility（毕业反例重放与机械转写的输入）。
//   2. **agent 会话 / 手工发现**（source=agent-session|manual）：finding 为自由
//      JSON 证据载荷（session sheet 摘录等），不强制属性形状。
//
// 登记必填面与缺陷记录 schema 对齐；replayScript 是**脚本源码**（不是路径）——
// 门禁在登记前实测，脚本此时尚未入库，由宿主注入执行器跑同一份字节，过门禁后
// 与记录同一事务入库（脚本随记录入库是长期重建依据，Spec §4）。
//
// 本模块是纯函数：零基础设施、零副作用；解析失败给可定位字段路径（devenv exit 2）。
import {
  ConcurrencySchema,
  DefectEngineSchema,
  DefectLayerSchema,
  EvidenceSchema,
  ReproducibilityKindSchema,
  SeveritySchema,
  type Counterexample,
  type DefectEngine,
  type DefectLayer,
  type Evidence,
  type ReproducibilityKind,
  type Severity,
} from '../defect/schema.js'
import { z } from 'zod'

/** #107 属性发现附件形状（harness.ts PropertyFinding 的校验口径） */
export const PropertyFindingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  engine: z.literal('fast-check'),
  property: z.string().min(1),
  rule: z.string().min(1),
  charter: z.string().min(1),
  seed: z.number().int(),
  counterexample: z.unknown(),
  counterexamplePath: z.string().nullable(),
  numRuns: z.number().int().min(0),
  numShrinks: z.number().int().min(0),
  request: z
    .strictObject({
      method: z.enum(['get', 'post', 'put', 'patch', 'delete']),
      path: z.string().min(1),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.unknown().optional(),
      bodyBase64: z.string().min(1).optional(),
    })
    .optional(),
})
export type PropertyFinding = z.infer<typeof PropertyFindingSchema>

export const REPORT_FINDING_SOURCES = ['property-finding', 'agent-session', 'manual'] as const
export type ReportFindingSource = (typeof REPORT_FINDING_SOURCES)[number]

/** 默认 replayCommand：{ID} 由取号结果替换（脚本随记录入库于 apps/e2e/replay/） */
export const DEFAULT_REPLAY_COMMAND = 'node apps/e2e/replay/{ID}.mjs'

export const ReportFindingPayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: z.enum(REPORT_FINDING_SOURCES),
  title: z.string().min(1),
  summary: z.string().min(1),
  charter: z.string().min(1).optional(), // property-finding 可从 finding.charter 派生
  suspectedArea: z.string().min(1),
  layer: DefectLayerSchema,
  severity: SeveritySchema,
  engine: DefectEngineSchema.optional(), // property-finding 默认 fast-check
  discoveredAt: z.string().min(1).optional(), // 缺省由宿主填实测时刻
  discoveredBy: z.string().min(1).optional(), // 缺省由宿主填操作者
  finding: z.unknown().optional(), // 来源载荷（provenance；property-finding 形状强校验）
  reproducibility: z.strictObject({
    kind: ReproducibilityKindSchema,
    precondition: z.string().min(1), // 每轮开始前的明确前置状态**声明**
    replayScript: z.string().min(1), // 零第三方依赖脚本源码
    replayCommand: z.string().min(1).optional(), // 可含 {ID} 占位
    concurrency: ConcurrencySchema.optional(),
  }),
  evidence: z.array(EvidenceSchema).optional(), // 只存 URI（证据本体不入库）
  sanitized: z.boolean().optional(), // 缺省 true
})
export type ReportFindingPayload = z.infer<typeof ReportFindingPayloadSchema>

/** 归一化后的登记输入（缺陷记录的可直接装配面） */
export interface NormalizedFinding {
  source: ReportFindingSource
  title: string
  summary: string
  charter: string
  suspectedArea: string
  layer: DefectLayer
  severity: Severity
  engine: DefectEngine
  discoveredAt?: string
  discoveredBy?: string
  finding?: unknown
  reproducibility: {
    kind: ReproducibilityKind
    precondition: string
    replayScript: string
    replayCommand: string
    seed?: string
    path?: string
    counterexample?: Counterexample
    concurrency?: z.infer<typeof ConcurrencySchema>
  }
  evidence: Evidence[]
  sanitized: boolean
}

export type NormalizeResult =
  | { ok: true; value: NormalizedFinding }
  | { ok: false; error: string }

function issuePath(e: z.ZodError): string {
  const first = e.issues[0]
  return `${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim()
}

/** 属性发现 → 机械引擎反例（request 方法大写进契约枚举；input 保留收缩后最小反例） */
function counterexampleOf(f: PropertyFinding): Counterexample {
  const req =
    f.request === undefined
      ? undefined
      : {
          method: f.request.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
          path: f.request.path,
          ...(f.request.headers === undefined ? {} : { headers: f.request.headers }),
          ...(f.request.body === undefined ? {} : { body: f.request.body }),
          ...(f.request.bodyBase64 === undefined ? {} : { bodyBase64: f.request.bodyBase64 }),
        }
  return {
    property: f.property,
    ...(req === undefined ? {} : { request: req }),
    ...(f.counterexample === undefined ? {} : { input: f.counterexample }),
  }
}

/**
 * 解析 + 归一化发现载荷。拒绝口径（全部 exit 2，输入契约违规）：
 *   - schema 不符（给字段路径）；
 *   - source=property-finding 但 finding 缺失/形状不符（属性发现必须可机械归因）；
 *   - charter 既未显式给出也无法从 finding 派生（charter 是认领单位，Spec §15）；
 *   - concurrency 在场却 kind=pure（并发必然依赖外部状态，Spec §5）。
 */
export function normalizeReportFinding(raw: unknown): NormalizeResult {
  const parsed = ReportFindingPayloadSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: `发现载荷 schema 不符：${issuePath(parsed.error)}` }
  const p = parsed.data

  let property: PropertyFinding | undefined
  if (p.source === 'property-finding') {
    if (p.finding === undefined) {
      return { ok: false, error: 'source=property-finding 需携带 finding（#107 property-finding 附件载荷）' }
    }
    const fp = PropertyFindingSchema.safeParse(p.finding)
    if (!fp.success) {
      return { ok: false, error: `finding 非合法属性发现载荷：${issuePath(fp.error)}` }
    }
    property = fp.data
  }

  const charter = p.charter ?? property?.charter
  if (charter === undefined) {
    return { ok: false, error: '缺 charter（探索任务书标识）：显式给出或从属性发现载荷派生' }
  }
  const kind = p.reproducibility.kind
  if (p.reproducibility.concurrency !== undefined && kind !== 'external-state') {
    return {
      ok: false,
      error: `并发缺陷必属依赖外部状态路径：concurrency 在场时 kind 须为 external-state（当前 ${kind}）`,
    }
  }

  const engine: DefectEngine = p.engine ?? (property !== undefined ? 'fast-check' : 'agent-session')
  const value: NormalizedFinding = {
    source: p.source,
    title: p.title,
    summary: p.summary,
    charter,
    suspectedArea: p.suspectedArea,
    layer: p.layer,
    severity: p.severity,
    engine,
    ...(p.discoveredAt === undefined ? {} : { discoveredAt: p.discoveredAt }),
    ...(p.discoveredBy === undefined ? {} : { discoveredBy: p.discoveredBy }),
    ...(p.finding === undefined ? {} : { finding: p.finding }),
    reproducibility: {
      kind,
      precondition: p.reproducibility.precondition,
      replayScript: p.reproducibility.replayScript,
      replayCommand: p.reproducibility.replayCommand ?? DEFAULT_REPLAY_COMMAND,
      ...(property === undefined ? {} : { seed: String(property.seed) }),
      ...(property?.counterexamplePath == null ? {} : { path: property.counterexamplePath }),
      ...(property === undefined ? {} : { counterexample: counterexampleOf(property) }),
      ...(p.reproducibility.concurrency === undefined
        ? {}
        : { concurrency: p.reproducibility.concurrency }),
    },
    evidence: p.evidence ?? [],
    sanitized: p.sanitized ?? true,
  }
  return { ok: true, value }
}

// ---------------------------------------------------------------------------
// 来源一：Playwright results.json 的 property-finding 附件
// ---------------------------------------------------------------------------

export const PROPERTY_FINDING_ATTACHMENT = 'property-finding'

export type FindingExtraction =
  | { ok: true; finding: PropertyFinding; candidates: number }
  | { ok: false; error: string }

/** 递归扫描报告树，收集全部 property-finding 附件（对 suites 嵌套层级不敏感） */
function collectAttachmentBodies(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collectAttachmentBodies(n, out)
    return
  }
  if (node === null || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  if (obj['name'] === PROPERTY_FINDING_ATTACHMENT && typeof obj['body'] === 'string') {
    out.push(obj['body'])
  }
  for (const v of Object.values(obj)) collectAttachmentBodies(v, out)
}

/**
 * 从 Playwright 结果 JSON 提取属性发现。多个发现时须以 propertyName 选定
 * （否则拒绝——不静默取第一个，登记错发现比报错更坏）。
 */
export function extractPropertyFinding(resultsJson: string, propertyName?: string): FindingExtraction {
  let report: unknown
  try {
    report = JSON.parse(resultsJson)
  } catch (e) {
    return { ok: false, error: `results.json 解析失败：${String(e instanceof Error ? e.message : e)}` }
  }
  const bodies: string[] = []
  collectAttachmentBodies(report, bodies)
  if (bodies.length === 0) {
    return { ok: false, error: `results.json 内无 ${PROPERTY_FINDING_ATTACHMENT} 附件（探索未产出发现？）` }
  }
  const findings: PropertyFinding[] = []
  for (const b of bodies) {
    let raw: unknown
    try {
      raw = JSON.parse(Buffer.from(b, 'base64').toString('utf8'))
    } catch (e) {
      return { ok: false, error: `附件 body 非 base64 JSON：${String(e instanceof Error ? e.message : e)}` }
    }
    const p = PropertyFindingSchema.safeParse(raw)
    if (!p.success) return { ok: false, error: `附件载荷非合法属性发现：${issuePath(p.error)}` }
    findings.push(p.data)
  }
  if (propertyName !== undefined) {
    const hit = findings.filter((f) => f.property === propertyName)
    if (hit.length === 0) {
      return { ok: false, error: `无属性 ${propertyName} 的发现（在场：${findings.map((f) => f.property).join(', ')}）` }
    }
    return { ok: true, finding: hit[0] as PropertyFinding, candidates: findings.length }
  }
  if (findings.length > 1) {
    return {
      ok: false,
      error: `results.json 含 ${findings.length} 个发现，须以 --property 选定：${findings.map((f) => f.property).join(', ')}`,
    }
  }
  return { ok: true, finding: findings[0] as PropertyFinding, candidates: findings.length }
}