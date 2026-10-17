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
  targetOrgUnitId: '01ARZ3NDEKTSV4RRFFQ69G5FAC',
  targetOrgUnitBasis: 'object',
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
      targetOrgUnitId: '01ARZ3NDEKTSV4RRFFQ69G5FAC',
      targetOrgUnitBasis: 'object',
    });
    expect(written[0]?.id).toMatch(ULID);
  });

  it('拒绝行没给目标机构时按操作者机构兜底，并标 actor-fallback（ADR 0011 修正）', async () => {
    const { db, written } = recorder();
    await new PrismaAuditTrail(db).append({
      action: 'authz.denied',
      reason: 'not-authenticated',
      actorId: null,
      actorCode: null,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId: 'org-actor',
      sourceIp: null,
    });
    expect(written[0]).toMatchObject({ targetOrgUnitId: 'org-actor', targetOrgUnitBasis: 'actor-fallback' });
  });

  it('其他动作两列都空；表外来源或非拒绝动作带目标机构都拒绝写', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    await trail.append({
      action: 'login.succeeded',
      actorId: 'p',
      actorCode: 'P',
      subjectPersonnelId: 'p',
      subjectCode: 'P',
      orgUnitId: 'org-actor',
      sourceIp: null,
    });
    expect(written[0]).toMatchObject({ targetOrgUnitId: null, targetOrgUnitBasis: null });
    await expect(trail.append({ ...entry, targetOrgUnitBasis: 'guess' } as unknown as AuthzDeniedEntry))
      .rejects.toBeInstanceOf(AuditVocabularyError);
    await expect(trail.append({
      action: 'login.succeeded',
      actorId: 'p',
      actorCode: 'P',
      subjectPersonnelId: 'p',
      subjectCode: 'P',
      orgUnitId: 'org-actor',
      sourceIp: null,
      targetOrgUnitId: 'x',
    } as unknown as AuthzDeniedEntry)).rejects.toBeInstanceOf(AuditVocabularyError);
    expect(written).toHaveLength(1);
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
