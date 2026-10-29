// 告知有效性判据与决定呈批闸口（#248；#28 第四节 A／B／C、批2 Q13／Q14、Q18）。
// A 类（含 Q13 的 B1b）：系统判失效，阻断决定呈批，直到重新告知（E05 再进入一次）。
// B 类：主办「有效性确认」＋审理／法审复核；确认记录只追加，差异清单按违法记录分组。
// C1：重新告知产生新锚点；旧「视为放弃」保留并绑定旧告知书。C3 主持守卫由 #272 执行，本模块只复核。
// 判据内容属法律适用，标【待法制部门确认】；口径变化时改本表，不改闸口签名。

import { createHash } from 'node:crypto';

import { assessHearing, type PartyType } from '../notice/rules.ts';

/** A 类命中项。B1b（同一违法记录内事实收窄）按 Q13 并入 A 类。 */
export const VALIDITY_HIT_CODES = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1b', 'reason-changed'] as const;
export type ValidityHitCode = (typeof VALIDITY_HIT_CODES)[number];

export const VALIDITY_HIT_NAMES: Readonly<Record<ValidityHitCode, string>> = {
  A1: '当事人变更或增加',
  A2: '违法记录增加',
  A3: '依据条款变更',
  A4: '罚种增加或加重',
  A5: '罚款金额上调',
  A6: '新拟决定命中应听证，而原告知未告知听证',
  B1b: '同一违法记录内事实收窄',
  'reason-changed': '理由已变化',
};

/** Q14 加重来源。写明来源是重新告知之外的另一项义务。 */
export const AGRAVATION_SOURCE_KINDS = ['reflow-new-evidence', 'r4-qualification-correction'] as const;
export type AggravationSourceKind = (typeof AGRAVATION_SOURCE_KINDS)[number];

export const AGRAVATION_SOURCE_NAMES: Readonly<Record<AggravationSourceKind, string>> = {
  'reflow-new-evidence': '回流取得的新事实、新证据',
  'r4-qualification-correction': 'R4 定性或法律适用纠正',
};

export function isAggravationSourceKind(value: string): value is AggravationSourceKind {
  return (AGRAVATION_SOURCE_KINDS as readonly string[]).includes(value);
}

/** 重新告知原因。A 类与 B1b 须与系统判定一致；reason-changed 与 R7 由主办手动发起。 */
export const VALIDITY_REISSUE_REASONS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1b', 'reason-changed', 'R7'] as const;
export type ValidityReissueReason = (typeof VALIDITY_REISSUE_REASONS)[number];

export function isValidityReissueReason(value: string): value is ValidityReissueReason {
  return (VALIDITY_REISSUE_REASONS as readonly string[]).includes(value);
}

/** 系统可机读的重新告知原因（R7 与理由已变化除外）。 */
export function isSystemValidityReason(value: string): value is Exclude<ValidityReissueReason, 'R7' | 'reason-changed'> {
  return (VALIDITY_HIT_CODES as readonly string[]).includes(value) && value !== 'reason-changed';
}

export interface DecisionViolation {
  readonly violationRecordId: string;
  readonly kind: string;
  readonly penaltyCodes: readonly string[];
  readonly fineAmount: number | null;
  readonly fineBases: readonly string[];
  readonly basisText: string;
  /** 上游决定书摘要声明的事实变化。只有 narrowed 会进 A 类（B1b）。 */
  readonly factChange: 'narrowed' | null;
}

/** 决定书摘要。与 #240 冻结摘要同源；parties 缺省时由案件当事人补齐。 */
export interface DecisionSummary {
  readonly parties: readonly string[];
  readonly kind: string;
  readonly violations: readonly DecisionViolation[];
  readonly confiscationValue: number | null;
}

/**
 * 原告知书基线。送达时冻结，绑定告知书标识。
 * 重新告知产生新基线；旧基线只读保留。
 */
export interface ValidityBaseline {
  readonly noticeId: string;
  readonly entrySeq: number;
  readonly kind: string;
  readonly partyType: PartyType;
  readonly hearingNoticeAttached: boolean;
  readonly confiscationValue: number | null;
  readonly summary: DecisionSummary;
}

