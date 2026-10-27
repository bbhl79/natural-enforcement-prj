// 立案呈批（《立案（不予立案）呈批表》）与案件最小模型的领域规则（#234）。
//
// 纯规则、不依赖 Nest 与存储（写法同 clue/closure/rules.ts）：
// 呈批内容校验（结论二选一＋不予立案理由两类互斥，X30）、审批链最小固定形态的迁移门槛、
// X31 在途锁判定、批准时的守卫（X01、行政处罚法第 42 条、处罚办法第 16 条（一）），
// 以及批准·立案（T01）时案件最小字段的组装。接口层只负责喂事实、把结果映射成 HTTP。

import { checkNoCaseReason, type NoCaseReason } from '../clue/closure/rules.ts';

/** 呈批结论：立案 | 不予立案（#27 批2 Q8：一期只设两项）。 */
export const FILING_CONCLUSIONS = ['file', 'no-case'] as const;
export type FilingConclusion = (typeof FILING_CONCLUSIONS)[number];

/**
 * 呈批状态：拟制中 | 待行政审核 | 待行政审批 | 已批准。
 * 退回、撤回都回到拟制中（已签意见保留在审批步骤里）。
 */
export const FILING_APPROVAL_STATUSES = ['drafting', 'pending_review', 'pending_approval', 'approved'] as const;
export type FilingApprovalStatus = (typeof FILING_APPROVAL_STATUSES)[number];

/** 审批步骤：提交 | 行政审核 | 行政审批（末级 doc.approve）| 退回 | 撤回。 */
export const FILING_STEPS = ['submit', 'review', 'approve', 'return', 'withdraw'] as const;
export type FilingStep = (typeof FILING_STEPS)[number];

/** 行政审核一级可配置为跳过或一级（#234 范围 2）。 */
export type FilingAdminReview = 'skip' | 'one-level';

/** 各步骤允许的起始状态（最小固定链路：提交 → 行政审核（可跳过）→ 行政审批）。 */
export const FILING_STEP_FROM: Readonly<Record<FilingStep, readonly FilingApprovalStatus[]>> = {
  submit: ['drafting'],
  review: ['pending_review'],
  approve: ['pending_approval'],
  return: ['pending_review', 'pending_approval'],
  withdraw: ['pending_review', 'pending_approval'],
};

/** 各步骤成功后的状态。提交的去向取决于行政审核配置。 */
export function filingStatusAfter(step: FilingStep, adminReview: FilingAdminReview): FilingApprovalStatus {
  switch (step) {
    case 'submit':
      return adminReview === 'skip' ? 'pending_approval' : 'pending_review';
    case 'review':
      return 'pending_approval';
    case 'approve':
      return 'approved';
    case 'return':
    case 'withdraw':
      return 'drafting';
  }
}

/** 步骤能否从当前状态发起。 */
export function canTakeFilingStep(step: FilingStep, status: string): boolean {
  return (FILING_STEP_FROM[step] as readonly string[]).includes(status);
}

/** X31 原因码（#27 批2 Q9；系统完整性守卫）。 */
export const FILING_APPROVAL_PENDING_REASON = 'filing-approval-pending';
/** X31 出路。 */
export const FILING_APPROVAL_PENDING_OUTLET = '先撤回立案呈批';

/**
 * X31 在途锁：呈批「已提交、未批准、未退回、未撤回」＝待行政审核或待行政审批。
 * 在途期间该线索的移送、其他、报请指定管辖、改承办机构、换承办人一律 409。
 */
export function isFilingApprovalPending(status: string | null | undefined): boolean {
  return status === 'pending_review' || status === 'pending_approval';
}

/** 呈批内容（一个版本的正文）。 */
export type FilingContent =
  | {
      readonly conclusion: 'file';
      /** 当事人名称（立案须带；批准时守卫「当事人可确定」）。 */
      readonly partyNames: readonly string[];
    }
  | {
      readonly conclusion: 'no-case';
      /** 不予立案理由快照（两类互斥，沿用 #226）。 */
      readonly noCaseReason: NoCaseReason;
    };

export type FilingContentCheck =
  | { readonly ok: true; readonly content: FilingContent }
  | { readonly ok: false; readonly rule: 'invalid-conclusion' | 'invalid-no-case-reason' };

/**
 * 呈批内容校验：结论二选一；不予立案须带合法理由（X30，提交与批准两处都调本函数）。
 * 立案结论的当事人名称去空白去重；为空不在此拒绝，由批准守卫按第 16 条（一）阻断。
 */
export function checkFilingContent(input: unknown): FilingContentCheck {
  if (input === null || typeof input !== 'object') return { ok: false, rule: 'invalid-conclusion' };
  const raw = input as Record<string, unknown>;
  if (raw.conclusion === 'file') {
    const list = Array.isArray(raw.partyNames) ? raw.partyNames : [];
    const partyNames = [
      ...new Set(list.filter((name): name is string => typeof name === 'string').map((name) => name.trim())),
    ].filter((name) => name !== '');
    return { ok: true, content: { conclusion: 'file', partyNames } };
  }
  if (raw.conclusion === 'no-case') {
    const checked = checkNoCaseReason(raw.noCaseReason);
    if (!checked.ok) return { ok: false, rule: 'invalid-no-case-reason' };
    return { ok: true, content: { conclusion: 'no-case', noCaseReason: checked.reason } };
  }
  return { ok: false, rule: 'invalid-conclusion' };
}

/** 批准守卫的依据条号（#30 Q1：阻断须引条款；X01 为系统完整性守卫，不带条号）。 */
export const FILING_GUARD_BASIS = {
  'handlers-not-qualified': '行政处罚法第 42 条',
  'party-unknown': '处罚办法第 16 条（一）',
} as const;

