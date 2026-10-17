// #100：记住我。断言打在 HTTP 状态码、Cookie、会话终点和留痕行上。
// 时间用可注入时钟拨动，不在用例里等待。
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const HOUR_MS = 60 * 60 * 1000;
const T0 = Date.parse('2026-10-17T00:00:00.000Z');
const REMEMBER_END = '2026-10-24T00:00:00.000Z';
const clock = { millis: T0 };
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Remember-pass-100!';
const PHONE = '13800010001';
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
};

let cloned: ClonedDatabase;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
let personId = '';

async function audits(): Promise<AuditRecord[]> {
  return cloned.prisma.$queryRaw<AuditRecord[]>`
    SELECT id, action, outcome, reason
    FROM audit_trail
    ORDER BY created_at, id
  `;
}

function added(before: AuditRecord[], after: AuditRecord[]): AuditRecord[] {
  const known = new Set(before.map((row) => row.id));
  return after.filter((row) => !known.has(row.id));
}

function postLogin(rememberMe: boolean, cookie?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ mobilePhone: PHONE, password: PASSWORD, rememberMe }),
  });
}

function sessionWith(cookie: string, sourceIp?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/session`, {
    headers: {
      cookie,
      ...(sourceIp ? { 'x-forwarded-for': sourceIp } : {}),
    },
  });
}

function cookieValue(setCookie: string, name: string): string {
  const pair = setCookie.split(';')[0] ?? '';
  return pair.slice(`${name}=`.length);
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
  const passwordHash = await hash(PASSWORD, PINNED);
  personId = newUlid();
  await cloned.prisma.personnel.create({
    data: {
      id: personId,
      code: 'P-100-OK',
      name: '己记住',
      orgUnitId: dept.id,
      passwordHash,
      mobilePhone: PHONE,
      passwordChangedAt: new Date(T0 - 16 * 24 * HOUR_MS),
    },
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

describe('勾选记住我', () => {
  it('登录勾选记住我时发放 __Host-rm，会话终点是这次认证起 168 小时', async () => {
    clock.millis = T0;
    const before = await audits();
    const response = await postLogin(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'established' });
    const cookies = response.headers.getSetCookie();
    const sid = cookies.filter((item) => item.startsWith('__Host-sid='));
    const rm = cookies.filter((item) => item.startsWith('__Host-rm='));
    expect(sid).toHaveLength(1);
    expect(rm).toHaveLength(1);
    expect(sid[0]).toMatch(/^__Host-sid=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=\/$/);
    expect(rm[0]).toMatch(/^__Host-rm=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=\/; Expires=[^;]+$/);
    expect(rm[0]).toContain(`Expires=${new Date(REMEMBER_END).toUTCString()}`);
    const secret = cookieValue(rm[0] ?? '', '__Host-rm');
    const digest = createHash('sha256').update(secret).digest('hex');
    expect(digest).not.toBe(secret);
    const stored = await cloned.prisma.authRememberMe.findMany({ where: { personnelId: personId } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      secretHash: digest,
      chainId: stored[0]?.id,
      predecessorId: null,
      endedAt: null,
      endReason: null,
      absoluteEndsAt: new Date(REMEMBER_END),
    });
    const sessions = await cloned.prisma.authSession.findMany({ where: { personnelId: personId } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      rememberMeChainId: stored[0]?.id,
      absoluteEndsAt: new Date(REMEMBER_END),
      authenticatedAt: new Date(T0),
    });
    expect(added(before, await audits()).map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['login.succeeded', 'succeeded', null],
    ]);
  });

  it('本次不勾选时清掉这台浏览器的记住我，另一台设备仍保留', async () => {
    clock.millis = T0;
    const first = await postLogin(true);
    const firstCookies = first.headers.getSetCookie();
    const firstRm = pairOf(firstCookies, '__Host-rm');
    const firstDigest = createHash('sha256').update(cookieValue(firstRm, '__Host-rm')).digest('hex');
    const second = await postLogin(true);
    const secondRm = pairOf(second.headers.getSetCookie(), '__Host-rm');
    const secondDigest = createHash('sha256').update(cookieValue(secondRm, '__Host-rm')).digest('hex');
    const response = await postLogin(false, firstRm);
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((item) => item.startsWith('__Host-rm=') && !item.includes('Max-Age=0'))).toBe(false);
    expect(cookies.some((item) => item.startsWith('__Host-rm=;') && item.includes('Max-Age=0'))).toBe(true);
    const ended = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: firstDigest } });
    expect(ended.endReason).toBe('login-without-remember');
    expect(ended.endedAt).not.toBeNull();
    const kept = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: secondDigest } });
    expect(kept.endedAt).toBeNull();
    const sid = pairOf(cookies, '__Host-sid');
    const sessionDigest = createHash('sha256').update(cookieValue(sid, '__Host-sid')).digest('hex');
    const session = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: sessionDigest } });
    expect(session.rememberMeChainId).toBeNull();
    expect(session.absoluteEndsAt.toISOString()).toBe('2026-10-17T08:00:00.000Z');
  });

  it('退出只结束当前会话和这台浏览器的记住我，另一台设备仍保留', async () => {
    clock.millis = T0;
    const here = await postLogin(true);
    const hereCookies = here.headers.getSetCookie();
    const hereSid = pairOf(hereCookies, '__Host-sid');
    const hereRm = pairOf(hereCookies, '__Host-rm');
    const hereDigest = createHash('sha256').update(cookieValue(hereRm, '__Host-rm')).digest('hex');
    const there = await postLogin(true);
    const thereDigest = createHash('sha256')
      .update(cookieValue(pairOf(there.headers.getSetCookie(), '__Host-rm'), '__Host-rm'))
      .digest('hex');
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: `${hereSid}; ${hereRm}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'ended' });
    const cleared = response.headers.getSetCookie();
    expect(cleared.some((item) => item.startsWith('__Host-sid=;') && item.includes('Max-Age=0'))).toBe(true);
    expect(cleared.some((item) => item.startsWith('__Host-rm=;') && item.includes('Max-Age=0'))).toBe(true);
    const endedRm = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: hereDigest } });
    expect(endedRm.endReason).toBe('logout');
    const kept = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: thereDigest } });
    expect(kept.endedAt).toBeNull();
    const thereSession = await cloned.prisma.authSession.findFirstOrThrow({
      where: { rememberMeChainId: kept.chainId, endedAt: null },
    });
    expect(thereSession.personnelId).toBe(personId);
    expect(added(before, await audits()).map((row) => [row.action, row.reason])).toEqual([
      ['session.ended', 'logout'],
    ]);
    const again = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: hereSid } });
    expect(await again.json()).toEqual({ result: 'anonymous' });
  });

  it('免输口令进入新建会话并换发秘密，绝对终点不往后推', async () => {
    await endOpenSessions();
    clock.millis = T0;
    const login = await postLogin(true);
    const rm = pairOf(login.headers.getSetCookie(), '__Host-rm');
    const oldDigest = createHash('sha256').update(cookieValue(rm, '__Host-rm')).digest('hex');
    const oldRow = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: oldDigest } });
    clock.millis = T0 + HOUR_MS;
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: rm } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: 'authenticated',
      name: '己记住',
      code: 'P-100-OK',
      orgName: null,
      roles: [],
      passwordChangeRequired: false,
      passwordChangeKind: null,
    });
    const cookies = response.headers.getSetCookie();
    const nextRm = pairOf(cookies, '__Host-rm');
    const nextSid = pairOf(cookies, '__Host-sid');
    expect(nextRm).not.toBe(rm);
    const nextRmHeader = cookies.find((item) => item.startsWith('__Host-rm=')) ?? '';
    // 换发的 Cookie 过期时间仍是这条链的终点，不往后推。
    expect(nextRmHeader).toContain(`Expires=${new Date(REMEMBER_END).toUTCString()}`);
    const nextDigest = createHash('sha256').update(cookieValue(nextRm, '__Host-rm')).digest('hex');
    const rotated = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: oldDigest } });
    expect(rotated.endReason).toBe('rotated');
    const issued = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: nextDigest } });
    expect(issued).toMatchObject({
      predecessorId: rotated.id,
      chainId: oldRow.chainId,
      absoluteEndsAt: new Date(REMEMBER_END),
      endedAt: null,
    });
    const sessionDigest = createHash('sha256').update(cookieValue(nextSid, '__Host-sid')).digest('hex');
    const session = await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: sessionDigest } });
    expect(session).toMatchObject({
      rememberMeChainId: oldRow.chainId,
      absoluteEndsAt: new Date(REMEMBER_END),
      authenticatedAt: new Date(T0 + HOUR_MS),
      lastSeenAt: new Date(T0 + HOUR_MS),
      endedAt: null,
    });
    expect(added(before, await audits()).map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['session.ended', 'succeeded', 'idle-timeout'],
      ['login.succeeded', 'succeeded', null],
    ]);
  });

  it('换发后 60 秒内旧秘密按未登录处理，满 60 秒才结束该人员全部会话和记住我', async () => {
    clock.millis = T0;
    const first = await postLogin(true);
    const oldRm = pairOf(first.headers.getSetCookie(), '__Host-rm');
    const other = await postLogin(true);
    const otherDigest = createHash('sha256')
      .update(cookieValue(pairOf(other.headers.getSetCookie(), '__Host-rm'), '__Host-rm'))
      .digest('hex');
    clock.millis = T0 + HOUR_MS;
    const entered = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: oldRm } });
    expect((await entered.json()).result).toBe('authenticated');
    const beforeGrace = await audits();
    clock.millis = T0 + HOUR_MS + 60_000 - 1;
    const grace = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: oldRm } });
    expect(await grace.json()).toEqual({ result: 'anonymous' });
    expect(added(beforeGrace, await audits())).toEqual([]);
    const otherDuringGrace = await cloned.prisma.authRememberMe.findUniqueOrThrow({
      where: { secretHash: otherDigest },
    });
    expect(otherDuringGrace.endedAt).toBeNull();
    const liveDuringGrace = await cloned.prisma.authSession.count({
      where: { personnelId: personId, endedAt: null },
    });
    expect(liveDuringGrace).toBeGreaterThan(1);
    const activeBeforeLeak = await cloned.prisma.authSession.findMany({
      where: { personnelId: personId, endedAt: null },
    });
    clock.millis = T0 + HOUR_MS + 60_000;
    const beforeLeak = await audits();
    const leak = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: oldRm } });
    expect(await leak.json()).toEqual({ result: 'anonymous' });
    for (const session of activeBeforeLeak) {
      const stored = await cloned.prisma.authSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(stored.endReason).toBe('remember-me-reuse');
    }
    const kept = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: otherDigest } });
    expect(kept.endReason).toBe('remember-me-reuse');
    const rows = added(beforeLeak, await audits());
    expect(rows.map((row) => [row.action, row.reason])).toEqual(
      activeBeforeLeak.map(() => ['session.ended', 'remember-me-reuse']),
    );
  });

  it('同时提交同一枚旧秘密只签发一次', async () => {
    clock.millis = T0;
    const login = await postLogin(true);
    const rm = pairOf(login.headers.getSetCookie(), '__Host-rm');
    const digest = createHash('sha256').update(cookieValue(rm, '__Host-rm')).digest('hex');
    const before = await audits();
    const [left, right] = await Promise.all([
      fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: rm } }),
      fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: rm } }),
    ]);
    const bodies = [await left.json(), await right.json()] as Array<{ result: string }>;
    expect(bodies.filter((body) => body.result === 'authenticated')).toHaveLength(1);
    expect(bodies.filter((body) => body.result === 'anonymous')).toHaveLength(1);
    const predecessor = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: digest } });
    const successors = await cloned.prisma.authRememberMe.findMany({ where: { predecessorId: predecessor.id } });
    expect(successors).toHaveLength(1);
    expect(added(before, await audits()).map((row) => row.action)).toEqual(['login.succeeded']);
  });

  it('地址闸拒绝免输口令进入时记住我保留且不换发', async () => {
    clock.millis = T0;
    const login = await postLogin(true);
    const rm = pairOf(login.headers.getSetCookie(), '__Host-rm');
    const digest = createHash('sha256').update(cookieValue(rm, '__Host-rm')).digest('hex');
    const ip = '203.0.113.100';
    for (let i = 0; i < 10; i += 1) {
      const failed = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ mobilePhone: `138000101${String(i).padStart(2, '0')}`, password: 'wrong-password', rememberMe: false }),
      });
      expect(failed.status).toBe(401);
    }
    const before = await audits();
    const response = await sessionWith(rm, ip);
    expect(await response.json()).toEqual({ result: 'anonymous' });
    expect(response.headers.getSetCookie()).toEqual([]);
    const stored = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: digest } });
    expect(stored.endedAt).toBeNull();
    expect(added(before, await audits()).map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['login.source-limited', 'failed', null],
    ]);
  });

  it('锁定期拒绝免输口令进入时记住我保留且不延长锁定', async () => {
    clock.millis = T0;
    const login = await postLogin(true);
    const rm = pairOf(login.headers.getSetCookie(), '__Host-rm');
    const digest = createHash('sha256').update(cookieValue(rm, '__Host-rm')).digest('hex');
    const until = new Date(T0 + 30 * 60 * 1000);
    await cloned.prisma.personnel.update({
      where: { id: personId },
      data: { lockedUntil: until },
    });
    try {
      const before = await audits();
      const response = await sessionWith(rm);
      expect(await response.json()).toEqual({ result: 'anonymous' });
      expect(response.headers.getSetCookie()).toEqual([]);
      const stored = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: digest } });
      expect(stored.endedAt).toBeNull();
      const person = await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: personId } });
      expect(person.lockedUntil?.toISOString()).toBe(until.toISOString());
      expect(added(before, await audits()).map((row) => [row.action, row.outcome, row.reason])).toEqual([
        ['login.locked-retry', 'failed', null],
      ]);
    } finally {
      await cloned.prisma.personnel.update({
        where: { id: personId },
        data: { lockedUntil: null },
      });
    }
  });

  it('停用后已有会话的下一次请求结束全部会话和全部记住我', async () => {
    clock.millis = T0;
    await endOpenSessions();
    await cloned.prisma.authRememberMe.updateMany({
      where: { personnelId: personId, endedAt: null },
      data: { endedAt: new Date(T0), endReason: 'logout' },
    });
    const first = await postLogin(true);
    const sid = pairOf(first.headers.getSetCookie(), '__Host-sid');
    const second = await postLogin(true);
    expect(second.status).toBe(200);
    await cloned.prisma.personnel.update({
      where: { id: personId },
      data: { deactivatedAt: new Date(T0) },
    });
    try {
      const activeSessions = await cloned.prisma.authSession.findMany({
        where: { personnelId: personId, endedAt: null },
      });
      const activeRemember = await cloned.prisma.authRememberMe.findMany({
        where: { personnelId: personId, endedAt: null },
      });
      expect(activeSessions.length).toBe(2);
      expect(activeRemember.length).toBe(2);
      const before = await audits();
      const response = await fetch(`${baseUrl}/api/admin/locked-personnel`, {
        headers: { cookie: sid },
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ reason: 'not-authenticated' });
      for (const row of activeSessions) {
        const stored = await cloned.prisma.authSession.findUniqueOrThrow({ where: { id: row.id } });
        expect(stored.endReason).toBe('personnel-deactivated');
      }
      for (const row of activeRemember) {
        const stored = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { id: row.id } });
        expect(stored.endReason).toBe('personnel-deactivated');
      }
      const rows = added(before, await audits());
      expect(rows.map((row) => [row.action, row.reason])).toEqual([
        ...activeSessions.map(() => ['session.ended', 'personnel-deactivated']),
        ['authz.denied', 'not-authenticated'],
      ]);
      const again = await sessionWith(sid);
      expect(await again.json()).toEqual({ result: 'anonymous' });
    } finally {
      await cloned.prisma.personnel.update({
        where: { id: personId },
        data: { deactivatedAt: null },
      });
    }
  });

  it('停用后免输口令进入结束该人员全部记住我和全部会话', async () => {
    clock.millis = T0;
    const here = await postLogin(true);
    const rm = pairOf(here.headers.getSetCookie(), '__Host-rm');
    await postLogin(true);
    await cloned.prisma.personnel.update({
      where: { id: personId },
      data: { deactivatedAt: new Date(T0) },
    });
    try {
      const activeSessions = await cloned.prisma.authSession.findMany({
        where: { personnelId: personId, endedAt: null },
      });
      const activeRemember = await cloned.prisma.authRememberMe.findMany({
        where: { personnelId: personId, endedAt: null },
      });
      expect(activeRemember.length).toBeGreaterThan(1);
      const before = await audits();
      const response = await sessionWith(rm);
      expect(await response.json()).toEqual({ result: 'anonymous' });
      for (const row of activeRemember) {
        const stored = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { id: row.id } });
        expect(stored.endReason).toBe('personnel-deactivated');
      }
      for (const row of activeSessions) {
        const stored = await cloned.prisma.authSession.findUniqueOrThrow({ where: { id: row.id } });
        expect(stored.endReason).toBe('personnel-deactivated');
      }
      const rows = added(before, await audits());
      expect(rows[0]).toMatchObject({ action: 'login.deactivated', outcome: 'failed', reason: null });
      expect(rows.slice(1).map((row) => [row.action, row.reason])).toEqual(
        activeSessions.map(() => ['session.ended', 'personnel-deactivated']),
      );
    } finally {
      await cloned.prisma.personnel.update({
        where: { id: personId },
        data: { deactivatedAt: null },
      });
    }
  });

  it('记住我已过终点或已作废时清除 Cookie，按未登录处理且不写留痕', async () => {
    clock.millis = T0;
    const login = await postLogin(true);
    const rm = pairOf(login.headers.getSetCookie(), '__Host-rm');
    const digest = createHash('sha256').update(cookieValue(rm, '__Host-rm')).digest('hex');
    clock.millis = Date.parse(REMEMBER_END);
    const before = await audits();
    const expired = await sessionWith(rm);
    expect(await expired.json()).toEqual({ result: 'anonymous' });
    expect(expired.headers.getSetCookie().some((item) => item.startsWith('__Host-rm=;') && item.includes('Max-Age=0'))).toBe(true);
    expect(added(before, await audits())).toEqual([]);
    const stored = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: digest } });
    expect(stored.endReason).toBe('absolute-timeout');

    clock.millis = T0;
    const again = await postLogin(true);
    const voided = pairOf(again.headers.getSetCookie(), '__Host-rm');
    const sid = pairOf(again.headers.getSetCookie(), '__Host-sid');
    await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: `${sid}; ${voided}` },
    });
    const beforeVoid = await audits();
    const response = await sessionWith(voided);
    expect(await response.json()).toEqual({ result: 'anonymous' });
    expect(response.headers.getSetCookie().some((item) => item.startsWith('__Host-rm=;') && item.includes('Max-Age=0'))).toBe(true);
    expect(added(beforeVoid, await audits())).toEqual([]);
  });

  it('免输口令进入处于强制改密时建立会话并换发', async () => {
    await endOpenSessions();
    clock.millis = T0;
    const person = await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: personId } });
    await cloned.prisma.personnel.update({
      where: { id: personId },
      data: { passwordChangedAt: null },
    });
    try {
      const login = await postLogin(true);
      expect(await login.json()).toEqual({ result: 'password-change-required' });
      const rm = pairOf(login.headers.getSetCookie(), '__Host-rm');
      const digest = createHash('sha256').update(cookieValue(rm, '__Host-rm')).digest('hex');
      const before = await audits();
      const response = await sessionWith(rm);
      expect(await response.json()).toMatchObject({
        result: 'password-change-required',
        passwordChangeRequired: true,
        passwordChangeKind: 'password-change-required',
      });
      const rotated = await cloned.prisma.authRememberMe.findUniqueOrThrow({ where: { secretHash: digest } });
      expect(rotated.endReason).toBe('rotated');
      expect(added(before, await audits()).map((row) => [row.action, row.outcome])).toEqual([
        ['login.password-change-required', 'failed'],
      ]);
    } finally {
      await cloned.prisma.personnel.update({
        where: { id: personId },
        data: { passwordChangedAt: person.passwordChangedAt },
      });
    }

    await endOpenSessions();
    const expiredAt = new Date(T0 - 90 * 24 * HOUR_MS - 1);
    await cloned.prisma.personnel.update({
      where: { id: personId },
      data: { passwordChangedAt: expiredAt },
    });
    try {
      const login = await postLogin(true);
      expect(await login.json()).toEqual({ result: 'password-expired' });
      const rm = pairOf(login.headers.getSetCookie(), '__Host-rm');
      const before = await audits();
      const response = await sessionWith(rm);
      expect(await response.json()).toMatchObject({
        result: 'password-expired',
        passwordChangeRequired: true,
        passwordChangeKind: 'password-expired',
      });
      expect(added(before, await audits()).map((row) => row.action)).toEqual(['login.password-expired']);
    } finally {
      await cloned.prisma.personnel.update({
        where: { id: personId },
        data: { passwordChangedAt: person.passwordChangedAt },
      });
    }
  });
});
