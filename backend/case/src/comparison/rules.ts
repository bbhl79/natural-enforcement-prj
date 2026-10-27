// 新旧比对最小版（#271）。纯规则，不写库。
// 人工比对：系统不判「较轻」，不自动解析版本集，不自动重新比对，不自动触发 R7／T32。
// 决定呈批必备「新旧比对判定」；批准时校验判定所写的决定时版本在批准当日有效。
// Q31：批准日等于某依据条款施行日时只警告，当天归属 cfg.rule 配置项不设默认。
// Q32：裁量基准到期或新版未录入时提示，不阻断。
// 比对结果只进内部材料和卷宗，对外决定书不引用本模块。

import { beijingDateOf } from '../clue/disposition/rules.ts';
import { parseCalendarDay } from '../investigation/rules.ts';
import { Q31_RULE_KEY, Q31_WARNING_MESSAGE, type WarningItem } from '../state-machine/rule-registry.ts';

/** 批准时发现判定已过时的原因文案与出路。 */
export const COMPARISON_STALE_MESSAGE = '比对过时';
export const COMPARISON_STALE_OUTLET = '重新比对';

/** 决定呈批缺少判定的阻断文案与出路。 */
export const COMPARISON_MISSING_MESSAGE = '决定呈批缺少新旧比对判定';
export const COMPARISON_MISSING_OUTLET = '为每条有效违法记录补齐新旧比对判定';

/** Q31 的出路。系统不替人决定当天归属。 */
export const Q31_OUTLET = '请在比对判定中写明按哪一版并写理由，并由法制部门确认';

/** Q32 提示的规则键与文案。提示不阻断。 */
export const Q32_RULE_KEY = 'CMP-02';
export const Q32_PROMPT = '裁量基准已到期或新版未录入，请在比对判定中写明适用哪一版';

/**
 * 施行日当天归属的配置项（#42 关票第二节、#256 §6 第 4 条）。
 * 法制部门确认前 attribution 为 null，系统不据此自动判定。
 */
export interface EffectiveDayAttribution {
  readonly ruleId: string;
  readonly version: string;
  readonly attribution: 'new' | 'old' | null;
}

export const EFFECTIVE_DAY_ATTRIBUTION_V1: EffectiveDayAttribution = {
  ruleId: 'cfg.rule.comparison-effective-day-attribution.v1',
  version: '1',
  attribution: null,
};

/**
 * 一条依据条款的版本。effectiveFrom 是施行日，expiresOn 是失效日（当日不再有效）。
 * 版本与施行日由主办在判定材料里填写；本票不自动解析版本集。
 */
export interface ComparisonBasis {
  readonly clause: string;
  readonly version: string;
  readonly effectiveFrom: string;
  readonly expiresOn: string | null;
}

/** 裁量基准。version 为空表示新版未录入；validUntil 是到期日（当日及以后视为到期）。 */
export interface ComparisonBenchmark {
  readonly clause: string;
  readonly version: string;
  readonly validUntil: string | null;
}

/** 人的判定。差异为零也要有 adoptedVersion 与 reason。 */
export interface ComparisonJudgment {
  readonly violationRecordId: string;
  readonly behaviorBases: readonly ComparisonBasis[];
  readonly decisionBases: readonly ComparisonBasis[];
  readonly behaviorBenchmarks: readonly ComparisonBenchmark[];
  readonly decisionBenchmarks: readonly ComparisonBenchmark[];
  readonly adoptedVersion: string;
  readonly reason: string;
  readonly noticeRef: string;
  readonly zeroDifference: boolean;
}

/** 判定记录行在判定内容之外还有主键与时间；最新一行按两者排序。 */
export interface ComparisonJudgmentEntry extends ComparisonJudgment {
  readonly id: string;
  readonly createdAt: Date;
}

export type ComparisonJudgmentRead =
  | { readonly ok: true; readonly judgment: ComparisonJudgment }
  | {
      readonly ok: false;
      readonly reason:
        | 'missing-judgment'
        | 'missing-basis'
        | 'invalid-basis'
        | 'missing-reason'
        | 'missing-notice'
        | 'invalid-input';
      readonly message: string;
    };

