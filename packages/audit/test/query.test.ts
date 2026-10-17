import { describe, expect, it } from 'vitest';

import {
  AUDIT_CATEGORIES,
  PrismaAuditTrailReader,
  auditCategoryOf,
  type AuditTrailReadClient,
} from '../src/index.ts';

type FindManyArgs = Parameters<AuditTrailReadClient['auditTrail']['findMany']>[0];

function row(action: string, opcode: string | null = null) {
  return {
    id: `id-${action}-${opcode ?? ''}`,
    createdAt: new Date('2026-10-17T01:00:00.000Z'),
    action,
    outcome: 'succeeded',
    reason: null,
    actorCode: 'P-1',
    subjectCode: null,
    orgUnitId: 'org-a',
    opcode,
    resourceType: null,
    resourceId: null,
    itemCount: null,
    orgUnit: { name: '甲区' },
  };
}

function fake(rows: ReturnType<typeof row>[]): { db: AuditTrailReadClient; calls: FindManyArgs[] } {
  const calls: FindManyArgs[] = [];
  return {
    calls,
    db: { auditTrail: { findMany: async (args) => { calls.push(args); return rows; } } },
  };
}

const RANGE = { from: new Date('2026-10-15T16:00:00.000Z'), to: new Date('2026-10-17T16:00:00.000Z') };

describe('#126 留痕类别（P8 筛选）', () => {
  it('七个类别与原型「操作类别」下拉一一对应（不含「全部操作」）', () => {
    expect(AUDIT_CATEGORIES).toEqual([
      'auth-session', 'personnel-view', 'personnel-maintenance', 'org-maintenance', 'unlock-reset', 'cert', 'export',
    ]);
  });

  it('按动作归类；授权拒绝按被拒的操作码归类，业务区的码不归类', () => {
    expect(auditCategoryOf('login.failed', null)).toBe('auth-session');
    expect(auditCategoryOf('session.ended', null)).toBe('auth-session');
    expect(auditCategoryOf('personnel.viewed', null)).toBe('personnel-view');
    expect(auditCategoryOf('account.unlocked', null)).toBe('unlock-reset');
    expect(auditCategoryOf('account.password-reset', null)).toBe('unlock-reset');
    expect(auditCategoryOf('personnel.exported', 'personnel.profile.export')).toBe('export');
    expect(auditCategoryOf('audit.exported', 'audit.admin.export')).toBe('export');
    expect(auditCategoryOf('audit.viewed', 'audit.admin.read')).toBeNull();
    expect(auditCategoryOf('authz.denied', 'personnel.locked.release')).toBe('unlock-reset');
    expect(auditCategoryOf('authz.denied', 'personnel.profile.export')).toBe('export');
    expect(auditCategoryOf('authz.denied', 'org.unit.rename')).toBe('org-maintenance');
    expect(auditCategoryOf('authz.denied', 'case.open')).toBeNull();
    expect(auditCategoryOf('authz.denied', null)).toBeNull();
  });
});

describe('#126 PrismaAuditTrailReader', () => {
  it('范围只取给定机构；不带无机构的行时条件里没有 orgUnitId 为空', async () => {
    const { db, calls } = fake([]);
    await new PrismaAuditTrailReader(db).list({ ...RANGE, orgUnitIds: ['org-a', 'org-b'], includeUnanchored: false });
    expect(calls[0]?.where).toEqual({
      createdAt: { gte: RANGE.from, lt: RANGE.to },
      OR: [{ orgUnitId: { in: ['org-a', 'org-b'] } }],
    });
    expect(calls[0]?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('范围根是根机构时带上无机构的行；操作人与结果在库里筛', async () => {
    const { db, calls } = fake([]);
    await new PrismaAuditTrailReader(db).list({
      ...RANGE, orgUnitIds: ['root'], includeUnanchored: true, actorCode: 'P-9', outcome: 'failed',
    });
    expect(calls[0]?.where).toEqual({
      createdAt: { gte: RANGE.from, lt: RANGE.to },
      OR: [{ orgUnitId: { in: ['root'] } }, { orgUnitId: null }],
      actorCode: 'P-9',
      outcome: 'failed',
    });
  });

  it('类别按 auditCategoryOf 筛，返回行带所属机构名，不带来源地址与前值', async () => {
    const { db } = fake([row('login.succeeded'), row('account.unlocked'), row('authz.denied', 'personnel.locked.release')]);
    const rows = await new PrismaAuditTrailReader(db).list({
      ...RANGE, orgUnitIds: ['org-a'], includeUnanchored: false, category: 'unlock-reset',
    });
    expect(rows.map((item) => [item.action, item.opcode])).toEqual([
      ['account.unlocked', null],
      ['authz.denied', 'personnel.locked.release'],
    ]);
    expect(rows[0]?.orgUnitName).toBe('甲区');
    expect(Object.keys(rows[0] ?? {})).not.toContain('sourceIp');
    expect(Object.keys(rows[0] ?? {})).not.toContain('previousValue');
  });
});
