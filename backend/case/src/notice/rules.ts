// 告知与听证（E05、E06）纯规则（#272）。
// X07 命中＝系统自动 ∪ 人工勾选。任一命中即应听证；人工勾选只能加不能减。
// 命中后勾「不适用听证」或未带听证告知一律 X07 409（law＋userLock #111 L3）。
// 较大数额提示只提示，不替代 X07；阈值取粤府令第 294 号第 7 条，比对口径可配置、默认「任一」。
// X26 衔接：命中必审且未经告知前法审 → normative 警告，走 #258 两段式，不写 409。

import type { GuardResult } from '../state-machine/guard.ts';
import { HEARING_AMOUNT_RULE_KEY, X26_MESSAGE, X26_RULE_KEY } from '../state-machine/rule-registry.ts';

export const NOTICE_KINDS = ['penalty', 'no-penalty'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const NOTICE_KIND_NAMES: Readonly<Record<NoticeKind, string>> = {
  penalty: '拟处罚',
  'no-penalty': '拟不予处罚',
};

export function isNoticeKind(value: string): value is NoticeKind {
  return (NOTICE_KINDS as readonly string[]).includes(value);
}

/** 当事人主体类型：公民、法人或其他组织。阈值按此二选一。 */
export const PARTY_TYPES = ['citizen', 'legal-person'] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const PARTY_TYPE_NAMES: Readonly<Record<PartyType, string>> = {
  citizen: '公民',
  'legal-person': '法人或其他组织',
};

export function isPartyType(value: string): value is PartyType {
  return (PARTY_TYPES as readonly string[]).includes(value);
}

/** 人工勾选应听证的清单项。系统判不了的情形由此补足。 */
export const HEARING_MANUAL_ITEMS = ['other-heavy', 'law-required', 'cannot-structure'] as const;
export type HearingManualItem = (typeof HEARING_MANUAL_ITEMS)[number];

export const HEARING_MANUAL_ITEM_NAMES: Readonly<Record<HearingManualItem, string>> = {
  'other-heavy': '其他较重的行政处罚',
  'law-required': '法律、法规、规章规定的其他听证情形',
  'cannot-structure': '系统无法结构化判断的情形',
};

export function isHearingManualItem(value: string): value is HearingManualItem {
  return (HEARING_MANUAL_ITEMS as readonly string[]).includes(value);
}

/**
 * 可结构化判断的听证触发罚种（办法第 34 条、规程 8.3）。
 * 罚款、没收按金额判断；本清单只列非金额类。
 */
export const HEARING_TRIGGER_PENALTY_CODES = [
  'suspend-permit',
  'lower-qualification',
  'revoke-permit',
  'order-stop-production',
  'order-close',
  'restrict-practice',
] as const;

const HEARING_TRIGGER_CODES = new Set<string>(HEARING_TRIGGER_PENALTY_CODES);

export function penaltyTriggersHearing(code: string): boolean {
  return HEARING_TRIGGER_CODES.has(code);
}

/** 金额罚种代码。与 #240 处理建议的罚种代码共用。 */
export const MONEY_PENALTY_CODES = ['fine', 'confiscation'] as const;

export const HEARING_AMOUNT_COMPARISONS = ['any', 'fine', 'confiscation', 'sum'] as const;
export type HearingAmountComparison = (typeof HEARING_AMOUNT_COMPARISONS)[number];

export interface HearingAmountRule {
  /** cfg.rule.hearing-amount.v1 */
  readonly ruleId: string;
  readonly version: string;
  readonly citizenThreshold: number;
  readonly legalThreshold: number;
  /** 比对口径。默认 any＝罚款额、没收等价值任一达阈值。 */
  readonly comparison: HearingAmountComparison;
}

/** 粤府令第 294 号第 7 条：公民 5000 元，法人或其他组织 10 万元。 */
export const HEARING_AMOUNT_RULE_V1: HearingAmountRule = {
  ruleId: 'cfg.rule.hearing-amount.v1',
  version: '2026-10-29',
  citizenThreshold: 5000,
  legalThreshold: 100000,
  comparison: 'any',
};

export const HEARING_LARGE_AMOUNT_MESSAGE = '罚款额、没收等价值或二者相加达较大数额标准，提示按应听证情形处理';
export const HEARING_LARGE_AMOUNT_HINT_OUTLET = '核对是否应发听证告知';

export interface HearingFacts {
  readonly penaltyCodes: readonly string[];
  readonly fineAmount: number | null;
  readonly confiscationValue: number | null;
  readonly partyType: PartyType;
  /** 人工勾选应听证的清单项。只能加，不能减。 */
  readonly manualItems: readonly string[];
  /** 勾选「不适用听证」。命中时 409，不命中时允许。 */
  readonly notApplicableHearing: boolean;
  /** 告知书是否带听证告知。 */
  readonly hearingNoticeAttached: boolean;
}

export type HearingBlockCode = 'X07';

export interface HearingAssessment {
  readonly autoHit: boolean;
  /** auto-hit 原因：penalty-kind、amount。 */
  readonly autoReasons: readonly string[];
  readonly manualHit: boolean;
  /** 应听证命中＝自动 ∪ 人工。 */
  readonly required: boolean;
  /** 单项达阈值（提示口径）。 */
  readonly amountReached: boolean;
  readonly hints: readonly { readonly ruleKey: string; readonly message: string; readonly outlet: string }[];
  readonly block: { readonly code: HearingBlockCode; readonly message: string } | null;
}

function thresholdOf(rule: HearingAmountRule, partyType: PartyType): number {
  return partyType === 'citizen' ? rule.citizenThreshold : rule.legalThreshold;
}

function amountAutoHit(
  comparison: HearingAmountComparison,
  fine: number,
  confiscation: number,
  threshold: number,
): boolean {
  switch (comparison) {
    case 'any':
      return fine >= threshold || confiscation >= threshold;
    case 'fine':
      return fine >= threshold;
    case 'confiscation':
      return confiscation >= threshold;
    case 'sum':
      return fine + confiscation >= threshold;
  }
}

/**
 * X07 判定与较大数额提示。
 * 自动命中：非金额类触发罚种；或按比对口径的金额达阈值。
 * 人工命中：manualItems 非空。人工勾选不改变自动命中（只能加不能减）。
 */
export function assessHearing(
  facts: HearingFacts,
  rule: HearingAmountRule = HEARING_AMOUNT_RULE_V1,
): HearingAssessment {
  const fine = facts.fineAmount ?? 0;
  const confiscation = facts.confiscationValue ?? 0;
  const threshold = thresholdOf(rule, facts.partyType);
  const autoReasons: string[] = [];
  if (facts.penaltyCodes.some((code) => penaltyTriggersHearing(code))) autoReasons.push('penalty-kind');
  if (amountAutoHit(rule.comparison, fine, confiscation, threshold)) autoReasons.push('amount');
  const autoHit = autoReasons.length > 0;
  const manualHit = facts.manualItems.length > 0;
  const required = autoHit || manualHit;
  const amountReached = fine >= threshold || confiscation >= threshold;
  const hints = amountReached
    ? [{ ruleKey: HEARING_AMOUNT_RULE_KEY, message: HEARING_LARGE_AMOUNT_MESSAGE, outlet: HEARING_LARGE_AMOUNT_HINT_OUTLET }]
    : [];
  let block: HearingAssessment['block'] = null;
  if (required && facts.notApplicableHearing) {
    block = { code: 'X07', message: '应听证情形不得勾选不适用听证' };
  } else if (required && !facts.hearingNoticeAttached) {
    block = { code: 'X07', message: '应听证情形未发听证告知' };
  }
  return { autoHit, autoReasons, manualHit, required, amountReached, hints, block };
}

/** 命中必审：人工勾选或系统可判事实（已有听证程序标记）。 */
export function mandatoryReviewHit(input: {
  readonly manual: boolean;
  readonly hearingEntered: boolean;
}): boolean {
  return input.manual || input.hearingEntered;
}

/**
 * X26 衔接：命中必审且没有告知前法审通过引用 → normative 警告。
 * 有通过引用时不警告；摘要覆盖校验归法审票。
 */
export function preReviewWarning(input: {
  readonly mandatoryReview: boolean;
  readonly preReviewApproval: string | null;
}): GuardResult | null {
  if (!input.mandatoryReview) return null;
  if (typeof input.preReviewApproval === 'string' && input.preReviewApproval.trim() !== '') return null;
  return {
    level: 'warn',
    code: X26_RULE_KEY,
    message: X26_MESSAGE,
    authority: 'normative',
    citation: '规程7.1／8.2；设计加严，非规定要求',
  };
}

/** 告知正文。保存与批准共用同一份校验。 */
export interface NoticeContent {
  readonly kind: NoticeKind;
  readonly partyType: PartyType;
  readonly hearingNoticeAttached: boolean;
  readonly manualHearingItems: readonly HearingManualItem[];
  readonly notApplicableHearing: boolean;
  readonly mandatoryReview: boolean;
  readonly preReviewApproval: string | null;
  readonly confiscationValue: number | null;
  readonly note: string;
}

export interface NoticeContentHit {
  readonly httpStatus: 400;
  readonly reason: string;
  readonly message: string;
  readonly outlet: string;
}

export type NoticeContentRead =
  | { readonly ok: true; readonly content: NoticeContent }
  | { readonly ok: false; readonly hit: NoticeContentHit };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function invalid(reason: string, message: string, outlet: string): NoticeContentRead {
  return { ok: false, hit: { httpStatus: 400, reason, message, outlet } };
}

export function readNoticeContent(raw: unknown): NoticeContentRead {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return invalid('invalid-content', '告知正文不合规', '按告知正文格式填写');
  }
  const body = raw as Record<string, unknown>;
  const kind = text(body.kind);
  if (!isNoticeKind(kind)) return invalid('invalid-kind', '没有这类告知', '按拟处罚或拟不予处罚选择');
  const partyType = text(body.partyType);
  if (!isPartyType(partyType)) return invalid('invalid-party-type', '当事人主体类型不合规', '选择公民或法人或其他组织');
  if (typeof body.hearingNoticeAttached !== 'boolean') {
    return invalid('invalid-hearing-attachment', '听证告知是否带出未标明', '标明是否带出听证告知');
  }
  const manualHearingItems: HearingManualItem[] = [];
  if (body.manualHearingItems != null) {
    if (!Array.isArray(body.manualHearingItems) || body.manualHearingItems.some((item) => typeof item !== 'string')) {
      return invalid('invalid-hearing-selection', '人工勾选的听证情形不合规', '按清单勾选听证情形');
    }
    for (const item of body.manualHearingItems as string[]) {
      const trimmed = item.trim();
      if (trimmed === '') continue;
      if (!isHearingManualItem(trimmed)) {
        return invalid('invalid-hearing-selection', '人工勾选的听证情形不合规', '按清单勾选听证情形');
      }
      if (!manualHearingItems.includes(trimmed)) manualHearingItems.push(trimmed);
    }
  }
  if (body.notApplicableHearing != null && typeof body.notApplicableHearing !== 'boolean') {
    return invalid('invalid-hearing-selection', '「不适用听证」取值不合规', '重新选择');
  }
  if (body.mandatoryReview != null && typeof body.mandatoryReview !== 'boolean') {
    return invalid('invalid-mandatory-review', '必审勾选取值不合规', '重新选择');
  }
  const confiscationValue =
    body.confiscationValue == null || body.confiscationValue === ''
      ? null
      : typeof body.confiscationValue === 'number' && Number.isFinite(body.confiscationValue) && body.confiscationValue >= 0
        ? body.confiscationValue
        : undefined;
  if (confiscationValue === undefined) {
    return invalid('invalid-confiscation-value', '没收等价值不合规', '填写非负金额');
  }
  const note = text(body.note);
  if (note === '') return invalid('missing-note', '告知正文说明必填', '填写告知正文说明');
  const preReviewApproval = text(body.preReviewApproval);
  return {
    ok: true,
    content: {
      kind,
      partyType,
      hearingNoticeAttached: body.hearingNoticeAttached,
      manualHearingItems,
      notApplicableHearing: body.notApplicableHearing === true,
      mandatoryReview: body.mandatoryReview === true,
      preReviewApproval: preReviewApproval === '' ? null : preReviewApproval,
      confiscationValue,
      note,
    },
  };
}

