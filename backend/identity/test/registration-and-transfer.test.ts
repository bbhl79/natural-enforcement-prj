// 根机构登记与调岗写入形态（unit 层无库）。
// 外部可观察：拒绝必须是 AccessDeniedError 且 reason 精确；调岗必须是一次 transferAssignment，
// 不能拆成关止、插入、改归属三次独立提交。
import { describe, expect, it, vi } from 'vitest';

import { AccessDeniedError } from '../src/domain/access.ts';
import type { ActorRef } from '../src/domain/actor.ts';
import type {
  AssignmentTransfer,
  IdentityStore,
  PersonnelAssignmentRow,
  PersonnelRow,
} from '../src/persistence/identity-store.ts';
import { AccessControlService } from '../src/services/access-control.service.ts';
import { CredentialService } from '../src/services/credential.service.ts';
import { OrgUnitService } from '../src/services/org-unit.service.ts';
import { PersonnelService } from '../src/services/personnel.service.ts';

const supervisor: PersonnelRow = {
  id: 'sup',
  code: 'P-SUP',
  name: '主管',
  orgUnitId: 'dept-a',
  role: 'supervisor',
  passwordHash: null,
  deactivatedAt: null,
};

const viewer: PersonnelRow = {
  id: 'viewer',
  code: 'P-VIEW',
  name: '查看',
  orgUnitId: 'dept-a',
  role: 'viewer',
  passwordHash: null,
  deactivatedAt: null,
};

const clerk: PersonnelRow = {
  id: 'clerk',
  code: 'P-CLERK',
  name: '经办',
  orgUnitId: 'dept-a',
  role: 'clerk',
  passwordHash: null,
  deactivatedAt: null,
};

function people(): Record<string, PersonnelRow> {
  return { sup: supervisor, viewer, clerk };
}

function store(extra: Partial<IdentityStore> = {}): IdentityStore {
  const known = people();
  return {
    findPersonnelById: async (id) => known[id] ?? null,
    findCurrentAssignment: async (personnelId) =>
      ({
        id: `asg-${personnelId}`,
        personnelId,
        orgUnitId: 'dept-a',
        startedAt: new Date('2026-01-01T00:00:00Z'),
        endedAt: null,
      }) satisfies PersonnelAssignmentRow,
    findOrgUnitPathToRoot: async (orgUnitId) => ['hq', orgUnitId],
    insertOrgUnit: async () => undefined,
    insertOrgUnitNameVersion: async () => undefined,
    findOrgUnitById: async () => ({
      id: 'child',
      code: 'child',
      name: '子机构',
      parentId: 'dept-a',
      deactivatedAt: null,
    }),
    ...extra,
  } as IdentityStore;
}

const authed = (personnelId: string): ActorRef => ({ personnelId, authenticated: true });

describe('根机构登记', () => {
  it('未认证被拒（not-authenticated），且不写库', async () => {
    const insertOrgUnit = vi.fn();
    const orgUnits = new OrgUnitService(store({ insertOrgUnit }), new AccessControlService(store()));
    await expect(
      orgUnits.registerOrgUnit(
        { personnelId: 'sup', authenticated: false },
        { code: 'ROOT', name: '根', parentId: null },
      ),
    ).rejects.toMatchObject({ reason: 'not-authenticated' });
    expect(insertOrgUnit).not.toHaveBeenCalled();
  });

  it('viewer 被拒（permission-denied）', async () => {
    const orgUnits = new OrgUnitService(store(), new AccessControlService(store()));
    await expect(
      orgUnits.registerOrgUnit(authed('viewer'), { code: 'ROOT', name: '根', parentId: null }),
    ).rejects.toMatchObject({ reason: 'permission-denied' });
  });

  it('有改权限的主管仍被拒（scope-denied）', async () => {
    const insertOrgUnit = vi.fn();
    const orgUnits = new OrgUnitService(store({ insertOrgUnit }), new AccessControlService(store()));
    await expect(
      orgUnits.registerOrgUnit(authed('sup'), { code: 'ROOT', name: '根', parentId: null }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      orgUnits.registerOrgUnit(authed('sup'), { code: 'ROOT', name: '根', parentId: null }),
    ).rejects.toMatchObject({ reason: 'scope-denied' });
    expect(insertOrgUnit).not.toHaveBeenCalled();
  });

  it('上级机构在数据范围内时放行并写入', async () => {
    const insertOrgUnit = vi.fn();
    const orgUnits = new OrgUnitService(store({ insertOrgUnit }), new AccessControlService(store()));
    const created = await orgUnits.registerOrgUnit(authed('sup'), {
      code: 'CHILD',
      name: '子机构',
      parentId: 'dept-a',
    });
    expect(insertOrgUnit).toHaveBeenCalledOnce();
    expect(created.parentId).toBe('dept-a');
  });
});

describe('调岗写入', () => {
  it('三次写入收成一次 transferAssignment', async () => {
    const transferAssignment = vi.fn(async (_transfer: AssignmentTransfer) => undefined);
    const closeAssignment = vi.fn();
    const insertAssignment = vi.fn();
    const updatePersonnelOrgUnit = vi.fn();
    const backing = store({
      transferAssignment,
      closeAssignment,
      insertAssignment,
      updatePersonnelOrgUnit,
    });
    const personnel = new PersonnelService(
      backing,
      new AccessControlService(backing),
      new CredentialService(backing),
    );

    await personnel.transferPersonnel(authed('sup'), 'clerk', 'dept-b');

    expect(transferAssignment).toHaveBeenCalledOnce();
    const transfer = transferAssignment.mock.calls[0][0];
    expect(transfer.closedAssignmentId).toBe('asg-clerk');
    expect(transfer.personnelId).toBe('clerk');
    expect(transfer.toOrgUnitId).toBe('dept-b');
    expect(transfer.next.orgUnitId).toBe('dept-b');
    expect(transfer.next.endedAt).toBeNull();
    expect(closeAssignment).not.toHaveBeenCalled();
    expect(insertAssignment).not.toHaveBeenCalled();
    expect(updatePersonnelOrgUnit).not.toHaveBeenCalled();
  });
});
