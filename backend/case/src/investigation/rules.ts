// 调查环节与收尾的纯规则（#236）。不写库。
// 终止原因取处罚办法第 28 条四项，并上规程 3.5 增列的不可抗力。
// 四项原文见 docs/research/suspension-termination.md §2.2。
// 规程 3.5 的逐条原文只抽出了不可抗力一项（同文 §3.2），其余四项与办法第 28 条相同。
// 停表、续表的依据标签由调用方传入，本文件不写死「业务不计入」。

import { findIllegal, stageIndex } from '../state-machine/index.ts';

/** 认定方式（#42/6431079827）：一次性／连续／继续。 */
export const RECOGNITION_MODES = [
  { code: 'one-off', label: '一次性' },
  { code: 'continuous', label: '连续' },
  { code: 'continuing', label: '继续' },
] as const;
export type RecognitionMode = (typeof RECOGNITION_MODES)[number]['code'];

/** 违法记录状态。作废后仍保留，不物理删除。 */
export const VIOLATION_STATUSES = ['active', 'voided'] as const;
export type ViolationStatus = (typeof VIOLATION_STATUSES)[number];

/** 处罚办法第 17 条第 2 款。笔录在场承办人员少于两人时，命中记录带这句。 */
export const INQUIRY_OFFICER_CITATION = '处罚办法第 17 条第 2 款';

/** 中止呈批界面的提示。不选也能提交。 */
export const EXTEND_DEADLINE_PROMPT = '是否同时办延长办案期限';

/** 中止、恢复都提示三个工作日内书面告知。本票不算期限。 */
export const PARTY_NOTICE_PROMPT = '须在三个工作日内书面告知当事人';

/** 结案「不属本部门管辖」分支未开放时的提示。 */
export const CLOSE_BRANCH_NOT_OPEN_MESSAGE = '该分支未开放';

/**
 * 终止调查原因。办法第 28 条（一）至（四），规程 3.5 在管辖与「其他」之间增列不可抗力。
 * 当事人死亡、注销不单列，归入「其他」（#236 已知限制）。
 */
export const TERMINATION_REASONS = [
  { code: 'fact-not-established', label: '调查过程中，发现违法事实不成立的', source: '处罚办法第 28 条（一）' },
  { code: 'limitation-expired', label: '违法行为已过行政处罚追诉时效的', source: '处罚办法第 28 条（二）' },
  { code: 'outside-jurisdiction', label: '不属于本部门管辖，需要向其他部门移送的', source: '处罚办法第 28 条（三）' },
  { code: 'force-majeure', label: '因不可抗力致使案件无法调查处理的', source: '规程 3.5' },
  { code: 'other', label: '其他应当终止调查的情形', source: '处罚办法第 28 条（四）' },
] as const;
export type TerminationReason = (typeof TERMINATION_REASONS)[number]['code'];

/** 撤案原因只此两项（规程 4.3.3(4)、7.1(6)）。 */
export const WITHDRAW_REASONS = [
  { code: 'fact-not-established', label: '违法事实不成立' },
  { code: 'limitation-expired', label: '已过追诉时效' },
] as const;
export type WithdrawReason = (typeof WITHDRAW_REASONS)[number]['code'];

/**
 * 待收尾结案原因。不可抗力开放（规程 7.1(5)）。
 * 不属本部门管辖须已有管辖移送记录，本票不开放。
 */
export const CLOSE_REASONS = [
  { code: 'force-majeure', label: '不可抗力', open: true },
  { code: 'outside-jurisdiction', label: '不属本部门管辖', open: false },
] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number]['code'];

export const PROCEDURE_KINDS = ['suspend', 'resume', 'terminate', 'withdraw', 'close'] as const;
export type ProcedureKind = (typeof PROCEDURE_KINDS)[number];

export const PROCEDURE_TRANSITION: Readonly<Record<ProcedureKind, string>> = {
  suspend: 'T03',
  resume: 'T04',
  terminate: 'T05',
  withdraw: 'T06',
  close: 'T07',
};

/** 待收尾只允许这两类呈批（X03）。 */
export const PENDING_CLOSEOUT_KINDS = ['withdraw', 'close'] as const;

