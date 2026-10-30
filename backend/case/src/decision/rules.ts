// 决定（E09／T23）的纯规则（#270）。判定在这里，服务层只喂事实与落库。
// X05、X06、X16 产出 GuardResult，由迁移引擎按 #255 层级映射为 409。
// Q24 罚款基数缺失只返回提示，不进入阻断或确认门。
// 责令改正与罚款一起作出的写进处罚决定书；只责令改正的用《责令改正通知书（决定书）》。
// 对外文书一律市局名义；区分局承办加盖执法监督专用章；自然资源所用章待定，不阻断。

import { findIllegal } from '../state-machine/catalog.ts';
import type { GuardResult } from '../state-machine/guard.ts';
import type { WarningItem } from '../state-machine/rule-registry.ts';

export const DECISION_KINDS = ['penalty', 'no-penalty'] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export const DECISION_KIND_NAMES: Readonly<Record<DecisionKind, string>> = {
  penalty: '行政处罚决定（O1）',
  'no-penalty': '不予行政处罚决定（O2）',
};

export const DECISION_DOCUMENT_TYPES = [
  'penalty-decision',
  'no-penalty-decision',
  'order-correction-notice',
] as const;
export type DecisionDocumentType = (typeof DECISION_DOCUMENT_TYPES)[number];

export const DECISION_DOCUMENT_NAMES: Readonly<Record<DecisionDocumentType, string>> = {
  'penalty-decision': '行政处罚决定书',
  'no-penalty-decision': '不予行政处罚决定书',
  'order-correction-notice': '责令改正通知书（决定书）',
};

export const DECISION_CONTENT_RULE_ID = 'cfg.rule.decision-content.v1';
export const DECISION_CONTENT_VERSION = '1';

/** Q24 罚款基数缺失提示。hint 不阻断、不要求确认。 */
export const DECISION_FINE_BASE_RULE_KEY = 'DECISION-FINE-BASE';
export const DECISION_FINE_BASE_MESSAGE = '罚款基数缺失，请在决定呈批前补齐罚款基数';
export const DECISION_FINE_BASE_OUTLET = '补齐罚款基数';

/** Q24 的 hint 项。服务层随成功响应返回，不交给确认门。 */
export function fineBaseHint(): WarningItem {
  return {
    level: 'hint',
    code: DECISION_FINE_BASE_RULE_KEY,
    message: DECISION_FINE_BASE_MESSAGE,
    citation: null,
    ruleKey: DECISION_FINE_BASE_RULE_KEY,
  };
}

/** 决定正文。出口与是否罚款由冻结的拟决定摘要推导，正文只写人工判断部分。 */
export interface DecisionContent {
  /** 责令改正。与罚款一起作出的，写进处罚决定书；只责令改正的，用责令改正通知书（决定书）。 */
  readonly correctionOrdered: boolean;
  /** 决定书引用的证据标识。X16 在批准时逐条核对入卷。 */
  readonly evidenceRefs: readonly string[];
  readonly note: string | null;
}

export interface DecisionContentHit {
  readonly httpStatus: 400;
  readonly reason: string;
  readonly message: string;
  readonly outlet: string;
}

export type DecisionContentRead =
  | { readonly ok: true; readonly content: DecisionContent }
  | { readonly ok: false; readonly hit: DecisionContentHit };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function invalid(reason: string, message: string, outlet: string): DecisionContentRead {
  return { ok: false, hit: { httpStatus: 400, reason, message, outlet } };
}

export function readDecisionContent(raw: unknown): DecisionContentRead {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return invalid('invalid-content', '决定正文不合规', '按决定正文格式填写');
  }
  const body = raw as Record<string, unknown>;
  if (body.correctionOrdered != null && typeof body.correctionOrdered !== 'boolean') {
    return invalid('invalid-content', '责令改选取值不合规', '重新选择是否责令改正');
  }
  if (body.note != null && typeof body.note !== 'string') {
    return invalid('invalid-content', '决定正文说明只能是文字', '改写决定正文说明');
  }
  const evidenceRefs: string[] = [];
  if (body.evidenceRefs != null) {
    if (!Array.isArray(body.evidenceRefs) || body.evidenceRefs.some((item) => typeof item !== 'string')) {
      return invalid('invalid-evidence', '证据引用不合规', '按入卷证据标识填写');
    }
    for (const item of body.evidenceRefs as string[]) {
      const trimmed = item.trim();
      if (trimmed === '') continue;
      if (!evidenceRefs.includes(trimmed)) evidenceRefs.push(trimmed);
    }
  }
  const note = text(body.note);
  return {
    ok: true,
    content: {
      correctionOrdered: body.correctionOrdered === true,
      evidenceRefs,
      note: note === '' ? null : note,
    },
  };
}

/** 冻结拟决定摘要里的一条违法记录事实（tolerant 解析，缺字段按空值）。 */
export interface FrozenViolationFact {
  readonly kind: string;
  readonly penaltyCodes: readonly string[];
  readonly fineAmount: number | null;
  readonly fineBases: readonly string[];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const rows: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed !== '') rows.push(trimmed);
  }
  return rows;
}

/** 读冻结摘要的 violations。摘要不合规时返回空数组。 */
export function readFrozenViolations(summary: unknown): FrozenViolationFact[] {
  if (typeof summary !== 'object' || summary === null || Array.isArray(summary)) return [];
  const rows = (summary as Record<string, unknown>).violations;
  if (!Array.isArray(rows)) return [];
  const facts: FrozenViolationFact[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) continue;
    const body = row as Record<string, unknown>;
    facts.push({
      kind: text(body.kind),
      penaltyCodes: stringList(body.penaltyCodes),
      fineAmount: typeof body.fineAmount === 'number' && Number.isFinite(body.fineAmount) ? body.fineAmount : null,
      fineBases: stringList(body.fineBases),
    });
  }
  return facts;
}

