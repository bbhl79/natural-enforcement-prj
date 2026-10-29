// 法制审核与集体讨论（E07、E08）纯规则（#269）。不依赖 Nest 与存储。
// 必审清单以广州市局 2022-02-15 清单六项为准（#90/6409846424、#90/6410046818）。
// 系统自动判：实际举行过听证；已受理／已排期（含其后终止）；拟处罚种类含清单第 5 项列举种类；涉刑移送。
// 人工勾选：清单第 1、3、4、6 项与《广州市依法行政条例》第 37 条（三）。
// 市局清单默认适用各区分局，可按区分局覆盖（cfg.rule.*）；判定记录所用清单与版本。
// 法审不通过不是退回（#31/6233037268）；不通过且不接受时，集体讨论后回法审补出通过并引用讨论记录。
// 法审 5＋10 个工作日由 #246 的 legal-review.round 规则键计算（本文件不另算期限）。
// 集体讨论标准以粤自然资规字〔2022〕2 号第 12 条四种情形为准（#90/6430937705）。

import { findIllegal } from '../state-machine/catalog.ts';
import type { GuardResult } from '../state-machine/guard.ts';
import {
  LEGAL_QUALIFICATION_RULE_KEY,
  LEGAL_SAME_PERSON_MESSAGE,
  LEGAL_SAME_PERSON_RULE_KEY,
  X26_MESSAGE,
  X26_RULE_KEY,
} from '../state-machine/rule-registry.ts';

/** 必审清单标识。市局清单默认适用各区分局；区分局覆盖时换 id 与版本。 */
export const LEGAL_REVIEW_LIST_ID = 'cfg.rule.legal-review-list.v1';
export const LEGAL_REVIEW_LIST_VERSION = '2026-10-29';
export const DEFAULT_LEGAL_REVIEW_LIST_LEVEL = 'city';

/** 清单六项与《广州市依法行政条例》第 37 条（三）。 */
export const MANDATORY_REVIEW_ITEMS = [
  { code: 'major-public-interest', item: 1, name: '涉及重大公共利益', judgedBy: 'manual' },
  { code: 'hearing-held', item: 2, name: '拟作出处罚且本案实际举行过听证', judgedBy: 'auto' },
  { code: 'hearing-entered', item: 2, name: '已受理或已排期（含其后终止）', judgedBy: 'auto' },
  { code: 'major-social-impact', item: 3, name: '可能造成重大社会影响或引发社会风险', judgedBy: 'manual' },
  { code: 'complex-multiple-relations', item: 4, name: '案件情况疑难复杂、涉及多个法律关系', judgedBy: 'manual' },
  { code: 'penalty-item-5', item: 5, name: '拟处罚种类含清单第 5 项列举种类', judgedBy: 'auto' },
  { code: 'law-requires', item: 6, name: '法律、法规、规章或规范性文件规定应当审核', judgedBy: 'manual' },
  {
    code: 'material-rights',
    item: 37,
    name: '直接关系当事人或第三人重大权益',
    judgedBy: 'manual',
    basis: '《广州市依法行政条例》第 37 条（三）',
  },
  { code: 'criminal-transfer', item: null, name: '涉刑移送决定', judgedBy: 'auto' },
] as const;

export type MandatoryReviewItemCode = (typeof MANDATORY_REVIEW_ITEMS)[number]['code'];

export const MANUAL_REVIEW_ITEM_CODES = [
  'major-public-interest',
  'major-social-impact',
  'complex-multiple-relations',
  'law-requires',
  'material-rights',
] as const;
export type ManualReviewItemCode = (typeof MANUAL_REVIEW_ITEM_CODES)[number];

/** 拟不予处罚只命中第 1–4 项才必审（清单第 1、3、4 项与听证）。 */
export const NO_PENALTY_MANUAL_ITEM_CODES = [
  'major-public-interest',
  'major-social-impact',
  'complex-multiple-relations',
] as const;

/** 不必审的情形。主动送审不受本清单限制。 */
export const NOT_REQUIRED_DECISION_KINDS = [
  'filing',
  'no-filing',
  'withdrawal',
  'jurisdiction-transfer',
  'suspension',
  'termination',
  'closure',
  'party-discipline-transfer',
] as const;
export type NotRequiredDecisionKind = (typeof NOT_REQUIRED_DECISION_KINDS)[number];

