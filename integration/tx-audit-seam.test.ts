// #119 事务前置：接缝①（留痕工厂令牌）与拒绝留痕。
// 把留痕工厂覆写为「业务写完后抛错」：A10 解锁、重设初始口令（含结束会话与记住我）、调岗，
// 所涉各表的行一律不变。被拒的 A10 动作在业务回滚后仍写出失败留痕。
// 断言打在 HTTP 状态码、库里的行和留痕行上。
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  prismaAuditTrailFactory,
  runAuditedTransaction,
  type AuditTrailFactory,
} from '@natural-enforcement/audit';

import {
  AccessControlService,
  CredentialService,
  PersonnelService,
  newUlid,
  type IdentityTransaction,
} from '../backend/identity/src/index.ts';
import { PrismaIdentityStore } from '../backend/identity/src/persistence/prisma-identity-store.ts';
import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const MINUTE_MS = 60 * 1000;
const T0 = Date.parse('2026-10-17T02:00:00.000Z');
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Seam-pass-119!';
const ADMIN_PHONE = '13800011901';
const SEAM_ERROR = '接缝①：业务写完后抛错';

/** 接缝①：先照常写下留痕，再抛错。armed 为假时与默认工厂相同。 */
const seam = { armed: false };
const failingFactory: AuditTrailFactory = {
  forClient(client) {
    const real = prismaAuditTrailFactory.forClient(client);
    return {
      async append(entry) {
        await real.append(entry);
        if (seam.armed) throw new Error(SEAM_ERROR);
      },
    };
  },
};

let cloned: ClonedDatabase;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
let passwordHash = '';
let adminRoleId = '';
let deptAId = '';
let deptBId = '';
let adminId = '';

/** 所涉各表的全部行，按主键排序。 */
async function snapshot(): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  const tables = {
    personnel: await cloned.prisma.$queryRaw<Array<{ line: string }>>`
      SELECT row_to_json(t)::text AS line FROM personnel t ORDER BY id`,
    personnel_assignment: await cloned.prisma.$queryRaw<Array<{ line: string }>>`
      SELECT row_to_json(t)::text AS line FROM personnel_assignment t ORDER BY id`,
    auth_session: await cloned.prisma.$queryRaw<Array<{ line: string }>>`
      SELECT row_to_json(t)::text AS line FROM auth_session t ORDER BY id`,
    auth_remember_me: await cloned.prisma.$queryRaw<Array<{ line: string }>>`
      SELECT row_to_json(t)::text AS line FROM auth_remember_me t ORDER BY id`,
    audit_trail: await cloned.prisma.$queryRaw<Array<{ line: string }>>`
      SELECT row_to_json(t)::text AS line FROM audit_trail t ORDER BY id`,
  };
  for (const [name, rows] of Object.entries(tables)) result[name] = rows.map((row) => row.line);
  return result;
}

async function addPerson(input: {
  code: string;
  phone: string;
  orgUnitId: string;
  roleId?: string;
  lockedUntil?: Date;
}): Promise<string> {
  const id = newUlid();
  await cloned.prisma.personnel.create({
    data: {
      id,
      code: input.code,
      name: input.code,
      orgUnitId: input.orgUnitId,
      passwordHash,
      mobilePhone: input.phone,
      passwordChangedAt: new Date(T0 - 10 * 24 * 60 * MINUTE_MS),
      passwordFailureCount: input.lockedUntil ? 5 : 0,
      passwordFailureWindowStartedAt: input.lockedUntil ? new Date(T0) : null,
      lockedUntil: input.lockedUntil ?? null,
    },
  });
  await cloned.prisma.personnelAssignment.create({
    data: { id: newUlid(), personnelId: id, orgUnitId: input.orgUnitId },
  });
  if (input.roleId) {
    await cloned.prisma.personnelRole.create({
      data: { id: newUlid(), personnelId: id, roleId: input.roleId },
    });
  }
  return id;
}

async function login(phone: string, rememberMe = false): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: phone, password: PASSWORD, rememberMe }),
  });
  expect(response.status).toBe(200);
  return response.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
}

function post(path: string, cookie: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  deptAId = (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-A' } })).id;
  deptBId = (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-B' } })).id;
  adminRoleId = (await cloned.prisma.role.findFirstOrThrow({
    where: { name: '系统管理', deactivatedAt: null },
  })).id;
  passwordHash = await hash(PASSWORD, PINNED);
  adminId = await addPerson({ code: 'P-119-ADM', phone: ADMIN_PHONE, orgUnitId: deptAId, roleId: adminRoleId });
  const app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(T0) },
    undefined,
    { auditTrailFactory: failingFactory },
  );
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();
}, 60_000);

afterAll(async () => {
  seam.armed = false;
  await closeApp();
  await cloned?.close();
});

