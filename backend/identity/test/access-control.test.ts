// 授权服务（#96）：经公共出口观察允许、拒绝和身份上下文。
import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTION_AUTHZ_DENIED,
  type AuditTrailPort,
  type AuthzDeniedEntry,
} from '@natural-enforcement/audit';

import { isAccessDenied, type DenyReason } from '../src/domain/access.ts';
import type { ActorRef } from '../src/domain/actor.ts';
import type { IdentityStore, PersonnelRow } from '../src/persistence/identity-store.ts';
import { OPCODES } from '@natural-enforcement/shield';

import { AccessControlService } from '../src/services/access-control.service.ts';

const CERT = 'CERT-SHOULD-NOT-LEAK';

function person(partial: Partial<PersonnelRow> & Pick<PersonnelRow, 'id' | 'code'>): PersonnelRow {
  return {
    name: partial.code,
    orgUnitId: 'dept-a',
    passwordHash: null,
    enforcementCertNo: null,
    enforcementCertExpiresOn: null,
    deactivatedAt: null,
    ...partial,
  };
}

const people: Record<string, PersonnelRow> = {
  handler: person({
    id: 'handler',
    code: 'P-HANDLER',
    enforcementCertNo: CERT,
    enforcementCertExpiresOn: new Date('2099-12-31T00:00:00.000Z'),
  }),
  expired: person({
    id: 'expired',
    code: 'P-EXPIRED',
    enforcementCertNo: CERT,
    enforcementCertExpiresOn: new Date('2020-01-01T00:00:00.000Z'),
  }),
  boundary: person({
    id: 'boundary',
    code: 'P-BOUNDARY',
    enforcementCertNo: CERT,
    enforcementCertExpiresOn: new Date('2026-10-16T00:00:00.000Z'),
  }),
  today: person({
    id: 'today',
    code: 'P-TODAY',
    enforcementCertNo: CERT,
    enforcementCertExpiresOn: new Date('2026-10-17T00:00:00.000Z'),
  }),
  blank: person({ id: 'blank', code: 'P-BLANK', enforcementCertNo: '   ' }),
  supervisor: person({ id: 'supervisor', code: 'P-SUPER' }),
  both: person({ id: 'both', code: 'P-BOTH' }),
  ghost: person({ id: 'ghost', code: 'P-GHOST', deactivatedAt: new Date('2026-01-01T00:00:00.000Z') }),
  noorg: person({ id: 'noorg', code: 'P-NOORG' }),
};

const grants: Record<string, Record<string, string[]>> = {
  handler: { 'clue.read': ['经办'], 'clue.verify.start': ['经办'], 'case.open': ['经办'] },
  expired: { 'clue.verify.start': ['经办'], 'clue.read': ['经办'] },
  boundary: { 'clue.read': ['经办'] },
  today: { 'clue.read': ['经办'] },
  blank: { 'clue.read': ['经办'] },
  supervisor: { 'clue.read': ['监督'], 'case.open': ['监督'] },
  both: { 'clue.read': ['经办', '监督'], 'case.open': ['经办', '监督'] },
  ghost: { 'clue.read': ['经办'] },
  noorg: { 'clue.read': ['经办'] },
};

const roles: Record<string, string[]> = {
  handler: ['经办'],
  expired: ['经办'],
  boundary: ['经办'],
  today: ['经办'],
  blank: ['经办'],
  supervisor: ['监督'],
  both: ['经办', '监督'],
  ghost: ['经办'],
  noorg: ['经办'],
};

const paths: Record<string, string[]> = {
  hq: ['hq'],
  'dept-a': ['hq', 'dept-a'],
  'dept-b': ['hq', 'dept-b'],
  station: ['hq', 'dept-a', 'station'],
};

const subtrees: Record<string, string[]> = {
  hq: ['hq', 'dept-a', 'dept-b', 'station'],
  'dept-a': ['dept-a', 'station'],
  'dept-b': ['dept-b'],
  station: ['station'],
};

function store(): IdentityStore {
  return {
    findPersonnelById: async (id) => people[id] ?? null,
    findCurrentAssignment: async (personnelId) => {
      if (personnelId === 'noorg' || !people[personnelId]) return null;
      return {
        id: `asg-${personnelId}`,
        personnelId,
        orgUnitId: 'dept-a',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        endedAt: null,
      };
    },
    findOrgUnitPathToRoot: async (orgUnitId) => paths[orgUnitId] ?? [],
    listOrgUnitSubtreeIds: async (orgUnitId) => subtrees[orgUnitId] ?? [],
    listActiveRoleNames: async (personnelId) => roles[personnelId] ?? [],
    listGrantingRoleNames: async (personnelId, opcode) => grants[personnelId]?.[opcode] ?? [],
    listGrantedOpcodes: async (personnelId) =>
      Object.entries(grants[personnelId] ?? {}).flatMap(([opcode, names]) =>
        names.map((roleName) => ({ opcode, roleName }))),
  } as IdentityStore;
}

