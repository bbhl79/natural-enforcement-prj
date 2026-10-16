// #95：手机号与口令登录，并保持会话。
// 断言打在 HTTP 状态码、结果码、Set-Cookie 和留痕表新增行上。
// 留痕行经表名读取。本文件不引用留痕委托。
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { hash } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

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

const PASSWORD = 'Correct-horse-95';
const WRONG_PASSWORD = 'wrong-password';
const CERT = 'CERT-95-SHOULD-NOT-LEAK';
const KNOWN_PHONE = '13800009501';
const FRESH_PHONE = '13800009502';
const UNKNOWN_PHONE = '13800009999';
const SECRETS = [PASSWORD, WRONG_PASSWORD, CERT, KNOWN_PHONE, FRESH_PHONE, UNKNOWN_PHONE];

type AuditRecord = {
  id: string;
  action: string;
  outcome: string;
  actor_id: string | null;
  actor_code: string | null;
  subject_personnel_id: string | null;
  subject_code: string | null;
  org_unit_id: string | null;
  source_ip: string | null;
  reason: string | null;
  opcode: string | null;
  resource_type: string | null;
  resource_id: string | null;
  previous_value: string | null;
};

let cloned: ClonedDatabase;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
let knownId = '';
let freshId = '';
let deptId = '';

async function audits(): Promise<AuditRecord[]> {
  return cloned.prisma.$queryRaw<AuditRecord[]>`
    SELECT id, action, outcome, actor_id, actor_code, subject_personnel_id, subject_code,
           org_unit_id, source_ip, reason, opcode, resource_type, resource_id, previous_value
    FROM audit_trail
    ORDER BY created_at, id
  `;
}

function added(before: AuditRecord[], after: AuditRecord[]): AuditRecord[] {
  const known = new Set(before.map((row) => row.id));
  return after.filter((row) => !known.has(row.id));
}

function assertSecretsAbsent(rows: AuditRecord[]): void {
  const text = JSON.stringify(rows);
  for (const secret of SECRETS) {
    expect(text.includes(secret)).toBe(false);
  }
}

async function postLogin(
  mobilePhone: string,
  password: string,
  rememberMe: boolean,
  cookie?: string,
): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ mobilePhone, password, rememberMe }),
  });
}

function sessionCookie(response: Response): string {
  const all = response.headers.getSetCookie();
  expect(all.some((item) => item.startsWith('__Host-rm='))).toBe(false);
  const sid = all.filter((item) => item.startsWith(`${'__Host-sid'}=`));
  expect(sid).toHaveLength(1);
  const cookie = sid[0];
  if (!cookie) throw new Error('缺少会话 Cookie');
  expect(cookie).toMatch(/^__Host-sid=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=\/$/);
  return cookie;
}

function cookiePair(setCookie: string): string {
  const pair = setCookie.split(';')[0];
  if (!pair) throw new Error('Cookie 没有名字');
  return pair;
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const dept = await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-A' } });
  deptId = dept.id;
  const handler = await cloned.prisma.role.findFirstOrThrow({
    where: { name: '经办', deactivatedAt: null },
  });
  const overseer = await cloned.prisma.role.findFirstOrThrow({
    where: { name: '监督', deactivatedAt: null },
  });
  const passwordHash = await hash(PASSWORD);
  knownId = newUlid();
  freshId = newUlid();
  await cloned.prisma.personnel.create({
    data: {
      id: knownId,
      code: 'P-95-OK',
      name: '丁经办',
      orgUnitId: deptId,
      role: 'clerk',
      passwordHash,
      mobilePhone: KNOWN_PHONE,
      passwordChangedAt: new Date('2026-09-01T00:00:00.000Z'),
      enforcementCertNo: CERT,
    },
  });
  await cloned.prisma.personnelAssignment.create({
    data: { id: newUlid(), personnelId: knownId, orgUnitId: deptId },
  });
  await cloned.prisma.personnelRole.create({
    data: { id: newUlid(), personnelId: knownId, roleId: handler.id },
  });
  await cloned.prisma.personnelRole.create({
    data: { id: newUlid(), personnelId: knownId, roleId: overseer.id },
  });
  await cloned.prisma.personnel.create({
    data: {
      id: freshId,
      code: 'P-95-NEW',
      name: '戊初登',
      orgUnitId: deptId,
      role: 'clerk',
      passwordHash,
      mobilePhone: FRESH_PHONE,
    },
  });
  await cloned.prisma.personnelAssignment.create({
    data: { id: newUlid(), personnelId: freshId, orgUnitId: deptId },
  });

  const app = await createApplication(cloned.connectionString);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();
}, 60000);

afterAll(async () => {
  await closeApp();
  await cloned?.close();
});

