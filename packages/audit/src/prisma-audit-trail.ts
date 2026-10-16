// 留痕表适配器（ADR 0012）。本文件是包内唯一引用 auditTrail 委托的地方。
// 调用方传入带 auditTrail.create 的客户端。不在这里 import 生成客户端。
import type { AuditAppend, AuditTrailPort, AuthzDeniedEntry } from './port.ts';
import { newAuditId } from './ulid.ts';
import { AUDIT_SUCCEEDED_ACTIONS } from './vocabulary.ts';

const SUCCEEDED = new Set<string>(AUDIT_SUCCEEDED_ACTIONS);

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
