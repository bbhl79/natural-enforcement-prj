// 案件阶段三类移送（#242）：管辖、涉刑、党纪政务。
// 最小版＝呈批＋记载＋回证上传。判定留在本文件，服务层只喂事实与落库。
// 管辖移送批准即办结本机关环节，不直送对方待分派池；涉刑、党纪政务走侧链不改当前环节。
// 涉刑移送批准前须有通过的法审（#269 必审判定，criminal-transfer 一项），未通过即阻断。
// T30 分支（A 回调查、B 结案或其他处理）由服务层解析出单一落点后再交引擎，不改引擎分支机制。
// X11 在结案闸口：有已提交的涉刑或党纪政务呈批而未形成记载时阻断。

import { findIllegal } from '../state-machine/catalog.ts';
import type { GuardResult } from '../state-machine/guard.ts';

/** 三类移送。顺序即界面清单顺序。 */
export const TRANSFER_KINDS = ['jurisdiction', 'criminal', 'party-discipline'] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];

export const TRANSFER_KIND_NAMES: Readonly<Record<TransferKind, string>> = {
  jurisdiction: '管辖移送',
  criminal: '涉刑移送',
  'party-discipline': '党纪政务移送',
};

const TRANSFER_KIND_SET = new Set<string>(TRANSFER_KINDS);

export function isTransferKind(value: string): value is TransferKind {
  return TRANSFER_KIND_SET.has(value);
}

/** 呈批链路配置（规程无明文，可配置）。 */
export const TRANSFER_APPROVAL_CHAIN_RULE_ID = 'cfg.rule.transfer-approval-chain.v1';
export const TRANSFER_APPROVAL_CHAIN_VERSION = '2026-10-29';
/** 默认链路：承办机构负责人审核 → 部门负责人批准。规程无明文。 */
export const TRANSFER_APPROVAL_CHAIN_BASIS = '规程无明文';

export const TRANSFER_APPROVAL_LEVELS = ['review', 'approve'] as const;
export type TransferApprovalLevel = (typeof TRANSFER_APPROVAL_LEVELS)[number];

export interface TransferApprovalChain {
  readonly ruleId: string;
  readonly version: string;
  readonly basis: string;
  readonly levels: readonly TransferApprovalLevel[];
}

export const DEFAULT_TRANSFER_APPROVAL_CHAIN: TransferApprovalChain = {
  ruleId: TRANSFER_APPROVAL_CHAIN_RULE_ID,
  version: TRANSFER_APPROVAL_CHAIN_VERSION,
  basis: TRANSFER_APPROVAL_CHAIN_BASIS,
  levels: ['review', 'approve'],
};

/** 配置只调层级个数与次序；最后一级必须是批准，审核至多一级。 */
export function resolveTransferApprovalChain(override?: {
  readonly levels?: readonly string[];
}): TransferApprovalChain {
  const levels = (override?.levels ?? DEFAULT_TRANSFER_APPROVAL_CHAIN.levels)
    .map((item) => item.trim())
    .filter((item): item is TransferApprovalLevel => (TRANSFER_APPROVAL_LEVELS as readonly string[]).includes(item));
  const last = levels[levels.length - 1];
  if (last !== 'approve' || levels.filter((item) => item === 'review').length > 1) {
    return DEFAULT_TRANSFER_APPROVAL_CHAIN;
  }
  return { ...DEFAULT_TRANSFER_APPROVAL_CHAIN, levels };
}

/** 呈批状态推进：提交、审核、批准。状态不符返回 null。 */
export function transferStatusAfter(
  step: 'submit' | 'review',
  chain: TransferApprovalChain,
): string | null {
  if (step === 'submit') return chain.levels.includes('review') ? 'pending_review' : 'pending_approval';
  if (step === 'review') return 'pending_approval';
  return null;
}

