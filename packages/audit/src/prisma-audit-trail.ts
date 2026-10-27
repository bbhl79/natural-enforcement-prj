// 留痕表适配器（ADR 0012）。本文件是包内唯一引用 auditTrail 委托的地方。
// 追加（PrismaAuditTrail）与查阅（PrismaAuditTrailReader，#126）都在这里。
// 调用方传入带 auditTrail.create 的客户端。不在这里 import 生成客户端。
import { AUDIT_ACTION_AUTHZ_DENIED, type AuditAppend, type AuditTrailPort, type AuthzDeniedEntry } from './port.ts';
import {
  auditCategoryOf,
  auditCategoryPrefilter,
  type AuditTrailQuery,
  type AuditTrailReader,
  type AuditTrailRecord,
} from './query.ts';
import type { AuditTrailFactory } from './transaction.ts';
import { newAuditId } from './ulid.ts';
import {
  AUDIT_ACTIONS,
  AUDIT_COUNTED_ACTIONS,
  AUDIT_DETAIL_ACTIONS,
  AUDIT_NEXT_VALUE_ACTIONS,
  AUDIT_TARGET_ORG_BASES,
  ACCOUNT_MAINTENANCE_FAILED_REASONS,
  AUDIT_SUCCEEDED_ACTIONS,
  AUTHZ_DENIED_REASONS,
  CERT_UPDATE_FAILED_REASONS,
  CLUE_ITEMS_SUPPLEMENT_FAILED_REASONS,
  CLUE_REGISTER_FAILED_REASONS,
  CLUE_GEOMETRY_UPDATE_FAILED_REASONS,
  CLUE_VERIFY_RETRY_FAILED_REASONS,
  CLUE_DESIGNATE_REJECTED_FAILED_REASONS,
  CLUE_DESIGNATE_REQUESTED_FAILED_REASONS,
  CLUE_DISPATCH_DECIDE_FAILED_REASONS,
  CLUE_DISPOSITION_RECORDED_FAILED_REASONS,
  CLUE_EXTERNAL_TRANSFER_ATTACHED_FAILED_REASONS,
  CLUE_HANDLER_ASSIGNED_FAILED_REASONS,
  CLUE_ORG_ASSIGNED_FAILED_REASONS,
  CLUE_POOL_REASSIGNED_FAILED_REASONS,
  STORAGE_QUARANTINED_FAILED_REASONS,
  STORAGE_SECRECY_REPORT_CREATED_FAILED_REASONS,
  STORAGE_SECRECY_REPORT_REPORTED_FAILED_REASONS,
  STORAGE_SECRECY_REPORT_RECEIPTED_FAILED_REASONS,
  CLUE_REMINDER_RESOLVED_FAILED_REASONS,
  CLUE_WITHDRAWN_FAILED_REASONS,
  CASE_FILING_APPROVED_FAILED_REASONS,
  CASE_FILING_DRAFTED_FAILED_REASONS,
  CASE_FILING_RETURNED_FAILED_REASONS,
  CASE_FILING_REVIEWED_FAILED_REASONS,
  CASE_FILING_SUBMITTED_FAILED_REASONS,
  CASE_FILING_WITHDRAWN_FAILED_REASONS,
  CASE_OPENED_FAILED_REASONS,
  CASE_TRANSITIONED_FAILED_REASONS,
  LOGIN_FAILED_REASONS,
  ORG_UNIT_DEACTIVATE_FAILED_REASONS,
  ORG_UNIT_REGISTER_FAILED_REASONS,
  PASSWORD_CHANGED_REASONS,
  PASSWORD_REJECTED_REASONS,
  PERSONNEL_DEACTIVATE_FAILED_REASONS,
  PERSONNEL_MOBILE_CHANGE_FAILED_REASONS,
  PERSONNEL_POST_GRANT_FAILED_REASONS,
  PERSONNEL_POST_REVOKE_FAILED_REASONS,
  PERSONNEL_REGISTER_FAILED_REASONS,
  PERSONNEL_RENAME_FAILED_REASONS,
  PERSONNEL_RESTORE_FAILED_REASONS,
  PERSONNEL_ROLE_GRANT_FAILED_REASONS,
  PERSONNEL_ROLE_REVOKE_FAILED_REASONS,
  PERSONNEL_TRANSFER_FAILED_REASONS,
  SESSION_END_REASONS,
} from './vocabulary.ts';