/** 清单第 5 项列举的处罚种类。只认列举出的代码，不扩大解释「等」。 */
export const MANDATORY_REVIEW_PENALTY_CODES = [
  { code: 'confiscate-mineral-products', name: '没收违法采出的矿产品' },
  { code: 'confiscate-illegal-gains', name: '没收违法所得' },
  { code: 'confiscate-illegal-buildings', name: '没收违法建筑物' },
  { code: 'demolish-illegal-buildings', name: '限期拆除违法建筑物' },
  { code: 'revoke-exploration-permit', name: '吊销勘查许可证' },
  { code: 'revoke-mining-permit', name: '吊销采矿许可证' },
  { code: 'revoke-geological-disaster-qualification', name: '吊销地质灾害防治单位资质' },
  { code: 'revoke-surveying-qualification', name: '吊销测绘资质' },
] as const;

const MANDATORY_PENALTY_CODE_SET = new Set<string>(MANDATORY_REVIEW_PENALTY_CODES.map((row) => row.code));
const MANUAL_CODE_SET = new Set<string>(MANUAL_REVIEW_ITEM_CODES);
const NO_PENALTY_MANUAL_CODE_SET = new Set<string>(NO_PENALTY_MANUAL_ITEM_CODES);
const NOT_REQUIRED_KIND_SET = new Set<string>(NOT_REQUIRED_DECISION_KINDS);

export function isMandatoryReviewPenaltyCode(code: string): boolean {
  return MANDATORY_PENALTY_CODE_SET.has(code);
}

export function isManualReviewItemCode(value: string): value is ManualReviewItemCode {
  return MANUAL_CODE_SET.has(value);
}

export function isNotRequiredDecisionKind(value: string): value is NotRequiredDecisionKind {
  return NOT_REQUIRED_KIND_SET.has(value);
}

export interface MandatoryReviewFacts {
  /** penalty | no-penalty | criminal-transfer | 不必审情形。 */
  readonly decisionKind: string;
  /** 实际举行过听证（有听证笔录等）。 */
  readonly hearingHeld: boolean;
  /** 已受理或已排期（含其后终止、受理后书面撤回或放弃）。 */
  readonly hearingEntered: boolean;
  readonly penaltyCodes: readonly string[];
  readonly criminalTransfer: boolean;
  readonly manualItems: readonly string[];
}

export interface LegalReviewListOverride {
  readonly listId?: string;
  readonly listVersion?: string;
  readonly listLevel?: 'city' | 'district';
}

export interface MandatoryReviewAssessment {
  readonly required: boolean;
  /** 不必审情形为 true；此时不因人工勾选改判。 */
  readonly excluded: boolean;
  /** 自动命中原因：hearing-held、hearing-entered、penalty-item-5、criminal-transfer。 */
  readonly autoReasons: readonly string[];
  /** 采纳的人工勾选项。拟不予处罚只收第 1–4 项。 */
  readonly manualItems: readonly string[];
  readonly listId: string;
  readonly listVersion: string;
  readonly listLevel: 'city' | 'district';
}

function manualFor(decisionKind: string, items: readonly string[]): string[] {
  const allowed = decisionKind === 'no-penalty' ? NO_PENALTY_MANUAL_CODE_SET : MANUAL_CODE_SET;
  const picked: string[] = [];
  for (const item of items) {
    const code = item.trim();
    if (!allowed.has(code) || picked.includes(code)) continue;
    picked.push(code);
  }
  return picked;
}

/**
 * 必审判定。系统自动命中的项不因人工未勾选而消失；人工项只加不减。
 * 不必审情形一律不触发；主动送审由调用方另行发起，不走本函数。
 */