export const TRANSFER_APPROVAL_STATUSES = [
  'drafting',
  'pending_review',
  'pending_approval',
  'approved',
  'withdrawn',
] as const;
export type TransferApprovalStatus = (typeof TRANSFER_APPROVAL_STATUSES)[number];

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 日历日。非法日期（如 2 月 31 日）拒绝。 */
export function parseTransferDay(value: unknown): string | null {
  if (typeof value !== 'string' || !DAY.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function filled(value: unknown): boolean {
  return text(value) !== '';
}

function stringList(value: unknown, limit: number): string[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  const rows: string[] = [];
  for (const item of value as string[]) {
    const name = item.trim();
    if (name === '') continue;
    if (rows.includes(name)) continue;
    rows.push(name);
  }
  return rows.length > limit ? null : rows;
}

export interface TransferContent {
  readonly kind: TransferKind;
  /** 接收机关。自然资源部门以外的机关。 */
  readonly receivingOrg: string;
  readonly documentNo: string;
  /** 发函日期（缺省北京当日，可补录）。 */
  readonly letterDate: string;
  readonly reason: string;
  /** 附件名称 0..n。 */
  readonly attachments: readonly string[];
}

export interface TransferContentHit {
  readonly httpStatus: 400;
  readonly reason: string;
  readonly message: string;
  readonly outlet: string;
}

export type TransferContentRead =
  | { readonly ok: true; readonly content: TransferContent }
  | { readonly ok: false; readonly hit: TransferContentHit };

function invalidTransfer(reason: string, message: string): TransferContentRead {
  return { ok: false, hit: { httpStatus: 400, reason, message, outlet: '按移送呈批表填写' } };
}

/** 呈批正文校验。发函日期空串取北京当日；补录值须是真实日历日。 */
export function readTransferContent(raw: unknown, today: string): TransferContentRead {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return invalidTransfer('invalid-content', '移送呈批正文不合规');
  }
  const body = raw as Record<string, unknown>;
  const kind = text(body.kind);
  if (!isTransferKind(kind)) {
    return invalidTransfer('invalid-kind', '移送类型只能是管辖、涉刑或党纪政务');
  }
  if (!filled(body.receivingOrg) || !filled(body.documentNo) || !filled(body.reason)) {
    return invalidTransfer('missing-fields', '接收机关、文书编号与原因必填');
  }
  const rawDate = text(body.letterDate);
  const letterDate = rawDate === '' ? today : parseTransferDay(rawDate);
  if (letterDate === null) {
    return invalidTransfer('invalid-letter-date', '发函日期须是真实日历日');
  }
  const attachments = stringList(body.attachments, 20);
  if (attachments === null) {
    return invalidTransfer('invalid-attachment', '附件名称不合规');
  }
  return {
    ok: true,
    content: {
      kind,
      receivingOrg: text(body.receivingOrg),
      documentNo: text(body.documentNo),
      letterDate,
      reason: text(body.reason),
      attachments,
    },
  };
}

/** 涉刑移送的必审原因（#269 必审清单 criminal-transfer 一项）。 */
export const CRIMINAL_TRANSFER_REVIEW_ITEM = 'criminal-transfer';
/** 涉刑移送三个工作日的规则键（#246 登记，本票只算提示）。 */
export const CRIMINAL_TRANSFER_DECISION_RULE_KEY = 'criminal-transfer.decision';

export interface TransferLegalReviewFact {
  readonly id: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly determinationJson: string;
}

/**
 * 取最近一次通过、且必审判定含涉刑移送的轮次。
 * 未通过、未定稿、判定不含 criminal-transfer 的轮次不算。
 */
export function criminalTransferReviewPass(
  rows: readonly TransferLegalReviewFact[],
): string | null {
  let found: string | null = null;
  for (const row of rows) {
    if (row.status !== 'concluded' || row.conclusion !== 'pass') continue;
    let decisionKind: string | null = null;
    try {
      const parsed = JSON.parse(row.determinationJson) as { autoReasons?: unknown };
      const reasons = Array.isArray(parsed.autoReasons) ? parsed.autoReasons : [];
      if (!reasons.includes(CRIMINAL_TRANSFER_REVIEW_ITEM)) continue;
      decisionKind = CRIMINAL_TRANSFER_REVIEW_ITEM;
    } catch {
      continue;
    }
    if (decisionKind !== null) found = row.id;
  }
  return found;
}

/** 涉刑移送批准前的法审闸口。未通过返回阻断，不是 X 编号。 */
export function assertCriminalTransferReview(input: {
  readonly required: boolean;
  readonly passedReviewId: string | null;
}): GuardResult | null {
  if (!input.required || input.passedReviewId !== null) return null;
  return {
    level: 'block',
    code: 'legal-review-required',
    message: '涉刑移送须先完成法制审核且结论通过',
    authority: 'regulation',
    citation: '行政处罚法第58条；#90/6430922038 Q1',
  };
}

/** 结案闸口（X11）：有已提交的涉刑或党纪政务呈批，却未形成移送记载。 */
export const CLOSEOUT_TRANSFER_KINDS = ['criminal', 'party-discipline'] as const;

export interface TransferRecordFact {
  readonly kind: string;
}

export interface TransferApprovalFact {
  readonly kind: string;
  readonly status: string;
}

export interface CloseoutGateBlock {
  readonly code: string;
  readonly message: string;
  readonly outlet: string;
  readonly citation: string | null;
}

export type CloseoutGateCheck = { readonly ok: true } | { readonly ok: false; readonly block: CloseoutGateBlock };

function blockOf(code: string, message: string, outlet: string): CloseoutGateBlock {
  const row = findIllegal(code);
  return { code, message, outlet: row?.outlet ?? outlet, citation: row?.citation ?? null };
}

/**
 * X11 判定。须移送指：本案已有提交过（非拟制中）的涉刑或党纪政务呈批。
 * 已形成同类型记载即满足；回证是否齐全不影响本判定。
 */
export function assertCloseoutTransferGate(input: {
  readonly records: readonly TransferRecordFact[];
  readonly approvals: readonly TransferApprovalFact[];
}): CloseoutGateCheck {
  for (const kind of CLOSEOUT_TRANSFER_KINDS) {
    const required = input.approvals.some((row) => row.kind === kind && row.status !== 'drafting');
    if (!required) continue;
    const satisfied = input.records.some((row) => row.kind === kind);
    if (satisfied) continue;
    return {
      ok: false,
      block: blockOf('X11', '须移送党纪政务、刑事而未移送，不能结案', '先完成应当的移送'),
    };
  }
  return { ok: true };
}

/** 回证齐全：每条记载至少一份回证。 */
export function receiptsCompleteOf(
  records: readonly { readonly id: string }[],
  receiptRefs: readonly { readonly transferId: string | null }[],
): boolean {
  return records.every((record) => receiptRefs.some((file) => file.transferId === record.id));
}

/** 停表、续表事件的依据（办法第38条第2款；不计入期间由 #246 登记）。 */
export const TRANSFER_CLOCK_BASIS = {
  basisLabel: '业务不计入',
  basisNote: '涉刑移送期间不计入办案期限（办法第38条第2款）',
} as const;

/** T30 记载来源。 */
export const CRIMINAL_DECISION_SOURCES = ['police', 'procuratorate'] as const;
export type CriminalDecisionSource = (typeof CRIMINAL_DECISION_SOURCES)[number];

export const CRIMINAL_DECISION_SOURCE_NAMES: Readonly<Record<CriminalDecisionSource, string>> = {
  police: '公安',
  procuratorate: '检察',
};

const CRIMINAL_DECISION_SOURCE_SET = new Set<string>(CRIMINAL_DECISION_SOURCES);

export function isCriminalDecisionSource(value: string): value is CriminalDecisionSource {
  return CRIMINAL_DECISION_SOURCE_SET.has(value);
}

/** 复议或建议检察监督的三日倒计时规则键（310号令第9条，日历日，只警告）。 */
export const CRIMINAL_DECISION_REVIEW_RULE_KEY = 'criminal-decision.review';

export interface CriminalDecisionContent {
  readonly source: CriminalDecisionSource;
  readonly notifiedOn: string;
  readonly reason: string;
  readonly caseReturned: boolean;
  /** 退回案卷时必填的清单。 */
  readonly returnedList: readonly string[];
  /** 是否提请复议（可选记载）。 */
  readonly reviewRequested: boolean | null;
  /** 是否建议立案监督（可选记载）。 */
  readonly supervisionSuggested: boolean | null;
  readonly reviewOn: string | null;
  readonly reviewResult: string | null;
  /** 告知当事人的可选记录（一期不强制）。 */
  readonly partyNotifiedOn: string | null;
  readonly partyNoticeNote: string | null;
}

export type CriminalDecisionRead =
  | { readonly ok: true; readonly content: CriminalDecisionContent }
  | { readonly ok: false; readonly hit: TransferContentHit };

function invalidDecision(reason: string, message: string): CriminalDecisionRead {
  return { ok: false, hit: { httpStatus: 400, reason, message, outlet: '按外部决定记载表填写' } };
}

function optionalDay(value: unknown): { readonly ok: true; readonly day: string | null } | { readonly ok: false } {
  const raw = text(value);
  if (raw === '') return { ok: true, day: null };
  const day = parseTransferDay(raw);
  return day === null ? { ok: false } : { ok: true, day };
}

function optionalFlag(value: unknown): boolean | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === 'boolean' ? value : undefined;
}