const SUCCEEDED = new Set<string>(AUDIT_SUCCEEDED_ACTIONS);
const ACTIONS = new Set<string>(AUDIT_ACTIONS);
const COUNTED = new Set<string>(AUDIT_COUNTED_ACTIONS);
const NEXT_VALUE_ACTIONS = new Set<string>(AUDIT_NEXT_VALUE_ACTIONS);
const TARGET_BASES = new Set<string>(AUDIT_TARGET_ORG_BASES);
const DETAIL_ACTIONS = new Set<string>(AUDIT_DETAIL_ACTIONS);

/** 带原因的动作及其封闭原因表。不在表里的动作不许带原因。 */
const REASONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['login.failed', new Set<string>(LOGIN_FAILED_REASONS)],
  ['session.ended', new Set<string>(SESSION_END_REASONS)],
  ['account.password-changed', new Set<string>(PASSWORD_CHANGED_REASONS)],
  ['account.password-rejected', new Set<string>(PASSWORD_REJECTED_REASONS)],
  ['authz.denied', new Set<string>(AUTHZ_DENIED_REASONS)],
]);

/** 记成功的动作被拒绝（outcome=failed）时的封闭原因表。不在表里的成功动作不能记失败。 */
const FAILED_REASONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['org.unit.registered', new Set<string>(ORG_UNIT_REGISTER_FAILED_REASONS)],
  ['org.unit.deactivated', new Set<string>(ORG_UNIT_DEACTIVATE_FAILED_REASONS)],
  ['personnel.registered', new Set<string>(PERSONNEL_REGISTER_FAILED_REASONS)],
  ['personnel.renamed', new Set<string>(PERSONNEL_RENAME_FAILED_REASONS)],
  ['personnel.mobile-changed', new Set<string>(PERSONNEL_MOBILE_CHANGE_FAILED_REASONS)],
  ['personnel.role-granted', new Set<string>(PERSONNEL_ROLE_GRANT_FAILED_REASONS)],
  ['personnel.role-revoked', new Set<string>(PERSONNEL_ROLE_REVOKE_FAILED_REASONS)],
  ['personnel.post-granted', new Set<string>(PERSONNEL_POST_GRANT_FAILED_REASONS)],
  ['personnel.post-revoked', new Set<string>(PERSONNEL_POST_REVOKE_FAILED_REASONS)],
  ['personnel.transferred', new Set<string>(PERSONNEL_TRANSFER_FAILED_REASONS)],
  ['personnel.deactivated', new Set<string>(PERSONNEL_DEACTIVATE_FAILED_REASONS)],
  ['personnel.restored', new Set<string>(PERSONNEL_RESTORE_FAILED_REASONS)],
  ['cert.updated', new Set<string>(CERT_UPDATE_FAILED_REASONS)],
  ['account.unlocked', new Set<string>(ACCOUNT_MAINTENANCE_FAILED_REASONS)],
  ['account.password-reset', new Set<string>(ACCOUNT_MAINTENANCE_FAILED_REASONS)],
  ['clue.registered', new Set<string>(CLUE_REGISTER_FAILED_REASONS)],
  ['clue.items-supplemented', new Set<string>(CLUE_ITEMS_SUPPLEMENT_FAILED_REASONS)],
  ['clue.verify-retried', new Set<string>(CLUE_VERIFY_RETRY_FAILED_REASONS)],
  ['clue.geometry-updated', new Set<string>(CLUE_GEOMETRY_UPDATE_FAILED_REASONS)],
  ['clue.dispatched', new Set<string>(CLUE_DISPATCH_DECIDE_FAILED_REASONS)],
  ['clue.held', new Set<string>(CLUE_DISPATCH_DECIDE_FAILED_REASONS)],
  ['clue.org-assigned', new Set<string>(CLUE_ORG_ASSIGNED_FAILED_REASONS)],
  ['clue.handler-assigned', new Set<string>(CLUE_HANDLER_ASSIGNED_FAILED_REASONS)],
  ['clue.pool-reassigned', new Set<string>(CLUE_POOL_REASSIGNED_FAILED_REASONS)],
  ['clue.designate-requested', new Set<string>(CLUE_DESIGNATE_REQUESTED_FAILED_REASONS)],
  ['clue.designate-rejected', new Set<string>(CLUE_DESIGNATE_REJECTED_FAILED_REASONS)],
  ['clue.withdrawn', new Set<string>(CLUE_WITHDRAWN_FAILED_REASONS)],
  ['clue.disposition-recorded', new Set<string>(CLUE_DISPOSITION_RECORDED_FAILED_REASONS)],
  ['clue.external-transfer-attached', new Set<string>(CLUE_EXTERNAL_TRANSFER_ATTACHED_FAILED_REASONS)],
  ['clue.reminder-resolved', new Set<string>(CLUE_REMINDER_RESOLVED_FAILED_REASONS)],
  ['storage.quarantined', new Set<string>(STORAGE_QUARANTINED_FAILED_REASONS)],
  ['storage.secrecy-report-created', new Set<string>(STORAGE_SECRECY_REPORT_CREATED_FAILED_REASONS)],
  ['storage.secrecy-report-reported', new Set<string>(STORAGE_SECRECY_REPORT_REPORTED_FAILED_REASONS)],
  ['storage.secrecy-report-receipted', new Set<string>(STORAGE_SECRECY_REPORT_RECEIPTED_FAILED_REASONS)],
  ['case.filing-drafted', new Set<string>(CASE_FILING_DRAFTED_FAILED_REASONS)],
  ['case.filing-submitted', new Set<string>(CASE_FILING_SUBMITTED_FAILED_REASONS)],
  ['case.filing-reviewed', new Set<string>(CASE_FILING_REVIEWED_FAILED_REASONS)],
  ['case.filing-approved', new Set<string>(CASE_FILING_APPROVED_FAILED_REASONS)],
  ['case.filing-returned', new Set<string>(CASE_FILING_RETURNED_FAILED_REASONS)],
  ['case.filing-withdrawn', new Set<string>(CASE_FILING_WITHDRAWN_FAILED_REASONS)],
  ['case.opened', new Set<string>(CASE_OPENED_FAILED_REASONS)],
  ['case.transitioned', new Set<string>(CASE_TRANSITIONED_FAILED_REASONS)],
]);

