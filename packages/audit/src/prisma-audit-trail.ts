// 留痕表适配器（ADR 0012）。本文件是包内唯一引用 auditTrail 委托的地方。
// 调用方传入带 auditTrail.create 的客户端。不在这里 import 生成客户端。
import type { AuditAppend, AuditTrailPort, AuthzDeniedEntry } from './port.ts';
import type { AuditTrailFactory } from './transaction.ts';
import { newAuditId } from './ulid.ts';
import {
  AUDIT_ACTIONS,
  AUDIT_SUCCEEDED_ACTIONS,
  AUTHZ_DENIED_REASONS,
  LOGIN_FAILED_REASONS,
  ORG_UNIT_REGISTER_FAILED_REASONS,
  PASSWORD_CHANGED_REASONS,
  SESSION_END_REASONS,
} from './vocabulary.ts';

const SUCCEEDED = new Set<string>(AUDIT_SUCCEEDED_ACTIONS);
const ACTIONS = new Set<string>(AUDIT_ACTIONS);

/** 带原因的动作及其封闭原因表。不在表里的动作不许带原因。 */
const REASONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['login.failed', new Set<string>(LOGIN_FAILED_REASONS)],
  ['session.ended', new Set<string>(SESSION_END_REASONS)],
  ['account.password-changed', new Set<string>(PASSWORD_CHANGED_REASONS)],
  ['authz.denied', new Set<string>(AUTHZ_DENIED_REASONS)],
]);

/** 记成功的动作被拒绝（outcome=failed）时的封闭原因表。不在表里的成功动作不能记失败。 */
const FAILED_REASONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['org.unit.registered', new Set<string>(ORG_UNIT_REGISTER_FAILED_REASONS)],
]);

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
    assertVocabulary(entry.action, outcome, reason);
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
      },
    });
  }
}

/** 默认留痕工厂：client 是 Prisma 根客户端或交互式事务客户端。 */
export const prismaAuditTrailFactory: AuditTrailFactory = {
  forClient: (client) => new PrismaAuditTrail(client as AuditTrailCreateClient),
};
