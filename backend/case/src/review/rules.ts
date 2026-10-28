// 审理（E04）纯规则（#240）。不依赖 Nest 与存储。
// T08、T09 的迁移判定在引擎；本文件管报告处理建议、审理人候选与签出守卫、意见类型到去向的映射。
// 「调查审理职能分离」是独立规则，不占 X 号（不改 X01–X33、不动 catalog 的 T／X 计数）。
// 时效届满的发现时点 → 出口一律读 cfg.rule.limitation-discovery-exit.v1，不硬编码。

import {
  LIMITATION_DISCOVERY_EXIT_V1,
  type LimitationDiscoveryExit,
} from '../investigation/rules.ts';
import { findIllegal } from '../state-machine/catalog.ts';
import {
  REVIEW_SEPARATION_MESSAGE,
  REVIEW_SEPARATION_RULE_KEY,
  X22_MESSAGE,
  X22_RULE_KEY,
} from '../state-machine/rule-registry.ts';
import type { GuardResult } from '../state-machine/guard.ts';

/** 审理意见类型（#240 范围第 9 条）。枚举保留「修改纠正」，与「补充调查」分开留痕。 */
export const REVIEW_OPINION_KINDS = [
  'supplementary-investigation',
  'correction',
  'penalty',
  'no-penalty',
  'fact-not-established',
  'limitation-expired',
] as const;
export type ReviewOpinionKind = (typeof REVIEW_OPINION_KINDS)[number];

export const REVIEW_OPINION_NAMES: Readonly<Record<ReviewOpinionKind, string>> = {
  'supplementary-investigation': '补充调查',
  correction: '修改纠正',
  penalty: '拟处罚',
  'no-penalty': '拟不予处罚',
  'fact-not-established': '事实不成立',
  'limitation-expired': '已过追诉时效',
};

/** 处理建议三类（#240 范围第 1 条）。 */
export const HANDLING_SUGGESTION_KINDS = ['penalty', 'no-penalty', 'fact-not-established'] as const;
export type HandlingSuggestionKind = (typeof HANDLING_SUGGESTION_KINDS)[number];

export const HANDLING_SUGGESTION_NAMES: Readonly<Record<HandlingSuggestionKind, string>> = {
  penalty: '拟处罚',
  'no-penalty': '拟不予处罚',
  'fact-not-established': '事实不成立',
};

/** 事实不成立作不予处罚决定拟制（#40 Q5）。出口编号不来自时效映射。 */
export const NO_PENALTY_OUTCOME = { outcomeCode: 'O2', outcomeLabel: '不予行政处罚' } as const;

/** T09 的退回原因（#238 R2：「事实不清、证据不足，需补充调查」）。 */
export const REVIEW_RETURN_REASON = 'R2';

export const MISSING_HANDLING_SUGGESTION_MESSAGE = '每条有效违法记录都要写处理建议';
export const MISSING_HANDLING_SUGGESTION_OUTLET = '为每条有效违法记录写处理建议';
export const FINE_COMPETITION_MESSAGE = '罚款竞合的比对理由未填';
export const FINE_COMPETITION_OUTLET = '写明罚款竞合的比对理由';

export interface OpinionDestination {
  readonly transitionId: string;
  readonly outcomeCode: string | null;
  readonly outcomeLabel: string | null;
  /** 本票是否执行该迁移。T09 执行；T10、T11、T12 只记录去向。 */
  readonly appliedInThisTicket: boolean;
}

/**
 * 意见类型到去向的映射。T09 由本票执行；T10、T11、T12 只记录去向并冻结摘要。
 * 「已过追诉时效」的出口取参数，不从本文件写死（G2）。
 */
export function opinionDestination(
  kind: ReviewOpinionKind,
  rule: LimitationDiscoveryExit = LIMITATION_DISCOVERY_EXIT_V1,
): OpinionDestination {
  switch (kind) {
    case 'supplementary-investigation':
    case 'correction':
      return { transitionId: 'T09', outcomeCode: null, outcomeLabel: null, appliedInThisTicket: true };
    case 'penalty':
      return { transitionId: 'T10', outcomeCode: null, outcomeLabel: null, appliedInThisTicket: false };
    case 'no-penalty':
      return { transitionId: 'T11', outcomeCode: null, outcomeLabel: null, appliedInThisTicket: false };
    case 'fact-not-established':
      return {
        transitionId: 'T12',
        outcomeCode: NO_PENALTY_OUTCOME.outcomeCode,
        outcomeLabel: NO_PENALTY_OUTCOME.outcomeLabel,
        appliedInThisTicket: false,
      };
    case 'limitation-expired':
      return {
        transitionId: rule.afterHearing.transitionId,
        outcomeCode: rule.afterHearing.outcomeCode,
        outcomeLabel: rule.afterHearing.outcomeLabel,
        appliedInThisTicket: false,
      };
  }
}