export interface ValidityDifference {
  /** null＝整体项（当事人、是否命中应听证）。 */
  readonly violationRecordId: string | null;
  readonly field: 'parties' | 'violation-record' | 'fact' | 'penalty-kind' | 'fine-amount' | 'basis' | 'hearing';
  readonly change: 'added' | 'removed' | 'narrowed' | 'increased' | 'decreased' | 'changed';
  readonly before: unknown;
  readonly after: unknown;
}

export interface ValidityDifferenceGroup {
  readonly violationRecordId: string | null;
  readonly items: readonly ValidityDifference[];
}

export interface ValidityHit {
  readonly code: ValidityHitCode;
  /** 能落到单条违法记录的，带该记录标识；整体项为 null。 */
  readonly violationRecordId: string | null;
  readonly message: string;
}

export interface ValidityAssessment {
  readonly hits: readonly ValidityHit[];
  readonly differences: readonly ValidityDifference[];
  readonly groups: readonly ValidityDifferenceGroup[];
  readonly conclusion: 'valid' | 'invalid';
  readonly renoticeRequired: boolean;
}

export type DecisionSummaryRead =
  | { readonly ok: true; readonly summary: DecisionSummary }
  | { readonly ok: false; readonly reason: string; readonly message: string; readonly outlet: string };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return sortedUnique((value as string[]).map((item) => item.trim()).filter((item) => item !== ''));
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readViolation(raw: unknown): DecisionViolation | null {
  const row = recordOf(raw);
  if (!row) return null;
  const violationRecordId = text(row.violationRecordId);
  const kind = text(row.kind);
  if (violationRecordId === '' || kind === '') return null;
  const penaltyCodes = row.penaltyCodes == null ? [] : stringList(row.penaltyCodes);
  if (!penaltyCodes) return null;
  const fineBases = row.fineBases == null ? [] : stringList(row.fineBases);
  if (!fineBases) return null;
  const fineAmount =
    row.fineAmount == null || row.fineAmount === ''
      ? null
      : typeof row.fineAmount === 'number' && Number.isFinite(row.fineAmount) && row.fineAmount >= 0
        ? row.fineAmount
        : undefined;
  if (fineAmount === undefined) return null;
  const factChange = row.factChange === 'narrowed' ? 'narrowed' : null;
  return {
    violationRecordId,
    kind,
    penaltyCodes,
    fineAmount,
    fineBases,
    basisText: text(row.basisText),
    factChange,
  };
}

/**
 * 读决定书摘要。parties 与 confiscationValue 缺省时用调用方给的默认值。
 * violations 缺省或含不合规行时拒绝，避免把「读不出差异」当成「没有差异」。
 */
export function readDecisionSummary(
  raw: unknown,
  defaults: { readonly parties: readonly string[]; readonly confiscationValue: number | null },
): DecisionSummaryRead {
  const body = recordOf(raw);
  if (!body) {
    return { ok: false, reason: 'invalid-summary', message: '决定书摘要不合规', outlet: '按决定书摘要格式提交' };
  }
  if (!Array.isArray(body.violations)) {
    return { ok: false, reason: 'invalid-summary', message: '决定书摘要缺少违法记录', outlet: '按决定书摘要格式提交' };
  }
  const violations: DecisionViolation[] = [];
  for (const item of body.violations) {
    const parsed = readViolation(item);
    if (!parsed) {
      return { ok: false, reason: 'invalid-summary', message: '决定书摘要的违法记录不合规', outlet: '按决定书摘要格式提交' };
    }
    violations.push(parsed);
  }
  let parties = [...defaults.parties];
  if (body.parties != null) {
    const parsed = stringList(body.parties);
    if (!parsed) {
      return { ok: false, reason: 'invalid-summary', message: '决定书摘要的当事人不合规', outlet: '按决定书摘要格式提交' };
    }
    parties = parsed;
  }
  const confiscationValue =
    body.confiscationValue == null || body.confiscationValue === ''
      ? defaults.confiscationValue
      : typeof body.confiscationValue === 'number' && Number.isFinite(body.confiscationValue) && body.confiscationValue >= 0
        ? body.confiscationValue
        : undefined;
  if (confiscationValue === undefined) {
    return { ok: false, reason: 'invalid-summary', message: '决定书摘要的没收等价值不合规', outlet: '按决定书摘要格式提交' };
  }
  return {
    ok: true,
    summary: {
      parties: sortedUnique(parties),
      kind: text(body.kind),
      violations: [...violations].sort((left, right) => left.violationRecordId.localeCompare(right.violationRecordId)),
      confiscationValue,
    },
  };
}