/** T30 外部决定记载校验。必填：来源、通知日期、理由、是否退回案卷（退回附清单）。 */
export function readCriminalDecisionContent(raw: unknown): CriminalDecisionRead {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return invalidDecision('invalid-content', '外部决定记载不合规');
  }
  const body = raw as Record<string, unknown>;
  const source = text(body.source);
  if (!isCriminalDecisionSource(source)) {
    return invalidDecision('invalid-source', '来源只能是公安或检察');
  }
  const notifiedOn = parseTransferDay(text(body.notifiedOn));
  if (notifiedOn === null) {
    return invalidDecision('invalid-notified-on', '通知日期须是真实日历日');
  }
  if (!filled(body.reason)) {
    return invalidDecision('missing-reason', '外部决定的理由必填');
  }
  if (typeof body.caseReturned !== 'boolean') {
    return invalidDecision('missing-case-returned', '须写明是否退回案卷');
  }
  const returnedList = stringList(body.returnedList, 50);
  if (returnedList === null) {
    return invalidDecision('invalid-returned-list', '退回案卷清单不合规');
  }
  if (body.caseReturned && returnedList.length === 0) {
    return invalidDecision('missing-returned-list', '退回案卷须附清单');
  }
  const reviewRequested = optionalFlag(body.reviewRequested);
  const supervisionSuggested = optionalFlag(body.supervisionSuggested);
  if (reviewRequested === undefined || supervisionSuggested === undefined) {
    return invalidDecision('invalid-optional', '复议或监督记载只能是是或否');
  }
  const reviewOn = optionalDay(body.reviewOn);
  if (!reviewOn.ok) return invalidDecision('invalid-review-on', '复议或监督日期须是真实日历日');
  const partyNotifiedOn = optionalDay(body.partyNotifiedOn);
  if (!partyNotifiedOn.ok) return invalidDecision('invalid-party-notified-on', '告知当事人的日期须是真实日历日');
  return {
    ok: true,
    content: {
      source,
      notifiedOn,
      reason: text(body.reason),
      caseReturned: body.caseReturned,
      returnedList: body.caseReturned ? returnedList : [],
      reviewRequested,
      supervisionSuggested,
      reviewOn: reviewOn.day,
      reviewResult: text(body.reviewResult) === '' ? null : text(body.reviewResult),
      partyNotifiedOn: partyNotifiedOn.day,
      partyNoticeNote: text(body.partyNoticeNote) === '' ? null : text(body.partyNoticeNote),
    },
  };
}