/** 后值只许出现在带后值的动作上，且这些动作必须带非空后值（#128）。 */
function assertNextValue(action: string, nextValue: unknown): void {
  if (NEXT_VALUE_ACTIONS.has(action)) {
    if (typeof nextValue !== 'string' || nextValue === '') {
      throw new AuditVocabularyError(`动作 ${action} 必须带后值`);
    }
    return;
  }
  if (nextValue != null) throw new AuditVocabularyError(`动作 ${action} 不带后值，收到：${String(nextValue)}`);
}

/** 封闭取值表的运行时把关：类型之外（如 as 断言、JS 调用方）传入的表外取值一律拒绝，不写库。 */
export class AuditVocabularyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditVocabularyError';
  }
}

function assertVocabulary(action: string, outcome: unknown, reason: unknown): void {
  if (!ACTIONS.has(action)) throw new AuditVocabularyError(`表外留痕动作：${action}`);
  if (outcome !== 'succeeded' && outcome !== 'failed') {
    throw new AuditVocabularyError(`动作 ${action} 的表外成败：${String(outcome)}`);
  }
  if (SUCCEEDED.has(action) && outcome === 'failed') {
    const failed = FAILED_REASONS.get(action);
    if (!failed) throw new AuditVocabularyError(`动作 ${action} 只记成功`);
    if (typeof reason !== 'string' || !failed.has(reason)) {
      throw new AuditVocabularyError(`动作 ${action} 的表外失败原因：${String(reason)}`);
    }
    return;
  }
  if (!SUCCEEDED.has(action) && outcome === 'succeeded') {
    throw new AuditVocabularyError(`动作 ${action} 只记失败`);
  }
  const allowed = REASONS.get(action);
  if (!allowed) {
    if (reason != null) throw new AuditVocabularyError(`动作 ${action} 不带原因，收到：${String(reason)}`);
    return;
  }
  if (typeof reason !== 'string' || !allowed.has(reason)) {
    throw new AuditVocabularyError(`动作 ${action} 的表外原因：${String(reason)}`);
  }
}

