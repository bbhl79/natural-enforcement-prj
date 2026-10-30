// 送达（T24）、执行记载（T25）、结案（T26）的纯规则（#270）。
// 送达接受回证（送达人两人以上），或公告送达的原因和经过记录加公告材料（Q27，规程 9.6）。
// 执行记载只登记事实和凭证：「已申请法院强制执行」须附申请书；「履行完毕」须附缴款凭证等。
// X10（决定未送达）是 normative → 警告，不改业务行；X11 由移送闸口在结案批准前执行。

import { findIllegal } from '../state-machine/catalog.ts';
import type { GuardResult } from '../state-machine/guard.ts';

export const DELIVERY_RECORD_KINDS = ['receipt', 'announcement'] as const;
export type DeliveryRecordKind = (typeof DELIVERY_RECORD_KINDS)[number];

export const DELIVERY_RECORD_KIND_NAMES: Readonly<Record<DeliveryRecordKind, string>> = {
  receipt: '送达回证',
  announcement: '公告送达',
};

/** 回证路径的送达人下限（规程第 9 章）。 */
export const DELIVERY_MIN_DELIVERERS = 2;

export interface DeliveryRecordContent {
  readonly kind: DeliveryRecordKind;
  /** 送达完成日，YYYY-MM-DD。 */
  readonly deliveredOn: string;
  readonly deliverers: readonly string[];
  /** 公告送达的原因和经过。回证路径为 null。 */
  readonly reasonRecord: string | null;
  readonly announcementMaterials: readonly string[];
  readonly note: string | null;
}

export interface DeliveryRecordHit {
  readonly httpStatus: 400;
  readonly reason: string;
  readonly message: string;
  readonly outlet: string;
}

export type DeliveryRecordRead =
  | { readonly ok: true; readonly content: DeliveryRecordContent }
  | { readonly ok: false; readonly hit: DeliveryRecordHit };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown): string[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const rows: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const trimmed = item.trim();
    if (trimmed !== '') rows.push(trimmed);
  }
  return rows;
}

/** 日期只认 YYYY-MM-DD，且必须是真实日期。 */
export function isCivilDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function invalid(reason: string, message: string, outlet: string): DeliveryRecordRead {
  return { ok: false, hit: { httpStatus: 400, reason, message, outlet } };
}

/** Q27：回证，或公告原因经过加公告材料。两条路径都要求送达完成日。 */
export function readDeliveryRecord(raw: unknown): DeliveryRecordRead {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return invalid('invalid-content', '送达正文不合规', '按送达回证或公告送达填写');
  }
  const body = raw as Record<string, unknown>;
  const kind = text(body.kind);
  if (!(DELIVERY_RECORD_KINDS as readonly string[]).includes(kind)) {
    return invalid('invalid-kind', '没有这类送达', '按送达回证或公告送达选择');
  }
  const deliveredOn = text(body.deliveredOn);
  if (!isCivilDay(deliveredOn)) {
    return invalid('invalid-delivered-on', '送达完成日不合规', '填写送达完成日');
  }
  if (body.note != null && typeof body.note !== 'string') {
    return invalid('invalid-content', '送达说明只能是文字', '改写送达说明');
  }
  const note = text(body.note);
  if (kind === 'receipt') {
    const deliverers = stringList(body.deliverers);
    if (deliverers === null) {
      return invalid('invalid-deliverers', '送达人清单不合规', '按送达人姓名逐个填写');
    }
    if (deliverers.length < DELIVERY_MIN_DELIVERERS) {
      return invalid('insufficient-deliverers', '送达人须两人以上', '补齐送达人');
    }
    return {
      ok: true,
      content: {
        kind: 'receipt',
        deliveredOn,
        deliverers,
        reasonRecord: null,
        announcementMaterials: [],
        note: note === '' ? null : note,
      },
    };
  }
  const reasonRecord = text(body.reasonRecord);
  if (reasonRecord === '') {
    return invalid('missing-reason-record', '公告送达须写明原因和经过', '填写公告送达的原因和经过');
  }
  const announcementMaterials = stringList(body.announcementMaterials);
  if (announcementMaterials === null || announcementMaterials.length === 0) {
    return invalid('missing-announcement-materials', '公告送达须附公告材料', '上传公告材料');
  }
  return {
    ok: true,
    content: {
      kind: 'announcement',
      deliveredOn,
      deliverers: [],
      reasonRecord,
      announcementMaterials,
      note: note === '' ? null : note,
    },
  };
}

export const EXECUTION_RECORD_KINDS = ['court-enforcement', 'fulfilled', 'other'] as const;
export type ExecutionRecordKind = (typeof EXECUTION_RECORD_KINDS)[number];

export const EXECUTION_RECORD_KIND_NAMES: Readonly<Record<ExecutionRecordKind, string>> = {
  'court-enforcement': '已申请法院强制执行',
  fulfilled: '履行完毕',
  other: '其他执行记载',
};

