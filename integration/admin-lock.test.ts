// #102：被锁列表、解锁、重设初始口令。
// 断言打在 HTTP 状态码、结果码、列表字段、留痕行和会话是否结束上。
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const MINUTE_MS = 60 * 1000;
const T0 = Date.parse('2026-10-17T02:00:00.000Z');
const clock = { millis: T0 };
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Admin-pass-102!';
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function newUlid(): string {
  let time = BigInt(Date.now());
  let id = '';
  for (let i = 0; i < 10; i += 1) {
    id = CROCKFORD[Number(time % 32n)] + id;
    time /= 32n;
  }
  const random = crypto.getRandomValues(new Uint8Array(16));
  for (const byte of random) id += CROCKFORD[byte % 32];
  if (!ULID.test(id)) throw new Error('ULID 生成结果不符合形制');
  return id;
}

let cloned: ClonedDatabase;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
let passwordHash = '';
let adminRoleId = '';
let deptAId = '';
let adminAId = '';
let lockedAId = '';
let lockedStationId = '';
let lockedNoneId = '';

const ADMIN_A_PHONE = '13800010201';
const ADMIN_ROOT_PHONE = '13800010202';
const LOCKED_A_PHONE = '13800010211';
const LOCKED_STATION_PHONE = '13800010212';
const LOCKED_B_PHONE = '13800010213';
const EXPIRED_PHONE = '13800010214';
const EDGE_PHONE = '13800010215';
const FREE_PHONE = '13800010216';
const NONE_PHONE = '13800010219';
const LOCKED_A_CERT = 'CERT-102-A';
const LOCKED_STATION_CERT = 'CERT-102-S';
const NONE_CERT = 'CERT-102-N';
const HOLD_PHONE = '13800010231';
const WRONG = 'wrong-password';
const FAIL_IP = '203.0.113.102';
const ADMIN_IP = '203.0.113.201';

type AuditRecord = {
  id: string;
  action: string;
  outcome: string;
  reason: string | null;
  actor_id: string | null;
  actor_code: string | null;
  subject_personnel_id: string | null;
  subject_code: string | null;
  org_unit_id: string | null;
  source_ip: string | null;
  opcode: string | null;
};

async function audits(): Promise<AuditRecord[]> {
  return cloned.prisma.$queryRaw<AuditRecord[]>`
    SELECT id, action, outcome, reason, actor_id, actor_code,
           subject_personnel_id, subject_code, org_unit_id, source_ip, opcode
    FROM audit_trail
    ORDER BY created_at, id
  `;
}

function added(before: AuditRecord[], after: AuditRecord[]): AuditRecord[] {
  const known = new Set(before.map((row) => row.id));
  return after.filter((row) => !known.has(row.id));
}

function cookiePair(response: Response): string {
  const sid = response.headers.getSetCookie().filter((item) => item.startsWith('__Host-sid='));
  expect(sid).toHaveLength(1);
  const pair = sid[0]?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

function postLogin(mobilePhone: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone, password: PASSWORD, rememberMe: false }),
  });
}