export type ProcedureContent =
  | { readonly kind: 'suspend'; readonly extendTogether: boolean }
  | { readonly kind: 'resume' }
  | { readonly kind: 'terminate'; readonly reason: TerminationReason }
  | { readonly kind: 'withdraw'; readonly reason: WithdrawReason }
  | { readonly kind: 'close'; readonly reason: 'force-majeure' };

export type ProcedureContentHit =
  | { readonly httpStatus: 400; readonly reason: 'invalid-kind' | 'invalid-reason'; readonly message: string }
  | {
      readonly httpStatus: 409;
      readonly reason: 'invalid-withdraw-reason' | 'branch-not-open';
      readonly message: string;
      readonly outlet: string;
    };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 日历日。非法日期（如 2 月 31 日）拒绝。 */
export function parseCalendarDay(value: unknown): string | null {
  if (typeof value !== 'string' || !DAY.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
}

export function isRecognitionMode(value: string): value is RecognitionMode {
  return RECOGNITION_MODES.some((item) => item.code === value);
}

function codesOf(rows: readonly { readonly code: string }[]): readonly string[] {
  return rows.map((item) => item.code);
}

/** 审理从 E04 开始（#27 Q2：调查报告批准后进入审理）。当前环节到达 E04 即已开始。 */
export function hearingHasStarted(stage: string): boolean {
  const index = stageIndex(stage);
  return index >= stageIndex('E04');
}

/**
 * 在场承办人员。只数本案当前承办人员里的不同的人。
 * 少于两人即 X20，依据处罚办法第 17 条第 2 款。
 */
export function checkInquiryOfficers(
  officerIds: readonly string[],
  handlerIds: readonly string[],
): { readonly ok: true; readonly officerIds: readonly string[] } | { readonly ok: false; readonly reason: 'X20' } {
  const handlers = new Set(handlerIds);
  const present = [...new Set(officerIds.filter((id) => handlers.has(id)))];
  if (present.length < 2) return { ok: false, reason: 'X20' };
  return { ok: true, officerIds: present };
}

export function inquiryOfficerBlock(): { readonly citation: string; readonly message: string; readonly outlet: string } {
  const row = findIllegal('X20');
  return {
    citation: INQUIRY_OFFICER_CITATION,
    message: '在场承办人员少于两人，不能保存笔录',
    outlet: row?.outlet ?? '笔录在场承办人员须不少于两人',
  };
}

/** 作废理由去掉空白后必须有字。审理开始后不能作废。 */
export function checkVoidViolation(input: {
  readonly stage: string;
  readonly reason: string;
  readonly isMainHandler: boolean;
}):
  | { readonly ok: true; readonly reason: string }
  | { readonly ok: false; readonly httpStatus: 400 | 409; readonly reason: string; readonly message: string; readonly outlet: string } {
  const reason = input.reason.trim();
  if (reason === '') {
    return { ok: false, httpStatus: 400, reason: 'missing-void-reason', message: '作废理由必填', outlet: '填写作废理由' };
  }
  if (!input.isMainHandler) {
    return { ok: false, httpStatus: 409, reason: 'not-main-handler', message: '作废由主办标记', outlet: '请由本案主办标记作废' };
  }
  if (hearingHasStarted(input.stage)) {
    return {
      ok: false,
      httpStatus: 409,
      reason: 'hearing-started',
      message: '审理开始后不能作废违法记录',
      outlet: '审理开始后走不予处罚',
    };
  }
  return { ok: true, reason };
}

export function isProcedureKind(value: string): value is ProcedureKind {
  return (PROCEDURE_KINDS as readonly string[]).includes(value);
}

/** 呈批正文。终止原因不在枚举内为 400。撤案原因不合为 409。未开放的结案分支为 409。 */
export function checkProcedureContent(input: {
  readonly kind: string;
  readonly reason?: unknown;
  readonly extendTogether?: unknown;
}): { readonly ok: true; readonly content: ProcedureContent } | { readonly ok: false; readonly hit: ProcedureContentHit } {
  if (!isProcedureKind(input.kind)) {
    return { ok: false, hit: { httpStatus: 400, reason: 'invalid-kind', message: '没有这类呈批' } };
  }
  if (input.kind === 'suspend') {
    const extendTogether = input.extendTogether === true;
    return { ok: true, content: { kind: 'suspend', extendTogether } };
  }
  if (input.kind === 'resume') return { ok: true, content: { kind: 'resume' } };
  const reason = typeof input.reason === 'string' ? input.reason : '';
  if (input.kind === 'terminate') {
    if (!codesOf(TERMINATION_REASONS).includes(reason)) {
      return { ok: false, hit: { httpStatus: 400, reason: 'invalid-reason', message: '终止调查原因不在枚举内' } };
    }
    return { ok: true, content: { kind: 'terminate', reason: reason as TerminationReason } };
  }
  if (input.kind === 'withdraw') {
    if (!codesOf(WITHDRAW_REASONS).includes(reason)) {
      return {
        ok: false,
        hit: {
          httpStatus: 409,
          reason: 'invalid-withdraw-reason',
          message: '撤案原因只能是违法事实不成立或已过追诉时效',
          outlet: '改用违法事实不成立或已过追诉时效',
        },
      };
    }
    return { ok: true, content: { kind: 'withdraw', reason: reason as WithdrawReason } };
  }
  const close = CLOSE_REASONS.find((item) => item.code === reason);
  if (!close) {
    return { ok: false, hit: { httpStatus: 400, reason: 'invalid-reason', message: '结案原因不在枚举内' } };
  }
  if (!close.open) {
    return {
      ok: false,
      hit: {
        httpStatus: 409,
        reason: 'branch-not-open',
        message: CLOSE_BRANCH_NOT_OPEN_MESSAGE,
        outlet: '该分支未开放，请改选不可抗力',
      },
    };
  }
  return { ok: true, content: { kind: 'close', reason: 'force-majeure' } };
}

export type ProcedureStateHit =
  | { readonly reason: 'X03'; readonly message: string; readonly outlet: string; readonly citation: string | null }
  | { readonly reason: 'invalid-state'; readonly message: string; readonly outlet: string };

/** 呈批种类与当前主状态、环节、中止标记是否相配。待收尾的其他种类为 X03。 */
export function checkProcedureState(input: {
  readonly kind: ProcedureKind;
  readonly mainStatus: string;
  readonly stage: string;
  readonly suspended: boolean;
}): { readonly ok: true } | { readonly ok: false; readonly hit: ProcedureStateHit } {
  if (input.kind === 'withdraw' && hearingHasStarted(input.stage)) {
    return {
      ok: false,
      hit: { reason: 'invalid-state', message: '撤案只在审理开始前', outlet: '审理开始前经终止调查进入待收尾后再撤案' },
    };
  }
  if (input.mainStatus === 'terminated_pending') {
    if (input.kind === 'withdraw' || input.kind === 'close') return { ok: true };
    const row = findIllegal('X03');
    return {
      ok: false,
      hit: {
        reason: 'X03',
        message: '待收尾状态下只能撤案或结案',
        outlet: row?.outlet ?? '只可走撤案呈批或结案呈批',
        citation: row?.citation ?? null,
      },
    };
  }
  if (input.mainStatus !== 'in_progress' || input.stage !== 'E02') {
    return { ok: false, hit: { reason: 'invalid-state', message: '当前环节不能发起该呈批', outlet: '请按当前环节选择呈批' } };
  }
  if (input.kind === 'withdraw' || input.kind === 'close') {
    return { ok: false, hit: { reason: 'invalid-state', message: '撤案和结案只在待收尾发起', outlet: '先终止调查' } };
  }
  if (input.kind === 'suspend' && input.suspended) {
    return { ok: false, hit: { reason: 'invalid-state', message: '案件已处于中止', outlet: '中止期间可恢复或终止调查' } };
  }
  if (input.kind === 'resume' && !input.suspended) {
    return { ok: false, hit: { reason: 'invalid-state', message: '案件未中止', outlet: '先办中止呈批' } };
  }
  return { ok: true };
}

/**
 * 时效届满的发现时点 → 出口。配置对象落地前用带版本号的常量（cfg.rule.*）。
 * 审理前同时保留终止调查与撤案，本对象不把原因收成只能撤案。
 * 审理后指向调用方给出的结果。本票不执行那条迁移。
 */
export interface LimitationDiscoveryExit {
  readonly ruleId: string;
  readonly beforeHearing: readonly {
    readonly kind: 'terminate' | 'withdraw';
    readonly transitionId: string;
  }[];
  readonly afterHearing: {
    readonly outcomeCode: string;
    readonly outcomeLabel: string;
    readonly transitionId: string;
    readonly applyInThisTicket: false;
  };
}

/** cfg.rule.limitation-discovery-exit.v1。审理后的 T12 只作映射，批准事务不套用。 */
export const LIMITATION_DISCOVERY_EXIT_V1: LimitationDiscoveryExit = {
  ruleId: 'cfg.rule.limitation-discovery-exit.v1',
  beforeHearing: [
    { kind: 'terminate', transitionId: 'T05' },
    { kind: 'withdraw', transitionId: 'T06' },
  ],
  afterHearing: {
    outcomeCode: 'O2',
    outcomeLabel: '不予行政处罚',
    transitionId: 'T12',
    applyInThisTicket: false,
  },
};

export type LimitationDiscoveryHit =
  | { readonly httpStatus: 409; readonly reason: 'invalid-state'; readonly message: string; readonly outlet: string }
  | {
      readonly httpStatus: 409;
      readonly reason: 'post-hearing-limitation';
      readonly message: string;
      readonly outlet: string;
      readonly outcomeCode: string;
      readonly transitionId: string;
      readonly applyInThisTicket: false;
    };

/**
 * 已过追诉时效时按映射决定能否在本环节办。
 * 审理前只放行映射里列出的种类。默认同时列出终止调查与撤案。
 * 审理后抄映射中的出口字段，不调用那条迁移。
 */
export function checkLimitationDiscoveryExit(input: {
  readonly stage: string;
  readonly kind: string;
  readonly reason: string | null;
  readonly rule: LimitationDiscoveryExit;
}): { readonly ok: true } | { readonly ok: false; readonly hit: LimitationDiscoveryHit } {
  const limited = (input.kind === 'terminate' || input.kind === 'withdraw') && input.reason === 'limitation-expired';
  if (!limited) return { ok: true };
  if (!hearingHasStarted(input.stage)) {
    const listed = input.rule.beforeHearing.some((row) => row.kind === input.kind);
    if (listed) return { ok: true };
    return {
      ok: false,
      hit: {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '该发现时点未配置这一出口',
        outlet: '按映射选择终止调查或撤案',
      },
    };
  }
  const exit = input.rule.afterHearing;
  return {
    ok: false,
    hit: {
      httpStatus: 409,
      reason: 'post-hearing-limitation',
      message: '审理开始后已过追诉时效不在本环节办结',
      outlet: exit.outcomeLabel,
      outcomeCode: exit.outcomeCode,
      transitionId: exit.transitionId,
      applyInThisTicket: exit.applyInThisTicket,
    },
  };
}

/** 停表或续表事件。依据标签与备注整段来自参数，调用处不写类别字面量。 */
export interface SuspensionClockParameter {
  readonly basisLabel: string;
  readonly basisNote: string;
}

/**
 * #29 的期间事件参数。类别是「业务不计入」，备注标依据待法制部门确认。
 * 消费方读这一处。改类别只改这个对象。
 */
export const SUSPENSION_CLOCK_PARAMETER: SuspensionClockParameter = {
  basisLabel: '业务不计入',
  basisNote: '依据待法制部门确认',
};

export interface DeadlineEventDraft {
  readonly eventKind: 'stop' | 'continue';
  readonly basisLabel: string;
  readonly basisNote: string;
  readonly stage: string;
  readonly entrySeq: number;
  readonly transitionCode: string;
}

export function suspensionClockEvent(
  parameter: SuspensionClockParameter,
  input: {
    readonly eventKind: 'stop' | 'continue';
    readonly stage: string;
    readonly entrySeq: number;
    readonly transitionCode: string;
  },
): DeadlineEventDraft {
  return {
    eventKind: input.eventKind,
    basisLabel: parameter.basisLabel,
    basisNote: parameter.basisNote,
    stage: input.stage,
    entrySeq: input.entrySeq,
    transitionCode: input.transitionCode,
  };
}