/** T30 人工出口。A 回调查继续行政处罚；B 呈批结案或其他处理。 */
export const CRIMINAL_OUTLETS = ['investigate-again', 'close-or-other'] as const;
export type CriminalOutlet = (typeof CRIMINAL_OUTLETS)[number];

export const CRIMINAL_OUTLET_NAMES: Readonly<Record<CriminalOutlet, string>> = {
  'investigate-again': '回调查继续行政处罚',
  'close-or-other': '呈批结案或其他处理',
};

const CRIMINAL_OUTLET_SET = new Set<string>(CRIMINAL_OUTLETS);

export function isCriminalOutlet(value: string): value is CriminalOutlet {
  return CRIMINAL_OUTLET_SET.has(value);
}

export interface CriminalOutletContent {
  readonly outlet: CriminalOutlet;
  /** A：违法状态是否仍未消除。 */
  readonly illegalStateCleared: 'yes' | 'no' | null;
  readonly illegalStateNote: string | null;
  /** A：处罚依据。 */
  readonly penaltyBasis: string | null;
  /** B：理由。 */
  readonly reason: string | null;
}

export type CriminalOutletRead =
  | { readonly ok: true; readonly content: CriminalOutletContent }
  | { readonly ok: false; readonly hit: TransferContentHit };