async function addPerson(input: {
  code: string;
  name: string;
  phone: string;
  orgUnitId: string;
  roleId?: string;
  lockedUntil?: Date | null;
  certNo?: string;
  assign?: boolean;
}): Promise<string> {
  const id = newUlid();
  await cloned.prisma.personnel.create({
    data: {
      id,
      code: input.code,
      name: input.name,
      orgUnitId: input.orgUnitId,
      passwordHash,
      mobilePhone: input.phone,
      passwordChangedAt: new Date(T0 - 10 * 24 * 60 * MINUTE_MS),
      passwordFailureCount: input.lockedUntil ? 5 : 0,
      passwordFailureWindowStartedAt: input.lockedUntil ? new Date(T0) : null,
      lockedUntil: input.lockedUntil ?? null,
      enforcementCertNo: input.certNo ?? null,
    },
  });
  if (input.assign !== false) {
    await cloned.prisma.personnelAssignment.create({
      data: { id: newUlid(), personnelId: id, orgUnitId: input.orgUnitId },
    });
  }
  if (input.roleId) {
    await cloned.prisma.personnelRole.create({
      data: { id: newUlid(), personnelId: id, roleId: input.roleId },
    });
  }
  return id;
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const root = await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-HQ' } });
  const deptA = await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-A' } });
  deptAId = deptA.id;
  const deptB = await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-B' } });
  const station = await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-STATION-A' } });
  const role = await cloned.prisma.role.findFirstOrThrow({
    where: { name: '系统管理', deactivatedAt: null },
  });
  adminRoleId = role.id;
  passwordHash = await hash(PASSWORD, PINNED);
  await addPerson({
    code: 'P-102-ADM-ROOT',
    name: '市局管理',
    phone: ADMIN_ROOT_PHONE,
    orgUnitId: root.id,
    roleId: adminRoleId,
  });
  adminAId = await addPerson({
    code: 'P-102-ADM-A',
    name: '甲区管理',
    phone: ADMIN_A_PHONE,
    orgUnitId: deptA.id,
    roleId: adminRoleId,
  });
  lockedAId = await addPerson({
    code: 'P-102-A',
    name: '甲被锁',
    phone: LOCKED_A_PHONE,
    orgUnitId: deptA.id,
    lockedUntil: new Date(T0 + 30 * MINUTE_MS),
    certNo: LOCKED_A_CERT,
  });
  lockedStationId = await addPerson({
    code: 'P-102-STA',
    name: '所被锁',
    phone: LOCKED_STATION_PHONE,
    orgUnitId: station.id,
    lockedUntil: new Date(T0 + 60 * MINUTE_MS),
    certNo: LOCKED_STATION_CERT,
  });
  await addPerson({
    code: 'P-102-B',
    name: '乙被锁',
    phone: LOCKED_B_PHONE,
    orgUnitId: deptB.id,
    lockedUntil: new Date(T0 + 30 * MINUTE_MS),
  });
  await addPerson({
    code: 'P-102-EXP',
    name: '已到期',
    phone: EXPIRED_PHONE,
    orgUnitId: deptA.id,
    lockedUntil: new Date(T0 - 1),
  });
  await addPerson({
    code: 'P-102-EDGE',
    name: '刚到期',
    phone: EDGE_PHONE,
    orgUnitId: deptA.id,
    lockedUntil: new Date(T0),
  });
  await addPerson({
    code: 'P-102-FREE',
    name: '未锁定',
    phone: FREE_PHONE,
    orgUnitId: deptA.id,
  });
  lockedNoneId = await addPerson({
    code: 'P-102-NONE',
    name: '无任职',
    phone: NONE_PHONE,
    orgUnitId: deptA.id,
    lockedUntil: new Date(T0 + 30 * MINUTE_MS),
    certNo: NONE_CERT,
    assign: false,
  });
  const app = await createApplication(cloned.connectionString, { now: () => new Date(clock.millis) });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();
}, 60_000);

afterAll(async () => {
  await closeApp();
  await cloned?.close();
});