export function assessMandatoryReview(
  facts: MandatoryReviewFacts,
  override: LegalReviewListOverride = {},
): MandatoryReviewAssessment {
  const listId = override.listId ?? LEGAL_REVIEW_LIST_ID;
  const listVersion = override.listVersion ?? LEGAL_REVIEW_LIST_VERSION;
  const listLevel = override.listLevel ?? DEFAULT_LEGAL_REVIEW_LIST_LEVEL;
  if (isNotRequiredDecisionKind(facts.decisionKind)) {
    return { required: false, excluded: true, autoReasons: [], manualItems: [], listId, listVersion, listLevel };
  }
  const autoReasons: string[] = [];
  if (facts.hearingHeld) autoReasons.push('hearing-held');
  if (facts.hearingEntered) autoReasons.push('hearing-entered');
  if (facts.criminalTransfer) autoReasons.push('criminal-transfer');
  if (facts.decisionKind === 'penalty' && facts.penaltyCodes.some((code) => MANDATORY_PENALTY_CODE_SET.has(code))) {
    autoReasons.push('penalty-item-5');
  }
  const manualItems = manualFor(facts.decisionKind, facts.manualItems);
  return {
    required: autoReasons.length > 0 || manualItems.length > 0,
    excluded: false,
    autoReasons,
    manualItems,
    listId,
    listVersion,
    listLevel,
  };
}

/** 接收人角色、负责人角色与岗位标记。 */
export const LEGAL_REVIEW_RECEIVER_ROLE = '法制审核';
export const LEGAL_REVIEW_HEAD_ROLE = '行政审核';
export const LEGAL_REVIEW_HEAD_POST = 'legal-review-lead';

export interface LegalReviewCandidateFacts {
  readonly roles: readonly string[];
  /** 当前任职机构就是该案法制审核归属，人员未停用。 */
  readonly attributedOrgMatches: boolean;
  /** 本案现任或曾任主办、协办（含已改派换下的）。 */
  readonly isHandlerEver: boolean;
  readonly hasActiveConflict: boolean;
  readonly deactivated: boolean;
}

export type LegalReviewReceiverIssue =
  | 'receiver-not-legal-reviewer'
  | 'receiver-deactivated'
  | 'receiver-org-not-attributed'
  | 'receiver-is-handler'
  | 'receiver-conflict-active';

export type LegalReviewReceiverCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: LegalReviewReceiverIssue; readonly message: string; readonly outlet: string };

/** 法审接收人：持法制审核、任职属归属、非承办人员（含换下的）、无声明或生效回避。 */
export function checkLegalReviewReceiver(facts: LegalReviewCandidateFacts): LegalReviewReceiverCheck {
  if (facts.deactivated) {
    return { ok: false, reason: 'receiver-deactivated', message: '接收人已停用', outlet: '改选未停用的法制审核人员' };
  }
  if (!facts.roles.includes(LEGAL_REVIEW_RECEIVER_ROLE)) {
    return {
      ok: false,
      reason: 'receiver-not-legal-reviewer',
      message: '接收人不持法制审核角色',
      outlet: '改选持法制审核角色的人',
    };
  }
  if (!facts.attributedOrgMatches) {
    return {
      ok: false,
      reason: 'receiver-org-not-attributed',
      message: '接收人任职不属于该案法制审核归属',
      outlet: '改选归属那一级的法制审核人员',
    };
  }
  if (facts.isHandlerEver) {
    return {
      ok: false,
      reason: 'receiver-is-handler',
      message: '接收人不能是本案承办人员',
      outlet: '改选非本案承办人员',
    };
  }
  if (facts.hasActiveConflict) {
    return {
      ok: false,
      reason: 'receiver-conflict-active',
      message: '接收人有回避声明或生效回避',
      outlet: '等待回避决定或改选他人',
    };
  }
  return { ok: true };
}

export interface LegalReviewHeadFacts {
  readonly roles: readonly string[];
  readonly posts: readonly string[];
  /** 当前任职机构就是该案法制审核归属。 */
  readonly attributedOrgMatches: boolean;
  readonly deactivated: boolean;
}

export type LegalReviewHeadIssue =
  | 'head-deactivated'
  | 'head-not-admin-reviewer'
  | 'head-post-marker-missing'
  | 'head-org-not-attributed';

export type LegalReviewHeadCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: LegalReviewHeadIssue; readonly message: string; readonly outlet: string };

