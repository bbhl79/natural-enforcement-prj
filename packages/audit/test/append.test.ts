import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTION_AUTHZ_DENIED,
  PrismaAuditTrail,
  type AuditTrailCreateClient,
  type AuthzDeniedEntry,
} from '../src/index.ts';

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

const entry: AuthzDeniedEntry = {
  action: AUDIT_ACTION_AUTHZ_DENIED,
  outcome: 'failed',
  actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  actorCode: 'P-1',
  subjectPersonnelId: null,
  subjectCode: null,
  orgUnitId: '01ARZ3NDEKTSV4RRFFQ69G5FAB',
  sourceIp: null,
  reason: 'permission-denied',
  opcode: 'case.open',
  resourceType: 'case',
  resourceId: 'case-1',
  previousValue: null,
};

describe('授权拒绝追加', () => {
  it('写入一行失败的 authz.denied，带操作者、操作码、资源和原因', async () => {
    const written: Record<string, unknown>[] = [];
    const db: AuditTrailCreateClient = {
      auditTrail: {
        create: async (args) => {
          written.push(args.data);
        },
      },
    };
    await new PrismaAuditTrail(db).append(entry);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      action: 'authz.denied',
      outcome: 'failed',
      actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      actorCode: 'P-1',
      orgUnitId: '01ARZ3NDEKTSV4RRFFQ69G5FAB',
      reason: 'permission-denied',
      opcode: 'case.open',
      resourceType: 'case',
      resourceId: 'case-1',
      subjectPersonnelId: null,
      sourceIp: null,
      previousValue: null,
    });
    expect(written[0]?.id).toMatch(ULID);
  });
});