describe('GET /api/admin/locked-personnel', () => {
  it('区系统管理只看到本区尚未到期的被锁人员，字段不含手机号和执法证号', async () => {
    const login = await postLogin(ADMIN_A_PHONE);
    expect(login.status).toBe(200);
    const response = await fetch(`${baseUrl}/api/admin/locked-personnel`, {
      headers: { cookie: cookiePair(login) },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      result: string;
      personnel: Array<Record<string, unknown>>;
    };
    expect(body.result).toBe('listed');
    expect(body.personnel).toHaveLength(2);
    expect(body.personnel).toEqual(expect.arrayContaining([
      {
        id: lockedAId,
        code: 'P-102-A',
        name: '甲被锁',
        orgName: '第一执法支队',
        lockedUntil: new Date(T0 + 30 * MINUTE_MS).toISOString(),
      },
      {
        id: lockedStationId,
        code: 'P-102-STA',
        name: '所被锁',
        orgName: '甲区执法所',
        lockedUntil: new Date(T0 + 60 * MINUTE_MS).toISOString(),
      },
    ]));
    for (const row of body.personnel) {
      expect(Object.keys(row).sort()).toEqual(['code', 'id', 'lockedUntil', 'name', 'orgName']);
    }
    const text = JSON.stringify(body);
    expect(text).not.toContain(LOCKED_A_PHONE);
    expect(text).not.toContain(LOCKED_STATION_PHONE);
    expect(text).not.toContain(NONE_PHONE);
    expect(text).not.toContain(LOCKED_A_CERT);
    expect(text).not.toContain(LOCKED_STATION_CERT);
    expect(text).not.toContain(NONE_CERT);
    expect(text).not.toContain(adminAId);
  });

  it('没有当前任职的被锁人员只出现在根机构系统管理的列表里，机构名为空', async () => {
    const login = await postLogin(ADMIN_ROOT_PHONE);
    expect(login.status).toBe(200);
    const response = await fetch(`${baseUrl}/api/admin/locked-personnel`, {
      headers: { cookie: cookiePair(login) },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      result: string;
      personnel: Array<{
        id: string;
        code: string;
        name: string;
        orgName: string | null;
        lockedUntil: string;
      }>;
    };
    expect(body.result).toBe('listed');
    const none = body.personnel.find((row) => row.id === lockedNoneId);
    expect(none).toEqual({
      id: lockedNoneId,
      code: 'P-102-NONE',
      name: '无任职',
      orgName: null,
      lockedUntil: new Date(T0 + 30 * MINUTE_MS).toISOString(),
    });
    expect(body.personnel.map((row) => row.code).sort()).toEqual([
      'P-102-A',
      'P-102-B',
      'P-102-NONE',
      'P-102-STA',
    ]);
    expect(JSON.stringify(body)).not.toContain(NONE_PHONE);
    expect(JSON.stringify(body)).not.toContain(NONE_CERT);
  });
});

describe('POST /api/admin/personnel/:id/unlock', () => {
  it('解锁清零失败次数和锁定到期，写下 account.unlocked，不结束已有会话', async () => {
    const holderId = await addPerson({
      code: 'P-102-HOLD',
      name: '待解锁',
      phone: HOLD_PHONE,
      orgUnitId: deptAId,
    });
    const entered = await postLogin(HOLD_PHONE);
    expect(entered.status).toBe(200);
    const holderCookie = cookiePair(entered);
    for (let i = 0; i < 4; i += 1) {
      const wrong = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': FAIL_IP },
        body: JSON.stringify({ mobilePhone: HOLD_PHONE, password: WRONG, rememberMe: false }),
      });
      expect(wrong.status).toBe(401);
      expect(await wrong.json()).toEqual({ result: 'invalid-credential' });
    }
    const fifth = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': FAIL_IP },
      body: JSON.stringify({ mobilePhone: HOLD_PHONE, password: WRONG, rememberMe: false }),
    });
    expect(fifth.status).toBe(401);
    expect(await fifth.json()).toEqual({ result: 'locked' });

    const admin = await postLogin(ADMIN_A_PHONE);
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/admin/personnel/${holderId}/unlock`, {
      method: 'POST',
      headers: { cookie: cookiePair(admin), 'x-forwarded-for': ADMIN_IP },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'unlocked' });
    const rows = added(before, await audits());
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'account.unlocked',
        outcome: 'succeeded',
        reason: null,
        actor_id: adminAId,
        actor_code: 'P-102-ADM-A',
        subject_personnel_id: holderId,
        subject_code: 'P-102-HOLD',
        org_unit_id: deptAId,
        source_ip: ADMIN_IP,
      }),
    ]);

    const still = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: holderCookie } });
    expect(still.status).toBe(200);
    expect(await still.json()).toMatchObject({ result: 'authenticated', code: 'P-102-HOLD' });

    const list = await fetch(`${baseUrl}/api/admin/locked-personnel`, {
      headers: { cookie: cookiePair(admin) },
    });
    const listed = await list.json() as { personnel: Array<{ id: string }> };
    expect(listed.personnel.some((row) => row.id === holderId)).toBe(false);

    const again = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': FAIL_IP },
      body: JSON.stringify({ mobilePhone: HOLD_PHONE, password: WRONG, rememberMe: false }),
    });
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ result: 'invalid-credential' });
  });

  it('系统管理不能解锁自己，按 permission-denied 拒绝并留下授权拒绝留痕', async () => {
    const admin = await postLogin(ADMIN_A_PHONE);
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/admin/personnel/${adminAId}/unlock`, {
      method: 'POST',
      headers: { cookie: cookiePair(admin), 'x-forwarded-for': ADMIN_IP },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    const rows = added(before, await audits());
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'authz.denied',
        outcome: 'failed',
        reason: 'permission-denied',
        actor_id: adminAId,
        actor_code: 'P-102-ADM-A',
        org_unit_id: deptAId,
        opcode: 'personnel.locked.release',
      }),
    ]);
  });

  it('区系统管理解锁其他区的人员时按 scope-denied 拒绝', async () => {
    const other = await cloned.prisma.personnel.findUniqueOrThrow({ where: { code: 'P-102-B' } });
    const admin = await postLogin(ADMIN_A_PHONE);
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/admin/personnel/${other.id}/unlock`, {
      method: 'POST',
      headers: { cookie: cookiePair(admin), 'x-forwarded-for': ADMIN_IP },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    const rows = added(before, await audits());
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'authz.denied',
        outcome: 'failed',
        reason: 'scope-denied',
        actor_id: adminAId,
        actor_code: 'P-102-ADM-A',
        opcode: 'personnel.locked.release',
      }),
    ]);
    const still = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobilePhone: LOCKED_B_PHONE, password: PASSWORD, rememberMe: false }),
    });
    expect(still.status).toBe(401);
    expect(await still.json()).toEqual({ result: 'locked' });
  });

  it('没有当前任职的人员只有根上的系统管理能解锁，区系统管理得到 scope-denied', async () => {
    const none = await cloned.prisma.personnel.findUniqueOrThrow({ where: { code: 'P-102-NONE' } });
    const district = await postLogin(ADMIN_A_PHONE);
    const deniedBefore = await audits();
    const denied = await fetch(`${baseUrl}/api/admin/personnel/${none.id}/unlock`, {
      method: 'POST',
      headers: { cookie: cookiePair(district) },
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ reason: 'scope-denied' });
    expect(added(deniedBefore, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied',
        reason: 'scope-denied',
        actor_code: 'P-102-ADM-A',
        opcode: 'personnel.locked.release',
      }),
    ]);

    const rootAdmin = await cloned.prisma.personnel.findUniqueOrThrow({ where: { code: 'P-102-ADM-ROOT' } });
    const root = await postLogin(ADMIN_ROOT_PHONE);
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/admin/personnel/${none.id}/unlock`, {
      method: 'POST',
      headers: { cookie: cookiePair(root), 'x-forwarded-for': ADMIN_IP },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'unlocked' });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'account.unlocked',
        outcome: 'succeeded',
        actor_id: rootAdmin.id,
        actor_code: 'P-102-ADM-ROOT',
        subject_personnel_id: none.id,
        subject_code: 'P-102-NONE',
        org_unit_id: null,
        source_ip: ADMIN_IP,
      }),
    ]);
    const entered = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobilePhone: NONE_PHONE, password: PASSWORD, rememberMe: false }),
    });
    expect(entered.status).toBe(200);
    expect(await entered.json()).toEqual({ result: 'established' });
  });

  it('不持有解锁操作码的人员被拒绝，并写下 authz.denied', async () => {
    const clerkRole = await cloned.prisma.role.findFirstOrThrow({
      where: { name: '经办', deactivatedAt: null },
    });
    const clerkId = await addPerson({
      code: 'P-102-CLERK',
      name: '甲经办',
      phone: '13800010241',
      orgUnitId: deptAId,
      roleId: clerkRole.id,
    });
    const target = await cloned.prisma.personnel.findUniqueOrThrow({ where: { code: 'P-102-A' } });
    const clerk = await postLogin('13800010241');
    expect(clerk.status).toBe(200);
    const cookie = cookiePair(clerk);
    const before = await audits();
    const listed = await fetch(`${baseUrl}/api/admin/locked-personnel`, { headers: { cookie } });
    expect(listed.status).toBe(403);
    expect(await listed.json()).toEqual({ reason: 'permission-denied' });
    const response = await fetch(`${baseUrl}/api/admin/personnel/${target.id}/unlock`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(added(before, await audits()).map((row) => [row.action, row.reason, row.opcode, row.actor_code])).toEqual([
      ['authz.denied', 'permission-denied', 'personnel.locked.read', 'P-102-CLERK'],
      ['authz.denied', 'permission-denied', 'personnel.locked.release', 'P-102-CLERK'],
    ]);
    expect(added(before, await audits())[1]).toMatchObject({ actor_id: clerkId });
  });
});

