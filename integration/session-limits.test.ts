// #101：空闲超时、绝对超时、每人 3 段、全系统满员。
// 断言打在 HTTP 状态码、结果码、会话结束原因和留痕行上。
// 时间用可注入时钟拨动，不在用例里等待。
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthService } from '../backend/server/src/auth.service.ts';
import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const T0 = Date.parse('2026-10-17T00:00:00.000Z');
const clock = { millis: T0 };
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Limit-pass-101!';
const WRONG_PASSWORD = 'wrong-password';
const PHONE = '13800010101';
const HOLDER_PHONE = '13800010102';
const SESSION_CAPACITY = 3;
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

type AuditRecord = {
  id: string;
  action: string;
  outcome: string;
  reason: string | null;
  actor_id: string | null;
  actor_code: string | null;
  subject_personnel_id: string | null;
  org_unit_id: string | null;
};

let cloned: ClonedDatabase;
let app: Awaited<ReturnType<typeof createApplication>>;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
let personId = '';
let holderId = '';
let deptId = '';

async function audits(): Promise<AuditRecord[]> {
  return cloned.prisma.$queryRaw<AuditRecord[]>`
    SELECT id, action, outcome, reason, actor_id, actor_code, subject_personnel_id, org_unit_id
    FROM audit_trail
    ORDER BY created_at, id
  `;
}

function added(before: AuditRecord[], after: AuditRecord[]): AuditRecord[] {
  const known = new Set(before.map((row) => row.id));
  return after.filter((row) => !known.has(row.id));
}

function postLogin(rememberMe: boolean, cookie?: string): Promise<Response> {
  return postLoginAs(PHONE, rememberMe, cookie);
}

function postLoginAs(mobilePhone: string, rememberMe: boolean, cookie?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ mobilePhone, password: PASSWORD, rememberMe }),
  });
}

async function endOpenSessions(): Promise<void> {
  await cloned.prisma.authSession.updateMany({
    where: { endedAt: null },
    data: { endedAt: new Date(T0), endReason: 'logout' },
  });
}

function pairOf(cookies: string[], name: string): string {
  const found = cookies.find((item) => item.startsWith(`${name}=`));
  if (!found) throw new Error(`缺少 ${name}`);
  return found.split(';')[0] ?? '';
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const dept = await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-A' } });
  deptId = dept.id;
  const passwordHash = await hash(PASSWORD, PINNED);
  personId = newUlid();
  await cloned.prisma.personnel.create({
    data: {
      id: personId,
      code: 'P-101-A',
      name: '甲限次',
      orgUnitId: dept.id,
      passwordHash,
      mobilePhone: PHONE,
      passwordChangedAt: new Date(T0 - 10 * 24 * 60 * MINUTE_MS),
    },
  });
  await cloned.prisma.personnelAssignment.create({
    data: { id: newUlid(), personnelId: personId, orgUnitId: dept.id },
  });
  holderId = newUlid();
  await cloned.prisma.personnel.create({
    data: {
      id: holderId,
      code: 'P-101-B',
      name: '乙占位',
      orgUnitId: dept.id,
      passwordHash,
      mobilePhone: HOLDER_PHONE,
      passwordChangedAt: new Date(T0 - 10 * 24 * 60 * MINUTE_MS),
    },
  });
  await cloned.prisma.personnelAssignment.create({
    data: { id: newUlid(), personnelId: holderId, orgUnitId: dept.id },
  });
  app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(clock.millis) },
    SESSION_CAPACITY,
  );
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();
}, 60_000);

afterAll(async () => {
  await closeApp();
  await cloned?.close();
});

