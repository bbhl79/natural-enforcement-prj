// 根机构登记与调岗写入形态（unit 层无库）。
// 外部可观察：拒绝必须是 AccessDeniedError 且 reason 精确；调岗必须是一次 transferAssignment，
// 不能拆成关止、插入、改归属三次独立提交。
import { describe, expect, it, vi } from 'vitest';

import type { AuditTrailPort } from '@natural-enforcement/audit';

import { IDENTITY_MAINTENANCE_OPCODE, AccessDeniedError } from '../src/domain/access.ts';
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

const blankCert = { enforcementCertNo: null, enforcementCertExpiresOn: null };

// 角色按 ADR 0009 的七个角色命名：系统管理持有维护允许行，内勤与经办没有。
const sysAdmin: PersonnelRow = {
  id: 'sys-admin',
  code: 'P-SYS',
  name: '系统管理',
  orgUnitId: 'dept-a',
  passwordHash: null,
  deactivatedAt: null,
  ...blankCert,
};

const intake: PersonnelRow = {
  id: 'intake',
  code: 'P-INTAKE',
  name: '内勤',
  orgUnitId: 'dept-a',
  passwordHash: null,
  deactivatedAt: null,
  ...blankCert,
};

const handler: PersonnelRow = {
  id: 'handler',
  code: 'P-HANDLER',
  name: '经办',
  orgUnitId: 'dept-a',
  passwordHash: null,
  deactivatedAt: null,
  ...blankCert,
};

const audit: AuditTrailPort = { append: async () => undefined };

function accessFor(backing: IdentityStore): AccessControlService {
  return new AccessControlService(backing, audit);
}

function people(): Record<string, PersonnelRow> {
  return { 'sys-admin': sysAdmin, intake, handler };
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
    listOrgUnitSubtreeIds: async (orgUnitId) => [orgUnitId],
    listActiveRoleNames: async (personnelId) => ({
      'sys-admin': ['系统管理'],
      intake: ['内勤'],
      handler: ['经办'],
    })[personnelId] ?? [],
    listGrantingRoleNames: async (personnelId, opcode) =>
      personnelId === 'sys-admin' && opcode === IDENTITY_MAINTENANCE_OPCODE ? ['系统管理'] : [],
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
    const orgUnits = new OrgUnitService(store({ insertOrgUnit }), accessFor(store()));
    await expect(
      orgUnits.registerOrgUnit(
        { personnelId: 'sys-admin', authenticated: false },
        { code: 'ROOT', name: '根', parentId: null },
      ),
    ).rejects.toMatchObject({ reason: 'not-authenticated' });
    expect(insertOrgUnit).not.toHaveBeenCalled();
  });

  it('内勤没有维护允许行，被拒（permission-denied）', async () => {
    const orgUnits = new OrgUnitService(store(), accessFor(store()));
    await expect(
      orgUnits.registerOrgUnit(authed('intake'), { code: 'ROOT', name: '根', parentId: null }),
    ).rejects.toMatchObject({ reason: 'permission-denied' });
  });

  it('有维护允许行的系统管理登记根机构仍被拒（scope-denied）', async () => {
    const insertOrgUnit = vi.fn();
    const orgUnits = new OrgUnitService(store({ insertOrgUnit }), accessFor(store()));
    await expect(
      orgUnits.registerOrgUnit(authed('sys-admin'), { code: 'ROOT', name: '根', parentId: null }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      orgUnits.registerOrgUnit(authed('sys-admin'), { code: 'ROOT', name: '根', parentId: null }),
    ).rejects.toMatchObject({ reason: 'scope-denied' });
    expect(insertOrgUnit).not.toHaveBeenCalled();
  });

  it('上级机构在数据范围内时放行并写入', async () => {
    const insertOrgUnit = vi.fn();
    const orgUnits = new OrgUnitService(store({ insertOrgUnit }), accessFor(store()));
    const created = await orgUnits.registerOrgUnit(authed('sys-admin'), {
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
    const transferAssignment = vi.fn<(transfer: AssignmentTransfer) => Promise<void>>(
      async () => undefined,
    );
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
      accessFor(backing),
      new CredentialService(backing),
    );

    await personnel.transferPersonnel(authed('sys-admin'), 'handler', 'dept-b');

    expect(transferAssignment).toHaveBeenCalledOnce();
    const transfer = transferAssignment.mock.calls[0][0];
    expect(transfer.closedAssignmentId).toBe('asg-handler');
    expect(transfer.personnelId).toBe('handler');
    expect(transfer.toOrgUnitId).toBe('dept-b');
    expect(transfer.next.orgUnitId).toBe('dept-b');
    expect(transfer.next.endedAt).toBeNull();
    expect(closeAssignment).not.toHaveBeenCalled();
    expect(insertAssignment).not.toHaveBeenCalled();
    expect(updatePersonnelOrgUnit).not.toHaveBeenCalled();
  });
});
