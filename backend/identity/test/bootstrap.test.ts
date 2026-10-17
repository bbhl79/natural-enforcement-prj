// 生产引导（#131）：判定、写入与留痕、输入规则（unit 层无库）。
// 外部可观察：判定结果与差异、写了哪些行、追加了哪些留痕、是否先取锁。
import { describe, expect, it } from 'vitest';
import type { AuditAppend, AuditTrailFactory, AuditTrailPort, AuthzDeniedEntry } from '@natural-enforcement/audit';

import {
  BootstrapPrerequisiteError,
  bootstrapInputRules,
  judgeBootstrap,
  type BootstrapProfile,
} from '../src/domain/bootstrap.ts';
import type {
  IdentityStore,
  OrgUnitRow,
  PersonnelRow,
} from '../src/persistence/identity-store.ts';
import { BootstrapService } from '../src/services/bootstrap.service.ts';

const profile: BootstrapProfile = {
  rootCode: 'ORG-GZ',
  rootName: '市局',
  adminCode: 'SJ0001',
  adminName: '首个管理',
  adminMobilePhone: '13900000001',
};
const request = { ...profile, passwordHash: '$argon2id$v=19$fake' };

const rootRow: OrgUnitRow = { id: 'root', code: 'ORG-GZ', name: '市局', level: 'city', parentId: null, deactivatedAt: null };
const adminRow: PersonnelRow = {
  id: 'admin',
  code: 'SJ0001',
  name: '首个管理',
  orgUnitId: 'root',
  passwordHash: 'x',
  enforcementCertNo: null,
  enforcementCertExpiresOn: null,
  deactivatedAt: null,
};

interface FakeState {
  root?: OrgUnitRow | null;
  admin?: PersonnelRow | null;
  orgUnits?: number;
  personnel?: number;
  roleId?: string | null;
}

function fixture(state: FakeState = {}) {
  const calls: string[] = [];
  const writes: Array<[string, Record<string, unknown>]> = [];
  const appended: Array<AuditAppend | AuthzDeniedEntry> = [];
  const audit: AuditTrailPort = { append: async (entry) => void appended.push(entry) };
  const factory: AuditTrailFactory = { forClient: () => audit };
  const write = (name: string) => async (row: Record<string, unknown>) => {
    writes.push([name, row]);
    return { result: 'written' as const };
  };
  const store = {
    inTransaction: async <T>(work: (tx: { store: IdentityStore; client: unknown }) => Promise<T>) =>
      work({ store, client: 'tx-client' }),
    lockBootstrap: async () => void calls.push('lock'),
    findOrgUnitByCode: async () => {
      calls.push('find-root');
      return state.root ?? null;
    },
    findPersonnelByCode: async () => {
      calls.push('find-admin');
      return state.admin ?? null;
    },
    countOrgUnitsAndPersonnel: async () => ({ orgUnits: state.orgUnits ?? 0, personnel: state.personnel ?? 0 }),
    findActiveRoleIdByName: async (name: string) => (name === '系统管理' ? (state.roleId === undefined ? 'role-admin' : state.roleId) : null),
    insertOrgUnit: write('org_unit'),
    insertOrgUnitNameVersion: write('org_unit_name_version'),
    insertPersonnel: write('personnel'),
    insertPersonnelNameVersion: write('personnel_name_version'),
    insertAssignment: write('personnel_assignment'),
    insertPersonnelRole: write('personnel_role'),
  } as unknown as IdentityStore;
  return { service: new BootstrapService(store, factory), calls, writes, appended };
}

describe('判定（只看两个不可变键）', () => {
  const empty = { root: null, admin: null, orgUnits: 0, personnel: 0 };

  it('空库返回 null，可以写入', () => {
    expect(judgeBootstrap(profile, empty)).toBeNull();
  });

  it('两键都在、根机构编码是根：已引导', () => {
    expect(judgeBootstrap(profile, { ...empty, root: { id: 'r', parentId: null }, admin: { id: 'a' } }))
      .toEqual({ result: 'already-bootstrapped', rootOrgUnitId: 'r', adminPersonnelId: 'a' });
  });

  it('两键不全：逐条列出差异', () => {
    expect(judgeBootstrap(profile, { ...empty, root: { id: 'r', parentId: null } })).toEqual({
      result: 'incomplete',
      differences: [{ kind: 'admin-missing', adminCode: 'SJ0001' }],
    });
    expect(judgeBootstrap(profile, { ...empty, admin: { id: 'a' } })).toEqual({
      result: 'incomplete',
      differences: [{ kind: 'root-missing', rootCode: 'ORG-GZ' }],
    });
  });

  it('根机构编码存在但不是根：即使工号也在，仍是两键不全', () => {
    expect(judgeBootstrap(profile, { ...empty, root: { id: 'r', parentId: 'p' }, admin: { id: 'a' } })).toEqual({
      result: 'incomplete',
      differences: [{ kind: 'root-not-root', rootCode: 'ORG-GZ' }],
    });
  });

  it('两键都不在但库非空：拒绝，写明已有多少机构和人员', () => {
    expect(judgeBootstrap(profile, { ...empty, orgUnits: 4, personnel: 12 })).toEqual({
      result: 'incomplete',
      differences: [
        { kind: 'root-missing', rootCode: 'ORG-GZ' },
        { kind: 'admin-missing', adminCode: 'SJ0001' },
        { kind: 'not-empty', orgUnits: 4, personnel: 12 },
      ],
    });
  });
});

