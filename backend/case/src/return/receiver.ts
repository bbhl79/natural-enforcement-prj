// 退回接收人（#238，#28 Q16，N5）。
// 系统不自动选。N5 只看人员停用与调离（#71/6431326440）。
// 不读机构停用，不放宽 org-has-open-items。

import type { ReturnTarget } from './target.ts';
import { returnsToInvestigation } from './target.ts';

/** #71：不能指定行政审批、内勤、监督、系统管理。N5 只放开承办机构内勤。 */
export const RETURN_FORBIDDEN_RECEIVER_ROLES = ['行政审批', '内勤', '监督', '系统管理'] as const;

/** N5 也不放开的角色。 */
export const RETURN_NEVER_RECEIVER_ROLES = ['行政审批', '监督', '系统管理'] as const;

/**
 * 非回调查时，除主办、协办外可指定的角色。
 * 法制审核按法制审核归属，不看数据范围（#230/6431448104，与 #90/6430937672 Q3 同口径）。
 * 行政审核仍按任职机构覆盖该案（#71）。
 */
export const RETURN_CHAIN_RECEIVER_ROLES = ['法制审核', '行政审核'] as const;

/** 法制审核归属用的机构层级。市、区、所。 */
export const LEGAL_REVIEW_ORG_LEVELS = ['city', 'district', 'station'] as const;
export type LegalReviewOrgLevel = (typeof LEGAL_REVIEW_ORG_LEVELS)[number];

/** 承办机构或它的直接上级。只带归属判定要用的字段。 */
export interface LegalReviewOrgFact {
  readonly id: string;
  readonly level: LegalReviewOrgLevel;
  readonly parentId: string | null;
}

/**
 * 该案的法制审核归属机构。
 * 市承办归市局。区承办归该区。所承办归所在区分局（直接上级且层级为区）。
 * 所的上级不是区时返回 null，不另找一级。
 */
export function legalReviewAttributionOrgId(
  handlingOrg: LegalReviewOrgFact,
  parent: LegalReviewOrgFact | null,
): string | null {
  if (handlingOrg.level === 'city' || handlingOrg.level === 'district') return handlingOrg.id;
  if (!parent || parent.id !== handlingOrg.parentId || parent.level !== 'district') return null;
  return parent.id;
}

export interface HandlerAvailability {
  readonly personnelId: string;
  readonly role: 'main' | 'assist';
  /** 人员已停用。不是机构停用。 */
  readonly deactivated: boolean;
  /** 人员已调离承办机构：没有当前任职，或当前任职机构不是承办机构。 */
  readonly transferredAway: boolean;
}

export interface ReceiverCandidate {
  readonly personnelId: string;
  readonly roles: readonly string[];
  readonly handlerRole: 'main' | 'assist' | null;
  /** 人员已停用。 */
  readonly deactivated: boolean;
  /** 人员已调离承办机构。 */
  readonly transferredAway: boolean;
  /** 当前任职的数据范围覆盖承办机构。只用于行政审核。 */
  readonly orgCoversCase: boolean;
  /**
   * 当前任职机构就是该案的法制审核归属，且人员未停用。
   * 只用于法制审核。不看数据范围，也不看「法制审核负责人」岗位标记。
   */
  readonly legalReviewAttributed: boolean;
  /** 持有内勤，且当前任职机构就是承办机构，且人员未停用。 */
  readonly clerkOfHandlingOrg: boolean;
}

export type ReceiverCheck =
  | { readonly ok: true; readonly n5: boolean }
  | { readonly ok: false; readonly reason: 'receiver-not-allowed' };

export function handlerUnavailable(handler: HandlerAvailability): boolean {
  return handler.deactivated || handler.transferredAway;
}

/**
 * 主办和协办都不可用。
 * 缺主办或缺协办时不成立，避免把缺人当成 N5。
 */
export function bothHandlersUnavailable(handlers: readonly HandlerAvailability[]): boolean {
  const mains = handlers.filter((handler) => handler.role === 'main');
  const assists = handlers.filter((handler) => handler.role === 'assist');
  if (mains.length === 0 || assists.length === 0) return false;
  return mains.every(handlerUnavailable) && assists.every(handlerUnavailable);
}

function holds(roles: readonly string[], role: string): boolean {
  return roles.includes(role);
}

function holdsNeverRole(roles: readonly string[]): boolean {
  return RETURN_NEVER_RECEIVER_ROLES.some((role) => holds(roles, role));
}

function availableHandler(candidate: ReceiverCandidate): boolean {
  if (candidate.handlerRole !== 'main' && candidate.handlerRole !== 'assist') return false;
  return !candidate.deactivated && !candidate.transferredAway;
}

function n5Clerk(candidate: ReceiverCandidate, handlers: readonly HandlerAvailability[]): boolean {
  return bothHandlersUnavailable(handlers) && candidate.clerkOfHandlingOrg && !holdsNeverRole(candidate.roles);
}

/** 法制审核看归属。行政审核看覆盖。两种角色都有时，各自的口径分别成立即可。 */
function chainReceiver(candidate: ReceiverCandidate): boolean {
  if (candidate.deactivated) return false;
  if (holds(candidate.roles, '法制审核') && candidate.legalReviewAttributed) return true;
  if (holds(candidate.roles, '行政审核') && candidate.orgCoversCase) return true;
  return false;
}

/** 接收人是否在允许范围内。n5 为真表示本次走了退回内勤例外。 */
export function checkReceiver(
  target: ReturnTarget,
  candidate: ReceiverCandidate,
  handlers: readonly HandlerAvailability[],
): ReceiverCheck {
  if (availableHandler(candidate)) return { ok: true, n5: false };
  if (holdsNeverRole(candidate.roles)) return { ok: false, reason: 'receiver-not-allowed' };
  if (returnsToInvestigation(target)) {
    if (n5Clerk(candidate, handlers)) return { ok: true, n5: true };
    return { ok: false, reason: 'receiver-not-allowed' };
  }
  if (chainReceiver(candidate)) return { ok: true, n5: false };
  if (n5Clerk(candidate, handlers)) return { ok: true, n5: true };
  return { ok: false, reason: 'receiver-not-allowed' };
}

export type DocumentEditCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly httpStatus: 403; readonly reason: 'clerk-cannot-edit' | 'permission-denied' };

/**
 * 内勤收到退回后不能编辑文书（#238 N5，#239 才允许改派）。
 * 本案主办或协办不受这条限制。
 */
export function checkDocumentEdit(input: {
  readonly roles: readonly string[];
  readonly isCaseHandler: boolean;
}): DocumentEditCheck {
  if (input.isCaseHandler) return { ok: true };
  if (holds(input.roles, '内勤')) return { ok: false, httpStatus: 403, reason: 'clerk-cannot-edit' };
  return { ok: false, httpStatus: 403, reason: 'permission-denied' };
}