/** 批准守卫命中（409）：原因码、依据条号、出路。 */
export type FilingGuardHit =
  | { readonly reason: 'invalid-state'; readonly basis: null; readonly outlet: string }
  | {
      readonly reason: 'handlers-not-qualified';
      readonly basis: (typeof FILING_GUARD_BASIS)['handlers-not-qualified'];
      readonly outlet: string;
    }
  | {
      readonly reason: 'party-unknown';
      readonly basis: (typeof FILING_GUARD_BASIS)['party-unknown'];
      readonly outlet: string;
    };

/** 批准时的承办人员事实（资格由调用方按 #133 领域判定后喂入）。 */
export interface FilingHandlerFact {
  readonly personnelId: string;
  /** main（主办）| assist（协办）。 */
  readonly role: string;
  readonly qualified: boolean;
}

/** 批准守卫入参。 */
export interface FilingGuardInput {
  readonly conclusion: FilingConclusion;
  /** 线索当前主状态。 */
  readonly clueStatus: string;
  readonly handlers: readonly FilingHandlerFact[];
  /** 立案结论的当事人名称（不予立案时忽略）。 */
  readonly partyNames: readonly string[];
  /** 线索「当事人不明」标记（GLOSSARY；登记时独立标记）。 */
  readonly subjectUnknown: boolean;
}

/** 呈批的线索起点（T01、T02 都从已派承办人出发）。 */
export const FILING_FROM_CLUE_STATUS = 'handler_assigned';

/**
 * 当事人可确定（R-8 定案 C / 处罚办法第 16 条（一））。
 * 提交与批准都拦；拟制草稿不拦（可保存未提交）。
 */
export function checkFilingParty(input: {
  readonly conclusion: FilingConclusion;
  readonly partyNames: readonly string[];
  readonly subjectUnknown: boolean;
}): FilingGuardHit | null {
  if (input.conclusion !== 'file') return null;
  if (input.subjectUnknown || input.partyNames.length === 0) {
    return {
      reason: 'party-unknown',
      basis: FILING_GUARD_BASIS['party-unknown'],
      outlet: '先补明确的当事人，或改拟不予立案',
    };
  }
  return null;
}

/**
 * 批准守卫（T01／T02）：按序只报第一条命中。
 * ① 线索须为 handler_assigned（X01）；
 * ② 立案：主办＋协办不少于 2 人且都有执法资格（行政处罚法第 42 条，#27 Q6）；
 * ③ 立案：当事人可确定（R-8 定案 C；提交路径另调 checkFilingParty）。
 */
export function checkFilingGuards(input: FilingGuardInput): FilingGuardHit | null {
  if (input.clueStatus !== FILING_FROM_CLUE_STATUS) {
    return { reason: 'invalid-state', basis: null, outlet: '线索须为已派承办人' };
  }
  if (input.conclusion === 'no-case') return null;
  const hasMain = input.handlers.some((handler) => handler.role === 'main');
  if (!hasMain || input.handlers.length < 2 || input.handlers.some((handler) => !handler.qualified)) {
    return {
      reason: 'handlers-not-qualified',
      basis: FILING_GUARD_BASIS['handlers-not-qualified'],
      outlet: '先补派协办，并为承办人员登记有效执法证',
    };
  }
  return checkFilingParty(input);
}

/** 案件主状态「办理中」（#27 第 1／2 条 三、案件主状态）。 */
export const CASE_STATUS_IN_PROGRESS = 'in_progress';
/** 立案后进入的法定环节：E02 调查（T01：E01 完成，E02 进入拟制中）。 */
export const CASE_FIRST_STAGE = 'E02';
/** 环节进入次序号起点（回流时加 1，由 #235 接管）。 */
export const CASE_FIRST_STAGE_ENTRY_SEQ = 1;

/**
 * 案件最小模型（#234 范围 3；供 #235 无损接管）。
 * 承办机构＝线索当前承办机构，此后不可变（X13，库层触发器兜底）。
 * 来源线索用主键引用（#16）；本票只支持一条。
 */
export interface CaseOpening {
  readonly caseId: string;
  readonly handlingOrgId: string;
  readonly handlers: readonly { readonly personnelId: string; readonly role: 'main' | 'assist' }[];
  readonly partyNames: readonly string[];
  readonly sourceClueIds: readonly string[];
  readonly filingApprovalId: string;
  readonly status: typeof CASE_STATUS_IN_PROGRESS;
  readonly currentStage: typeof CASE_FIRST_STAGE;
  readonly stageEntrySeq: typeof CASE_FIRST_STAGE_ENTRY_SEQ;
  readonly openedAt: Date;
}

/** 组装批准·立案的案件最小字段（守卫已过后调用）。 */
export function buildCaseOpening(input: {
  readonly caseId: string;
  readonly handlingOrgId: string;
  readonly handlers: readonly { readonly personnelId: string; readonly role: string }[];
  readonly partyNames: readonly string[];
  readonly sourceClueId: string;
  readonly filingApprovalId: string;
  readonly openedAt: Date;
}): CaseOpening {
  return {
    caseId: input.caseId,
    handlingOrgId: input.handlingOrgId,
    handlers: input.handlers.map((handler) => ({
      personnelId: handler.personnelId,
      role: handler.role === 'main' ? 'main' : 'assist',
    })),
    partyNames: [...input.partyNames],
    sourceClueIds: [input.sourceClueId],
    filingApprovalId: input.filingApprovalId,
    status: CASE_STATUS_IN_PROGRESS,
    currentStage: CASE_FIRST_STAGE,
    stageEntrySeq: CASE_FIRST_STAGE_ENTRY_SEQ,
    openedAt: input.openedAt,
  };
}