export interface RawComparisonJudgment {
  readonly violationRecordId?: unknown;
  readonly behaviorBases?: unknown;
  readonly decisionBases?: unknown;
  readonly behaviorBenchmarks?: unknown;
  readonly decisionBenchmarks?: unknown;
  readonly adoptedVersion?: unknown;
  readonly reason?: unknown;
  readonly noticeRef?: unknown;
  readonly zeroDifference?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseBases(value: unknown): readonly ComparisonBasis[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rows: ComparisonBasis[] = [];
  for (const item of value) {
    const row = recordOf(item);
    if (!row) return null;
    const clause = text(row.clause);
    const version = text(row.version);
    const effectiveFrom = parseCalendarDay(row.effectiveFrom);
    if (clause === '' || version === '' || !effectiveFrom) return null;
    let expiresOn: string | null = null;
    if (row.expiresOn != null && row.expiresOn !== '') {
      expiresOn = parseCalendarDay(row.expiresOn);
      if (!expiresOn || expiresOn <= effectiveFrom) return null;
    }
    rows.push({ clause, version, effectiveFrom, expiresOn });
  }
  return rows;
}

function parseBenchmarks(value: unknown): readonly ComparisonBenchmark[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const rows: ComparisonBenchmark[] = [];
  for (const item of value) {
    const row = recordOf(item);
    if (!row) return null;
    const clause = text(row.clause);
    if (clause === '') return null;
    const version = typeof row.version === 'string' ? row.version.trim() : '';
    let validUntil: string | null = null;
    if (row.validUntil != null && row.validUntil !== '') {
      validUntil = parseCalendarDay(row.validUntil);
      if (!validUntil) return null;
    }
    rows.push({ clause, version, validUntil });
  }
  return rows;
}

/** 判定材料录入校验。字段不合规即拒绝，不写库。 */
export function readComparisonJudgment(raw: RawComparisonJudgment): ComparisonJudgmentRead {
  const violationRecordId = text(raw.violationRecordId);
  if (violationRecordId === '') {
    return { ok: false, reason: 'missing-judgment', message: '须指定违法记录' };
  }
  const rawBehavior = raw.behaviorBases;
  const rawDecision = raw.decisionBases;
  if (
    !Array.isArray(rawBehavior) ||
    rawBehavior.length === 0 ||
    !Array.isArray(rawDecision) ||
    rawDecision.length === 0
  ) {
    return {
      ok: false,
      reason: 'missing-basis',
      message: '行为时、决定时的依据与版本须逐条填写',
    };
  }
  const behaviorBases = parseBases(rawBehavior);
  const decisionBases = parseBases(rawDecision);
  if (!behaviorBases || !decisionBases) {
    return {
      ok: false,
      reason: 'invalid-basis',
      message: '依据与版本须逐条填写条款、版本和施行日',
    };
  }
  const behaviorBenchmarks = parseBenchmarks(raw.behaviorBenchmarks);
  const decisionBenchmarks = parseBenchmarks(raw.decisionBenchmarks);
  if (!behaviorBenchmarks || !decisionBenchmarks) {
    return { ok: false, reason: 'invalid-basis', message: '裁量基准的条款、版本或到期日不合规' };
  }
  const adoptedVersion = text(raw.adoptedVersion);
  if (adoptedVersion === '') {
    return { ok: false, reason: 'missing-judgment', message: '判定须写明适用哪一版' };
  }
  const reason = text(raw.reason);
  if (reason === '') {
    return { ok: false, reason: 'missing-reason', message: '判定须写理由；差异为零也要写' };
  }
  const noticeRef = text(raw.noticeRef);
  if (noticeRef === '') {
    return { ok: false, reason: 'missing-notice', message: '判定须绑定告知书' };
  }
  if (typeof raw.zeroDifference !== 'boolean') {
    return { ok: false, reason: 'invalid-input', message: '差异为零标记须明确' };
  }
  return {
    ok: true,
    judgment: {
      violationRecordId,
      behaviorBases,
      decisionBases,
      behaviorBenchmarks,
      decisionBenchmarks,
      adoptedVersion,
      reason,
      noticeRef,
      zeroDifference: raw.zeroDifference,
    },
  };
}

function q32Hint(): WarningItem {
  return {
    level: 'hint',
    code: Q32_RULE_KEY,
    message: Q32_PROMPT,
    citation: null,
    ruleKey: Q32_RULE_KEY,
  };
}

/** Q32：决定时裁量基准到期或新版未录入，给提示，不阻断。 */
export function q32Hints(judgment: ComparisonJudgment, day: string): WarningItem[] {
  if (judgment.decisionBenchmarks.length === 0) return [];
  const hit = judgment.decisionBenchmarks.some(
    (row) => row.version === '' || (row.validUntil !== null && day >= row.validUntil),
  );
  return hit ? [q32Hint()] : [];
}

export interface ComparisonJudgmentRef {
  readonly id: string;
  readonly violationRecordId: string;
  readonly createdAt: Date;
}

function compareRef(left: ComparisonJudgmentRef, right: ComparisonJudgmentRef): number {
  const byTime = left.createdAt.getTime() - right.createdAt.getTime();
  if (byTime !== 0) return byTime;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

/** 每条违法记录只取最新一条判定。 */
export function latestJudgments<T extends ComparisonJudgmentRef>(rows: readonly T[]): ReadonlyMap<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const previous = latest.get(row.violationRecordId);
    if (!previous || compareRef(row, previous) > 0) latest.set(row.violationRecordId, row);
  }
  return latest;
}