describe('POST /api/auth/login', () => {
  it('口令正确且上次改密时间已有值时建立会话，角色来自人员—角色', async () => {
    const before = await audits();
    const response = await postLogin(KNOWN_PHONE, PASSWORD, true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'established' });
    const setCookie = sessionCookie(response);
    const secret = cookiePair(setCookie).slice('__Host-sid='.length);
    const digest = createHash('sha256').update(secret).digest('hex');
    const stored = await cloned.prisma.authSession.findMany({ where: { personnelId: knownId } });
    expect(stored.map((row) => row.secretHash)).toEqual([digest]);
    expect(stored[0]?.rememberMeChainId).toBeNull();
    expect(digest).not.toBe(secret);

    const session = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { cookie: cookiePair(setCookie) },
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({
      result: 'authenticated',
      name: '丁经办',
      code: 'P-95-OK',
      orgName: '第一执法支队',
      roles: ['监督', '经办'],
    });
    const text = JSON.stringify(await audits());
    expect(text.includes(KNOWN_PHONE)).toBe(false);
    expect(text.includes(CERT)).toBe(false);
    expect(text.includes(PASSWORD)).toBe(false);

    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['login.succeeded', 'succeeded', null],
    ]);
    expect(rows[0]).toMatchObject({
      actor_id: knownId,
      actor_code: 'P-95-OK',
      subject_personnel_id: knownId,
      subject_code: 'P-95-OK',
      org_unit_id: deptId,
    });
    assertSecretsAbsent(rows);
  });

  it('查无此人和口令错误的状态码与响应体相同，留痕原因不同', async () => {
    const before = await audits();
    const unknown = await postLogin(UNKNOWN_PHONE, WRONG_PASSWORD, false);
    const bad = await postLogin(KNOWN_PHONE, WRONG_PASSWORD, false);
    const unknownText = await unknown.text();
    const badText = await bad.text();
    expect(unknown.status).toBe(401);
    expect(bad.status).toBe(401);
    expect(unknownText).toBe(badText);
    expect(JSON.parse(unknownText)).toEqual({ result: 'invalid-credential' });
    expect(unknown.headers.getSetCookie()).toEqual([]);
    expect(bad.headers.getSetCookie()).toEqual([]);

    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['login.failed', 'failed', 'unknown-identifier'],
      ['login.failed', 'failed', 'bad-credential'],
    ]);
    expect(rows[0]).toMatchObject({
      actor_id: null,
      actor_code: null,
      subject_personnel_id: null,
      subject_code: null,
      org_unit_id: null,
    });
    expect(rows[1]).toMatchObject({
      actor_id: knownId,
      actor_code: 'P-95-OK',
      subject_personnel_id: knownId,
      subject_code: 'P-95-OK',
      org_unit_id: deptId,
    });
    assertSecretsAbsent(rows);
  });

  it('上次改密时间为空时不进入系统，返回必须改口令', async () => {
    const before = await audits();
    const response = await postLogin(FRESH_PHONE, PASSWORD, false);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'password-change-required' });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await cloned.prisma.authSession.count({ where: { personnelId: freshId } })).toBe(0);
    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['login.password-change-required', 'failed', null],
    ]);
    expect(rows[0]).toMatchObject({
      actor_id: freshId,
      actor_code: 'P-95-NEW',
      subject_personnel_id: freshId,
      org_unit_id: deptId,
    });
    assertSecretsAbsent(rows);
  });

  it('来自其他站点的登录写请求被拒绝', async () => {
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
      },
      body: JSON.stringify({ mobilePhone: KNOWN_PHONE, password: PASSWORD, rememberMe: false }),
    });
    expect(response.status).toBe(403);
    expect(added(before, await audits())).toEqual([]);
  });
});

describe('会话查询与受保护接口', () => {
  it('未登录时会话查询返回未登录，不写授权拒绝', async () => {
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/auth/session`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'anonymous' });
    expect(added(before, await audits())).toEqual([]);
  });

  it('健康检查和登录不要求会话', async () => {
    const before = await audits();
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });
    expect(health.headers.get('set-cookie')).toBeNull();
    const login = await postLogin(UNKNOWN_PHONE, WRONG_PASSWORD, false);
    expect(login.status).toBe(401);
    const rows = added(before, await audits());
    expect(rows.map((row) => row.action)).toEqual(['login.failed']);
    expect(rows.some((row) => row.action === 'authz.denied')).toBe(false);
  });

  it('未登录调用退出被拒绝，并写授权拒绝，原因是未认证', async () => {
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ reason: 'not-authenticated' });
    const rows = added(before, await audits());
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'authz.denied',
        outcome: 'failed',
        reason: 'not-authenticated',
        actor_id: null,
        actor_code: null,
        subject_personnel_id: null,
        subject_code: null,
        org_unit_id: null,
      }),
    ]);
    assertSecretsAbsent(rows);
  });

  it('已登录的人员可以退出，旧 Cookie 不再代表他', async () => {
    const login = await postLogin(KNOWN_PHONE, PASSWORD, false);
    const setCookie = sessionCookie(login);
    const pair = cookiePair(setCookie);
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: pair },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'ended' });
    const cleared = response.headers.getSetCookie();
    expect(cleared.some((item) => item.startsWith('__Host-sid=;') && item.includes('Max-Age=0'))).toBe(true);
    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['session.ended', 'succeeded', 'logout'],
    ]);
    expect(rows[0]).toMatchObject({
      actor_id: knownId,
      actor_code: 'P-95-OK',
      subject_personnel_id: knownId,
      org_unit_id: deptId,
    });
    const again = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: pair } });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ result: 'anonymous' });
    const digest = createHash('sha256').update(pair.slice('__Host-sid='.length)).digest('hex');
    const stored = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: digest } });
    expect(stored.endReason).toBe('logout');
    expect(stored.endedAt).not.toBeNull();
  });
});