/** 法制审核负责人：持行政审核、带法制审核负责人岗位标记、任职在归属那一级。 */
export function checkLegalReviewHead(facts: LegalReviewHeadFacts): LegalReviewHeadCheck {
  if (facts.deactivated) {
    return { ok: false, reason: 'head-deactivated', message: '签出人已停用', outlet: '改由归属那一级的法制审核负责人签出' };
  }
  if (!facts.roles.includes(LEGAL_REVIEW_HEAD_ROLE)) {
    return {
      ok: false,
      reason: 'head-not-admin-reviewer',
      message: '法制审核负责人须持行政审核角色',
      outlet: '改由持行政审核的法制审核负责人签出',
    };
  }
  if (!facts.posts.includes(LEGAL_REVIEW_HEAD_POST)) {
    return {
      ok: false,
      reason: 'head-post-marker-missing',
      message: '签出人未带法制审核负责人岗位标记',
      outlet: '改由带该岗位标记的人签出',
    };
  }
  if (!facts.attributedOrgMatches) {
    return {
      ok: false,
      reason: 'head-org-not-attributed',
      message: '签出人任职不属于该案法制审核归属',
      outlet: '改由归属那一级的法制审核负责人签出',
    };
  }
  return { ok: true };
}

export const LEGAL_REVIEW_CONCLUSIONS = ['pass', 'fail'] as const;
export type LegalReviewConclusion = (typeof LEGAL_REVIEW_CONCLUSIONS)[number];

/** 不通过的两条去向。法审不通过不是退回。 */
export const LEGAL_REVIEW_FAIL_ROUTES = ['accept-revise', 'collective-discussion'] as const;
export type LegalReviewFailRoute = (typeof LEGAL_REVIEW_FAIL_ROUTES)[number];

export function isLegalReviewConclusion(value: string): value is LegalReviewConclusion {
  return (LEGAL_REVIEW_CONCLUSIONS as readonly string[]).includes(value);
}

export function isLegalReviewFailRoute(value: string): value is LegalReviewFailRoute {
  return (LEGAL_REVIEW_FAIL_ROUTES as readonly string[]).includes(value);
}

export interface LegalReviewOpinionContent {
  readonly conclusion: LegalReviewConclusion;
  /** 结论为不通过时必填；通过时为空。 */
  readonly failRoute: LegalReviewFailRoute | null;
  readonly content: string;
  /** 结论通过且前一次不通过走了集体讨论时引用。 */
  readonly discussionRecordId: string | null;
}

export interface LegalReviewContentHit {
  readonly httpStatus: 400;
  readonly reason: string;
  readonly message: string;
  readonly outlet: string;
}

export type LegalReviewOpinionRead =
  | { readonly ok: true; readonly content: LegalReviewOpinionContent }
  | { readonly ok: false; readonly hit: LegalReviewContentHit };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function invalid(reason: string, message: string, outlet: string): LegalReviewOpinionRead {
  return { ok: false, hit: { httpStatus: 400, reason, message, outlet } };
}

/** 法审意见正文校验。通过时可不填去向；不通过时去向必填。 */
export function readLegalReviewOpinionContent(raw: unknown): LegalReviewOpinionRead {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return invalid('invalid-content', '法审意见不合规', '按法审意见格式填写');
  }
  const body = raw as Record<string, unknown>;
  const conclusion = text(body.conclusion);
  if (!isLegalReviewConclusion(conclusion)) {
    return invalid('invalid-conclusion', '法审结论只有通过与不通过', '按通过与不通过选择');
  }
  const content = text(body.content);
  if (content === '') {
    return invalid('missing-content', '法审意见必填', '填写法审意见');
  }
  const routeText = text(body.failRoute);
  if (conclusion === 'fail') {
    if (!isLegalReviewFailRoute(routeText)) {
      return invalid('missing-fail-route', '不通过时须选择去向', '选择按意见修改后重送或提请集体讨论');
    }
  } else if (routeText !== '') {
    return invalid('invalid-fail-route', '通过时不能填不通过去向', '去掉不通过去向');
  }
  const discussionRecordId = text(body.discussionRecordId);
  return {
    ok: true,
    content: {
      conclusion,
      failRoute: conclusion === 'fail' ? (routeText as LegalReviewFailRoute) : null,
      content,
      discussionRecordId: discussionRecordId === '' ? null : discussionRecordId,
    },
  };
}

export interface DiscussionRecordFacts {
  readonly id: string;
  readonly caseId: string;
  readonly purposes: readonly string[];
  readonly createdAt: Date;
}

export type DiscussionReferenceCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly message: string; readonly outlet: string };

/**
 * 集体讨论后回法审补出通过时，校验引用的讨论记录（#31/6233037268 §2.2）。
 * 记录须属本案、目的含统一法制审核意见、写入时刻晚于最近一次不通过定稿。
 */