describe('空闲超时', () => {
  it('会话已过空闲或绝对终点时退出仍作废记住我并清除两枚 Cookie', async () => {
    clock.millis = T0;
    const login = await postLogin(true);
    const cookies = login.headers.getSetCookie();
    const sid = pairOf(cookies, '__Host-sid');
    const rm = pairOf(cookies, '__Host-rm');
    clock.millis = T0 + 30 * MINUTE_MS;
    const before = await audits();
    const idle = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: `${sid}; ${rm}` },
    });
    expect(idle.status).toBe(401);
    expect(await idle.json()).toEqual({ reason: 'not-authenticated' });
    const cleared = idle.headers.getSetCookie();
    expect(cleared.some((item) => item.startsWith('__Host-sid=;') && item.includes('Max-Age=0'))).toBe(true);
    expect(cleared.some((item) => item.startsWith('__Host-rm=;') && item.includes('Max-Age=0'))).toBe(true);
    const sidDigest = createHash('sha256').update(sid.slice('__Host-sid='.length)).digest('hex');
    const ended = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: sidDigest } });
    expect(ended.endReason).toBe('idle-timeout');
    const rmDigest = createHash('sha256').update(rm.slice('__Host-rm='.length)).digest('hex');
    const voided = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: rmDigest } });
    expect(voided.endedAt).not.toBeNull();
    expect(voided.endReason).toBe('logout');
    expect(added(before, await audits()).map((row) => [row.action, row.reason])).toEqual([
      ['session.ended', 'idle-timeout'],
      ['authz.denied', 'not-authenticated'],
    ]);

    clock.millis = T0;
    const plain = await postLogin(false);
    const plainSid = pairOf(plain.headers.getSetCookie(), '__Host-sid');
    let cursor = T0;
    while (cursor + 29 * MINUTE_MS < T0 + 8 * HOUR_MS) {
      cursor += 29 * MINUTE_MS;
      clock.millis = cursor;
      const beat = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: plainSid } });
      expect(await beat.json()).toMatchObject({ result: 'authenticated', code: 'P-101-A' });
    }
    clock.millis = T0 + 8 * HOUR_MS;
    const absolute = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: plainSid },
    });
    expect(absolute.status).toBe(401);
    const absoluteCleared = absolute.headers.getSetCookie();
    expect(absoluteCleared.some((item) => item.startsWith('__Host-sid=;') && item.includes('Max-Age=0'))).toBe(true);
    expect(absoluteCleared.some((item) => item.startsWith('__Host-rm=;') && item.includes('Max-Age=0'))).toBe(true);
    const plainDigest = createHash('sha256').update(plainSid.slice('__Host-sid='.length)).digest('hex');
    const absoluteRow = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: plainDigest } });
    expect(absoluteRow.endReason).toBe('absolute-timeout');
  });

  it('空闲满 30 分钟后，下一次请求结束会话并要求重新登录', async () => {
    clock.millis = T0;
    const login = await postLogin(false);
    expect(login.status).toBe(200);
    const sid = pairOf(login.headers.getSetCookie(), '__Host-sid');
    clock.millis = T0 + 30 * MINUTE_MS - 1;
    const still = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: sid } });
    expect(still.status).toBe(200);
    expect(await still.json()).toMatchObject({ result: 'authenticated', code: 'P-101-A' });

    clock.millis = T0 + 30 * MINUTE_MS - 1 + 30 * MINUTE_MS;
    const before = await audits();
    const next = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: sid },
    });
    expect(next.status).toBe(401);
    expect(await next.json()).toEqual({ reason: 'not-authenticated' });
    const digest = createHash('sha256').update(sid.slice('__Host-sid='.length)).digest('hex');
    const stored = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: digest } });
    expect(stored.endReason).toBe('idle-timeout');
    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['session.ended', 'succeeded', 'idle-timeout'],
      ['authz.denied', 'failed', 'not-authenticated'],
    ]);
    expect(rows[0]).toMatchObject({ actor_id: null, subject_personnel_id: personId });
    const again = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: sid } });
    expect(await again.json()).toEqual({ result: 'anonymous' });
  });
});

