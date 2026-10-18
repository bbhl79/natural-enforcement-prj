// 机构停用（#124）：判定顺序、只返回第一条、重复停用、接缝③注入计数（unit 层无库）。
// 外部可观察：返回结果与被拒的那一条、是否写库、是否追加留痕、交出的失败留痕行。
import { describe, expect, it, vi } from 'vitest';
import type { AuditAppend, AuditTrailPort, AuthzDeniedEntry } from '@natural-enforcement/audit';

import type { ActorRef } from '../src/domain/actor.ts';
import type { OpenItems, OpenItemsCounter } from '../src/domain/open-items.ts';
import type { IdentityStore, OrgUnitRow, PersonnelRow } from '../src/persistence/identity-store.ts';
import { AccessControlService } from '../src/services/access-control.service.ts';
import { OrgUnitService } from '../src/services/org-unit.service.ts';

const FIRST_OFF = new Date('2026-09-01T00:00:00Z');

const admin: PersonnelRow = {
  id: 'admin',
  code: 'P-ADMIN',
  name: '市局管理',
  orgUnitId: 'hq',
  passwordHash: null,
  enforcementCertNo: null,
  enforcementCertExpiresOn: null,
  deactivatedAt: null,
};

interface Setup {
  /** 操作者任职机构 */
  home?: string;
  children?: number;
  assignments?: number;
  openItems?: OpenItems;
  opcodes?: string[];
}

function fixture(setup: Setup = {}) {
  const units: Record<string, OrgUnitRow> = {
    hq: { id: 'hq', code: 'HQ', name: '市局', level: 'city', parentId: null, deactivatedAt: null },
    'dept-a': { id: 'dept-a', code: 'A', name: '区A', level: 'district', parentId: 'hq', deactivatedAt: null },
    'dept-b': { id: 'dept-b', code: 'B', name: '区B', level: 'district', parentId: 'hq', deactivatedAt: null },
    'dept-x': { id: 'dept-x', code: 'X', name: '已停用区', level: 'district', parentId: 'hq', deactivatedAt: FIRST_OFF },
  };
  const opcodes = new Set(setup.opcodes ?? ['org.unit.deactivate']);
  const deactivateOrgUnit = vi.fn(async () => undefined);
  const countActiveChildOrgUnits = vi.fn(async () => setup.children ?? 0);
  const countOpenAssignmentsOfOrgUnit = vi.fn(async () => setup.assignments ?? 0);
  const countOpenItems = vi.fn<OpenItemsCounter['countOpenItems']>(async () => setup.openItems ?? { clues: 0, cases: 0 });
  const appended: Array<AuditAppend | AuthzDeniedEntry> = [];
  const audit: AuditTrailPort = { append: async (entry) => void appended.push(entry) };
  const store = {
    findPersonnelById: async (id: string) => (id === 'admin' ? admin : null),
    findCurrentAssignment: async (personnelId: string) => ({
      id: `asg-${personnelId}`,
      personnelId,
      orgUnitId: setup.home ?? 'hq',
      startedAt: new Date('2026-01-01T00:00:00Z'),
      endedAt: null,
    }),
    findOrgUnitPathToRoot: async (id: string) => {
      const path: string[] = [];
      for (let unit: OrgUnitRow | undefined = units[id]; unit; unit = unit.parentId ? units[unit.parentId] : undefined) {
        path.unshift(unit.id);
      }
      return path;
    },
    listOrgUnitSubtreeIds: async (id: string) => (id === 'hq' ? Object.keys(units) : [id]),
    listActiveRoleNames: async () => ['系统管理'],
    listGrantingRoleNames: async (_id: string, opcode: string) => (opcodes.has(opcode) ? ['系统管理'] : []),
    lockOrgUnit: async (id: string) => units[id] ?? null,
    countActiveChildOrgUnits,
    countOpenAssignmentsOfOrgUnit,
    deactivateOrgUnit,
  } as unknown as IdentityStore;
  const service = new OrgUnitService(store, new AccessControlService(store, audit), { countOpenItems });
  return {
    run: (id: string) => service.deactivateOrgUnit(actor, id, { store, client: null }, audit, '10.0.0.1'),
    appended,
    deactivateOrgUnit,
    countActiveChildOrgUnits,
    countOpenAssignmentsOfOrgUnit,
    countOpenItems,
  };
}

const actor: ActorRef = { personnelId: 'admin', authenticated: true };