/** 带条数的动作必须带非负整数条数；其余动作不许带条数（ADR 0013）。 */
function assertItemCount(action: string, itemCount: unknown): void {
  if (!COUNTED.has(action)) {
    if (itemCount != null) throw new AuditVocabularyError(`动作 ${action} 不带条数，收到：${String(itemCount)}`);
    return;
  }
  if (typeof itemCount !== 'number' || !Number.isSafeInteger(itemCount) || itemCount < 0) {
    throw new AuditVocabularyError(`动作 ${action} 的条数须为非负整数，收到：${String(itemCount)}`);
  }
}

/**
 * 结构化快照（#211，规格 G）：只有带快照的动作许带 detail，其余一律不带。
 * 带就必须有值（空快照等于没写）。
 */
function assertDetail(action: string, detail: unknown): void {
  if (!DETAIL_ACTIONS.has(action)) {
    if (detail != null) throw new AuditVocabularyError(`动作 ${action} 不带结构化快照，收到：${String(detail)}`);
    return;
  }
  if (detail == null) return;
  if (typeof detail !== 'string' || detail === '') {
    throw new AuditVocabularyError(`动作 ${action} 的结构化快照须为非空文本`);
  }
}

/**
 * 授权拒绝行的目标机构（#119 修正，ADR 0011）。
 * 调用方没给时取操作者机构并记 actor-fallback。其他动作两列都空。
 */
function targetOf(entry: AuditAppend | AuthzDeniedEntry): {
  targetOrgUnitId: string | null;
  targetOrgUnitBasis: string | null;
} {
  if (entry.action !== 'authz.denied') {
    if ('targetOrgUnitId' in entry || 'targetOrgUnitBasis' in entry) {
      throw new AuditVocabularyError(`动作 ${entry.action} 不带目标机构`);
    }
    return { targetOrgUnitId: null, targetOrgUnitBasis: null };
  }
  const basis = entry.targetOrgUnitBasis;
  if (basis === undefined) return { targetOrgUnitId: entry.orgUnitId, targetOrgUnitBasis: 'actor-fallback' };
  if (!TARGET_BASES.has(basis)) throw new AuditVocabularyError(`表外目标机构来源：${String(basis)}`);
  return { targetOrgUnitId: entry.targetOrgUnitId ?? null, targetOrgUnitBasis: basis };
}