describe('绝对超时', () => {
  it('未勾选记住我时，认证满 8 小时后下一次请求按绝对超时结束', async () => {
    clock.millis = T0;
    const login = await postLogin(false);
    expect(login.status).toBe(200);
    const sid = pairOf(login.headers.getSetCookie(), '__Host-sid');
    let cursor = T0;
    while (cursor + 29 * MINUTE_MS < T0 + 8 * HOUR_MS) {
      cursor += 29 * MINUTE_MS;
      clock.millis = cursor;
      const beat = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: sid } });
      expect(await beat.json()).toMatchObject({ result: 'authenticated', code: 'P-101-A' });
    }
    clock.millis = T0 + 8 * HOUR_MS - 1;
    const still = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: sid } });
    expect(still.status).toBe(200);
    expect(await still.json()).toMatchObject({ result: 'authenticated', code: 'P-101-A' });

    clock.millis = T0 + 8 * HOUR_MS;
    const before = await audits();
    const next = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: sid },
    });
    expect(next.status).toBe(401);
    expect(await next.json()).toEqual({ reason: 'not-authenticated' });
    const digest = createHash('sha256').update(sid.slice('__Host-sid='.length)).digest('hex');
    const stored = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: digest } });
    expect(stored.endReason).toBe('absolute-timeout');
    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['session.ended', 'succeeded', 'absolute-timeout'],
      ['authz.denied', 'failed', 'not-authenticated'],
    ]);
    expect(rows[0]).toMatchObject({ actor_id: null, subject_personnel_id: personId });
  });

  it('勾选记住我时绝对终点是勾选那次认证起 168 小时，免输口令进入不往后推', async () => {
    const rememberEnd = T0 + 168 * HOUR_MS;
    clock.millis = T0;
    const login = await postLogin(true);
    expect(login.status).toBe(200);
    const cookies = login.headers.getSetCookie();
    const sid = pairOf(cookies, '__Host-sid');
    const rm = pairOf(cookies, '__Host-rm');
    let cursor = T0;
    while (cursor + 29 * MINUTE_MS < T0 + 8 * HOUR_MS) {
      cursor += 29 * MINUTE_MS;
      clock.millis = cursor;
      const beat = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: sid } });
      expect(await beat.json()).toMatchObject({ result: 'authenticated' });
    }
    clock.millis = T0 + 8 * HOUR_MS;
    const atEight = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: sid } });
    expect(await atEight.json()).toMatchObject({ result: 'authenticated', code: 'P-101-A' });
    const firstDigest = createHash('sha256').update(sid.slice('__Host-sid='.length)).digest('hex');
    const first = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: firstDigest } });
    expect(first.absoluteEndsAt.toISOString()).toBe(new Date(rememberEnd).toISOString());

    clock.millis = T0 + 8 * HOUR_MS + 30 * MINUTE_MS;
    const idle = await fetch(`${baseUrl}/api/admin/locked-personnel`, { headers: { cookie: sid } });
    expect(idle.status).toBe(401);
    const ended = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: firstDigest } });
    expect(ended.endReason).toBe('idle-timeout');
    const rmDigest = createHash('sha256').update(rm.slice('__Host-rm='.length)).digest('hex');
    const kept = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: rmDigest } });
    expect(kept.endedAt).toBeNull();

    const entered = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: rm } });
    expect(await entered.json()).toMatchObject({ result: 'authenticated', code: 'P-101-A' });
    const nextSid = pairOf(entered.headers.getSetCookie(), '__Host-sid');
    const nextDigest = createHash('sha256').update(nextSid.slice('__Host-sid='.length)).digest('hex');
    const next = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: nextDigest } });
    expect(next.absoluteEndsAt.toISOString()).toBe(new Date(rememberEnd).toISOString());
    expect(next.authenticatedAt.toISOString()).toBe(new Date(T0 + 8 * HOUR_MS + 30 * MINUTE_MS).toISOString());

    cursor = clock.millis;
    while (cursor + 29 * MINUTE_MS < rememberEnd) {
      cursor += 29 * MINUTE_MS;
      clock.millis = cursor;
      const beat = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: nextSid } });
      expect(await beat.json()).toMatchObject({ result: 'authenticated' });
    }
    clock.millis = rememberEnd;
    const before = await audits();
    const last = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { cookie: nextSid } });
    expect(last.status).toBe(401);
    const finalRow = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: nextDigest } });
    expect(finalRow.endReason).toBe('absolute-timeout');
    expect(added(before, await audits()).map((row) => [row.action, row.reason])).toEqual([
      ['session.ended', 'absolute-timeout'],
      ['authz.denied', 'not-authenticated'],
    ]);
  });
});