function recorder(): { port: AuditTrailPort; rows: AuthzDeniedEntry[] } {
  const rows: AuthzDeniedEntry[] = [];
  return {
    rows,
    port: {
      append: async (entry) => {
        if (entry.action !== AUDIT_ACTION_AUTHZ_DENIED || !('outcome' in entry)) {
          throw new Error('授权测试只记录授权拒绝');
        }
        rows.push(entry);
      },
    },
  };
}

const auth = (personnelId: string): ActorRef => ({ personnelId, authenticated: true });

async function expectDenied(
  promise: Promise<unknown>,
  reason: DenyReason,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (!isAccessDenied(error)) {
      throw new Error(`校验缺失形态：裸异常（期望 reason=${reason}）：${String(error)}`);
    }
    expect(error.reason).toBe(reason);
    return;
  }
  throw new Error(`校验缺失形态：越权调用未抛 AccessDeniedError（期望 reason=${reason}）`);
}

describe('按操作码授权', () => {
  it('名册外的操作码按 permission-denied 拒绝，并写下操作码和原因', async () => {
    const recorded = recorder();
    const access = new AccessControlService(store(), recorded.port);
    await expectDenied(
      access.authorize(auth('handler'), 'menu.visible', 'dept-a', {
        resourceType: 'menu',
        resourceId: 'button-1',
      }),
      'permission-denied',
    );
    expect(recorded.rows).toEqual([
      {
        action: AUDIT_ACTION_AUTHZ_DENIED,
        outcome: 'failed',
        actorId: 'handler',
        actorCode: 'P-HANDLER',
        subjectPersonnelId: null,
        subjectCode: null,
        orgUnitId: 'dept-a',
        sourceIp: null,
        reason: 'permission-denied',
        opcode: 'menu.visible',
        resourceType: 'menu',
        resourceId: 'button-1',
        previousValue: null,
      },
    ]);
  });

  it('未知人员按 identity-unknown 拒绝，操作者为空', async () => {
    const recorded = recorder();
    const access = new AccessControlService(store(), recorded.port);
    await expectDenied(
      access.authorize(auth('missing'), 'clue.read', 'dept-a', { resourceId: 'r1' }),
      'identity-unknown',
    );
    expect(recorded.rows[0]).toMatchObject({
      reason: 'identity-unknown',
      actorId: null,
      actorCode: null,
      orgUnitId: null,
      opcode: 'clue.read',
      resourceId: 'r1',
    });
  });

  it('未认证先于权限拒绝', async () => {
    const access = new AccessControlService(store(), recorder().port);
    await expectDenied(
      access.authorize({ personnelId: 'handler', authenticated: false }, 'not-an-opcode', 'dept-a'),
      'not-authenticated',
    );
  });

  it('已失效先于权限拒绝', async () => {
    const access = new AccessControlService(store(), recorder().port);
    await expectDenied(access.authorize(auth('ghost'), 'not-an-opcode', 'dept-a'), 'identity-deactivated');
  });

  it('区人员读其他区得 scope-denied', async () => {
    const recorded = recorder();
    const access = new AccessControlService(store(), recorded.port);
    await expectDenied(
      access.authorize(auth('handler'), 'clue.read', 'dept-b', { resourceType: 'clue', resourceId: 'c1' }),
      'scope-denied',
    );
    expect(recorded.rows[0]).toMatchObject({
      reason: 'scope-denied',
      opcode: 'clue.read',
      resourceType: 'clue',
      resourceId: 'c1',
      orgUnitId: 'dept-a',
    });
  });

  it('没有当前任职时数据范围为空，授权按 scope-denied 拒绝', async () => {
    const access = new AccessControlService(store(), recorder().port);
    expect(await access.listDataScopeOrgUnitIds('noorg')).toEqual([]);
    await expectDenied(access.authorize(auth('noorg'), 'clue.read', 'dept-a'), 'scope-denied');
  });

  it('数据范围含当前任职及其下级，不含兄弟机构', async () => {
    const access = new AccessControlService(store(), recorder().port);
    expect(await access.listDataScopeOrgUnitIds('handler')).toEqual(['dept-a', 'station']);
  });

  it('放行不写授权拒绝', async () => {
    const recorded = recorder();
    const access = new AccessControlService(store(), recorded.port);
    const context = await access.authorize(auth('handler'), 'clue.read', 'dept-a');
    expect(context.personnelId).toBe('handler');
    expect(context.orgUnitId).toBe('dept-a');
    expect(context.roles).toEqual(['经办']);
    expect(recorded.rows).toEqual([]);
  });

  it('执法证过期仍可放行，上下文报告没有执法资格，且不交出证号', async () => {
    const access = new AccessControlService(store(), recorder().port);
    const context = await access.authorize(auth('expired'), 'clue.verify.start', 'dept-a');
    expect(context.hasEnforcementQualification).toBe(false);
    expect(JSON.stringify(context)).not.toContain(CERT);
    expect(Object.keys(context).sort()).toEqual([
      'hasEnforcementQualification',
      'orgUnitId',
      'personnelId',
      'roles',
    ]);
  });

  it('有效期等于 Asia/Shanghai 的今天仍有资格，拨到昨天则没有', async () => {
    const atBoundary = new AccessControlService(store(), recorder().port, {
      now: () => new Date('2026-10-16T16:30:00.000Z'),
    });
    const expiredYesterday = await atBoundary.authorize(auth('boundary'), 'clue.read', 'dept-a');
    expect(expiredYesterday.hasEnforcementQualification).toBe(false);
    const stillToday = await atBoundary.authorize(auth('today'), 'clue.read', 'dept-a');
    expect(stillToday.hasEnforcementQualification).toBe(true);
    const nextShanghaiDay = new AccessControlService(store(), recorder().port, {
      now: () => new Date('2026-10-17T16:30:00.000Z'),
    });
    const rolled = await nextShanghaiDay.authorize(auth('today'), 'clue.read', 'dept-a');
    expect(rolled.hasEnforcementQualification).toBe(false);
  });

  it('证号为空白则没有执法资格', async () => {
    const access = new AccessControlService(store(), recorder().port);
    const context = await access.authorize(auth('blank'), 'clue.read', 'dept-a');
    expect(context.hasEnforcementQualification).toBe(false);
  });

  it('监督角色即使挂上改变主状态的允许行，授权仍得 permission-denied', async () => {
    const access = new AccessControlService(store(), recorder().port);
    await expectDenied(access.authorize(auth('supervisor'), 'case.open', 'dept-a'), 'permission-denied');
  });

  it('同一人兼任经办时，改变主状态的操作码仍然放行', async () => {
    const access = new AccessControlService(store(), recorder().port);
    const context = await access.authorize(auth('both'), 'case.open', 'dept-a');
    expect(context.roles).toEqual(['监督', '经办']);
  });

  it('监督的阅读允许行仍然有效', async () => {
    const access = new AccessControlService(store(), recorder().port);
    await expect(access.authorize(auth('supervisor'), 'clue.read', 'dept-a')).resolves.toMatchObject({
      personnelId: 'supervisor',
    });
  });
});