describe('停用机构', () => {
  it('前提都满足：置停用时间，写一行 org.unit.deactivated（记成功、机构和资源都是被停用的机构）', async () => {
    const f = fixture();
    const outcome = await f.run('dept-a');
    expect(outcome.result).toBe('deactivated');
    expect(f.deactivateOrgUnit).toHaveBeenCalledTimes(1);
    expect(f.deactivateOrgUnit.mock.calls[0]).toEqual(['dept-a', expect.any(Date)]);
    expect(f.appended).toEqual([
      expect.objectContaining({
        action: 'org.unit.deactivated',
        actorId: 'admin',
        actorCode: 'P-ADMIN',
        orgUnitId: 'dept-a',
        opcode: 'org.unit.deactivate',
        resourceType: 'org-unit',
        resourceId: 'dept-a',
        sourceIp: '10.0.0.1',
      }),
    ]);
    expect(f.appended[0]).not.toHaveProperty('outcome');
  });

  it('重复停用：unchanged，首次停用时间不变，不写库、不写留痕，也不再查前提', async () => {
    const f = fixture({ children: 3, assignments: 2 });
    const outcome = await f.run('dept-x');
    expect(outcome).toEqual({ result: 'unchanged', orgUnit: expect.objectContaining({ deactivatedAt: FIRST_OFF }) });
    expect(f.deactivateOrgUnit).not.toHaveBeenCalled();
    expect(f.appended).toEqual([]);
    expect(f.countActiveChildOrgUnits).not.toHaveBeenCalled();
  });

  it.each([
    ['根机构', 'hq', { children: 2, assignments: 5, openItems: { clues: 1, cases: 2 } }, { reason: 'org-unit-root' }],
    ['未停用下级', 'dept-a', { children: 2, assignments: 5, openItems: { clues: 1, cases: 2 } }, { reason: 'org-has-active-children', children: 2 }],
    ['生效任职', 'dept-a', { assignments: 5, openItems: { clues: 1, cases: 2 } }, { reason: 'org-has-assignments', assignments: 5 }],
    ['未办结事项', 'dept-a', { openItems: { clues: 1, cases: 2 } }, { reason: 'org-has-open-items', openItems: { clues: 1, cases: 2 } }],
  ] as const)('%s：invalid-state，只返回判定顺序中的第一条，交出失败留痕，本事务不写库也不写留痕', async (_label, id, setup, blocker) => {
    const f = fixture(setup);
    const outcome = await f.run(id);
    expect(outcome.result).toBe('invalid-state');
    if (outcome.result !== 'invalid-state') return;
    expect(outcome.blocker).toEqual(blocker);
    expect(outcome.failure).toEqual(expect.objectContaining({
      action: 'org.unit.deactivated',
      outcome: 'failed',
      reason: blocker.reason,
      orgUnitId: id,
      resourceId: id,
      opcode: 'org.unit.deactivate',
    }));
    expect(f.deactivateOrgUnit).not.toHaveBeenCalled();
    expect(f.appended).toEqual([]);
  });

  it('接缝③：计数为 0 时照常停用；计数端口在同一事务里按本机构调用', async () => {
    const f = fixture({ openItems: { clues: 0, cases: 0 } });
    expect((await f.run('dept-a')).result).toBe('deactivated');
    expect(f.countOpenItems).toHaveBeenCalledWith('dept-a', expect.objectContaining({ client: null }));
  });

  it('越权先于一切前提：区 A 管理停用区 B 得 scope-denied，不查任何条数、不写库', async () => {
    const f = fixture({ home: 'dept-a', children: 2, openItems: { clues: 1, cases: 2 } });
    await expect(f.run('dept-b')).rejects.toMatchObject({ reason: 'scope-denied', denial: expect.anything() });
    expect(f.countActiveChildOrgUnits).not.toHaveBeenCalled();
    expect(f.countOpenAssignmentsOfOrgUnit).not.toHaveBeenCalled();
    expect(f.countOpenItems).not.toHaveBeenCalled();
    expect(f.deactivateOrgUnit).not.toHaveBeenCalled();
  });

  it('没有停用码：permission-denied', async () => {
    const f = fixture({ opcodes: ['org.unit.rename'] });
    await expect(f.run('dept-a')).rejects.toMatchObject({ reason: 'permission-denied' });
    expect(f.deactivateOrgUnit).not.toHaveBeenCalled();
  });

  it('未绑定计数端口时用恒为 0 的实现', async () => {
    const { NO_OPEN_ITEMS } = await import('../src/domain/open-items.ts');
    expect(await NO_OPEN_ITEMS.countOpenItems('any', { store: {} as IdentityStore, client: null })).toEqual({ clues: 0, cases: 0 });
  });
});