/** 这两类执行记载必须附凭证。 */
export const EXECUTION_ATTACHMENT_REQUIRED_KINDS: readonly ExecutionRecordKind[] = [
  'court-enforcement',
  'fulfilled',
];

export interface ExecutionRecordContent {
  readonly kind: ExecutionRecordKind;
  readonly note: string | null;
  readonly attachments: readonly string[];
}

export interface ExecutionRecordHit {
  readonly httpStatus: 400;
  readonly reason: string;
  readonly message: string;
  readonly outlet: string;
}

export type ExecutionRecordRead =
  | { readonly ok: true; readonly content: ExecutionRecordContent }
  | { readonly ok: false; readonly hit: ExecutionRecordHit };

function executionInvalid(reason: string, message: string, outlet: string): ExecutionRecordRead {
  return { ok: false, hit: { httpStatus: 400, reason, message, outlet } };
}

/** 执行记载：「已申请法院强制执行」附申请书；「履行完毕」附缴款凭证等。只登记事实和凭证。 */
export function readExecutionRecord(raw: unknown): ExecutionRecordRead {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return executionInvalid('invalid-content', '执行记载不合规', '按执行记载格式填写');
  }
  const body = raw as Record<string, unknown>;
  const kind = text(body.kind);
  if (!(EXECUTION_RECORD_KINDS as readonly string[]).includes(kind)) {
    return executionInvalid('invalid-kind', '没有这类执行记载', '按执行记载类型选择');
  }
  if (body.note != null && typeof body.note !== 'string') {
    return executionInvalid('invalid-content', '执行记载说明只能是文字', '改写执行记载说明');
  }
  const attachments = stringList(body.attachments);
  if (attachments === null) {
    return executionInvalid('invalid-attachment', '执行凭证清单不合规', '按凭证名称逐个填写');
  }
  if (EXECUTION_ATTACHMENT_REQUIRED_KINDS.includes(kind as ExecutionRecordKind) && attachments.length === 0) {
    const message = kind === 'court-enforcement' ? '已申请法院强制执行须附申请书' : '履行完毕须附缴款凭证等';
    return executionInvalid('missing-attachment', message, '上传执行凭证');
  }
  const note = text(body.note);
  if (kind === 'other' && note === '') {
    return executionInvalid('missing-note', '其他执行记载须写明事实', '填写执行事实');
  }
  return {
    ok: true,
    content: {
      kind: kind as ExecutionRecordKind,
      note: note === '' ? null : note,
      attachments,
    },
  };
}

export const CLOSURE_BRANCHES = ['penalty', 'no-penalty'] as const;
export type ClosureBranch = (typeof CLOSURE_BRANCHES)[number];

export const CLOSURE_BRANCH_NAMES: Readonly<Record<ClosureBranch, string>> = {
  penalty: '处罚支（经执行记载）',
  'no-penalty': '不予处罚支',
};

/** #267 两支：E11＝处罚支；E10＝不予处罚支。 */
export function closureBranchOf(stage: string): ClosureBranch | null {
  if (stage === 'E11') return 'penalty';
  if (stage === 'E10') return 'no-penalty';
  return null;
}

export interface ClosureContent {
  readonly note: string | null;
}

export interface ClosureContentHit {
  readonly httpStatus: 400;
  readonly reason: string;
  readonly message: string;
  readonly outlet: string;
}

export type ClosureContentRead =
  | { readonly ok: true; readonly content: ClosureContent }
  | { readonly ok: false; readonly hit: ClosureContentHit };

export function readClosureContent(raw: unknown): ClosureContentRead {
  if (raw == null) return { ok: true, content: { note: null } };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      hit: { httpStatus: 400, reason: 'invalid-content', message: '结案呈批正文不合规', outlet: '按结案呈批表填写' },
    };
  }
  const body = raw as Record<string, unknown>;
  if (body.note != null && typeof body.note !== 'string') {
    return {
      ok: false,
      hit: { httpStatus: 400, reason: 'invalid-content', message: '结案呈批说明只能是文字', outlet: '改写结案呈批说明' },
    };
  }
  const note = text(body.note);
  return { ok: true, content: { note: note === '' ? null : note } };
}

export const X10_RULE_KEY = 'X10';

/** X10：处罚决定未送达就执行记载或结案。normative → 警告，不改业务行，确认后继续。 */
export function x10Guard(input: {
  readonly branch: ClosureBranch;
  readonly delivered: boolean;
}): GuardResult | null {
  if (input.branch !== 'penalty' || input.delivered) return null;
  const row = findIllegal('X10');
  return {
    level: 'warn',
    code: X10_RULE_KEY,
    message: '处罚决定未送达就执行记载或结案',
    authority: 'normative',
    ...(row?.citation ? { citation: row.citation } : {}),
  };
}