export function isReviewOpinionKind(value: string): value is ReviewOpinionKind {
  return (REVIEW_OPINION_KINDS as readonly string[]).includes(value);
}

export function isHandlingSuggestionKind(value: string): value is HandlingSuggestionKind {
  return (HANDLING_SUGGESTION_KINDS as readonly string[]).includes(value);
}

/** 审理意见为补充调查或修改纠正时，可提 T09a 异议呈批。 */
export function allowsObjection(kind: string): boolean {
  return kind === 'supplementary-investigation' || kind === 'correction';
}

/** 一条处理建议。罚种代码集合、罚款金额、裁量理由按 #240 范围第 1 条。 */
export interface HandlingSuggestion {
  readonly violationRecordId: string;
  readonly kind: HandlingSuggestionKind;
  readonly penaltyCodes: readonly string[];
  readonly fineAmount: number | null;
  readonly discretionReason: string;
  /** 罚款依据条款。两条以上视为罚款竞合，须写比对理由（#41 决议 4）。 */
  readonly fineBases: readonly string[];
  readonly comparisonReason: string;
  /** 依据条款文本。进拟决定摘要。 */
  readonly basisText: string;
}

/** 调查报告正文。reviewerId 可选：批准时也可指定。 */
export interface ReviewReportContent {
  readonly suggestions: readonly HandlingSuggestion[];
  readonly reviewerId: string | null;
}

export interface ReviewContentHit {
  readonly httpStatus: 400 | 409;
  readonly reason: string;
  readonly message: string;
  readonly outlet: string;
  readonly missingViolationIds?: readonly string[];
}

export type ReviewReportContentRead =
  | { readonly ok: true; readonly content: ReviewReportContent }
  | { readonly ok: false; readonly hit: ReviewContentHit };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return value.map((item) => item.trim()).filter((item) => item !== '');
}

function invalid(reason: string, message: string, outlet: string): ReviewReportContentRead {
  return { ok: false, hit: { httpStatus: 400, reason, message, outlet } };
}

function readSuggestion(raw: unknown): HandlingSuggestion | null {
  const row = recordOf(raw);
  if (!row) return null;
  const violationRecordId = text(row.violationRecordId);
  const kind = text(row.kind);
  if (violationRecordId === '' || !isHandlingSuggestionKind(kind)) return null;
  if (kind !== 'penalty') {
    return {
      violationRecordId,
      kind,
      penaltyCodes: [],
      fineAmount: null,
      discretionReason: '',
      fineBases: [],
      comparisonReason: '',
      basisText: '',
    };
  }
  const penaltyCodes = stringList(row.penaltyCodes);
  const fineBases = row.fineBases == null ? [] : stringList(row.fineBases);
  const fineAmount =
    row.fineAmount == null || row.fineAmount === ''
      ? null
      : typeof row.fineAmount === 'number' && Number.isFinite(row.fineAmount) && row.fineAmount >= 0
        ? row.fineAmount
        : undefined;
  const discretionReason = text(row.discretionReason);
  const comparisonReason = text(row.comparisonReason);
  const basisText = text(row.basisText);
  if (!penaltyCodes || penaltyCodes.length === 0 || !fineBases || fineAmount === undefined) return null;
  if (discretionReason === '') return null;
  return {
    violationRecordId,
    kind,
    penaltyCodes,
    fineAmount,
    discretionReason,
    fineBases,
    comparisonReason,
    basisText,
  };
}

/**
 * 报告正文校验（T08 守卫）。
 * 每条有效违法记录都要有处理建议；建议不得指向非有效记录；罚款竞合须写比对理由。
 * requireCoverage 为 false 时用于拟制稿：检查结构，不要求覆盖全部有效记录。
 */