describe('POST /api/admin/personnel/:id/password-reset', () => {
  it('重设初始口令后上次改密时间为空，锁定解除，会话和记住我都结束', async () => {
    const personId = await addPerson({
      code: 'P-102-RST',
      name: '待重设',
      phone: '13800010251',
      orgUnitId: deptAId,
    });
    const first = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobilePhone: '13800010251', password: PASSWORD, rememberMe: true }),
    });
    expect(first.status).toBe(200);
    const sid = cookiePair(first);
    const rm = first.headers.getSetCookie().find((item) => item.startsWith('__Host-rm='));
    if (!rm) throw new Error('缺少记住我 Cookie');
    const remember = rm.split(';')[0] ?? '';
    const second = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobilePhone: '13800010251', password: PASSWORD, rememberMe: false }),
    });
    expect(second.status).toBe(200);
    const sid2 = cookiePair(second);
    for (let i = 0; i < 5; i += 1) {
      await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.151' },
        body: JSON.stringify({ mobilePhone: '13800010251', password: WRONG, rememberMe: false }),
      });
    }
    const admin = await postLogin(ADMIN_A_PHONE);
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/admin/personnel/${personId}/password-reset`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookiePair(admin),
        'x-forwarded-for': ADMIN_IP,
      },
      body: JSON.stringify({ password: 'Reset-pass-102!' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'reset' });
    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['account.password-reset', 'succeeded', null],
      ['account.unlocked', 'succeeded', null],
      ['session.ended', 'succeeded', 'admin-ended'],
      ['session.ended', 'succeeded', 'admin-ended'],
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({
        actor_id: adminAId,
        actor_code: 'P-102-ADM-A',
        subject_personnel_id: personId,
        subject_code: 'P-102-RST',
        org_unit_id: deptAId,
        source_ip: ADMIN_IP,
      });
    }
    const oldSession = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: sid },
    });
    expect(oldSession.status).toBe(401);
    const otherSession = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: sid2 },
    });
    expect(otherSession.status).toBe(401);
    const remembered = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: remember } });
    expect(remembered.status).toBe(200);
    expect(await remembered.json()).toEqual({ result: 'anonymous' });
    const next = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.152' },
      body: JSON.stringify({ mobilePhone: '13800010251', password: 'Reset-pass-102!', rememberMe: false }),
    });
    expect(next.status).toBe(200);
    expect(await next.json()).toEqual({ result: 'password-change-required' });
    const oldPassword = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.153' },
      body: JSON.stringify({ mobilePhone: '13800010251', password: PASSWORD, rememberMe: false }),
    });
    expect(oldPassword.status).toBe(401);
    expect(await oldPassword.json()).toEqual({ result: 'invalid-credential' });
  });

  it('初始口令按对方工号判断，含对方工号则拒绝且不结束会话', async () => {
    const personId = await addPerson({
      code: 'P-102-CODE',
      name: '工号口令',
      phone: '13800010261',
      orgUnitId: deptAId,
    });
    const entered = await postLogin('13800010261');
    const sid = cookiePair(entered);
    const admin = await postLogin(ADMIN_A_PHONE);
    const before = await audits();
    const rejected = await fetch(`${baseUrl}/api/admin/personnel/${personId}/password-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookiePair(admin) },
      body: JSON.stringify({ password: 'p-102-code-Zz9!' }),
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ result: 'non-compliant', rules: ['contains-code'] });
    expect(added(before, await audits())).toEqual([]);
    const still = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: sid } });
    expect(await still.json()).toMatchObject({ result: 'authenticated', code: 'P-102-CODE' });

    const accepted = await fetch(`${baseUrl}/api/admin/personnel/${personId}/password-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookiePair(admin) },
      body: JSON.stringify({ password: 'P-102-ADM-A-z!' }),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ result: 'reset' });
  });

  it('对方不在锁定期时重设不写 account.unlocked', async () => {
    const personId = await addPerson({
      code: 'P-102-OPEN',
      name: '未锁重设',
      phone: '13800010262',
      orgUnitId: deptAId,
      lockedUntil: new Date(T0),
    });
    const admin = await postLogin(ADMIN_A_PHONE);
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/admin/personnel/${personId}/password-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookiePair(admin) },
      body: JSON.stringify({ password: 'Open-pass-102!' }),
    });
    expect(response.status).toBe(200);
    expect(added(before, await audits()).map((row) => row.action)).toEqual(['account.password-reset']);
    const next = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.162' },
      body: JSON.stringify({ mobilePhone: '13800010262', password: 'Open-pass-102!', rememberMe: false }),
    });
    expect(next.status).toBe(200);
    expect(await next.json()).toEqual({ result: 'password-change-required' });
  });

  it('不能给自己重设口令，其他区得到 scope-denied', async () => {
    const admin = await postLogin(ADMIN_A_PHONE);
    const cookie = cookiePair(admin);
    const selfBefore = await audits();
    const self = await fetch(`${baseUrl}/api/admin/personnel/${adminAId}/password-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ password: 'Self-pass-102!' }),
    });
    expect(self.status).toBe(403);
    expect(await self.json()).toEqual({ reason: 'permission-denied' });
    expect(added(selfBefore, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied',
        reason: 'permission-denied',
        opcode: 'personnel.password.reset',
        actor_code: 'P-102-ADM-A',
      }),
    ]);
    const other = await cloned.prisma.personnel.findUniqueOrThrow({ where: { code: 'P-102-B' } });
    const cross = await fetch(`${baseUrl}/api/admin/personnel/${other.id}/password-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ password: 'Cross-pass-102!' }),
    });
    expect(cross.status).toBe(403);
    expect(await cross.json()).toEqual({ reason: 'scope-denied' });
    const still = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.163' },
      body: JSON.stringify({ mobilePhone: LOCKED_B_PHONE, password: PASSWORD, rememberMe: false }),
    });
    expect(still.status).toBe(401);
    expect(await still.json()).toEqual({ result: 'locked' });
  });

  it('没有当前任职的人员只有根上的系统管理能重设口令', async () => {
    const personId = await addPerson({
      code: 'P-102-BARE',
      name: '无任职重设',
      phone: '13800010263',
      orgUnitId: deptAId,
      assign: false,
      lockedUntil: new Date(T0 + 30 * MINUTE_MS),
    });
    const district = await postLogin(ADMIN_A_PHONE);
    const denied = await fetch(`${baseUrl}/api/admin/personnel/${personId}/password-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookiePair(district) },
      body: JSON.stringify({ password: 'Bare-pass-102!' }),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ reason: 'scope-denied' });
    const rootAdmin = await cloned.prisma.personnel.findUniqueOrThrow({ where: { code: 'P-102-ADM-ROOT' } });
    const root = await postLogin(ADMIN_ROOT_PHONE);
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/admin/personnel/${personId}/password-reset`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookiePair(root),
        'x-forwarded-for': ADMIN_IP,
      },
      body: JSON.stringify({ password: 'Bare-pass-102!' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'reset' });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'account.password-reset',
        actor_id: rootAdmin.id,
        subject_code: 'P-102-BARE',
        org_unit_id: null,
      }),
      expect.objectContaining({
        action: 'account.unlocked',
        actor_id: rootAdmin.id,
        subject_personnel_id: personId,
        org_unit_id: null,
      }),
    ]);
  });

  it('不持有重设操作码的人员被拒绝，并写下 authz.denied', async () => {
    const clerkRole = await cloned.prisma.role.findFirstOrThrow({
      where: { name: '经办', deactivatedAt: null },
    });
    const clerkId = await addPerson({
      code: 'P-102-CLERK2',
      name: '乙经办',
      phone: '13800010264',
      orgUnitId: deptAId,
      roleId: clerkRole.id,
    });
    const target = await cloned.prisma.personnel.findUniqueOrThrow({ where: { code: 'P-102-A' } });
    const clerk = await postLogin('13800010264');
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/admin/personnel/${target.id}/password-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookiePair(clerk) },
      body: JSON.stringify({ password: 'Clerk-pass-102!' }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied',
        reason: 'permission-denied',
        opcode: 'personnel.password.reset',
        actor_id: clerkId,
        actor_code: 'P-102-CLERK2',
      }),
    ]);
  });
});

describe('留痕不含个人信息与口令', () => {
  it('留痕任何一列都不含手机号、执法证号、口令原文', async () => {
    // 对不上人员的一次登录：手机号只在请求里，不能进入任何列。
    const unknownPhone = '13800019999';
    const unknown = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.250' },
      body: JSON.stringify({ mobilePhone: unknownPhone, password: WRONG, rememberMe: false }),
    });
    expect(unknown.status).toBe(401);

    const people = await cloned.prisma.personnel.findMany({
      select: { mobilePhone: true, enforcementCertNo: true },
    });
    const phones = people.map((row) => row.mobilePhone).filter((value): value is string => !!value);
    const certs = people.map((row) => row.enforcementCertNo).filter((value): value is string => !!value);
    const passwords = [
      PASSWORD,
      WRONG,
      'Seed-pass-52',
      'Bare-pass-102!',
      'Clerk-pass-102!',
      'Cross-pass-102!',
      'Open-pass-102!',
      'P-102-ADM-A-z!',
      'Reset-pass-102!',
      'Self-pass-102!',
      'p-102-code-Zz9!',
    ];
    const forbidden = [...phones, unknownPhone, ...certs, ...passwords];
    expect(phones.length).toBeGreaterThan(0);
    expect(certs).toEqual(expect.arrayContaining([LOCKED_A_CERT, LOCKED_STATION_CERT, NONE_CERT]));

    const rows = await cloned.prisma.$queryRaw<Array<{ line: string }>>`
      SELECT row_to_json(t)::text AS line FROM audit_trail t
    `;
    expect(rows.length).toBeGreaterThan(0);
    const actions = new Set<string>();
    for (const { line } of rows) {
      actions.add((JSON.parse(line) as { action: string }).action);
      for (const value of forbidden) expect(line).not.toContain(value);
    }
    // 覆盖本文件产生的登录、解锁、重设、会话结束与授权拒绝几类留痕。
    expect([...actions]).toEqual(expect.arrayContaining([
      'login.failed',
      'account.unlocked',
      'account.password-reset',
      'session.ended',
      'authz.denied',
    ]));
  });
});
