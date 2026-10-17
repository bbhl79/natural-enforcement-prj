import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTION_AUTHZ_DENIED,
  AUDIT_ACTIONS,
  AuditVocabularyError,
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

function recorder(): { db: AuditTrailCreateClient; written: Record<string, unknown>[] } {
  const written: Record<string, unknown>[] = [];
  return {
    written,
    db: { auditTrail: { create: async (args) => { written.push(args.data); } } },
  };
}

const parties = {
  actorId: null,
  actorCode: null,
  subjectPersonnelId: null,
  subjectCode: null,
  orgUnitId: null,
  sourceIp: '203.0.113.9',
};

describe('封闭取值表', () => {
  it('表外动作被拒绝，不写库', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    for (const action of ['login.unknown', 'session.deleted', '', 'LOGIN.SUCCEEDED']) {
      await expect(
        trail.append({ ...parties, action } as unknown as Parameters<typeof trail.append>[0]),
      ).rejects.toBeInstanceOf(AuditVocabularyError);
    }
    expect(written).toHaveLength(0);
  });

  it('带原因的动作给出表外原因被拒绝，不写库', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    const cases: Array<[string, unknown]> = [
      ['login.failed', 'wrong-phone'],
      ['login.failed', undefined],
      ['session.ended', 'expired'],
      ['account.password-changed', 'admin'],
      ['authz.denied', 'menu-hidden'],
    ];
    for (const [action, reason] of cases) {
      await expect(
        trail.append({ ...parties, action, reason } as unknown as Parameters<typeof trail.append>[0]),
      ).rejects.toBeInstanceOf(AuditVocabularyError);
    }
    expect(written).toHaveLength(0);
  });

  it('不带原因的动作附上原因被拒绝', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    await expect(
      trail.append({ ...parties, action: 'login.succeeded', reason: 'bad-credential' } as unknown as Parameters<typeof trail.append>[0]),
    ).rejects.toBeInstanceOf(AuditVocabularyError);
    expect(written).toHaveLength(0);
  });

  it('表内动作与原因照常写入', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    await trail.append({ ...parties, action: 'login.failed', reason: 'bad-credential' });
    await trail.append({ ...parties, action: 'session.ended', reason: 'remember-me-reuse' });
    await trail.append({ ...parties, action: 'login.capacity-reached' });
    expect(written.map((row) => [row.action, row.reason])).toEqual([
      ['login.failed', 'bad-credential'],
      ['session.ended', 'remember-me-reuse'],
      ['login.capacity-reached', null],
    ]);
    expect(AUDIT_ACTIONS).toContain('login.capacity-reached');
  });
});

describe('机构树动作（#123）', () => {
  it('新建下级、改名记成功，不带原因；新建下级被拒记失败，原因取 org-unit-deactivated', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    await trail.append({ ...parties, action: 'org.unit.registered', opcode: 'org.unit.register' });
    await trail.append({ ...parties, action: 'org.unit.renamed', previousValue: '旧名' });
    await trail.append({
      ...parties,
      action: 'org.unit.registered',
      outcome: 'failed',
      reason: 'org-unit-deactivated',
    });
    expect(written.map((row) => [row.action, row.outcome, row.reason, row.previousValue])).toEqual([
      ['org.unit.registered', 'succeeded', null, null],
      ['org.unit.renamed', 'succeeded', null, '旧名'],
      ['org.unit.registered', 'failed', 'org-unit-deactivated', null],
    ]);
  });

  it('失败原因表外、缺原因、无失败取值的动作记失败、只记失败的动作记成功，一律拒绝且不写库', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    const cases: Array<Record<string, unknown>> = [
      { action: 'org.unit.registered', outcome: 'failed', reason: 'org-has-open-items' },
      { action: 'org.unit.registered', outcome: 'failed' },
      { action: 'org.unit.registered', reason: 'org-unit-deactivated' },
      { action: 'org.unit.renamed', outcome: 'failed', reason: 'org-unit-deactivated' },
      { action: 'login.failed', outcome: 'succeeded', reason: 'bad-credential' },
      { action: 'org.unit.renamed', outcome: 'maybe' },
    ];
    for (const item of cases) {
      await expect(
        trail.append({ ...parties, ...item } as unknown as Parameters<typeof trail.append>[0]),
        JSON.stringify(item),
      ).rejects.toBeInstanceOf(AuditVocabularyError);
    }
    expect(written).toHaveLength(0);
  });
});

describe('机构停用（#124）', () => {
  it('停用记成功，不带原因；被拒记失败，原因取四个封闭取值之一', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    await trail.append({ ...parties, action: 'org.unit.deactivated', opcode: 'org.unit.deactivate' });
    for (const reason of ['org-unit-root', 'org-has-active-children', 'org-has-assignments', 'org-has-open-items'] as const) {
      await trail.append({ ...parties, action: 'org.unit.deactivated', outcome: 'failed', reason });
    }
    expect(written.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['org.unit.deactivated', 'succeeded', null],
      ['org.unit.deactivated', 'failed', 'org-unit-root'],
      ['org.unit.deactivated', 'failed', 'org-has-active-children'],
      ['org.unit.deactivated', 'failed', 'org-has-assignments'],
      ['org.unit.deactivated', 'failed', 'org-has-open-items'],
    ]);
  });

  it('停用失败缺原因、原因表外、成功带原因，一律拒绝且不写库', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    const cases: Array<Record<string, unknown>> = [
      { action: 'org.unit.deactivated', outcome: 'failed' },
      { action: 'org.unit.deactivated', outcome: 'failed', reason: 'org-unit-deactivated' },
      { action: 'org.unit.deactivated', reason: 'org-has-open-items' },
      { action: 'org.unit.registered', outcome: 'failed', reason: 'org-unit-root' },
    ];
    for (const item of cases) {
      await expect(
        trail.append({ ...parties, ...item } as unknown as Parameters<typeof trail.append>[0]),
        JSON.stringify(item),
      ).rejects.toBeInstanceOf(AuditVocabularyError);
    }
    expect(written).toHaveLength(0);
  });
});