export function readReviewReportContent(
  raw: unknown,
  activeViolationIds: readonly string[],
  options: { readonly requireCoverage?: boolean } = {},
): ReviewReportContentRead {
  const requireCoverage = options.requireCoverage ?? true;
  const body = recordOf(raw);
  if (!body || !Array.isArray(body.suggestions)) {
    return invalid('invalid-report', '处理建议不合规', '按每条有效违法记录写处理建议');
  }
  const active = new Set(activeViolationIds);
  const suggestions: HandlingSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of body.suggestions) {
    const suggestion = readSuggestion(item);
    if (!suggestion) return invalid('invalid-suggestion', '处理建议字段不合规', '补齐罚种、金额、裁量理由');
    if (!active.has(suggestion.violationRecordId)) {
      return invalid('invalid-violation-record', '处理建议指向的违法记录不是本案有效记录', '只对有效违法记录写处理建议');
    }
    if (seen.has(suggestion.violationRecordId)) {
      return invalid('duplicate-suggestion', '同一违法记录写了多条处理建议', '每条违法记录只写一条处理建议');
    }
    seen.add(suggestion.violationRecordId);
    if (requireCoverage && suggestion.kind === 'penalty' && suggestion.fineBases.length >= 2 && suggestion.comparisonReason === '') {
      return {
        ok: false,
        hit: {
          httpStatus: 409,
          reason: 'fine-competition-reason-missing',
          message: FINE_COMPETITION_MESSAGE,
          outlet: FINE_COMPETITION_OUTLET,
        },
      };
    }
    suggestions.push(suggestion);
  }
  const missing = requireCoverage ? activeViolationIds.filter((id) => !seen.has(id)) : [];
  if (missing.length > 0) {
    return {
      ok: false,
      hit: {
        httpStatus: 409,
        reason: 'missing-handling-suggestion',
        message: MISSING_HANDLING_SUGGESTION_MESSAGE,
        outlet: MISSING_HANDLING_SUGGESTION_OUTLET,
        missingViolationIds: missing,
      },
    };
  }
  const reviewerId = text(body.reviewerId);
  return { ok: true, content: { suggestions, reviewerId: reviewerId === '' ? null : reviewerId } };
}

export interface ReviewOpinionContent {
  readonly kind: ReviewOpinionKind;
  readonly content: string;
}

export type ReviewOpinionContentRead =
  | { readonly ok: true; readonly content: ReviewOpinionContent }
  | { readonly ok: false; readonly hit: ReviewContentHit };

/** 审理意见正文校验。意见签出即生效，只追加。 */
export function readReviewOpinionContent(raw: unknown): ReviewOpinionContentRead {
  const body = recordOf(raw);
  const kind = text(body?.kind);
  if (!isReviewOpinionKind(kind)) {
    return {
      ok: false,
      hit: { httpStatus: 400, reason: 'invalid-kind', message: '没有这类审理意见', outlet: '按意见类型枚举重选' },
    };
  }
  const content = text(body?.content);
  if (content === '') {
    return {
      ok: false,
      hit: { httpStatus: 400, reason: 'missing-content', message: '审理意见必填', outlet: '填写审理意见' },
    };
  }
  return { ok: true, content: { kind, content } };
}

/** 候选审判人的事实。调用方喂入，本文件不读库。 */
export interface ReviewCandidateFacts {
  readonly roles: readonly string[];
  readonly orgCoversCase: boolean;
  readonly hasActiveConflict: boolean;
  /** 本案现任或曾任主办、协办（含已换下的）。 */
  readonly isHandlerEver: boolean;
}

export type ReviewCandidateCheck =
  | { readonly ok: true; readonly separationWarning: boolean }
  | { readonly ok: false; readonly hit: ReviewContentHit };

/** 被指定人校验：持行政审核、任职机构覆盖该案、无回避。职能分离只警告。 */
export function checkReviewerCandidate(facts: ReviewCandidateFacts): ReviewCandidateCheck {
  if (!facts.roles.includes('行政审核')) {
    return {
      ok: false,
      hit: { httpStatus: 409, reason: 'reviewer-not-admin-reviewer', message: '被指定人不持行政审核角色', outlet: '改选持行政审核的人' },
    };
  }
  if (!facts.orgCoversCase) {
    return {
      ok: false,
      hit: { httpStatus: 409, reason: 'reviewer-org-not-covered', message: '被指定人的任职机构不能覆盖该案', outlet: '改选任职机构覆盖该案的人' },
    };
  }
  if (facts.hasActiveConflict) {
    return {
      ok: false,
      hit: { httpStatus: 409, reason: 'reviewer-conflict-active', message: '被指定人有回避声明或生效回避', outlet: '等待回避决定或改选他人' },
    };
  }
  return { ok: true, separationWarning: facts.isHandlerEver };
}

/** 调查审理职能分离的警告项。声明与生效回避不在此列（硬阻断）。 */
export function separationWarning(): GuardResult {
  return {
    level: 'warn',
    code: REVIEW_SEPARATION_RULE_KEY,
    message: REVIEW_SEPARATION_MESSAGE,
    authority: 'normative',
  };
}