export function checkDiscussionReference(input: {
  readonly record: DiscussionRecordFacts | null;
  readonly caseId: string;
  readonly latestFailAt: Date | null;
}): DiscussionReferenceCheck {
  if (!input.record) {
    return {
      ok: false,
      reason: 'discussion-record-not-found',
      message: '引用的集体讨论记录不存在',
      outlet: '改选本案的集体讨论记录',
    };
  }
  if (input.record.caseId !== input.caseId) {
    return {
      ok: false,
      reason: 'discussion-record-not-in-case',
      message: '引用的集体讨论记录不属本案',
      outlet: '改选本案的集体讨论记录',
    };
  }
  if (!input.record.purposes.includes('unify-legal-opinion')) {
    return {
      ok: false,
      reason: 'discussion-purpose-mismatch',
      message: '引用的讨论记录目的不含统一法制审核意见',
      outlet: '改选用于统一法制审核意见的讨论记录',
    };
  }
  if (input.latestFailAt && input.record.createdAt.getTime() <= input.latestFailAt.getTime()) {
    return {
      ok: false,
      reason: 'discussion-record-too-early',
      message: '讨论记录须晚于最近一次不通过定稿',
      outlet: '先组织集体讨论并录入记录，再回法审补出通过',
    };
  }
  return { ok: true };
}

/** 摘要覆盖：法审通过的冻结摘要必须是当前决定使用的同一份。 */
export function summaryCoversDecision(input: {
  readonly reviewedFrozenDecisionId: string | null;
  readonly currentFrozenDecisionId: string | null;
}): boolean {
  return input.reviewedFrozenDecisionId !== null && input.reviewedFrozenDecisionId === input.currentFrozenDecisionId;
}

/**
 * 告知前法审闸口（X26）。命中必审但未取到通过且覆盖的法审引用时警告，不阻断。
 * 引用无法解析为系统内法审记录时，沿用 #272 口径视为外部引用，不另告警；
 * 系统内引用必须结论通过且摘要覆盖当前拟决定。
 */
export function assertNoticeGate(input: {
  readonly mandatory: boolean;
  readonly preReviewApproval: string | null;
  readonly coverage: 'covered' | 'not-covered' | 'unknown';
}): GuardResult | null {
  if (!input.mandatory) return null;
  const hasReference = typeof input.preReviewApproval === 'string' && input.preReviewApproval.trim() !== '';
  if (hasReference && (input.coverage === 'covered' || input.coverage === 'unknown')) return null;
  return {
    level: 'warn',
    code: X26_RULE_KEY,
    message: X26_MESSAGE,
    authority: 'normative',
    citation: '规程7.1／8.2；设计加严，非规定要求',
  };
}

export interface DecisionGateFacts {
  readonly mandatory: boolean;
  /** 最近一次已定稿（负责人已签）的法审结论。 */
  readonly latestConclusion: LegalReviewConclusion | null;
  /** 最近一次通过的摘要覆盖当前决定。 */
  readonly latestPassCovered: boolean;
  readonly hearingEntered: boolean;
  /** 最近一次进入听证程序的时刻（受理或排期）。 */
  readonly latestHearingEntryAt: Date | null;
  /** 最近一次通过的定稿时刻。 */
  readonly latestPassAt: Date | null;
  readonly discussionRequired: boolean;
  readonly discussionSatisfied: boolean;
}

export interface DecisionGateBlock {
  readonly code: 'X27' | 'X08' | 'X09';
  readonly message: string;
  readonly outlet: string;
  readonly citation: string | null;
}

export type DecisionGateCheck = { readonly ok: true } | { readonly ok: false; readonly block: DecisionGateBlock };

function blockOf(code: 'X27' | 'X08' | 'X09', message: string): DecisionGateBlock {
  const row = findIllegal(code);
  return { code, message, outlet: row?.outlet ?? '按法审与集体讨论闸口处理', citation: row?.citation ?? null };
}

/**
 * 决定审批链科长审核之后、领导审批之前的闸口（X08、X09、X27）。
 * 顺序：听证后再审（X27）→ 必审通过且覆盖（X08）→ 集体讨论（X09）。
 */
