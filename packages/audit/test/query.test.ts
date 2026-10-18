import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  PrismaAuditTrailReader,
  auditCategoryOf,
  auditCategoryPrefilter,
  type AuditCategory,
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
    targetOrgUnitId: null as string | null,
    targetOrgUnitBasis: null as string | null,
    orgUnit: { name: '甲区' },
  };
}

/** 范围条件（ADR 0011 修正）：带来源的拒绝行按目标机构，其余行按 org_unit_id。 */
function anchors(ids: string[], unanchored = false): Array<Record<string, unknown>> {
  const list: Array<Record<string, unknown>> = [
    { targetOrgUnitBasis: null, orgUnitId: { in: ids } },
    { targetOrgUnitBasis: { not: null }, targetOrgUnitId: { in: ids } },
  ];
  if (unanchored) {
    list.push({ targetOrgUnitBasis: null, orgUnitId: null }, { targetOrgUnitBasis: { not: null }, targetOrgUnitId: null });
  }
  return list;
}

function fake(rows: ReturnType<typeof row>[]): { db: AuditTrailReadClient; calls: FindManyArgs[]; counts: unknown[] } {
  const calls: FindManyArgs[] = [];
  const counts: unknown[] = [];
  return {
    calls,
    counts,
    db: {
      auditTrail: {
        findMany: async (args) => { calls.push(args); return rows; },
        count: async (args) => { counts.push(args.where); return 7; },
      },
    },
  };
}

/** 与库里预筛条件同义的判断：动作在列表里，或是授权拒绝且操作码命中。 */
function prefilterMatches(category: AuditCategory, action: string, opcode: string | null): boolean {
  const pre = auditCategoryPrefilter(category);
  if (pre.actions.includes(action)) return true;
  if (action !== 'authz.denied' || !opcode) return false;
  return pre.deniedOpcodes.includes(opcode) || pre.deniedOpcodePrefixes.some((prefix) => opcode.startsWith(prefix));
}

/** 名册里管理台相关的码，外加业务区的码作反例。 */
const OPCODES = [
  'personnel.locked.read', 'personnel.locked.release', 'personnel.password.reset', 'personnel.profile.export',
  'personnel.profile.read', 'personnel.profile.register', 'personnel.profile.rename', 'personnel.sessions.end',
  'personnel.cert.update', 'audit.admin.read', 'audit.admin.export', 'authz.binding.submit', 'org.tree.read',
  'org.unit.register', 'org.unit.rename', 'org.unit.deactivate', 'case.open', 'clue.read', null,
];

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

  it('执法证一类（#133）：动作词 cert.updated，被拒的操作码 personnel.cert.update', () => {
    expect(auditCategoryOf('cert.updated', 'personnel.cert.update')).toBe('cert');
    expect(auditCategoryOf('authz.denied', 'personnel.cert.update')).toBe('cert');
    expect(auditCategoryPrefilter('cert').actions).toEqual(['cert.updated']);
  });
});

describe('#126 PrismaAuditTrailReader', () => {
  it('范围只取给定机构；不带无机构的行时条件里没有 orgUnitId 为空', async () => {
    const { db, calls } = fake([]);
    await new PrismaAuditTrailReader(db).list({ ...RANGE, orgUnitIds: ['org-a', 'org-b'], includeUnanchored: false });
    expect(calls[0]?.where).toEqual({
      createdAt: { gte: RANGE.from, lt: RANGE.to },
      AND: [{ OR: anchors(['org-a', 'org-b']) }],
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
      AND: [{ OR: anchors(['root'], true) }],
      actorCode: 'P-9',
      outcome: 'failed',
    });
  });

  it('有类别时在库里按动作与被拒的操作码预筛', async () => {
    const { db, calls } = fake([]);
    await new PrismaAuditTrailReader(db).list({ ...RANGE, orgUnitIds: ['org-a'], includeUnanchored: false, category: 'export' });
    expect(calls[0]?.where.AND).toEqual([
      { OR: anchors(['org-a']) },
      {
        OR: [
          { action: { in: ['personnel.exported', 'audit.exported'] } },
          { action: 'authz.denied', OR: [{ opcode: { in: ['personnel.profile.export', 'audit.admin.export'] } }] },
        ],
      },
    ]);
    await new PrismaAuditTrailReader(db).list({ ...RANGE, orgUnitIds: ['org-a'], includeUnanchored: false, category: 'auth-session' });
    // 认证与会话没有对应的拒绝码：只按动作
    expect((calls[1]?.where.AND as unknown[])[1]).toEqual({ OR: [{ action: { in: auditCategoryPrefilter('auth-session').actions } }] });
  });

  it('库里预筛是精确类别的超集：凡 auditCategoryOf 归入该类的动作与码，预筛都放行', () => {
    const actions = [...AUDIT_ACTIONS, ...AUDIT_CATEGORIES.flatMap((category) => auditCategoryPrefilter(category).actions)];
    for (const category of AUDIT_CATEGORIES) {
      for (const action of [...new Set(actions)]) {
        for (const opcode of OPCODES) {
          if (auditCategoryOf(action, opcode) === category) {
            expect(prefilterMatches(category, action, opcode), `${category} ${action} ${opcode}`).toBe(true);
          }
        }
      }
    }
  });

  it('只数条数：同一范围条件进 count，不取行', async () => {
    const { db, calls, counts } = fake([]);
    const today = await new PrismaAuditTrailReader(db).count({ ...RANGE, orgUnitIds: ['org-a'], includeUnanchored: false });
    expect(today).toBe(7);
    expect(calls).toHaveLength(0);
    expect(counts).toEqual([{ createdAt: { gte: RANGE.from, lt: RANGE.to }, AND: [{ OR: anchors(['org-a']) }] }]);
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

  it('所属机构：带来源的拒绝行取目标机构，来源为空的旧拒绝行和其他行取 org_unit_id', async () => {
    const target = { ...row('authz.denied', 'personnel.locked.release'), id: 'new', targetOrgUnitId: 'org-b', targetOrgUnitBasis: 'object' };
    const fallback = { ...row('authz.denied', 'audit.admin.read'), id: 'fb', targetOrgUnitId: 'org-a', targetOrgUnitBasis: 'actor-fallback' };
    const old = { ...row('authz.denied', 'personnel.locked.release'), id: 'old' };
    const { db } = fake([target, fallback, old, row('account.unlocked')]);
    const rows = await new PrismaAuditTrailReader(db).list({ ...RANGE, orgUnitIds: ['org-a', 'org-b'], includeUnanchored: false });
    expect(rows.map((item) => [item.id, item.anchorOrgUnitId, item.targetOrgUnitBasis])).toEqual([
      ['new', 'org-b', 'object'],
      ['fb', 'org-a', 'actor-fallback'],
      ['old', 'org-a', null],
      ['id-account.unlocked-', 'org-a', null],
    ]);
  });
});
