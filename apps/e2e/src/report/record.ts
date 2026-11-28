// 缺陷记录装配（#109；Spec-e2e §4 记录 schema / §5 门禁证据回填）。
//
// 过门禁的发现 → status=reported 的标准缺陷记录。装配是**纯函数**：输入是
// 归一化发现 + 实测门禁判定，输出是记录对象（落盘经 op 协议由 devenv 原子应用）。
//
// 关键口径：
//   - gate 证据全部来自实测（轮次/键空间/逐轮签名比对/前置状态声明），非自查申报；
//   - evidence 只存 URI，且**逐轮指向运行登记册的 run id**（.artifacts/e2e/<runId>/），
//     使记录与 run 登记册可互查（Spec §4 / 票面「与 run 登记册关联」）；
//   - issue 字段**留空**——tracker 回链写入归 #114（过门禁 → needs-triage）；
//   - graduation/fix/retirement 一律不带（reported 状态的条件不变量）。
import {
  DefectRecordSchema,
  MECHANICAL_ENGINES,
  type DefectRecord,
  type Evidence,
  type Gate,
} from '../defect/schema.js'
import type { NormalizedFinding } from './finding.js'
import type { GateVerdict } from './gate.js'

/** 实测元数据（宿主采集；脚本哈希绑定「实测所用字节 = 入库字节」） */
export interface GateMeasurement {
  measuredAt: string
  scriptSha256?: string
}

export function replayPathOf(id: string): string {
  return `apps/e2e/replay/${id}.mjs`
}

/** {ID} 占位替换（replayCommand 与脚本路径随取号结果定型） */
export function resolveReplayCommand(template: string, id: string): string {
  return template.split('{ID}').join(id)
}

/** 逐轮证据 URI（指向 gitignored 证据区；证据本体不入库） */
function roundEvidence(verdict: GateVerdict): Evidence[] {
  const out: Evidence[] = []
  for (const r of verdict.rounds) {
    out.push({ type: 'json-report', uri: `.artifacts/e2e/${r.runId}/replay.json` })
    out.push({ type: 'log', uri: `.artifacts/e2e/${r.runId}/logs/api.log` })
  }
  return out
}

export function buildGateEvidence(verdict: GateVerdict, precondition: string, m: GateMeasurement): Gate {
  return {
    attempts: verdict.attempts,
    keySpaces: verdict.keySpaces,
    allFailed: verdict.allFailed,
    signatureMatched: verdict.signatureMatched,
    rounds: verdict.rounds,
    precondition,
    baselineSignature: verdict.baselineSignature,
    compareReason: verdict.compareReason,
    measuredAt: m.measuredAt,
    ...(m.scriptSha256 === undefined ? {} : { scriptSha256: m.scriptSha256 }),
    ...(verdict.needsHumanJudgment ? { needsHumanJudgment: true } : {}),
  }
}

export type BuildResult = { ok: true; record: DefectRecord } | { ok: false; error: string }

/**
 * 装配 reported 记录。机械引擎（fast-check/schemathesis）必须携带 counterexample
 * （判别联合的判别载荷）——缺失即输入契约违规，拒绝登记而非产出非法记录。
 */
export function buildReportRecord(
  id: string,
  f: NormalizedFinding,
  verdict: GateVerdict,
  m: GateMeasurement,
): BuildResult {
  const reproducibility: Record<string, unknown> = {
    kind: f.reproducibility.kind,
    ...(f.reproducibility.seed === undefined ? {} : { seed: f.reproducibility.seed }),
    ...(f.reproducibility.path === undefined ? {} : { path: f.reproducibility.path }),
    replayPath: replayPathOf(id),
    replayCommand: resolveReplayCommand(f.reproducibility.replayCommand, id),
    ...(f.reproducibility.counterexample === undefined
      ? {}
      : { counterexample: f.reproducibility.counterexample }),
    ...(f.reproducibility.concurrency === undefined ? {} : { concurrency: f.reproducibility.concurrency }),
    gate: buildGateEvidence(verdict, f.reproducibility.precondition, m),
  }
  const candidate = {
    schemaVersion: 1,
    id,
    title: f.title,
    summary: f.summary,
    status: 'reported',
    engine: f.engine,
    layer: f.layer,
    discoveredAt: f.discoveredAt ?? m.measuredAt,
    discoveredBy: f.discoveredBy ?? 'unknown',
    charter: f.charter,
    suspectedArea: f.suspectedArea,
    severity: f.severity,
    reproducibility,
    evidence: [...f.evidence, ...roundEvidence(verdict)],
    sanitized: f.sanitized,
  }
  if (MECHANICAL_ENGINES.has(f.engine) && f.reproducibility.counterexample === undefined) {
    return {
      ok: false,
      error: `机械引擎 ${f.engine} 的发现须携带反例（counterexample）：属性发现走 source=property-finding，或显式给出反例`,
    }
  }
  const parsed = DefectRecordSchema.safeParse(candidate)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      error: `装配记录不符缺陷 schema：${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
    }
  }
  return { ok: true, record: parsed.data }
}