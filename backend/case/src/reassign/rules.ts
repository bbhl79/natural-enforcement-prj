// 改派呈批（#239，T33）与回避后材料效力认定。纯规则，不依赖 Nest 与存储。
//
// 改派：原因必填；批准才生效；换完不少于两人且都有执法资格（X14）；
// 新经办只能来自承办机构或其下属（#40/6232148047；N4 平级＝同一区分局内同级，Q27）。
// 发起人：主办或协办；两人都停用或调离时，承办机构内勤（N5）。
// 回避改派引用的回避决定须生效，批准人须是该决定的决定人。
// 效力认定：回避改派生效后由接手主办逐件认定，只追加，不另设呈批。

/** 改派原因：调岗 | 离职 | 回避 | 其他（须写说明）。 */
export const REASSIGN_REASON_CODES = ['transfer', 'leave', 'recusal', 'other'] as const;
export type ReassignReasonCode = (typeof REASSIGN_REASON_CODES)[number];

export const REASSIGN_REASON_NAMES: Readonly<Record<ReassignReasonCode, string>> = {
  transfer: '调岗',
  leave: '离职',
  recusal: '回避',
  other: '其他',
};

/** 承办人员角色：主办 | 协办。 */
export const HANDLER_ROLES = ['main', 'assist'] as const;
export type HandlerRole = (typeof HANDLER_ROLES)[number];

/** 效力认定结论：有效 | 无效 | 需补正。 */
export const MATERIAL_EFFECTIVENESS_CONCLUSIONS = ['valid', 'invalid', 'needs-correction'] as const;
export type MaterialEffectivenessConclusion = (typeof MATERIAL_EFFECTIVENESS_CONCLUSIONS)[number];

export const MATERIAL_EFFECTIVENESS_NAMES: Readonly<Record<MaterialEffectivenessConclusion, string>> = {
  valid: '有效',
  invalid: '无效',
  'needs-correction': '需补正',
};

/** X14 的文案与依据（规程 2.6；行政处罚法第 42 条）。 */
export const X14_MESSAGE = '改派后承办人员须不少于两人，且都有执法资格';
export const X14_CITATION = '规程 2.6；行政处罚法第 42 条';

/** 发起人身份：主办或协办 | N5 情形的承办机构内勤。 */
export type ReassignInitiator = 'handler' | 'n5-clerk';

export interface ReassignInitiatorInput {
  readonly actorIsHandler: boolean;
  readonly actorRoles: readonly string[];
  readonly actorOrgId: string | null;
  readonly handlingOrgId: string;
  /** 主办和协办都停用或调离（#238 同一判定）。 */
  readonly bothHandlersUnavailable: boolean;
}

/**
 * 发起人资格。
 * 主办或协办可直接发起。内勤只在两人都不可用、且本人任职在承办机构时发起（N5）。
 */
export function reassignInitiator(input: ReassignInitiatorInput): ReassignInitiator | null {
  if (input.actorIsHandler) return 'handler';
  if (
    input.actorRoles.includes('内勤') &&
    input.bothHandlersUnavailable &&
    input.actorOrgId === input.handlingOrgId
  ) {
    return 'n5-clerk';
  }
  return null;
}

/** 一名拟任承办人员的事实。角色由调用方按拟任名单给出。 */
export interface HandlerCandidateFacts {
  readonly personnelId: string;
  readonly role: HandlerRole;
  readonly exists: boolean;
  readonly deactivated: boolean;
  /** 当前持有经办角色。 */
  readonly holdsHandlerRole: boolean;
  /** 当前任职机构在承办机构及其下属之内。 */
  readonly inHandlingOrgSubtree: boolean;
  /** 执法资格（#133 fail-closed）。 */
  readonly qualified: boolean;
}

export type ReassignProposalIssueCode =
  | 'missing-main'
  | 'invalid-proposal'
  | 'X14'
  | 'handler-not-eligible'
  | 'handler-out-of-scope';

export interface ReassignProposalIssue {
  readonly code: ReassignProposalIssueCode;
  readonly httpStatus: 400 | 409;
  readonly message: string;
  readonly citation: string | null;
}

function issue(
  code: ReassignProposalIssueCode,
  httpStatus: 400 | 409,
  message: string,
  citation: string | null = null,
): ReassignProposalIssue {
  return { code, httpStatus, message, citation };
}

/**
 * 拟任名单校验。顺序：主办必填 → 名单形态 → 人数（X14）→ 可用 → 机构范围 → 执法资格（X14）。
 * candidates 与拟任名单同序：第一位是主办，其余是协办。
 */