describe('本人允许的操作码清单（#105 菜单来源）', () => {
  it('只列本人角色能放行的名册内操作码，顺序同名册', async () => {
    const access = new AccessControlService(store(), recorder().port);
    expect(await access.listPermittedOpcodes('handler')).toEqual(
      OPCODES.filter((code) => ['clue.read', 'clue.verify.start', 'case.open'].includes(code)),
    );
  });

  it('监督对改变主状态的码不进清单；兼任经办时由经办贡献', async () => {
    const access = new AccessControlService(store(), recorder().port);
    expect(await access.listPermittedOpcodes('supervisor')).toEqual(['clue.read']);
    expect(await access.listPermittedOpcodes('both')).toEqual(
      OPCODES.filter((code) => ['clue.read', 'case.open'].includes(code)),
    );
  });

  it('未知人员、已停用人员、没有生效任职的人员清单为空', async () => {
    const access = new AccessControlService(store(), recorder().port);
    expect(await access.listPermittedOpcodes('missing')).toEqual([]);
    expect(await access.listPermittedOpcodes('ghost')).toEqual([]);
    expect(await access.listPermittedOpcodes('noorg')).toEqual([]);
  });

  it('名册外的码即使有允许行也不进清单', async () => {
    const base = store();
    const access = new AccessControlService(
      {
        ...base,
        listGrantedOpcodes: async () => [{ opcode: 'menu.visible', roleName: '经办' }],
      } as IdentityStore,
      recorder().port,
    );
    expect(await access.listPermittedOpcodes('handler')).toEqual([]);
  });

  it('等价性：清单有这个码，当且仅当对本人任职机构授权能通过；查清单不写留痕', async () => {
    for (const personnelId of [...Object.keys(people), 'missing']) {
      const listed = recorder();
      const permitted = await new AccessControlService(store(), listed.port).listPermittedOpcodes(personnelId);
      expect(listed.rows).toEqual([]);
      for (const opcode of OPCODES) {
        const access = new AccessControlService(store(), recorder().port);
        const passed = await access.authorize(auth(personnelId), opcode, 'dept-a').then(
          () => true,
          (error: unknown) => {
            if (!isAccessDenied(error)) throw error;
            return false;
          },
        );
        expect({ personnelId, opcode, listed: permitted.includes(opcode) })
          .toEqual({ personnelId, opcode, listed: passed });
      }
    }
  });
});
