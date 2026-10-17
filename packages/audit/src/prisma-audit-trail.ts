// 留痕表适配器（ADR 0012）。本文件是包内唯一引用 auditTrail 委托的地方。
// 调用方传入带 auditTrail.create 的客户端。不在这里 import 生成客户端。
import type { AuditAppend, AuditTrailPort, AuthzDeniedEntry } from './port.ts';
import type { AuditTrailFactory } from './transaction.ts';
import { newAuditId } from './ulid.ts';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_ORG_BASES,
  AUDIT_SUCCEEDED_ACTIONS,
  AUTHZ_DENIED_REASONS,
  LOGIN_FAILED_REASONS,
  PASSWORD_CHANGED_REASONS,
  SESSION_END_REASONS,
} from './vocabulary.ts';

const SUCCEEDED = new Set<string>(AUDIT_SUCCEEDED_ACTIONS);
const ACTIONS = new Set<string>(AUDIT_ACTIONS);
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
    assertVocabulary(entry.action, reason);
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