describe('每人最多 3 段', () => {
  it('第 4 段登录结束最旧的一段，并作废那台设备的记住我', async () => {
    await endOpenSessions();
    const devices: { sid: string; rm: string }[] = [];
    for (let index = 0; index < 3; index += 1) {
      clock.millis = T0 + index * 1000;
      const response = await postLogin(true);
      expect(response.status).toBe(200);
      const cookies = response.headers.getSetCookie();
      devices.push({ sid: pairOf(cookies, '__Host-sid'), rm: pairOf(cookies, '__Host-rm') });
    }
    clock.millis = T0 + 10_000;
    const before = await audits();
    const fourth = await postLogin(false);
    expect(fourth.status).toBe(200);
    expect(await fourth.json()).toEqual({ result: 'established' });

    const oldestSid = createHash('sha256').update(devices[0]!.sid.slice('__Host-sid='.length)).digest('hex');
    const oldest = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: oldestSid } });
    expect(oldest.endReason).toBe('displaced');
    const oldestRm = createHash('sha256').update(devices[0]!.rm.slice('__Host-rm='.length)).digest('hex');
    const voided = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: oldestRm } });
    expect(voided.endReason).toBe('displaced');

    for (const device of devices.slice(1)) {
      const digest = createHash('sha256').update(device.sid.slice('__Host-sid='.length)).digest('hex');
      const row = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: digest } });
      expect(row.endedAt).toBeNull();
      const rmDigest = createHash('sha256').update(device.rm.slice('__Host-rm='.length)).digest('hex');
      const kept = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: rmDigest } });
      expect(kept.endedAt).toBeNull();
      const still = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: device.sid } });
      expect(await still.json()).toMatchObject({ result: 'authenticated', code: 'P-101-A' });
    }

    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['session.ended', 'succeeded', 'displaced'],
      ['login.succeeded', 'succeeded', null],
    ]);
    expect(rows[0]).toMatchObject({ actor_id: personId, subject_personnel_id: personId });
  });

  it('同一浏览器再次登录先以本人退出结束旧会话，不挤掉其他设备', async () => {
    await endOpenSessions();
    const devices: { sid: string }[] = [];
    for (let index = 0; index < 3; index += 1) {
      clock.millis = T0 + index * 1000;
      const response = await postLogin(false);
      expect(response.status).toBe(200);
      devices.push({ sid: pairOf(response.headers.getSetCookie(), '__Host-sid') });
    }
    clock.millis = T0 + 10_000;
    const beforeCount = await cloned.prisma.authSession.count({
      where: { personnelId: personId, endedAt: null },
    });
    const before = await audits();
    const again = await postLogin(false, devices[0]!.sid);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ result: 'established' });
    const replaced = createHash('sha256').update(devices[0]!.sid.slice('__Host-sid='.length)).digest('hex');
    const oldRow = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: replaced } });
    expect(oldRow.endReason).toBe('logout');
    for (const device of devices.slice(1)) {
      const digest = createHash('sha256').update(device.sid.slice('__Host-sid='.length)).digest('hex');
      const row = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: digest } });
      expect(row.endedAt).toBeNull();
    }
    const afterCount = await cloned.prisma.authSession.count({
      where: { personnelId: personId, endedAt: null },
    });
    expect(afterCount).toBe(beforeCount);
    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['session.ended', 'succeeded', 'logout'],
      ['login.succeeded', 'succeeded', null],
    ]);
    expect(rows[0]).toMatchObject({ actor_id: personId, subject_personnel_id: personId });
  });

  it('请求里的会话属于他人时登录不结束它', async () => {
    await endOpenSessions();
    clock.millis = T0;
    const holder = await postLoginAs(HOLDER_PHONE, false);
    expect(holder.status).toBe(200);
    const holderSid = pairOf(holder.headers.getSetCookie(), '__Host-sid');
    clock.millis = T0 + 1_000;
    const before = await audits();
    const response = await postLogin(false, holderSid);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'established' });
    const digest = createHash('sha256').update(holderSid.slice('__Host-sid='.length)).digest('hex');
    const stored = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: digest } });
    expect(stored.endedAt).toBeNull();
    expect(stored.endReason).toBeNull();
    const still = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: holderSid } });
    expect(await still.json()).toMatchObject({ result: 'authenticated', code: 'P-101-B' });
    expect(added(before, await audits()).map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['login.succeeded', 'succeeded', null],
    ]);
    await endOpenSessions();
  });

  it('统计名额前先结束本人已经超时的会话', async () => {
    await cloned.prisma.authSession.updateMany({
      where: { personnelId: personId, endedAt: null },
      data: { endedAt: new Date(T0), endReason: 'logout' },
    });
    const devices: { sid: string }[] = [];
    for (let index = 0; index < 3; index += 1) {
      clock.millis = T0 + index * 1000;
      const response = await postLogin(false);
      expect(response.status).toBe(200);
      devices.push({ sid: pairOf(response.headers.getSetCookie(), '__Host-sid') });
    }
    clock.millis = T0 + 30 * MINUTE_MS;
    const before = await audits();
    const fourth = await postLogin(false);
    expect(fourth.status).toBe(200);
    const oldestDigest = createHash('sha256').update(devices[0]!.sid.slice('__Host-sid='.length)).digest('hex');
    const oldest = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: oldestDigest } });
    expect(oldest.endReason).toBe('idle-timeout');
    for (const device of devices.slice(1)) {
      const digest = createHash('sha256').update(device.sid.slice('__Host-sid='.length)).digest('hex');
      const row = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: digest } });
      expect(row.endedAt).toBeNull();
    }
    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['session.ended', 'succeeded', 'idle-timeout'],
      ['login.succeeded', 'succeeded', null],
    ]);
    expect(rows[0]).toMatchObject({ actor_id: null, subject_personnel_id: personId });
  });
});

