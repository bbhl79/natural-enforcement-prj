import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTION_AUTHZ_DENIED,
  AUDIT_ACTIONS,
  AUDIT_COUNTED_ACTIONS,
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

describe('导出条数（ADR 0013）', () => {
  it('personnel.exported 带条数写入，记成功；条数 0 同样写入', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    await trail.append({ ...parties, action: 'personnel.exported', itemCount: 3 });
    await trail.append({ ...parties, action: 'personnel.exported', itemCount: 0 });
    expect(written.map((row) => [row.action, row.outcome, row.itemCount, row.reason])).toEqual([
      ['personnel.exported', 'succeeded', 3, null],
      ['personnel.exported', 'succeeded', 0, null],
    ]);
    expect(AUDIT_COUNTED_ACTIONS).toEqual(['personnel.exported', 'audit.exported']);
  });

  it('#126：audit.exported 带条数写入、audit.viewed 不带条数，都记成功', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    await trail.append({ ...parties, action: 'audit.exported', itemCount: 46 });
    await trail.append({ ...parties, action: 'audit.viewed' });
    expect(written.map((row) => [row.action, row.outcome, row.itemCount])).toEqual([
      ['audit.exported', 'succeeded', 46],
      ['audit.viewed', 'succeeded', null],
    ]);
  });

  it('#126：audit.exported 缺条数、audit.viewed 带条数都被拒绝，不写库', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    await expect(
      trail.append({ ...parties, action: 'audit.exported' } as unknown as Parameters<typeof trail.append>[0]),
    ).rejects.toBeInstanceOf(AuditVocabularyError);
    await expect(
      trail.append({ ...parties, action: 'audit.viewed', itemCount: 1 } as unknown as Parameters<typeof trail.append>[0]),
    ).rejects.toBeInstanceOf(AuditVocabularyError);
    expect(written).toHaveLength(0);
  });

  it('不带条数的动作写入时条数为空', async () => {
    const { db, written } = recorder();
    await new PrismaAuditTrail(db).append({ ...parties, action: 'login.succeeded' });
    await new PrismaAuditTrail(db).append(entry);
    expect(written.map((row) => row.itemCount)).toEqual([null, null]);
  });

  it('带条数的动作缺条数或条数不是非负整数被拒绝，不写库', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    for (const itemCount of [undefined, null, -1, 1.5, Number.NaN, '3']) {
      await expect(
        trail.append({ ...parties, action: 'personnel.exported', itemCount } as unknown as Parameters<typeof trail.append>[0]),
      ).rejects.toBeInstanceOf(AuditVocabularyError);
    }
    expect(written).toHaveLength(0);
  });

  it('别的动作带条数被拒绝，不写库', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    await expect(
      trail.append({ ...parties, action: 'login.succeeded', itemCount: 1 } as unknown as Parameters<typeof trail.append>[0]),
    ).rejects.toBeInstanceOf(AuditVocabularyError);
    expect(written).toHaveLength(0);
  });
});