export function assertDecisionGate(facts: DecisionGateFacts): DecisionGateCheck {
  if (facts.hearingEntered) {
    const reviewedAfterHearing =
      facts.latestConclusion === 'pass' &&
      facts.latestPassAt !== null &&
      facts.latestHearingEntryAt !== null &&
      facts.latestPassAt.getTime() > facts.latestHearingEntryAt.getTime();
    if (!reviewedAfterHearing) {
      return {
        ok: false,
        block: blockOf('X27', '进入听证程序后未重新法制审核，不能进入领导审批'),
      };
    }
  }
  if (facts.mandatory && (facts.latestConclusion !== 'pass' || !facts.latestPassCovered)) {
    return {
      ok: false,
      block: blockOf('X08', '必审案件未完成法制审核（未审、未通过或摘要不一致），不能进入领导审批'),
    };
  }
  if (facts.discussionRequired && !facts.discussionSatisfied) {
    return { ok: false, block: blockOf('X09', '须集体讨论而未讨论，不能进入领导审批') };
  }
  return { ok: true };
}

/**
 * 广州市局程序条参照适用清单（#241/6431445240）。
 * 与本地更高效力或已锁口径冲突时以本地／已锁为准；参照范围做成配置清单。
 */
export const GUANGZHOU_PROCEDURE_REFERENCE_LIST_V1 = {
  ruleId: 'cfg.rule.guangzhou-procedure-reference.v1',
  version: '2026-10-29',
  items: [
    { code: 'hearing-re-review', name: '听证后再法审', basis: '广州市局程序条' },
    { code: 'two-handlers', name: '承办不少于二人', basis: '广州市局程序条' },
    { code: 'legal-review-deadline', name: '法审 5＋10 个工作日', basis: '广州市局程序条' },
  ],
  /** 冲突时以本地更高效力或已锁口径为准。 */
  precedence: 'local-or-locked',
} as const;

/** 集体讨论标准：粤自然资规字〔2022〕2 号第 12 条四种情形，另加情节复杂或重大违法行为的法定触发。 */
export const COLLECTIVE_DISCUSSION_LIST_ID = 'cfg.rule.collective-discussion.v1';
export const COLLECTIVE_DISCUSSION_LIST_VERSION = '2026-10-29';

export const COLLECTIVE_DISCUSSION_CRITERIA = [
  {
    code: 'mixed-lenient-severe',
    name: '违法行为同时具有从轻减轻处罚和从重处罚情形',
    basis: '粤自然资规字〔2022〕2号第12条（一）',
  },
  {
    code: 'not-in-benchmark',
    name: '对未列入《实施基准》的其他违法行为实施行政处罚，按法律、法规、规章规定需要裁量',
    basis: '粤自然资规字〔2022〕2号第12条（二）',
  },
  {
    code: 'no-illegal-gains',
    name: '认定无违法所得或者不能计算违法所得的情形进行处罚',
    basis: '粤自然资规字〔2022〕2号第12条（三）',
  },
  {
    code: 'other-collective',
    name: '其他需交由集体讨论决定的情形',
    basis: '粤自然资规字〔2022〕2号第12条（四）',
  },
  {
    code: 'complex-or-major',
    name: '情节复杂或者重大违法行为',
    basis: '行政处罚法第57条第2款；规程7.1末款',
  },
] as const;

export type CollectiveDiscussionCriterionCode = (typeof COLLECTIVE_DISCUSSION_CRITERIA)[number]['code'];

const DISCUSSION_CRITERION_SET = new Set<string>(COLLECTIVE_DISCUSSION_CRITERIA.map((row) => row.code));

export function isCollectiveDiscussionCriterion(value: string): value is CollectiveDiscussionCriterionCode {
  return DISCUSSION_CRITERION_SET.has(value);
}

export const DISCUSSION_PURPOSES = ['penalty-decision', 'unify-legal-opinion'] as const;
export type DiscussionPurpose = (typeof DISCUSSION_PURPOSES)[number];

const DISCUSSION_PURPOSE_SET = new Set<string>(DISCUSSION_PURPOSES);

export function isDiscussionPurpose(value: string): value is DiscussionPurpose {
  return DISCUSSION_PURPOSE_SET.has(value);
}

export interface DiscussionMarkContent {
  readonly criteriaCodes: readonly CollectiveDiscussionCriterionCode[];
  readonly reason: string;
}

export type DiscussionContentHit = LegalReviewContentHit;

export type DiscussionMarkRead =
  | { readonly ok: true; readonly content: DiscussionMarkContent }
  | { readonly ok: false; readonly hit: DiscussionContentHit };