describe('全系统满员', () => {
  it('满员时携带他人会话登录不结束那段会话', async () => {
    await endOpenSessions();
    clock.millis = T0;
    const holderCookies: string[] = [];
    for (let index = 0; index < SESSION_CAPACITY; index += 1) {
      clock.millis = T0 + index * 1000;
      const held = await postLoginAs(HOLDER_PHONE, false);
      expect(held.status).toBe(200);
      holderCookies.push(pairOf(held.headers.getSetCookie(), '__Host-sid'));
    }
    clock.millis = T0 + 10_000;
    const victim = holderCookies[0]!;
    const before = await audits();
    const response = await postLogin(false, victim);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ result: 'capacity-reached' });
    const digest = createHash('sha256').update(victim.slice('__Host-sid='.length)).digest('hex');
    const stored = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: digest } });
    expect(stored.endedAt).toBeNull();
    expect(stored.endReason).toBeNull();
    const still = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: victim } });
    expect(await still.json()).toMatchObject({ result: 'authenticated', code: 'P-101-B' });
    expect(added(before, await audits()).map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['login.capacity-reached', 'failed', null],
    ]);
  });

  it('已满时口令正确也不建立新会话，并写满员留痕', async () => {
    await endOpenSessions();
    clock.millis = T0;
    for (let index = 0; index < SESSION_CAPACITY; index += 1) {
      clock.millis = T0 + index * 1000;
      const held = await postLoginAs(HOLDER_PHONE, false);
      expect(held.status).toBe(200);
    }
    clock.millis = T0 + 10_000;
    const before = await audits();
    const response = await postLogin(false);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ result: 'capacity-reached' });
    expect(response.headers.getSetCookie()).toEqual([]);
    const own = await cloned.prisma.authSession.count({ where: { personnelId: personId, endedAt: null } });
    expect(own).toBe(0);
    const held = await cloned.prisma.authSession.count({ where: { personnelId: holderId, endedAt: null } });
    expect(held).toBe(SESSION_CAPACITY);
    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['login.capacity-reached', 'failed', null],
    ]);
    expect(rows[0]).toMatchObject({ actor_id: personId, subject_personnel_id: personId });
  });

  it('统计全系统总数时排除已过期会话，不为他人写留痕', async () => {
    await endOpenSessions();
    const held: string[] = [];
    for (let index = 0; index < SESSION_CAPACITY; index += 1) {
      clock.millis = T0 + index * 1000;
      const response = await postLoginAs(HOLDER_PHONE, false);
      expect(response.status).toBe(200);
      held.push(pairOf(response.headers.getSetCookie(), '__Host-sid'));
    }
    clock.millis = T0 + 30 * MINUTE_MS;
    const before = await audits();
    const response = await postLogin(false);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'established' });
    const oldestDigest = createHash('sha256').update(held[0]!.slice('__Host-sid='.length)).digest('hex');
    const oldest = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: oldestDigest } });
    expect(oldest.endedAt).toBeNull();
    expect(oldest.endReason).toBeNull();
    const rows = added(before, await audits());
    expect(rows.map((row) => row.action)).toEqual(['login.succeeded']);
    expect(rows.some((row) => row.subject_personnel_id === holderId)).toBe(false);
  });

  it('口令正确但因满员不能进入时，失败次数仍被清零', async () => {
    await endOpenSessions();
    clock.millis = T0;
    for (let index = 0; index < SESSION_CAPACITY; index += 1) {
      clock.millis = T0 + index * 1000;
      const held = await postLoginAs(HOLDER_PHONE, false);
      expect(held.status).toBe(200);
    }
    clock.millis = T0 + 10_000;
    for (let index = 0; index < 2; index += 1) {
      const failed = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mobilePhone: PHONE, password: WRONG_PASSWORD, rememberMe: false }),
      });
      expect(failed.status).toBe(401);
    }
    const before = await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: personId } });
    expect(before.passwordFailureCount).toBe(2);
    const response = await postLogin(false);
    expect(response.status).toBe(503);
    const after = await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: personId } });
    expect(after.passwordFailureCount).toBe(0);
    expect(after.passwordFailureWindowStartedAt).toBeNull();
    expect(after.lockedUntil).toBeNull();
  });

  it('记住我免输口令进入遇到满员时拒绝并保留记住我', async () => {
    await endOpenSessions();
    clock.millis = T0;
    const login = await postLogin(true);
    expect(login.status).toBe(200);
    const cookies = login.headers.getSetCookie();
    const sid = pairOf(cookies, '__Host-sid');
    const rm = pairOf(cookies, '__Host-rm');
    const rmDigest = createHash('sha256').update(rm.slice('__Host-rm='.length)).digest('hex');
    clock.millis = T0 + 30 * MINUTE_MS;
    const idle = await fetch(`${baseUrl}/api/admin/locked-personnel`, { headers: { cookie: sid } });
    expect(idle.status).toBe(401);
    const holderCookies: string[] = [];
    for (let index = 0; index < SESSION_CAPACITY; index += 1) {
      clock.millis = T0 + 30 * MINUTE_MS + index * 1000;
      const held = await postLoginAs(HOLDER_PHONE, false);
      expect(held.status).toBe(200);
      holderCookies.push(pairOf(held.headers.getSetCookie(), '__Host-sid'));
    }
    const before = await audits();
    const rejected = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: rm } });
    expect(await rejected.json()).toEqual({ result: 'anonymous' });
    expect(rejected.headers.getSetCookie()).toEqual([]);
    const kept = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: rmDigest } });
    expect(kept.endedAt).toBeNull();
    expect(kept.endReason).toBeNull();
    expect(added(before, await audits()).map((row) => [row.action, row.outcome])).toEqual([
      ['login.capacity-reached', 'failed'],
    ]);

    const freed = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: holderCookies[0]! },
    });
    expect(freed.status).toBe(200);
    const entered = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: rm } });
    expect(await entered.json()).toMatchObject({ result: 'authenticated', code: 'P-101-A' });
  });

  it('本人已有 3 段时记住我进入先结束最旧一段，不受满员限制', async () => {
    await endOpenSessions();
    clock.millis = T0;
    const remembered = await postLogin(true);
    expect(remembered.status).toBe(200);
    const rememberedCookies = remembered.headers.getSetCookie();
    const oldSid = pairOf(rememberedCookies, '__Host-sid');
    const rm = pairOf(rememberedCookies, '__Host-rm');
    clock.millis = T0 + 30 * MINUTE_MS;
    const idle = await fetch(`${baseUrl}/api/admin/locked-personnel`, { headers: { cookie: oldSid } });
    expect(idle.status).toBe(401);
    const devices: string[] = [];
    for (let index = 0; index < SESSION_CAPACITY; index += 1) {
      clock.millis = T0 + 30 * MINUTE_MS + (index + 1) * 1000;
      const response = await postLogin(false);
      expect(response.status).toBe(200);
      devices.push(pairOf(response.headers.getSetCookie(), '__Host-sid'));
    }
    const before = await audits();
    const entered = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: rm } });
    expect(await entered.json()).toMatchObject({ result: 'authenticated', code: 'P-101-A' });
    const oldestDigest = createHash('sha256').update(devices[0]!.slice('__Host-sid='.length)).digest('hex');
    const oldest = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: oldestDigest } });
    expect(oldest.endReason).toBe('displaced');
    const keptDigest = createHash('sha256').update(devices[1]!.slice('__Host-sid='.length)).digest('hex');
    const kept = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: keptDigest } });
    expect(kept.endedAt).toBeNull();
    expect(added(before, await audits()).map((row) => [row.action, row.reason])).toEqual([
      ['session.ended', 'displaced'],
      ['login.succeeded', null],
    ]);
  });
});