/** 决定出口：任一条违法记录为处罚，即处罚决定；否则不予处罚决定。 */
export function deriveDecisionKind(facts: readonly FrozenViolationFact[]): DecisionKind {
  return facts.some((row) => row.kind === 'penalty') ? 'penalty' : 'no-penalty';
}

export function hasFine(facts: readonly FrozenViolationFact[]): boolean {
  return facts.some((row) => row.kind === 'penalty' && row.penaltyCodes.includes('fine'));
}

/** Q24：罚款处罚缺少罚款金额或罚款基数时提示。 */
export function fineBaseMissing(facts: readonly FrozenViolationFact[]): boolean {
  return facts.some(
    (row) => row.kind === 'penalty'
      && row.penaltyCodes.includes('fine')
      && (row.fineAmount === null || row.fineBases.length === 0),
  );
}

/**
 * 文书类型。只责令改正（无罚款）的用责令改正通知书；责令改正与罚款一起作出的写进处罚决定书。
 * 其余处罚决定与不予处罚决定按出口取文书。
 */
export function decisionDocumentTypeOf(input: {
  readonly kind: DecisionKind;
  readonly correctionOrdered: boolean;
  readonly hasFine: boolean;
}): DecisionDocumentType {
  if (input.kind === 'no-penalty') return 'no-penalty-decision';
  if (input.correctionOrdered && !input.hasFine) return 'order-correction-notice';
  return 'penalty-decision';
}

export const DECISION_ISSUER_NAME = '广州市规划和自然资源局';

export interface DecisionSignature {
  readonly issuer: string;
  readonly sealText: string | null;
  readonly sealPending: boolean;
  readonly note: string | null;
}

/**
 * #256 §6 第 9 条：一律市局名义。市局本级盖市局印章；区分局承办加盖执法监督专用章（XX区分局）。
 * 自然资源所用章待定，不阻塞。
 */
export function deriveDecisionSignature(input: {
  readonly level: string;
  readonly handlingOrgName: string;
}): DecisionSignature {
  if (input.level === 'city') {
    return { issuer: DECISION_ISSUER_NAME, sealText: `${DECISION_ISSUER_NAME}印章`, sealPending: false, note: null };
  }
  if (input.level === 'district') {
    const suffix = input.handlingOrgName.startsWith(DECISION_ISSUER_NAME)
      ? input.handlingOrgName.slice(DECISION_ISSUER_NAME.length)
      : input.handlingOrgName;
    return {
      issuer: DECISION_ISSUER_NAME,
      sealText: `${DECISION_ISSUER_NAME}执法监督专用章（${suffix === '' ? input.handlingOrgName : suffix}）`,
      sealPending: false,
      note: null,
    };
  }
  return {
    issuer: DECISION_ISSUER_NAME,
    sealText: null,
    sealPending: true,
    note: '自然资源所用章待定',
  };
}

/** 定案文书引用但未入卷或经回避认定无效的证据标识。 */
export function missingEvidenceRefs(input: {
  readonly evidenceRefs: readonly string[];
  readonly inDossierIds: readonly string[];
  readonly materialIds: readonly string[];
  readonly invalidMaterialIds: readonly string[];
}): string[] {
  const invalid = new Set(input.invalidMaterialIds);
  const valid = new Set<string>(input.inDossierIds);
  for (const id of input.materialIds) {
    if (!invalid.has(id)) valid.add(id);
  }
  return input.evidenceRefs.filter((ref) => !valid.has(ref));
}

function guardOf(code: string, message: string): GuardResult {
  const row = findIllegal(code);
  return {
    level: 'block',
    code,
    message,
    authority: row?.authority ?? 'system',
    ...(row?.citation ? { citation: row.citation } : {}),
    ...(row?.userLock ? { userLock: row.userLock } : {}),
  };
}

/** X05：拟处罚但告知书未送达就作出处罚决定。law → 409。 */
export function x05Guard(input: {
  readonly kind: DecisionKind;
  readonly noticeServed: boolean;
}): GuardResult | null {
  if (input.kind !== 'penalty' || input.noticeServed) return null;
  return guardOf('X05', '拟处罚，但告知书未送达就作出处罚决定');
}

export type DecisionNoticeWindow = 'open' | 'closed' | 'manual';

/**
 * X06：告知期限未满就作出处罚决定。regulation → 409。
 * 当事人书面明确放弃并记载的除外（R-4）。期限无法确认（缺日历）同样按未届满处理。
 */
export function x06Guard(input: {
  readonly kind: DecisionKind;
  readonly noticeServed: boolean;
  readonly window: DecisionNoticeWindow | null;
  readonly waiverRecorded: boolean;
}): GuardResult | null {
  if (input.kind !== 'penalty' || !input.noticeServed || input.waiverRecorded) return null;
  if (input.window === 'closed') return null;
  return guardOf('X06', '告知期限未满就作出处罚决定');
}

/** X16：定案文书引用未入卷证据仍签发（含经回避效力认定为无效的材料）。system＋userLock → 409。 */
export function x16Guard(missing: readonly string[]): GuardResult | null {
  if (missing.length === 0) return null;
  return guardOf('X16', '定案文书引用了未入卷或经认定无效的证据');
}