export function checkReassignProposal(
  candidates: readonly HandlerCandidateFacts[],
): ReassignProposalIssue | null {
  if (candidates.length === 0 || candidates[0]?.role !== 'main') {
    return issue('missing-main', 400, '改派须指定一名主办');
  }
  if (candidates.filter((row) => row.role === 'main').length !== 1) {
    return issue('invalid-proposal', 400, '改派名单只能有一名主办');
  }
  const ids = candidates.map((row) => row.personnelId);
  if (new Set(ids).size !== ids.length) {
    return issue('invalid-proposal', 400, '同一人不能同时担任主办与协办');
  }
  if (candidates.length < 2) {
    return issue('X14', 409, X14_MESSAGE, X14_CITATION);
  }
  if (candidates.some((row) => !row.exists || row.deactivated || !row.holdsHandlerRole)) {
    return issue('handler-not-eligible', 409, '拟任承办人员须为未停用且持经办角色的人员');
  }
  if (candidates.some((row) => !row.inHandlingOrgSubtree)) {
    return issue('handler-out-of-scope', 409, '新经办只能来自承办机构或其下属');
  }
  if (candidates.some((row) => !row.qualified)) {
    return issue('X14', 409, X14_MESSAGE, X14_CITATION);
  }
  return null;
}

/** 回避决定的事实。effective 表示该声明链当前处于「生效」。 */
export interface ConflictDecisionFact {
  readonly conclusion: string;
  readonly deciderId: string;
  readonly effective: boolean;
}

export type ConflictReferenceIssue =
  | 'conflict-decision-required'
  | 'conflict-decision-not-effective'
  | 'conflict-decider-mismatch';

/**
 * 回避原因的引用校验。非回避原因不校验。
 * approverId 为空表示发起阶段，只校验决定本身；批准阶段再校验决定人一致。
 */
export function checkRecusalReference(input: {
  readonly reasonCode: ReassignReasonCode;
  readonly lineageId: string | null;
  readonly decision: ConflictDecisionFact | null;
  readonly approverId: string | null;
}): ConflictReferenceIssue | null {
  if (input.reasonCode !== 'recusal') return null;
  if (!input.lineageId || input.lineageId.trim() === '') return 'conflict-decision-required';
  if (!input.decision || input.decision.conclusion !== 'recuse' || !input.decision.effective) {
    return 'conflict-decision-not-effective';
  }
  if (input.approverId !== null && input.decision.deciderId !== input.approverId) {
    return 'conflict-decider-mismatch';
  }
  return null;
}

/** 一条只追加的效力认定。同件材料可多次认定，时间最新的一条是当前结论。 */
export interface MaterialEffectivenessFact {
  readonly id: string;
  readonly materialId: string;
  readonly conclusion: string;
  readonly reason: string;
  readonly determinedBy: string;
  readonly determinedAt: Date;
}

function newer(left: MaterialEffectivenessFact, right: MaterialEffectivenessFact): MaterialEffectivenessFact {
  const delta = left.determinedAt.getTime() - right.determinedAt.getTime();
  if (delta !== 0) return delta > 0 ? left : right;
  return left.id > right.id ? left : right;
}

/** 每件材料只留最新一次认定。 */
export function latestEffectivenessByMaterial(
  rows: readonly MaterialEffectivenessFact[],
): Map<string, MaterialEffectivenessFact> {
  const latest = new Map<string, MaterialEffectivenessFact>();
  for (const row of rows) {
    const previous = latest.get(row.materialId);
    latest.set(row.materialId, previous ? newer(previous, row) : row);
  }
  return latest;
}

/** 当前被认定为无效的材料主键。供决定票做 X16 查询。 */
export function invalidMaterialIds(rows: readonly MaterialEffectivenessFact[]): string[] {
  return [...latestEffectivenessByMaterial(rows).values()]
    .filter((row) => row.conclusion === 'invalid')
    .map((row) => row.materialId)
    .sort();
}

export function isReassignReasonCode(value: string): value is ReassignReasonCode {
  return (REASSIGN_REASON_CODES as readonly string[]).includes(value);
}

export function isHandlerRole(value: string): value is HandlerRole {
  return (HANDLER_ROLES as readonly string[]).includes(value);
}

export function isMaterialEffectivenessConclusion(value: string): value is MaterialEffectivenessConclusion {
  return (MATERIAL_EFFECTIVENESS_CONCLUSIONS as readonly string[]).includes(value);
}