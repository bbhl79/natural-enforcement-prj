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
  AUDIT_TARGET_ORG_BASES,
  AUDIT_SUCCEEDED_ACTIONS,
  AUTHZ_DENIED_REASONS,
  LOGIN_FAILED_REASONS,
  PASSWORD_CHANGED_REASONS,
  SESSION_END_REASONS,
} from './vocabulary.ts';

const SUCCEEDED = new Set<string>(AUDIT_SUCCEEDED_ACTIONS);
const ACTIONS = new Set<string>(AUDIT_ACTIONS);
const COUNTED = new Set<string>(AUDIT_COUNTED_ACTIONS);
const TARGET_BASES = new Set<string>(AUDIT_TARGET_ORG_BASES);

/** 带原因的动作及其封闭原因表。不在表里的动作不许带原因。 */
const REASONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['login.failed', new Set<string>(LOGIN_FAILED_REASONS)],
  ['session.ended', new Set<string>(SESSION_END_REASONS)],
  ['account.password-changed', new Set<string>(PASSWORD_CHANGED_REASONS)],
  ['authz.denied', new Set<string>(AUTHZ_DENIED_REASONS)],
]);

/** 封闭取值表的运行时把关：类型之外（如 as 断言、JS 调用方）传入的表外取值一律拒绝，不写库。 */
export class AuditVocabularyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditVocabularyError';
  }
}

function assertVocabulary(action: string, reason: unknown): void {
  if (!ACTIONS.has(action)) throw new AuditVocabularyError(`表外留痕动作：${action}`);
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
    assertVocabulary(entry.action, reason);
    assertItemCount(entry.action, itemCount);
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
      orgUnit: { name: string } | null;
    }>>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
}

/** 范围、时间、操作人、结果，以及（有类别时）类别预筛，都放进库里的 where。 */
function auditWhere(query: AuditTrailQuery): Record<string, unknown> {
  const anchors: Array<Record<string, unknown>> = [{ orgUnitId: { in: [...query.orgUnitIds] } }];
  if (query.includeUnanchored) anchors.push({ orgUnitId: null });
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
        opcode: row.opcode,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        itemCount: row.itemCount,
      }));
  }
}