/** 摘要指纹。数组排序后取 SHA-256，顺序变化不影响覆盖判断。 */
export function decisionDigest(summary: DecisionSummary): string {
  const canonical = {
    parties: sortedUnique(summary.parties),
    kind: summary.kind.trim(),
    confiscationValue: summary.confiscationValue ?? null,
    violations: [...summary.violations]
      .sort((left, right) => left.violationRecordId.localeCompare(right.violationRecordId))
      .map((row) => ({
        violationRecordId: row.violationRecordId,
        kind: row.kind,
        penaltyCodes: sortedUnique(row.penaltyCodes),
        fineAmount: row.fineAmount ?? null,
        fineBases: sortedUnique(row.fineBases),
        basisText: row.basisText.trim(),
        factChange: row.factChange ?? null,
      })),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function basisOf(violation: DecisionViolation): string[] {
  return sortedUnique([...violation.fineBases, violation.basisText].map((item) => item.trim()).filter((item) => item !== ''));
}

function fineOf(violation: DecisionViolation): number {
  return violation.fineAmount ?? 0;
}

function hit(code: ValidityHitCode, violationRecordId: string | null): ValidityHit {
  return { code, violationRecordId, message: VALIDITY_HIT_NAMES[code] };
}

/** 差异按违法记录分组。整体项单独一组，排在最前。 */
export function groupDifferences(differences: readonly ValidityDifference[]): ValidityDifferenceGroup[] {
  const groups: ValidityDifferenceGroup[] = [];
  const byKey = new Map<string | null, ValidityDifference[]>();
  for (const item of differences) {
    const bucket = byKey.get(item.violationRecordId);
    if (bucket) {
      bucket.push(item);
    } else {
      byKey.set(item.violationRecordId, [item]);
    }
  }
  const keys = [...byKey.keys()].sort((left, right) => {
    if (left === null) return -1;
    if (right === null) return 1;
    return left.localeCompare(right);
  });
  for (const key of keys) groups.push({ violationRecordId: key, items: byKey.get(key) as ValidityDifference[] });
  return groups;
}

/**
 * 比较原告知基线与当前拟决定。
 * 顺序：当事人（A1）→ 违法记录集合（新增 A2／剔除 B1a）→ 记录内事实、罚种、金额、依据
 * → 整体是否命中应听证（A6）。原因变化（reason-changed）由调用方按确认记录传入。
 */
export function assessValidity(input: {
  readonly baseline: ValidityBaseline;
  readonly current: DecisionSummary;
  readonly reasonChanged?: boolean;
}): ValidityAssessment {
  const { baseline, current } = input;
  const hits: ValidityHit[] = [];
  const differences: ValidityDifference[] = [];

  const beforeParties = sortedUnique(baseline.summary.parties);
  const afterParties = sortedUnique(current.parties);
  if (!sameStrings(beforeParties, afterParties)) {
    differences.push({
      violationRecordId: null,
      field: 'parties',
      change: 'changed',
      before: beforeParties,
      after: afterParties,
    });
    hits.push(hit('A1', null));
  }

  const beforeById = new Map(baseline.summary.violations.map((row) => [row.violationRecordId, row]));
  const afterById = new Map(current.violations.map((row) => [row.violationRecordId, row]));

  for (const recordId of afterById.keys()) {
    if (beforeById.has(recordId)) continue;
    differences.push({ violationRecordId: recordId, field: 'violation-record', change: 'added', before: null, after: recordId });
    hits.push(hit('A2', recordId));
  }
  for (const recordId of beforeById.keys()) {
    if (afterById.has(recordId)) continue;
    differences.push({ violationRecordId: recordId, field: 'violation-record', change: 'removed', before: recordId, after: null });
  }

  for (const [recordId, before] of beforeById) {
    const after = afterById.get(recordId);
    if (!after) continue;

    if (after.factChange === 'narrowed') {
      differences.push({ violationRecordId: recordId, field: 'fact', change: 'narrowed', before: null, after: 'narrowed' });
      hits.push(hit('B1b', recordId));
    }

    const beforeCodes = sortedUnique(before.penaltyCodes);
    const afterCodes = sortedUnique(after.penaltyCodes);
    const addedCodes = afterCodes.filter((code) => !beforeCodes.includes(code));
    if (addedCodes.length > 0 || (before.kind !== 'penalty' && after.kind === 'penalty')) {
      differences.push({ violationRecordId: recordId, field: 'penalty-kind', change: 'changed', before: beforeCodes, after: afterCodes });
      hits.push(hit('A4', recordId));
    } else if (!sameStrings(beforeCodes, afterCodes)) {
      differences.push({ violationRecordId: recordId, field: 'penalty-kind', change: 'changed', before: beforeCodes, after: afterCodes });
    }

    if (fineOf(after) > fineOf(before)) {
      differences.push({
        violationRecordId: recordId,
        field: 'fine-amount',
        change: 'increased',
        before: before.fineAmount,
        after: after.fineAmount,
      });
      hits.push(hit('A5', recordId));
    } else if (fineOf(after) < fineOf(before)) {
      differences.push({
        violationRecordId: recordId,
        field: 'fine-amount',
        change: 'decreased',
        before: before.fineAmount,
        after: after.fineAmount,
      });
    }

    const beforeBasis = basisOf(before);
    const afterBasis = basisOf(after);
    if (!sameStrings(beforeBasis, afterBasis)) {
      differences.push({ violationRecordId: recordId, field: 'basis', change: 'changed', before: beforeBasis, after: afterBasis });
      hits.push(hit('A3', recordId));
    }
  }

  const hearing = assessHearing({
    penaltyCodes: current.violations.flatMap((row) => row.penaltyCodes),
    fineAmount: current.violations.reduce((sum, row) => sum + fineOf(row), 0),
    confiscationValue: current.confiscationValue ?? baseline.confiscationValue,
    partyType: baseline.partyType,
    manualItems: [],
    notApplicableHearing: false,
    hearingNoticeAttached: baseline.hearingNoticeAttached,
  });
  if (hearing.required && !baseline.hearingNoticeAttached) {
    differences.push({ violationRecordId: null, field: 'hearing', change: 'changed', before: false, after: true });
    hits.push(hit('A6', null));
  }

  if (input.reasonChanged) hits.push(hit('reason-changed', null));

  return {
    hits,
    differences,
    groups: groupDifferences(differences),
    conclusion: hits.length > 0 ? 'invalid' : 'valid',
    renoticeRequired: hits.length > 0,
  };
}

/** Q14 的加重来源。来源必须是原告知书送达后、且晚于最近一次陈述申辩的回流或 R4 退回。 */
export interface AggravationReference {
  readonly reasonCode: string;
  readonly inheritedCode: string | null;
  readonly reflow: boolean;
  readonly createdAt: Date;
}

export function aggravationSourceValid(input: {
  readonly sourceKind: string;
  readonly reference: AggravationReference | null;
  readonly afterAt: Date | null;
}): boolean {
  if (!input.reference) return false;
  if (input.afterAt !== null && input.reference.createdAt.getTime() <= input.afterAt.getTime()) return false;
  if (input.sourceKind === 'reflow-new-evidence') return input.reference.reflow;
  if (input.sourceKind === 'r4-qualification-correction') {
    return input.reference.reasonCode === 'R4' || input.reference.inheritedCode === 'R4';
  }
  return false;
}

export interface ValidityAggravationCheck {
  readonly noticeId: string;
  /** 相对该告知书的 A4／A5 命中。 */
  readonly hitCodes: readonly ('A4' | 'A5')[];
  readonly satisfied: boolean;
}

export interface ValidityConfirmationFact {
  readonly conclusion: 'valid' | 'invalid';
  /** 确认时记录的摘要指纹是否等于当前决定书摘要。 */
  readonly digestMatches: boolean;
  /** 复核结论通过且没有更晚的不通过。 */
  readonly reviewedPass: boolean;
  readonly reasonChanged: boolean;
}

/** 决定呈批闸口事实。由服务层从库中读齐后交给纯函数判定。 */
export interface ValidityGateFacts {
  /** 本案是否有任何告知书。没有告知书（拟不予处罚未发告知）时不适用有效性判据。 */
  readonly noticeExists: boolean;
  /** 最新已送达告知是否有基线。 */
  readonly baselinePresent: boolean;
  readonly currentPresent: boolean;
  readonly hits: readonly ValidityHit[];
  readonly differences: readonly ValidityDifference[];
  readonly confirmation: ValidityConfirmationFact | null;
  readonly q14: readonly ValidityAggravationCheck[];
}

export interface ValidityGateBlock {
  readonly code: string;
  readonly message: string;
  readonly outlet: string;
  readonly citation: string | null;
}

export type ValidityGateCheck = { readonly ok: true } | { readonly ok: false; readonly block: ValidityGateBlock };

function gateBlock(code: string, message: string, outlet: string, citation: string | null = null): ValidityGateCheck {
  return { ok: false, block: { code, message, outlet, citation } };
}

function hitCodes(hits: readonly ValidityHit[]): string {
  return [...new Set(hits.map((item) => item.code))].join('、');
}

/**
 * 决定呈批闸口（#248）。供决定票 doc.approve 调用：
 * A 类无命中（或已重新告知且新告知覆盖）→ 通过；
 * B 类已有确认且覆盖当前摘要、并经复核通过 → 通过；
 * Q14 适用的加重来源已填并可追溯 → 通过。
 * 阻断不设绕过通道（Q22）。
 */
export function assertValidityGate(facts: ValidityGateFacts): ValidityGateCheck {
  if (!facts.noticeExists) return { ok: true };
  if (!facts.baselinePresent) {
    return gateBlock(
      'validity-baseline-missing',
      '已送达告知缺少有效性基线，无法判断原告知内容',
      '补充送达基线后再作决定',
      '#28 第四节',
    );
  }
  if (!facts.currentPresent) {
    return gateBlock('validity-summary-missing', '缺少当前拟决定摘要', '先完成审理意见签出并冻结摘要', '#28 第四节');
  }
  if (facts.hits.length > 0) {
    return gateBlock(
      'validity-invalid',
      `A 类告知失效命中（${hitCodes(facts.hits)}），须重新告知后才能作出决定`,
      '发起重新告知：撤销原告知书，E05 再进入一次',
      '行政处罚法第44条；#28 第四节',
    );
  }
  const confirmation = facts.confirmation;
  if (confirmation?.reasonChanged) {
    return gateBlock(
      'validity-invalid',
      '有效性确认已勾选「理由已变化」，告知失效，须重新告知',
      '发起重新告知：撤销原告知书，E05 再进入一次',
      '#28 第四节',
    );
  }
  if (confirmation?.conclusion === 'invalid' && confirmation.digestMatches) {
    return gateBlock('validity-invalid-confirmed', '有效性确认结论为失效，须重新告知', '发起重新告知', '#28 第四节');
  }
  if (facts.differences.length === 0) {
    const q14Clear = facts.q14.find((item) => item.hitCodes.length > 0 && !item.satisfied);
    if (q14Clear) return q14Block();
    return { ok: true };
  }
  if (!confirmation) {
    return gateBlock(
      'validity-b-confirmation-required',
      'B 类变化须先作有效性确认，且确认覆盖当前决定书摘要',
      '提交有效性确认，由审理或法审复核',
      '#28 第四节；#28/6409982992',
    );
  }
  if (confirmation.conclusion !== 'valid') {
    return gateBlock('validity-invalid-confirmed', '有效性确认结论为失效，须重新告知', '发起重新告知', '#28 第四节');
  }
  if (!confirmation.digestMatches) {
    return gateBlock(
      'validity-b-confirmation-stale',
      '有效性确认未覆盖当前决定书摘要',
      '按当前决定书摘要重新作有效性确认',
      '#28 第四节',
    );
  }
  if (!confirmation.reviewedPass) {
    return gateBlock(
      'validity-review-required',
      '有效性确认尚未经审理或法审复核通过',
      '由审理人或法制审核人员复核有效性确认',
      '#28 第四节',
    );
  }
  const q14 = facts.q14.find((item) => item.hitCodes.length > 0 && !item.satisfied);
  if (q14) return q14Block();
  return { ok: true };
}

function q14Block(): ValidityGateCheck {
  return gateBlock(
    'Q14',
    '原告知下已有陈述申辩，拟处罚加重但未写明加重来源',
    '写明加重来源：回流取得的新事实、新证据，或 R4 定性纠正，并附记录标识',
    '行政处罚法第45条第2款；规程8.2',
  );
}