describe('引导服务', () => {
  it('空库：先取咨询锁，再建根机构（市）、首个系统管理人员（任职根机构、持系统管理、口令修改时间留空）和两行留痕', async () => {
    const { service, calls, writes, appended } = fixture();
    const outcome = await service.run(request);
    expect(outcome.result).toBe('bootstrapped');
    expect(calls[0]).toBe('lock');
    expect(writes.map(([name]) => name)).toEqual([
      'org_unit',
      'org_unit_name_version',
      'personnel',
      'personnel_name_version',
      'personnel_assignment',
      'personnel_role',
    ]);
    const [, org] = writes[0]!;
    expect(org).toMatchObject({ code: 'ORG-GZ', name: '市局', level: 'city', parentId: null });
    const rootId = org.id;
    const [, person] = writes[2]!;
    expect(person).toMatchObject({
      code: 'SJ0001',
      name: '首个管理',
      orgUnitId: rootId,
      passwordHash: request.passwordHash,
      mobilePhone: '13900000001',
    });
    expect(person).not.toHaveProperty('passwordChangedAt');
    expect(writes[4]![1]).toMatchObject({ orgUnitId: rootId, endedAt: null });
    expect(writes[5]![1]).toMatchObject({ personnelId: person.id, roleId: 'role-admin' });
    expect(appended).toEqual([
      {
        action: 'bootstrap.root-registered',
        actorId: null,
        actorCode: null,
        sourceIp: null,
        orgUnitId: rootId,
        subjectPersonnelId: null,
        subjectCode: null,
        resourceType: 'org-unit',
        resourceId: rootId,
      },
      {
        action: 'bootstrap.admin-registered',
        actorId: null,
        actorCode: null,
        sourceIp: null,
        orgUnitId: rootId,
        subjectPersonnelId: person.id,
        subjectCode: 'SJ0001',
        resourceType: 'personnel',
        resourceId: person.id,
      },
    ]);
    expect(JSON.stringify(appended)).not.toContain(request.passwordHash);
  });

  it('两键都在：已引导，不写行、不写留痕', async () => {
    const { service, writes, appended } = fixture({ root: rootRow, admin: adminRow });
    expect(await service.run(request)).toEqual({
      result: 'already-bootstrapped',
      rootOrgUnitId: 'root',
      adminPersonnelId: 'admin',
    });
    expect(writes).toEqual([]);
    expect(appended).toEqual([]);
  });

  it('两键不全或库非空：拒绝，不写行、不写留痕', async () => {
    for (const state of [
      { root: rootRow },
      { admin: adminRow },
      { root: { ...rootRow, parentId: 'other' }, admin: adminRow },
      { orgUnits: 1, personnel: 0 },
    ] satisfies FakeState[]) {
      const { service, writes, appended } = fixture(state);
      const outcome = await service.run(request);
      expect(outcome.result, JSON.stringify(state)).toBe('incomplete');
      expect(writes).toEqual([]);
      expect(appended).toEqual([]);
    }
  });

  it('参照种子未写入（没有系统管理角色）：报错，提示执行顺序，不写留痕', async () => {
    const { service, appended } = fixture({ roleId: null });
    await expect(service.run(request)).rejects.toBeInstanceOf(BootstrapPrerequisiteError);
    await expect(service.run(request)).rejects.toThrow(/迁移 → 参照种子 → 引导/);
    expect(appended).toEqual([]);
  });

  it('接缝②：取锁之后、读两键之前调用 afterLock', async () => {
    const { service, calls } = fixture();
    await service.run(request, { afterLock: async () => void calls.push('after-lock') });
    expect(calls.slice(0, 3)).toEqual(['lock', 'after-lock', 'find-root']);
  });
});

describe('输入规则', () => {
  const password = 'Boot-strap-27x';

  it('合规输入没有规则码', () => {
    expect(bootstrapInputRules(profile, password)).toEqual([]);
  });

  it('必填、过长、手机号不合规各给规则码', () => {
    expect(bootstrapInputRules(
      { rootCode: '', rootName: 'x'.repeat(101), adminCode: 'A'.repeat(65), adminName: '', adminMobilePhone: '1390000' },
      password,
    )).toEqual([
      'root-code-required',
      'root-name-too-long',
      'admin-code-too-long',
      'admin-name-required',
      'admin-mobile-invalid',
    ]);
  });

  it('口令按口令策略校验，只给规则码，规则码里不含口令本身', () => {
    const weak = 'SJ0001abc';
    const rules = bootstrapInputRules(profile, weak);
    expect(rules).toContain('password-too-short');
    expect(rules).toContain('password-contains-code');
    expect(JSON.stringify(rules)).not.toContain(weak);
  });
});