function badDiscussion(reason: string, message: string, outlet: string): DiscussionMarkRead {
  return { ok: false, hit: { httpStatus: 400, reason, message, outlet } };
}

function criterionList(value: unknown): CollectiveDiscussionCriterionCode[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  const picked: CollectiveDiscussionCriterionCode[] = [];
  for (const item of value as string[]) {
    const code = item.trim();
    if (code === '') continue;
    if (!isCollectiveDiscussionCriterion(code)) return null;
    if (!picked.includes(code)) picked.push(code);
  }
  return picked;
}

/** 经办勾选触发：至少一项标准，理由必填。 */
export function readDiscussionMarkContent(raw: unknown): DiscussionMarkRead {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return badDiscussion('invalid-content', '集体讨论勾选不合规', '按标准清单勾选并写理由');
  }
  const body = raw as Record<string, unknown>;
  const criteriaCodes = criterionList(body.criteriaCodes);
  if (!criteriaCodes || criteriaCodes.length === 0) {
    return badDiscussion('missing-criteria', '须至少勾选一项集体讨论标准', '按标准清单勾选');
  }
  const reason = text(body.reason);
  if (reason === '') return badDiscussion('missing-reason', '勾选集体讨论的理由必填', '填写理由');
  return { ok: true, content: { criteriaCodes, reason } };
}

export interface DiscussionRecordContent {
  readonly purposes: readonly DiscussionPurpose[];
  readonly criteriaCodes: readonly CollectiveDiscussionCriterionCode[];
  readonly note: string;
}

export type DiscussionRecordRead =
  | { readonly ok: true; readonly content: DiscussionRecordContent }
  | { readonly ok: false; readonly hit: DiscussionContentHit };

/** 讨论记录录入：目的至少一项，讨论情况必填。 */
export function readDiscussionRecordContent(raw: unknown): DiscussionRecordRead {
  const fail = (reason: string, message: string, outlet: string): DiscussionRecordRead => ({
    ok: false,
    hit: { httpStatus: 400, reason, message, outlet },
  });
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('invalid-content', '集体讨论记录不合规', '按讨论记录格式填写');
  }
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.purposes) || body.purposes.some((item) => typeof item !== 'string')) {
    return fail('missing-purpose', '讨论目的必填', '选择处罚决定或统一法制审核意见');
  }
  const purposes: DiscussionPurpose[] = [];
  for (const item of body.purposes as string[]) {
    const purpose = item.trim();
    if (purpose === '') continue;
    if (!isDiscussionPurpose(purpose)) return fail('invalid-purpose', '讨论目的不合规', '选择处罚决定或统一法制审核意见');
    if (!purposes.includes(purpose)) purposes.push(purpose);
  }
  if (purposes.length === 0) return fail('missing-purpose', '讨论目的必填', '选择处罚决定或统一法制审核意见');
  const criteriaCodes = body.criteriaCodes == null ? [] : criterionList(body.criteriaCodes);
  if (!criteriaCodes) return fail('invalid-criteria', '集体讨论标准不合规', '按标准清单勾选');
  const note = text(body.note);
  if (note === '') return fail('missing-note', '讨论记录内容必填', '填写讨论情况与结论');
  return { ok: true, content: { purposes, criteriaCodes, note } };
}

/** 审理人与法审人为同一人：警告不阻断，确认后留痕（#90 Q4；Q23 下理由选填）。 */
export function samePersonWarning(samePerson: boolean): GuardResult | null {
  if (!samePerson) return null;
  return {
    level: 'warn',
    code: LEGAL_SAME_PERSON_RULE_KEY,
    message: LEGAL_SAME_PERSON_MESSAGE,
    authority: 'normative',
  };
}

/**
 * 法律职业资格提示：一期不硬拦。档案未登记（含系统尚无该字段）时提示并留痕。
 * 字段归管理台人员档案（#105／#118）；本规则只消费登记事实。
 */
export function legalQualificationHint(registered: boolean | null): GuardResult | null {
  if (registered === true) return null;
  return {
    level: 'hint',
    code: LEGAL_QUALIFICATION_RULE_KEY,
    message: '法审人员法律职业资格未登记',
    authority: 'normative',
    citation: '行政处罚法第58条第2款',
  };
}