export interface AuditTrailCreateClient {
  auditTrail: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export class PrismaAuditTrail implements AuditTrailPort {
  constructor(private readonly db: AuditTrailCreateClient) {}

  async append(entry: AuditAppend | AuthzDeniedEntry): Promise<void> {
    const outcome = 'outcome' in entry
      ? entry.outcome
      : SUCCEEDED.has(entry.action) ? 'succeeded' : 'failed';
    const reason = 'reason' in entry ? entry.reason : null;
    const itemCount = 'itemCount' in entry ? (entry.itemCount ?? null) : null;
    const nextValue = 'nextValue' in entry ? entry.nextValue ?? null : null;
    const detail = 'detail' in entry ? entry.detail ?? null : null;
    assertVocabulary(entry.action, outcome, reason);
    assertItemCount(entry.action, itemCount);
    assertNextValue(entry.action, nextValue);
    assertDetail(entry.action, detail);
    const target = targetOf(entry);
    await this.db.auditTrail.create({
      data: {
        id: newAuditId(),
        action: entry.action,
        outcome,
        actorId: entry.actorId,
        actorCode: entry.actorCode,
        subjectPersonnelId: entry.subjectPersonnelId,
        subjectCode: entry.subjectCode,
        orgUnitId: entry.orgUnitId,
        sourceIp: entry.sourceIp,
        reason,
        opcode: entry.opcode ?? null,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        previousValue: entry.previousValue ?? null,
        itemCount,
        nextValue,
        detail,
        targetOrgUnitId: target.targetOrgUnitId,
        targetOrgUnitBasis: target.targetOrgUnitBasis,
      },
    });
  }
}

/** 默认留痕工厂：client 是 Prisma 根客户端或交互式事务客户端。 */
export const prismaAuditTrailFactory: AuditTrailFactory = {
  forClient: (client) => new PrismaAuditTrail(client as AuditTrailCreateClient),
};

/** 查阅用到的 auditTrail.findMany 形状。调用方传 Prisma 根客户端或交互式事务客户端。 */
export interface AuditTrailReadClient {
  auditTrail: {
    findMany(args: {
      where: Record<string, unknown>;
      include: { orgUnit: { select: { name: true } } };
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
    }): Promise<Array<{
      id: string;
      createdAt: Date;
      action: string;
      outcome: string;
      reason: string | null;
      actorCode: string | null;
      subjectCode: string | null;
      orgUnitId: string | null;
      opcode: string | null;
      resourceType: string | null;
      resourceId: string | null;
      itemCount: number | null;
      targetOrgUnitId: string | null;
      targetOrgUnitBasis: string | null;
      orgUnit: { name: string } | null;
    }>>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
}

/** 范围、时间、操作人、结果，以及（有类别时）类别预筛，都放进库里的 where。 */
function auditWhere(query: AuditTrailQuery): Record<string, unknown> {
  // 所属机构（ADR 0011 修正）：带来源的授权拒绝行按目标机构套；其余行（含来源为空的旧拒绝行）按 org_unit_id 套。
  const ids = [...query.orgUnitIds];
  const anchors: Array<Record<string, unknown>> = [
    { targetOrgUnitBasis: null, orgUnitId: { in: ids } },
    { targetOrgUnitBasis: { not: null }, targetOrgUnitId: { in: ids } },
  ];
  if (query.includeUnanchored) {
    anchors.push({ targetOrgUnitBasis: null, orgUnitId: null });
    anchors.push({ targetOrgUnitBasis: { not: null }, targetOrgUnitId: null });
  }
  const and: Array<Record<string, unknown>> = [{ OR: anchors }];
  if (query.category) {
    const pre = auditCategoryPrefilter(query.category);
    const opcodes: Array<Record<string, unknown>> = [];
    if (pre.deniedOpcodes.length > 0) opcodes.push({ opcode: { in: [...pre.deniedOpcodes] } });
    for (const prefix of pre.deniedOpcodePrefixes) opcodes.push({ opcode: { startsWith: prefix } });
    const kinds: Array<Record<string, unknown>> = [{ action: { in: [...pre.actions] } }];
    if (opcodes.length > 0) kinds.push({ action: AUDIT_ACTION_AUTHZ_DENIED, OR: opcodes });
    and.push({ OR: kinds });
  }
  const where: Record<string, unknown> = { createdAt: { gte: query.from, lt: query.to }, AND: and };
  if (query.actorCode) where.actorCode = query.actorCode;
  if (query.outcome) where.outcome = query.outcome;
  return where;
}

/**
 * 管理台留痕查阅（#126）。范围、时间、操作人、结果和类别预筛在库里筛；
 * 取回后再按 auditCategoryOf 精确筛一遍，与页面上的类别口径同一份代码。
 */
export class PrismaAuditTrailReader implements AuditTrailReader {
  constructor(private readonly db: AuditTrailReadClient) {}

  async count(query: Omit<AuditTrailQuery, 'category'>): Promise<number> {
    return this.db.auditTrail.count({ where: auditWhere({ ...query, category: null }) });
  }

  async list(query: AuditTrailQuery): Promise<AuditTrailRecord[]> {
    const rows = await this.db.auditTrail.findMany({
      where: auditWhere(query),
      include: { orgUnit: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows
      .filter((row) => !query.category || auditCategoryOf(row.action, row.opcode) === query.category)
      .map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        action: row.action,
        outcome: row.outcome,
        reason: row.reason,
        actorCode: row.actorCode,
        subjectCode: row.subjectCode,
        orgUnitId: row.orgUnitId,
        orgUnitName: row.orgUnit?.name ?? null,
        anchorOrgUnitId: row.targetOrgUnitBasis != null ? row.targetOrgUnitId : row.orgUnitId,
        targetOrgUnitBasis: row.targetOrgUnitBasis,
        opcode: row.opcode,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        itemCount: row.itemCount,
      }));
  }
}