export interface ReviewSignFacts {
  readonly roles: readonly string[];
  readonly signerId: string;
  /** 当前 E04 进入次序号的在任审理人；未指定为 null。 */
  readonly designatedReviewerId: string | null;
  readonly isHandlerEver: boolean;
}

export interface ReviewSignCheck {
  readonly block: {
    readonly code: string;
    readonly message: string;
    readonly outlet: string;
    readonly citation: string | null;
  } | null;
  readonly warnings: readonly GuardResult[];
}

/** 签出守卫：X23（无行政审核）、未指定、X32（非被指定人）、X22（承办人员，警告）。 */
export function checkReviewSign(facts: ReviewSignFacts): ReviewSignCheck {
  if (!facts.roles.includes('行政审核')) {
    const row = findIllegal('X23');
    return {
      block: {
        code: 'X23',
        message: '未持行政审核角色的人不能签出审理意见',
        outlet: row?.outlet ?? '由持行政审核角色的人签出',
        citation: null,
      },
      warnings: [],
    };
  }
  if (facts.designatedReviewerId === null) {
    return {
      block: {
        code: 'reviewer-not-designated',
        message: '尚未指定审理人',
        outlet: '先由承办机构负责人指定审理人',
        citation: null,
      },
      warnings: [],
    };
  }
  if (facts.designatedReviewerId !== facts.signerId) {
    const row = findIllegal('X32');
    return {
      block: {
        code: 'X32',
        message: '非被指定审理人不能签出审理意见',
        outlet: row?.outlet ?? '须由被指定的审理人签出',
        citation: null,
      },
      warnings: [],
    };
  }
  const warnings: GuardResult[] = [];
  if (facts.isHandlerEver) {
    warnings.push({
      level: 'warn',
      code: X22_RULE_KEY,
      message: X22_MESSAGE,
      authority: 'normative',
      citation: findIllegal('X22')?.citation,
    });
  }
  return { block: null, warnings };
}

/** 更换审理人的理由必填；首次指定不要求理由。 */
export function readDesignationReason(input: { readonly isReplacement: boolean; readonly reason: string }): {
  readonly ok: true;
  readonly reason: string;
} | { readonly ok: false; readonly hit: ReviewContentHit } {
  const reason = input.reason.trim();
  if (input.isReplacement && reason === '') {
    return {
      ok: false,
      hit: { httpStatus: 400, reason: 'missing-reason', message: '更换审理人的理由必填', outlet: '填写更换理由' },
    };
  }
  return { ok: true, reason };
}

/** 异议呈批正文：附调查报告、审理意见、证据引用。 */
export interface ReviewObjectionContent {
  readonly note: string;
  readonly evidenceRefs: readonly string[];
}

export type ReviewObjectionContentRead =
  | { readonly ok: true; readonly content: ReviewObjectionContent }
  | { readonly ok: false; readonly hit: ReviewContentHit };

export function readReviewObjectionContent(raw: unknown): ReviewObjectionContentRead {
  const body = recordOf(raw);
  const note = text(body?.note);
  if (note === '') {
    return {
      ok: false,
      hit: { httpStatus: 400, reason: 'missing-note', message: '异议理由必填', outlet: '填写异议理由' },
    };
  }
  const evidenceRefs =
    body?.evidenceRefs == null || body.evidenceRefs === '' ? [] : stringList(body.evidenceRefs);
  if (!evidenceRefs) {
    return {
      ok: false,
      hit: { httpStatus: 400, reason: 'invalid-evidence-refs', message: '证据引用不合规', outlet: '按清单填写证据引用' },
    };
  }
  return { ok: true, content: { note, evidenceRefs } };
}

export const OBJECTION_DECISIONS = ['support-review', 'support-handler'] as const;
export type ObjectionDecision = (typeof OBJECTION_DECISIONS)[number];

export const OBJECTION_DECISION_NAMES: Readonly<Record<ObjectionDecision, string>> = {
  'support-review': '支持审理意见',
  'support-handler': '支持承办人员',
};

export function isObjectionDecision(value: string): value is ObjectionDecision {
  return (OBJECTION_DECISIONS as readonly string[]).includes(value);
}

/** 负责人支持承办人员时可落入的决定去向。T09 不在其列（T09 是支持审理意见的落点）。 */
export const OBJECTION_DECISION_TRANSITIONS = ['T10', 'T11', 'T12'] as const;

export function isObjectionDecisionTransition(value: string): boolean {
  return (OBJECTION_DECISION_TRANSITIONS as readonly string[]).includes(value);
}