describe('引导动作（#131，ADR 0013 第 3 条）', () => {
  it('根机构与首个系统管理人员两行都记成功，不带原因和条数', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    const boot = { ...parties, sourceIp: null, orgUnitId: 'ROOT-ID' };
    await trail.append({ ...boot, action: 'bootstrap.root-registered', resourceType: 'org-unit', resourceId: 'ROOT-ID' });
    await trail.append({
      ...boot,
      action: 'bootstrap.admin-registered',
      subjectPersonnelId: 'ADMIN-ID',
      subjectCode: 'P-0001',
    });
    expect(written.map((row) => [row.action, row.outcome, row.reason, row.itemCount, row.orgUnitId, row.actorId]))
      .toEqual([
        ['bootstrap.root-registered', 'succeeded', null, null, 'ROOT-ID', null],
        ['bootstrap.admin-registered', 'succeeded', null, null, 'ROOT-ID', null],
      ]);
  });

  it('引导动作记失败、带原因或带条数，一律拒绝且不写库', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    const cases: Array<Record<string, unknown>> = [
      { action: 'bootstrap.root-registered', outcome: 'failed', reason: 'org-unit-deactivated' },
      { action: 'bootstrap.admin-registered', reason: 'bad-credential' },
      { action: 'bootstrap.admin-registered', itemCount: 1 },
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

describe('人员登记、查看与岗位标记（#128）', () => {
  it('登记、查看记成功；登记被拒记失败；加岗位标记带后值，其余动作后值为空', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    await trail.append({ ...parties, action: 'personnel.registered', opcode: 'personnel.profile.register' });
    await trail.append({ ...parties, action: 'personnel.viewed', opcode: 'personnel.profile.read' });
    await trail.append({ ...parties, action: 'personnel.post-granted', nextValue: 'legal-review-lead' });
    await trail.append({ ...parties, action: 'personnel.registered', outcome: 'failed', reason: 'already-exists' });
    await trail.append({ ...parties, action: 'personnel.registered', outcome: 'failed', reason: 'org-unit-deactivated' });
    expect(written.map((row) => [row.action, row.outcome, row.reason, row.nextValue])).toEqual([
      ['personnel.registered', 'succeeded', null, null],
      ['personnel.viewed', 'succeeded', null, null],
      ['personnel.post-granted', 'succeeded', null, 'legal-review-lead'],
      ['personnel.registered', 'failed', 'already-exists', null],
      ['personnel.registered', 'failed', 'org-unit-deactivated', null],
    ]);
  });

  it('加岗位标记缺后值、别的动作带后值、登记失败原因表外，一律拒绝且不写库', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    const cases: Array<Record<string, unknown>> = [
      { action: 'personnel.post-granted' },
      { action: 'personnel.post-granted', nextValue: '' },
      { action: 'personnel.registered', nextValue: 'legal-review-lead' },
      { action: 'org.unit.renamed', previousValue: '旧名', nextValue: '新名' },
      { action: 'personnel.registered', outcome: 'failed', reason: 'scope-denied' },
      { action: 'personnel.viewed', outcome: 'failed', reason: 'already-exists' },
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

describe('执法证登记（#133）', () => {
  it('cert.updated 记成功，前值写旧有效期和旧状态，不带原因、后值和条数', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    await trail.append({
      ...parties,
      action: 'cert.updated',
      opcode: 'personnel.cert.update',
      previousValue: 'expiresOn=2027-06-30;status=valid',
    });
    await trail.append({ ...parties, action: 'cert.updated', opcode: 'personnel.cert.update' });
    expect(written.map((row) => [row.action, row.outcome, row.reason, row.previousValue, row.nextValue, row.itemCount]))
      .toEqual([
        ['cert.updated', 'succeeded', null, 'expiresOn=2027-06-30;status=valid', null, null],
        ['cert.updated', 'succeeded', null, null, null, null],
      ]);
    expect(AUDIT_ACTIONS).toContain('cert.updated');
    expect(AUDIT_COUNTED_ACTIONS).not.toContain('cert.updated');
  });

  it('cert.updated 记失败、带原因、带后值或带条数，一律拒绝且不写库', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    const cases: Array<Record<string, unknown>> = [
      { action: 'cert.updated', outcome: 'failed' },
      { action: 'cert.updated', outcome: 'failed', reason: 'already-exists' },
      { action: 'cert.updated', reason: 'already-exists' },
      { action: 'cert.updated', nextValue: 'valid' },
      { action: 'cert.updated', itemCount: 1 },
describe('人员编辑与调岗（#129，ADR 0014）', () => {
  it('改名、改手机号、加减角色、摘岗位标记、调岗都记成功；改名前值写旧名，改手机号前值留空', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    await trail.append({ ...parties, action: 'personnel.renamed', previousValue: '陈晓宁' });
    await trail.append({ ...parties, action: 'personnel.mobile-changed' });
    await trail.append({ ...parties, action: 'personnel.role-granted', nextValue: '法制审核' });
    await trail.append({ ...parties, action: 'personnel.role-revoked', nextValue: '经办' });
    await trail.append({ ...parties, action: 'personnel.post-revoked', nextValue: 'legal-review-lead' });
    await trail.append({
      ...parties, action: 'personnel.transferred', previousValue: '石牌自然资源所', nextValue: '南华自然资源所',
    });
    expect(written.map((row) => [row.action, row.outcome, row.reason, row.previousValue, row.nextValue])).toEqual([
      ['personnel.renamed', 'succeeded', null, '陈晓宁', null],
      ['personnel.mobile-changed', 'succeeded', null, null, null],
      ['personnel.role-granted', 'succeeded', null, null, '法制审核'],
      ['personnel.role-revoked', 'succeeded', null, null, '经办'],
      ['personnel.post-revoked', 'succeeded', null, null, 'legal-review-lead'],
      ['personnel.transferred', 'succeeded', null, '石牌自然资源所', '南华自然资源所'],
    ]);
  });

  it('手机号已被占用记在改手机号上，违反根机构守卫记在被摘的角色或调岗上', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    await trail.append({ ...parties, action: 'personnel.mobile-changed', outcome: 'failed', reason: 'already-exists' });
    await trail.append({
      ...parties, action: 'personnel.role-revoked', outcome: 'failed', reason: 'root-admin-required', nextValue: '系统管理',
    });
    await trail.append({
      ...parties, action: 'personnel.transferred', outcome: 'failed', reason: 'org-unit-deactivated', nextValue: '五山自然资源所',
    });
    await trail.append({
      ...parties, action: 'personnel.transferred', outcome: 'failed', reason: 'root-admin-required', nextValue: '天河区分局',
    });
    expect(written.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['personnel.mobile-changed', 'failed', 'already-exists'],
      ['personnel.role-revoked', 'failed', 'root-admin-required'],
      ['personnel.transferred', 'failed', 'org-unit-deactivated'],
      ['personnel.transferred', 'failed', 'root-admin-required'],
    ]);
  });

  it('表外失败原因、只记成功的动作记失败、带后值的动作缺后值，一律拒绝且不写库', async () => {
    const { db, written } = recorder();
    const trail = new PrismaAuditTrail(db);
    const cases: Array<Record<string, unknown>> = [
      { action: 'personnel.renamed', outcome: 'failed', reason: 'root-admin-required' },
      { action: 'personnel.role-granted', outcome: 'failed', reason: 'root-admin-required' },
      { action: 'personnel.post-revoked', outcome: 'failed', reason: 'already-exists' },
      { action: 'personnel.mobile-changed', outcome: 'failed', reason: 'root-admin-required' },
      { action: 'personnel.transferred', outcome: 'failed', reason: 'already-exists' },
      { action: 'personnel.role-granted' },
      { action: 'personnel.post-revoked', nextValue: '' },
      { action: 'personnel.transferred', previousValue: '石牌自然资源所' },
      { action: 'personnel.renamed', nextValue: '邓雅' },
      { action: 'personnel.mobile-changed', nextValue: '13900007788' },
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
