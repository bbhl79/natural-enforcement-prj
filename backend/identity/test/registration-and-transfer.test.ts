// 根机构登记与调岗写入形态（unit 层无库）。新建下级、改名的规则见 org-unit.test.ts。
// 外部可观察：拒绝必须是 AccessDeniedError 且 reason 精确；调岗必须是一次 transferAssignment，
// 不能拆成关止、插入、改归属三次独立提交。
import { describe, expect, it, vi } from 'vitest';

import type { AuditTrailPort } from '@natural-enforcement/audit';

import { IDENTITY_MAINTENANCE_OPCODE, AccessDeniedError } from '../src/domain/access.ts';
import { AlreadyExistsError } from '../src/domain/already-exists.ts';
import { ORG_UNIT_REGISTER_OPCODE } from '../src/domain/org-unit.ts';
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

// 证件状态是必填列（#133）：没有证的人员一样有状态取值，资格判定按证号和有效期兜住。
const blankCert = { enforcementCertNo: null, enforcementCertExpiresOn: null, enforcementCertStatus: 'valid' as const };

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
  const backing: IdentityStore = {
    inTransaction: async (work) => work({ store: backing, client: null }),
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
      personnelId === 'sys-admin' && [IDENTITY_MAINTENANCE_OPCODE, ORG_UNIT_REGISTER_OPCODE].includes(opcode)
        ? ['系统管理']
        : [],
    insertOrgUnit: async () => undefined,
    insertOrgUnitNameVersion: async () => undefined,
    findOrgUnitById: async () => ({
      id: 'child',
      code: 'child',
      name: '子机构',
      level: 'station',
      parentId: 'dept-a',
      deactivatedAt: null,
    }),
    ...extra,
  } as IdentityStore;
  return backing;
}

const authed = (personnelId: string): ActorRef => ({ personnelId, authenticated: true });