export type SubmissionAssessment =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly missingViolationIds: readonly string[];
      readonly message: string;
      readonly outlet: string;
    };

/** 决定呈批提交检查：每条有效违法记录都要有判定。调查报告呈批不调用本函数。 */
export function assessDecisionSubmission(input: {
  readonly activeViolationIds: readonly string[];
  readonly judgments: readonly ComparisonJudgmentRef[];
}): SubmissionAssessment {
  const latest = latestJudgments(input.judgments);
  const missing = input.activeViolationIds.filter((id) => !latest.has(id));
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    missingViolationIds: missing,
    message: COMPARISON_MISSING_MESSAGE,
    outlet: COMPARISON_MISSING_OUTLET,
  };
}

export interface ComparisonFreshnessInput {
  readonly activeViolationIds: readonly string[];
  readonly judgments: readonly ComparisonJudgmentEntry[];
  readonly approvedAt: Date;
  readonly config: EffectiveDayAttribution;
}

export type ComparisonFreshness =
  | {
      readonly kind: 'fresh';
      readonly approvedDay: string;
      readonly hints: readonly WarningItem[];
    }
  | {
      readonly kind: 'effective-day-warning';
      readonly approvedDay: string;
      readonly clauses: readonly string[];
      readonly warning: WarningItem;
      readonly hints: readonly WarningItem[];
      readonly outlet: string;
      readonly ruleId: string;
      readonly attribution: 'new' | 'old' | null;
    }
  | {
      readonly kind: 'stale';
      readonly approvedDay: string;
      readonly reason: 'missing-judgment' | 'comparison-stale';
      readonly message: string;
      readonly outlet: string;
      readonly missingViolationIds: readonly string[];
    };

function aggregateQ32Hints(judgments: readonly ComparisonJudgment[], day: string): WarningItem[] {
  const seen = new Set<string>();
  const hints: WarningItem[] = [];
  for (const judgment of judgments) {
    for (const hint of q32Hints(judgment, day)) {
      const key = `${hint.ruleKey}|${hint.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hints.push(hint);
    }
  }
  return hints;
}

/**
 * 批准时校验。批准时刻先换算成北京日期。
 * 判定所写的决定时版本在批准当日不在有效区间内，或没有人的判定与理由，返回比对过时。
 * 批准日等于某依据条款施行日时只给 Q31 警告，不以新版或旧版判过时。
 */
export function assessComparisonFreshness(input: ComparisonFreshnessInput): ComparisonFreshness {
  const approvedDay = beijingDateOf(input.approvedAt);
  const latest = latestJudgments(input.judgments);
  const active: ComparisonJudgmentEntry[] = [];
  const missing: string[] = [];
  for (const violationId of input.activeViolationIds) {
    const judgment = latest.get(violationId);
    if (!judgment || judgment.adoptedVersion.trim() === '' || judgment.reason.trim() === '') {
      missing.push(violationId);
    } else {
      active.push(judgment);
    }
  }
  if (missing.length > 0) {
    return {
      kind: 'stale',
      approvedDay,
      reason: 'missing-judgment',
      message: COMPARISON_STALE_MESSAGE,
      outlet: COMPARISON_STALE_OUTLET,
      missingViolationIds: missing,
    };
  }

  const effectiveToday = active
    .flatMap((judgment) => [...judgment.behaviorBases, ...judgment.decisionBases])
    .filter((basis) => basis.effectiveFrom === approvedDay);
  if (effectiveToday.length > 0) {
    return {
      kind: 'effective-day-warning',
      approvedDay,
      clauses: [...new Set(effectiveToday.map((basis) => basis.clause))],
      warning: {
        level: 'warn',
        code: Q31_RULE_KEY,
        message: Q31_WARNING_MESSAGE,
        citation: null,
        ruleKey: Q31_RULE_KEY,
      },
      hints: aggregateQ32Hints(active, approvedDay),
      outlet: Q31_OUTLET,
      ruleId: input.config.ruleId,
      attribution: input.config.attribution,
    };
  }

  const stale = active.some((judgment) =>
    judgment.decisionBases.some(
      (basis) =>
        basis.effectiveFrom > approvedDay ||
        (basis.expiresOn !== null && approvedDay >= basis.expiresOn),
    ),
  );
  if (stale) {
    return {
      kind: 'stale',
      approvedDay,
      reason: 'comparison-stale',
      message: COMPARISON_STALE_MESSAGE,
      outlet: COMPARISON_STALE_OUTLET,
      missingViolationIds: [],
    };
  }
  return { kind: 'fresh', approvedDay, hints: aggregateQ32Hints(active, approvedDay) };
}