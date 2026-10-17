// 机构树（#123）：新建下级的层级与名称规则、上级停用、改名（unit 层无库）。
// 外部可观察：返回结果与规则码、是否写库、是否追加留痕。
import { describe, expect, it, vi } from 'vitest';
import type { AuditAppend, AuditTrailPort, AuthzDeniedEntry } from '@natural-enforcement/audit';

import type { ActorRef } from '../src/domain/actor.ts';
import { childLevelOf, orgUnitNameRules, type OrgUnitLevel } from '../src/domain/org-unit.ts';
import type {
  IdentityStore,
  OrgUnitNameVersionRow,
  OrgUnitRow,
  PersonnelRow,
} from '../src/persistence/identity-store.ts';
import { AccessControlService } from '../src/services/access-control.service.ts';
import { OrgUnitService } from '../src/services/org-unit.service.ts';

const units: Record<string, OrgUnitRow> = {
  hq: { id: 'hq', code: 'HQ', name: '市局', level: 'city', parentId: null, deactivatedAt: null },
  'dept-a': { id: 'dept-a', code: 'A', name: '区A', level: 'district', parentId: 'hq', deactivatedAt: null },
  'dept-x': {
    id: 'dept-x',
    code: 'X',
    name: '已停用区',
    level: 'district',
    parentId: 'hq',
    deactivatedAt: new Date('2026-09-01T00:00:00Z'),
  },
  station: { id: 'station', code: 'S', name: '所A', level: 'station', parentId: 'dept-a', deactivatedAt: null },
};

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

const OPCODES = new Set(['org.tree.read', 'org.unit.register', 'org.unit.rename']);

