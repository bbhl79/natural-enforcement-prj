// 留痕表适配器（ADR 0012）。本文件是包内唯一引用 auditTrail 委托的地方。
// 生成客户端只做类型导入。根类型检查排除本文件。server 传入已构造的客户端。
import type { PrismaClient } from '../../../backend/prisma/generated/prisma/client.ts';

import type { AuditAppend, AuditTrailPort } from './port.ts';
import { newAuditId } from './ulid.ts';
import { AUDIT_SUCCEEDED_ACTIONS } from './vocabulary.ts';

const SUCCEEDED = new Set<string>(AUDIT_SUCCEEDED_ACTIONS);

export class PrismaAuditTrail implements AuditTrailPort {
  constructor(private readonly prisma: PrismaClient) {}

  async append(entry: AuditAppend): Promise<void> {
    const reason = 'reason' in entry ? entry.reason : null;
    await this.prisma.auditTrail.create({
      data: {
        id: newAuditId(),
        action: entry.action,
        outcome: SUCCEEDED.has(entry.action) ? 'succeeded' : 'failed',
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
