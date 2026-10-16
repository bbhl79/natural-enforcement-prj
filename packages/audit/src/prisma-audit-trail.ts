// AuditTrail 的数据库适配器。只追加。调用方传入带 auditTrail.create 的客户端。
// 本文件是包内唯一触达该委托的位置。
import type { AuditTrailPort, AuthzDeniedEntry } from './port.ts';
import { newAuditId } from './ulid.ts';

export interface AuditTrailCreateClient {
  auditTrail: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export class PrismaAuditTrail implements AuditTrailPort {
  constructor(private readonly db: AuditTrailCreateClient) {}

  async append(entry: AuthzDeniedEntry): Promise<void> {
    await this.db.auditTrail.create({
      data: {
        id: newAuditId(),
        action: entry.action,
        outcome: entry.outcome,
        actorId: entry.actorId,
        actorCode: entry.actorCode,
        subjectPersonnelId: entry.subjectPersonnelId,
        subjectCode: entry.subjectCode,
        orgUnitId: entry.orgUnitId,
        sourceIp: entry.sourceIp,
        reason: entry.reason,
        opcode: entry.opcode,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        previousValue: entry.previousValue,
      },
    });
  }
}