function fixture() {
  const insertOrgUnit = vi.fn(async () => undefined);
  const insertOrgUnitNameVersion = vi.fn<(row: OrgUnitNameVersionRow) => Promise<void>>(async () => undefined);
  const updateOrgUnitCurrentName = vi.fn(async () => undefined);
  const appended: Array<AuditAppend | AuthzDeniedEntry> = [];
  const audit: AuditTrailPort = { append: async (entry) => void appended.push(entry) };
  const store = {
    findPersonnelById: async (id: string) => (id === 'admin' ? admin : null),
    findCurrentAssignment: async (personnelId: string) => ({
      id: `asg-${personnelId}`,
      personnelId,
      orgUnitId: 'hq',
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
    listOrgUnitSubtreeIds: async () => Object.keys(units),
    listActiveRoleNames: async () => ['系统管理'],
    listGrantingRoleNames: async (_id: string, opcode: string) => (OPCODES.has(opcode) ? ['系统管理'] : []),
    lockOrgUnit: async (id: string) => units[id] ?? null,
    findOrgUnitById: async (id: string) => units[id] ?? { ...units.station, id },
    listOrgUnitNameVersions: async (id: string) => [
      { id: 'v1', orgUnitId: id, name: units[id]?.name ?? '', version: 1, createdAt: new Date('2026-01-01T00:00:00Z') },
    ],
    insertOrgUnit,
    insertOrgUnitNameVersion,
    updateOrgUnitCurrentName,
  } as unknown as IdentityStore;
  const service = new OrgUnitService(store, new AccessControlService(store, audit));
  return {
    service,
    tx: { store, client: null },
    audit,
    appended,
    insertOrgUnit,
    insertOrgUnitNameVersion,
    updateOrgUnitCurrentName,
  };
}

const actor: ActorRef = { personnelId: 'admin', authenticated: true };

describe('层级规则', () => {
  it('市下只建区，区下只建所，所下不能再建', () => {
    expect(childLevelOf('city')).toBe('district');
    expect(childLevelOf('district')).toBe('station');
    expect(childLevelOf('station')).toBeNull();
  });

  it('名称去空白后不能为空，最长 100 字', () => {
    expect(orgUnitNameRules('')).toEqual(['org-name-required']);
    expect(orgUnitNameRules('甲'.repeat(100))).toEqual([]);
    expect(orgUnitNameRules('甲'.repeat(101))).toEqual(['org-name-too-long']);
  });
});

describe('新建下级', () => {
  const allowed: Array<[string, OrgUnitLevel]> = [
    ['hq', 'district'],
    ['dept-a', 'station'],
  ];
  it.each(allowed)('%s 下新建 %s：写入机构、首个名称版本和 org.unit.registered', async (parentId, level) => {
    const f = fixture();
    const outcome = await f.service.registerOrgUnit(actor, { parentId, name: '  新机构 ', level }, f.tx, f.audit, '10.0.0.1');
    expect(outcome.result).toBe('registered');
    expect(f.insertOrgUnit).toHaveBeenCalledOnce();
    expect(f.insertOrgUnit).toHaveBeenCalledWith(expect.objectContaining({ name: '新机构', level, parentId }));
    const [created] = f.insertOrgUnit.mock.calls[0] as unknown as [OrgUnitRow];
    expect(created.code).toBe(`ORG-${created.id}`);
    expect(f.insertOrgUnitNameVersion).toHaveBeenCalledWith(expect.objectContaining({ name: '新机构', version: 1 }));
    expect(f.appended).toEqual([
      expect.objectContaining({
        action: 'org.unit.registered',
        orgUnitId: created.id,
        resourceId: created.id,
        opcode: 'org.unit.register',
        sourceIp: '10.0.0.1',
      }),
    ]);
  });

  const mismatched: Array<[string, string]> = [
    ['hq', 'station'],
    ['hq', 'city'],
    ['dept-a', 'district'],
    ['dept-a', 'city'],
    ['station', 'station'],
    ['station', 'district'],
    ['hq', '科'],
  ];
  it.each(mismatched)('%s 下新建 %s：org-level-mismatch，不写库、不写留痕', async (parentId, level) => {
    const f = fixture();
    const outcome = await f.service.registerOrgUnit(actor, { parentId, name: '新机构', level }, f.tx, f.audit);
    expect(outcome).toEqual({ result: 'non-compliant', rules: ['org-level-mismatch'] });
    expect(f.insertOrgUnit).not.toHaveBeenCalled();
    expect(f.appended).toEqual([]);
  });

  it('名称为空与层级不符一起报', async () => {
    const f = fixture();
    const outcome = await f.service.registerOrgUnit(actor, { parentId: 'hq', name: '  ', level: 'station' }, f.tx, f.audit);
    expect(outcome).toEqual({ result: 'non-compliant', rules: ['org-name-required', 'org-level-mismatch'] });
  });

  it('上级已停用：invalid-state，交出待写的失败留痕，本事务内不写库也不写留痕', async () => {
    const f = fixture();
    const outcome = await f.service.registerOrgUnit(actor, { parentId: 'dept-x', name: '新所', level: 'station' }, f.tx, f.audit);
    expect(outcome).toMatchObject({
      result: 'invalid-state',
      failure: {
        action: 'org.unit.registered',
        outcome: 'failed',
        reason: 'org-unit-deactivated',
        orgUnitId: 'dept-x',
        resourceId: 'dept-x',
      },
    });
    expect(f.insertOrgUnit).not.toHaveBeenCalled();
    expect(f.appended).toEqual([]);
  });
});

describe('改名', () => {
  it('追加名称版本、更新现名，留痕带旧名', async () => {
    const f = fixture();
    const outcome = await f.service.renameOrgUnit(actor, 'dept-a', ' 区A新名 ', f.tx, f.audit);
    expect(outcome).toMatchObject({ result: 'renamed', orgUnit: { id: 'dept-a', name: '区A新名' } });
    expect(f.insertOrgUnitNameVersion).toHaveBeenCalledWith(expect.objectContaining({ name: '区A新名', version: 2 }));
    expect(f.updateOrgUnitCurrentName).toHaveBeenCalledWith('dept-a', '区A新名');
    expect(f.appended).toEqual([
      expect.objectContaining({ action: 'org.unit.renamed', previousValue: '区A', orgUnitId: 'dept-a' }),
    ]);
  });

  it('与现名相同：unchanged，不追加版本、不写留痕', async () => {
    const f = fixture();
    const outcome = await f.service.renameOrgUnit(actor, 'dept-a', '区A', f.tx, f.audit);
    expect(outcome.result).toBe('unchanged');
    expect(f.insertOrgUnitNameVersion).not.toHaveBeenCalled();
    expect(f.appended).toEqual([]);
  });

  it('已停用机构仍可改名（停用只禁新任职和新下级）', async () => {
    const f = fixture();
    const outcome = await f.service.renameOrgUnit(actor, 'dept-x', '撤并区', f.tx, f.audit);
    expect(outcome.result).toBe('renamed');
  });

  it('名称超长：non-compliant，不写库', async () => {
    const f = fixture();
    const outcome = await f.service.renameOrgUnit(actor, 'dept-a', '甲'.repeat(101), f.tx, f.audit);
    expect(outcome).toEqual({ result: 'non-compliant', rules: ['org-name-too-long'] });
    expect(f.updateOrgUnitCurrentName).not.toHaveBeenCalled();
  });
});