describe('系统管理结束会话', () => {
  it('结束某人员的全部会话，原因是 admin-ended，不提供独立入口', async () => {
    await endOpenSessions();
    clock.millis = T0;
    const first = await postLogin(false);
    const second = await postLogin(true);
    const holder = await postLoginAs(HOLDER_PHONE, false);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(holder.status).toBe(200);
    const sid = pairOf(first.headers.getSetCookie(), '__Host-sid');
    const rm = pairOf(second.headers.getSetCookie(), '__Host-rm');
    const holderSid = pairOf(holder.headers.getSetCookie(), '__Host-sid');
    const rmDigest = createHash('sha256').update(rm.slice('__Host-rm='.length)).digest('hex');
    const before = await audits();
    await app.get(AuthService).endPersonnelSessions({
      personnelId: personId,
      actorId: holderId,
      actorCode: 'P-101-B',
      sourceIp: '203.0.113.101',
    });
    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.reason])).toEqual([
      ['session.ended', 'admin-ended'],
      ['session.ended', 'admin-ended'],
    ]);
    expect(rows[0]).toMatchObject({
      actor_id: holderId,
      actor_code: 'P-101-B',
      subject_personnel_id: personId,
      org_unit_id: deptId,
    });
    const gone = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: sid } });
    expect(await gone.json()).toEqual({ result: 'anonymous' });
    const keptRm = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: rmDigest } });
    expect(keptRm.endedAt).toBeNull();
    const holderStill = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: holderSid } });
    expect(await holderStill.json()).toMatchObject({ result: 'authenticated', code: 'P-101-B' });
    const missing = await fetch(`${baseUrl}/api/admin/personnel/${personId}/sessions`, { method: 'POST' });
    expect(missing.status).toBe(404);
  });
});