describe('接缝①：留痕工厂覆写为「业务写完后抛错」', () => {
  it('解锁：请求失败，人员、会话、留痕各表的行不变', async () => {
    const lockedId = await addPerson({
      code: 'P-119-LOCKED',
      phone: '13800011911',
      orgUnitId: deptAId,
      lockedUntil: new Date(T0 + 30 * MINUTE_MS),
    });
    const admin = await login(ADMIN_PHONE);
    const before = await snapshot();
    seam.armed = true;
    try {
      const response = await post(`/api/admin/personnel/${lockedId}/unlock`, admin);
      expect(response.status).toBe(500);
    } finally {
      seam.armed = false;
    }
    expect(await snapshot()).toEqual(before);

    // 解除覆写后同一动作照常成功，证明上面的不变来自回滚。
    const retried = await post(`/api/admin/personnel/${lockedId}/unlock`, admin);
    expect(retried.status).toBe(200);
    const row = await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: lockedId } });
    expect(row.lockedUntil).toBeNull();
  });

  it('重设初始口令：口令、锁定、会话、记住我、留痕各表的行不变', async () => {
    const phone = '13800011912';
    const targetId = await addPerson({ code: 'P-119-RESET', phone, orgUnitId: deptAId });
    // 先登录一次，留下一段会话和一条记住我，再让对方进入锁定期。
    const holder = await login(phone, true);
    await cloned.prisma.personnel.update({
      where: { id: targetId },
      data: {
        lockedUntil: new Date(T0 + 30 * MINUTE_MS),
        passwordFailureCount: 5,
        passwordFailureWindowStartedAt: new Date(T0),
      },
    });
    expect(await cloned.prisma.authSession.count({ where: { personnelId: targetId, endedAt: null } })).toBe(1);
    expect(await cloned.prisma.authRememberMe.count({ where: { personnelId: targetId, endedAt: null } })).toBe(1);

    const admin = await login(ADMIN_PHONE);
    const before = await snapshot();
    seam.armed = true;
    try {
      const response = await post(`/api/admin/personnel/${targetId}/password-reset`, admin, {
        password: 'Reset-seam-119!',
      });
      expect(response.status).toBe(500);
    } finally {
      seam.armed = false;
    }
    expect(await snapshot()).toEqual(before);
    const still = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: holder } });
    expect(await still.json()).toMatchObject({ result: 'authenticated', code: 'P-119-RESET' });

    const retried = await post(`/api/admin/personnel/${targetId}/password-reset`, admin, {
      password: 'Reset-seam-119!',
    });
    expect(retried.status).toBe(200);
    expect(await cloned.prisma.authSession.count({ where: { personnelId: targetId, endedAt: null } })).toBe(0);
    expect(await cloned.prisma.authRememberMe.count({ where: { personnelId: targetId, endedAt: null } })).toBe(0);
  });

  it('调岗：并入调用方事务，留痕抛错时任职与人员归属不变', async () => {
    const moverId = await addPerson({ code: 'P-119-MOVER', phone: '13800011913', orgUnitId: deptAId });
    const store = new PrismaIdentityStore(cloned.prisma);
    const access = new AccessControlService(store, prismaAuditTrailFactory.forClient(cloned.prisma));
    const personnel = new PersonnelService(store, access, new CredentialService(store));
    const actor = { personnelId: adminId, authenticated: true };
    const before = await snapshot();
    seam.armed = true;
    try {
      await expect(runAuditedTransaction<IdentityTransaction, void>(
        (body) => store.inTransaction(body),
        (tx) => tx.client,
        failingFactory,
        async (tx, audit) => {
          await personnel.transferPersonnel(actor, moverId, deptBId, tx);
          // 调岗动作词 personnel.transferred 由人员票加入名册。这里借名册内的一行代替。
          await audit.append({
            action: 'account.unlocked',
            actorId: adminId,
            actorCode: 'P-119-ADM',
            subjectPersonnelId: moverId,
            subjectCode: 'P-119-MOVER',
            orgUnitId: deptBId,
            sourceIp: null,
          });
        },
      )).rejects.toThrow(SEAM_ERROR);
    } finally {
      seam.armed = false;
    }
    expect(await snapshot()).toEqual(before);

    await personnel.transferPersonnel(actor, moverId, deptBId);
    const moved = await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: moverId } });
    expect(moved.orgUnitId).toBe(deptBId);
  });
});

describe('拒绝留痕在业务回滚后另起事务写入', () => {
  it('解锁自己被拒：返回 403，写出 authz.denied 失败留痕，人员行不变', async () => {
    const admin = await login(ADMIN_PHONE);
    const before = await snapshot();
    const response = await post(`/api/admin/personnel/${adminId}/unlock`, admin);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    const after = await snapshot();
    expect(after.personnel).toEqual(before.personnel);
    const added = after.audit_trail.filter((line) => !before.audit_trail.includes(line))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(added).toEqual([
      expect.objectContaining({
        action: 'authz.denied',
        outcome: 'failed',
        reason: 'permission-denied',
        actor_id: adminId,
        opcode: 'personnel.locked.release',
        resource_id: adminId,
      }),
    ]);
  });

  it('越权重设被拒：返回 403 scope-denied，写出失败留痕，对方口令与会话不变', async () => {
    const phone = '13800011914';
    const otherId = await addPerson({ code: 'P-119-OTHER', phone, orgUnitId: deptBId });
    const holder = await login(phone);
    const admin = await login(ADMIN_PHONE);
    const before = await snapshot();
    const response = await post(`/api/admin/personnel/${otherId}/password-reset`, admin, {
      password: 'Cross-seam-119!',
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    const after = await snapshot();
    expect(after.personnel).toEqual(before.personnel);
    expect(after.auth_session).toEqual(before.auth_session);
    const added = after.audit_trail.filter((line) => !before.audit_trail.includes(line))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(added).toEqual([
      expect.objectContaining({
        action: 'authz.denied',
        outcome: 'failed',
        reason: 'scope-denied',
        opcode: 'personnel.password.reset',
        resource_id: otherId,
      }),
    ]);
    const still = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: holder } });
    expect(await still.json()).toMatchObject({ result: 'authenticated', code: 'P-119-OTHER' });
  });
});