/** 听证结束方式。受理前撤回不算经过听证；其余算。 */
export const HEARING_END_KINDS = [
  'concluded',
  'withdrawn',
  'waived',
  'no-show',
  'terminated',
  'withdrawn-before-acceptance',
] as const;
export type HearingEndKind = (typeof HEARING_END_KINDS)[number];

export const HEARING_END_KIND_NAMES: Readonly<Record<HearingEndKind, string>> = {
  concluded: '听证终结',
  withdrawn: '受理后书面撤回',
  waived: '受理后书面放弃',
  'no-show': '无正当理由不到场',
  terminated: '中途退出致终止',
  'withdrawn-before-acceptance': '受理前撤回',
};

export function isHearingEndKind(value: string): value is HearingEndKind {
  return (HEARING_END_KINDS as readonly string[]).includes(value);
}

/** 是否算「经过听证」：受理前撤回／放弃不算，其余算。 */
export function hearingCountsAsHeld(endKind: HearingEndKind): boolean {
  return endKind !== 'withdrawn-before-acceptance';
}

/** 主持人校验：曾任本案主办、协办（含已换下的）不得主持听证。 */
export function checkHearingHost(input: {
  readonly handlerPersonnelIds: readonly string[];
  readonly candidateId: string;
}): { readonly ok: true } | { readonly ok: false; readonly reason: string; readonly message: string; readonly outlet: string } {
  if (input.handlerPersonnelIds.includes(input.candidateId)) {
    return {
      ok: false,
      reason: 'hearing-host-is-handler',
      message: '曾任本案主办、协办的人员不得主持听证',
      outlet: '改选非本案承办人员主持听证',
    };
  }
  return { ok: true };
}

/** X28：自动复开已终止的听证。当事人未重新申请的，一律 409。 */
export function checkHearingReopen(input: {
  readonly hasTerminatedHearing: boolean;
}): { readonly ok: false; readonly code: 'X28' | 'invalid-state'; readonly message: string; readonly outlet: string } {
  if (!input.hasTerminatedHearing) {
    return {
      ok: false,
      code: 'invalid-state',
      message: '没有已终止的听证',
      outlet: '按告知等待或听证申请处理',
    };
  }
  return {
    ok: false,
    code: 'X28',
    message: '已终止的听证不自动复开',
    outlet: '须由当事人重新申请',
  };
}

/** 听证申请期的有效性。缺日历（需人工确认）时不静默按日历日算。 */
export type HearingWindowState = 'open' | 'closed' | 'manual';

export function hearingWindowState(input: {
  readonly dueOn: string | null;
  readonly needsManualConfirmation: boolean;
  readonly today: string;
}): HearingWindowState {
  if (input.needsManualConfirmation || input.dueOn === null) return 'manual';
  return input.today <= input.dueOn ? 'open' : 'closed';
}