describe('根机构登记', () => {
  const tx = (backing: IdentityStore) => ({ store: backing, client: null });

  it('未认证被拒（not-authenticated），且不写库', async () => {
    const insertOrgUnit = vi.fn();
    const backing = store({ insertOrgUnit });
    const orgUnits = new OrgUnitService(backing, accessFor(backing));
    await expect(
      orgUnits.registerOrgUnit(
        { personnelId: 'sys-admin', authenticated: false },
        { name: '根', level: 'city', parentId: null },
        tx(backing),
        audit,
      ),
    ).rejects.toMatchObject({ reason: 'not-authenticated' });
    expect(insertOrgUnit).not.toHaveBeenCalled();
  });

  it('内勤没有新建允许行，被拒（permission-denied）', async () => {
    const backing = store();
    const orgUnits = new OrgUnitService(backing, accessFor(backing));
    await expect(
      orgUnits.registerOrgUnit(authed('intake'), { name: '根', level: 'city', parentId: null }, tx(backing), audit),
    ).rejects.toMatchObject({ reason: 'permission-denied' });
  });

  it('有新建允许行的系统管理登记根机构仍被拒（scope-denied），错误带上待写的 authz.denied', async () => {
    const insertOrgUnit = vi.fn();
    const appended = vi.fn(async () => undefined);
    const backing = store({ insertOrgUnit });
    const orgUnits = new OrgUnitService(backing, new AccessControlService(backing, { append: appended }));
    const attempt = orgUnits.registerOrgUnit(
      authed('sys-admin'),
      { name: '根', level: 'city', parentId: null },
      tx(backing),
      { append: appended },
    );
    await expect(attempt).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(attempt).rejects.toMatchObject({
      reason: 'scope-denied',
      denial: { action: 'authz.denied', reason: 'scope-denied', opcode: ORG_UNIT_REGISTER_OPCODE },
    });
    expect(insertOrgUnit).not.toHaveBeenCalled();
    expect(appended).not.toHaveBeenCalled();
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

  it('不传事务时自开一个事务，写入经事务里的存储', async () => {
    const outside = vi.fn(async () => undefined);
    const inside = vi.fn<(transfer: AssignmentTransfer) => Promise<void>>(async () => undefined);
    const bound = store({ transferAssignment: inside });
    const opened = vi.fn();
    const backing = store({
      transferAssignment: outside,
      inTransaction: async (work) => {
        opened();
        return work({ store: bound, client: 'tx' });
      },
    });
    const personnel = new PersonnelService(backing, accessFor(backing), new CredentialService(backing));

    await personnel.transferPersonnel(authed('sys-admin'), 'handler', 'dept-b');

    expect(opened).toHaveBeenCalledOnce();
    expect(inside).toHaveBeenCalledOnce();
    expect(outside).not.toHaveBeenCalled();
  });

  it('传入调用方事务时并入该事务，不另开事务', async () => {
    const inside = vi.fn<(transfer: AssignmentTransfer) => Promise<void>>(async () => undefined);
    const bound = store({ transferAssignment: inside });
    const opened = vi.fn();
    const backing = store({
      inTransaction: async (work) => {
        opened();
        return work({ store: bound, client: 'tx' });
      },
    });
    const personnel = new PersonnelService(backing, accessFor(backing), new CredentialService(backing));

    await personnel.transferPersonnel(authed('sys-admin'), 'handler', 'dept-b', { store: bound, client: 'caller-tx' });

    expect(opened).not.toHaveBeenCalled();
    expect(inside).toHaveBeenCalledOnce();
  });

  it('传入调用方事务时授权读取也走事务内的存储，不碰根存储', async () => {
    const inside = vi.fn<(transfer: AssignmentTransfer) => Promise<void>>(async () => undefined);
    const bound = store({ transferAssignment: inside });
    const untouchable = () => {
      throw new Error('事务内调岗不应读根存储');
    };
    const root = store({
      findPersonnelById: untouchable,
      findCurrentAssignment: untouchable,
      listGrantingRoleNames: untouchable,
    });
    const personnel = new PersonnelService(root, accessFor(root), new CredentialService(root));

    await personnel.transferPersonnel(authed('sys-admin'), 'handler', 'dept-b', { store: bound, client: 'caller-tx' });

    expect(inside).toHaveBeenCalledOnce();
  });

  it('传入调用方事务且未授权时不写留痕，错误带上待写的 authz.denied', async () => {
    const appended = vi.fn(async () => undefined);
    const bound = store();
    const access = new AccessControlService(bound, { append: appended });
    const personnel = new PersonnelService(bound, access, new CredentialService(bound));

    const attempt = personnel.transferPersonnel(authed('intake'), 'handler', 'dept-b', { store: bound, client: 'tx' });
    await expect(attempt).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(attempt).rejects.toMatchObject({
      reason: 'permission-denied',
      denial: { action: 'authz.denied', outcome: 'failed', reason: 'permission-denied' },
    });
    expect(appended).not.toHaveBeenCalled();
  });

  it('未授权时不开事务、不写入', async () => {
    const inside = vi.fn(async () => undefined);
    const opened = vi.fn();
    const backing = store({
      transferAssignment: inside,
      inTransaction: async (work) => {
        opened();
        return work({ store: backing, client: 'tx' });
      },
    });
    const personnel = new PersonnelService(backing, accessFor(backing), new CredentialService(backing));

    await expect(personnel.transferPersonnel(authed('intake'), 'handler', 'dept-b'))
      .rejects.toMatchObject({ reason: 'permission-denied' });
    expect(opened).not.toHaveBeenCalled();
    expect(inside).not.toHaveBeenCalled();
  });
});

describe('业务唯一冲突', () => {
  it('登记时工号已存在，抛 AlreadyExistsError（personnel-code），不再写名称版本与任职', async () => {
    const insertPersonnelNameVersion = vi.fn();
    const insertAssignment = vi.fn();
    const backing = store({
      insertPersonnel: async () => ({ result: 'already-exists', conflict: 'personnel-code' }),
      insertPersonnelNameVersion,
      insertAssignment,
    });
    const personnel = new PersonnelService(backing, accessFor(backing), new CredentialService(backing));

    const attempt = personnel.registerPersonnel(authed('sys-admin'), {
      code: 'P-DUP',
      name: '重复工号',
      orgUnitId: 'dept-a',
    });
    await expect(attempt).rejects.toBeInstanceOf(AlreadyExistsError);
    await expect(attempt).rejects.toMatchObject({ conflict: 'personnel-code' });
    expect(insertPersonnelNameVersion).not.toHaveBeenCalled();
    expect(insertAssignment).not.toHaveBeenCalled();
  });
});