function invalidOutlet(reason: string, message: string): CriminalOutletRead {
  return { ok: false, hit: { httpStatus: 400, reason, message, outlet: '按人工出口表填写' } };
}

/** 出口正文校验。A、B 二选一，字段互斥。 */
export function readCriminalOutletContent(raw: unknown): CriminalOutletRead {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return invalidOutlet('invalid-content', '人工出口正文不合规');
  }
  const body = raw as Record<string, unknown>;
  const outlet = text(body.outlet);
  if (!isCriminalOutlet(outlet)) {
    return invalidOutlet('invalid-outlet', '人工出口只能是 A 或 B');
  }
  if (outlet === 'investigate-again') {
    const cleared = text(body.illegalStateCleared);
    if (cleared !== 'yes' && cleared !== 'no') {
      return invalidOutlet('missing-illegal-state', '须写明违法状态是否仍未消除');
    }
    if (!filled(body.illegalStateNote)) {
      return invalidOutlet('missing-illegal-state-note', '违法状态是否仍未消除须附说明');
    }
    if (!filled(body.penaltyBasis)) {
      return invalidOutlet('missing-penalty-basis', '回调查须写明处罚依据');
    }
    return {
      ok: true,
      content: {
        outlet,
        illegalStateCleared: cleared,
        illegalStateNote: text(body.illegalStateNote),
        penaltyBasis: text(body.penaltyBasis),
        reason: null,
      },
    };
  }
  if (!filled(body.reason)) {
    return invalidOutlet('missing-reason', '呈批结案或其他处理须写理由');
  }
  return {
    ok: true,
    content: {
      outlet,
      illegalStateCleared: null,
      illegalStateNote: null,
      penaltyBasis: null,
      reason: text(body.reason),
    },
  };
}

export interface CriminalOutletLanding {
  /** A 回 E02，进入次序号加 1（回流 reenter）。B 不改环节。 */
  readonly kind: 'enter';
  readonly stage: 'E02';
  readonly instanceStatus: 'drafting';
  readonly reenter: true;
}

/**
 * R-01：服务层把 T30 分支解析成单一落点，再用引擎算效果。
 * A＝回 E02（次序号加 1）；B＝不前移，等结案呈批。
 */
export function criminalOutletLanding(outlet: CriminalOutlet): CriminalOutletLanding | null {
  if (outlet !== 'investigate-again') return null;
  return { kind: 'enter', stage: 'E02', instanceStatus: 'drafting', reenter: true };
}

/** 出口只能在 T30 记载之后发起。 */
export const CRIMINAL_OUTLET_KIND = 'criminal-outlet';