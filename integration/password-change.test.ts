// #97：首次改密、超过 90 天、口令规则与到期提醒。
// 断言打在状态码、结果码、规则码和留痕行上。时间用可注入时钟拨动。
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-04-01T00:00:00.000Z');
const clock = { millis: T0 };
// type 2 是 argon2id，与定版散列参数一致。
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const OLD_PASSWORD = 'Old-pass-97!';
const NEW_PASSWORD = 'New-pass-97!';
const SEED_PASSWORD = 'Seed-pass-52';
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
};

let cloned: ClonedDatabase;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
let deptId = '';
let pinnedHash = '';

async function audits(): Promise<AuditRecord[]> {
  return cloned.prisma.$queryRaw<AuditRecord[]>`
    SELECT id, action, outcome, reason, actor_id, actor_code
    FROM audit_trail
    ORDER BY created_at, id
  `;
}

function added(before: AuditRecord[], after: AuditRecord[]): AuditRecord[] {
  const known = new Set(before.map((row) => row.id));
  return after.filter((row) => !known.has(row.id));
}

async function postLogin(mobilePhone: string, password: string, cookie?: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ mobilePhone, password, rememberMe: false }),
  });
}

async function postPassword(cookie: string, currentPassword: string, newPassword: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

function cookiePair(response: Response): string {
  const sid = response.headers.getSetCookie().filter((item) => item.startsWith('__Host-sid='));
  expect(sid).toHaveLength(1);
  const pair = sid[0]?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

async function addPerson(
  code: string,
  phone: string,
  passwordHash: string,
  passwordChangedAt: Date | null,
): Promise<string> {
  const id = newUlid();
  await cloned.prisma.personnel.create({
    data: {
      id,
      code,
      name: code,
      orgUnitId: deptId,
      passwordHash,
      mobilePhone: phone,
      passwordChangedAt,
    },
  });
  await cloned.prisma.personnelAssignment.create({
    data: { id: newUlid(), personnelId: id, orgUnitId: deptId },
  });
  return id;
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const dept = await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-A' } });
  deptId = dept.id;
  pinnedHash = await hash(OLD_PASSWORD, PINNED);
  await addPerson('P-97-NEW', '13800009701', pinnedHash, null);
  await addPerson('1234', '13800009702', pinnedHash, null);
  await addPerson('P-97-E90', '13800009703', pinnedHash, new Date(T0 - 90 * DAY_MS));
  await addPerson('P-97-E91', '13800009704', pinnedHash, new Date(T0 - 90 * DAY_MS - 1));
  await addPerson('P-97-D7', '13800009705', pinnedHash, new Date(T0 - 83 * DAY_MS));
  await addPerson('P-97-D8', '13800009706', pinnedHash, new Date(T0 - 83 * DAY_MS + 1));
  await addPerson('P-97-RE', '13800009707', await hash(OLD_PASSWORD), new Date('2026-01-01T00:00:00.000Z'));
  await addPerson('P-97-VOL', '13800009708', pinnedHash, new Date(T0 - 10 * DAY_MS));
  const app = await createApplication(cloned.connectionString, { now: () => new Date(clock.millis) });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();
}, 60000);

afterAll(async () => {
  await closeApp();
  await cloned?.close();
});

describe('POST /api/auth/password', () => {
  it('强制改密期间登录接口返回该种类，改口令和退出仍可用', async () => {
    clock.millis = T0;
    try {
      const fresh = await postLogin('13800009701', OLD_PASSWORD);
      const freshPair = cookiePair(fresh);
      const blockedFresh = await postLogin('13800009701', OLD_PASSWORD, freshPair);
      expect(blockedFresh.status).toBe(403);
      expect(await blockedFresh.json()).toEqual({ result: 'password-change-required' });
      const freshSession = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: freshPair } });
      expect((await freshSession.json()).result).toBe('password-change-required');

      const expired = await postLogin('13800009704', OLD_PASSWORD);
      const expiredPair = cookiePair(expired);
      const blockedExpired = await postLogin('13800009704', OLD_PASSWORD, expiredPair);
      expect(blockedExpired.status).toBe(403);
      expect(await blockedExpired.json()).toEqual({ result: 'password-expired' });

      const changed = await postPassword(freshPair, OLD_PASSWORD, NEW_PASSWORD);
      expect(changed.status).toBe(200);
      const out = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { cookie: freshPair },
      });
      expect(out.status).toBe(200);
    } finally {
      await cloned.prisma.personnel.update({
        where: { code: 'P-97-NEW' },
        data: {
          passwordHash: pinnedHash,
          passwordChangedAt: null,
          passwordFailureCount: 0,
          passwordFailureWindowStartedAt: null,
          lockedUntil: null,
        },
      });
    }
  });

  it('首次登录必须先改口令，改完沿用同一段会话，初始口令不能再登录', async () => {
    clock.millis = T0;
    const login = await postLogin('13800009701', OLD_PASSWORD);
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({ result: 'password-change-required' });
    const pair = cookiePair(login);
    const blocked = await fetch(`${baseUrl}/api/health`, { headers: { cookie: pair } });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ result: 'password-change-required' });
    const sessionId = (await cloned.prisma.authSession.findFirstOrThrow({
      where: { personnel: { code: 'P-97-NEW' }, endedAt: null },
    })).id;
    const secretHash = (await cloned.prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } })).secretHash;

    const wrong = await postPassword(pair, 'not-the-current', NEW_PASSWORD);
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ result: 'invalid-credential' });
    const still = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: pair } });
    expect(await still.json()).toMatchObject({
      result: 'password-change-required',
      passwordChangeRequired: true,
      passwordChangeKind: 'password-change-required',
      name: 'P-97-NEW',
      code: 'P-97-NEW',
    });

    const beforeRules = await audits();
    const rejected = await postPassword(pair, OLD_PASSWORD, '1234');
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({
      result: 'non-compliant',
      rules: ['too-short', 'insufficient-classes', 'sequential', 'common'],
    });
    expect(added(beforeRules, await audits())).toEqual([]);

    const beforeOk = await audits();
    const changed = await postPassword(pair, OLD_PASSWORD, NEW_PASSWORD);
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ result: 'established' });
    expect(changed.headers.getSetCookie()).toEqual([]);
    const kept = await cloned.prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(kept.secretHash).toBe(secretHash);
    expect(kept.endedAt).toBeNull();
    const health = await fetch(`${baseUrl}/api/health`, { headers: { cookie: pair } });
    expect(health.status).toBe(200);
    const entered = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: pair } });
    expect((await entered.json()).result).toBe('authenticated');
    const rows = added(beforeOk, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['account.password-changed', 'succeeded', 'first-login'],
      ['login.succeeded', 'succeeded', null],
    ]);

    const again = await postLogin('13800009701', OLD_PASSWORD);
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ result: 'invalid-credential' });
    const fresh = await postLogin('13800009701', NEW_PASSWORD);
    expect(fresh.status).toBe(200);
    expect((await fresh.json()).result).toBe('established');
  });

  it('不合规时一次返回全部未通过的规则码', async () => {
    clock.millis = T0;
    const login = await postLogin('13800009702', OLD_PASSWORD);
    const pair = cookiePair(login);
    const response = await postPassword(pair, OLD_PASSWORD, '1234');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      result: 'non-compliant',
      rules: ['too-short', 'insufficient-classes', 'sequential', 'common', 'contains-code'],
    });
  });

  it('没有会话时不能改口令', async () => {
    clock.millis = T0;
    const response = await fetch(`${baseUrl}/api/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ reason: 'not-authenticated' });
  });
});

describe('90 天与到期提醒', () => {
  it('90 天整可以进入系统，响应带剩余 0 天，不带改密时间戳', async () => {
    clock.millis = T0;
    const response = await postLogin('13800009703', OLD_PASSWORD);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ result: 'established', daysRemaining: 0 });
    expect(JSON.stringify(body)).not.toContain('passwordChangedAt');
  });

  it('超过 90 天必须改口令，改完原因是到期', async () => {
    clock.millis = T0;
    const login = await postLogin('13800009704', OLD_PASSWORD);
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({ result: 'password-expired' });
    const pair = cookiePair(login);
    const blocked = await fetch(`${baseUrl}/api/health`, { headers: { cookie: pair } });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ result: 'password-expired' });
    const before = await audits();
    const changed = await postPassword(pair, OLD_PASSWORD, NEW_PASSWORD);
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ result: 'established' });
    const health = await fetch(`${baseUrl}/api/health`, { headers: { cookie: pair } });
    expect(health.status).toBe(200);
    expect(added(before, await audits()).map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['account.password-changed', 'succeeded', 'expired'],
      ['login.succeeded', 'succeeded', null],
    ]);
  });

  it('距到期 7 天出现剩余天数，再早 1 毫秒的第 8 天不出现', async () => {
    clock.millis = T0;
    const within = await postLogin('13800009705', OLD_PASSWORD);
    expect(await within.json()).toEqual({ result: 'established', daysRemaining: 7 });
    const withinSession = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { cookie: cookiePair(within) },
    });
    const withinBody = await withinSession.json() as { noticeTag?: string };
    expect(withinBody).toEqual({
      result: 'authenticated',
      name: 'P-97-D7',
      code: 'P-97-D7',
      orgName: '第一执法支队',
      roles: [],
      passwordChangeRequired: false,
      passwordChangeKind: null,
      daysRemaining: 7,
      noticeTag: expect.stringMatching(/^[0-9a-f]{16}$/),
      opcodes: [],
    });
    // 到期横幅的会话标记：同一会话再查不变，换一个会话即变（#105 X1「同一会话关闭后不再出现」）
    const again = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: cookiePair(within) } });
    expect((await again.json() as { noticeTag?: string }).noticeTag).toBe(withinBody.noticeTag);
    const relogin = await postLogin('13800009705', OLD_PASSWORD);
    expect(await relogin.json()).toEqual({ result: 'established', daysRemaining: 7 });
    const other = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: cookiePair(relogin) } });
    const otherTag = (await other.json() as { noticeTag?: string }).noticeTag;
    expect(otherTag).toMatch(/^[0-9a-f]{16}$/);
    expect(otherTag).not.toBe(withinBody.noticeTag);
    const eighth = await postLogin('13800009706', OLD_PASSWORD);
    expect(await eighth.json()).toEqual({ result: 'established' });
    const eighthSession = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { cookie: cookiePair(eighth) },
    });
    expect(await eighthSession.json()).toEqual({
      result: 'authenticated',
      name: 'P-97-D8',
      code: 'P-97-D8',
      orgName: '第一执法支队',
      roles: [],
      passwordChangeRequired: false,
      passwordChangeKind: null,
      opcodes: [],
    });
  });

  it('已改密人员主动改口令只写改密留痕', async () => {
    clock.millis = T0;
    const login = await postLogin('13800009708', OLD_PASSWORD);
    expect(await login.json()).toEqual({ result: 'established' });
    const pair = cookiePair(login);
    const before = await audits();
    const changed = await postPassword(pair, OLD_PASSWORD, NEW_PASSWORD);
    expect(changed.status).toBe(200);
    expect(added(before, await audits()).map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['account.password-changed', 'succeeded', 'voluntary'],
    ]);
  });
});

describe('散列参数', () => {
  it('验真成功后按定版重写，上次改密时间不变，因此 90 天整加 1 毫秒仍算超过', async () => {
    clock.millis = Date.parse('2026-01-02T00:00:00.000Z');
    const first = await postLogin('13800009707', OLD_PASSWORD);
    expect((await first.json()).result).toBe('established');
    const stored = await cloned.prisma.personnel.findUniqueOrThrow({ where: { code: 'P-97-RE' } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(stored.passwordChangedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    clock.millis = Date.parse('2026-01-01T00:00:00.000Z') + 90 * DAY_MS + 1;
    const later = await postLogin('13800009707', OLD_PASSWORD);
    expect(later.status).toBe(200);
    expect(await later.json()).toEqual({ result: 'password-expired' });
  });

  it('种子人员不豁免首次改密，重写散列也不写入改密时间', async () => {
    clock.millis = T0;
    const first = await postLogin('13800001001', SEED_PASSWORD);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ result: 'password-change-required' });
    const person = await cloned.prisma.personnel.findUniqueOrThrow({ where: { code: 'P-SUP-A' } });
    expect(person.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(person.passwordChangedAt).toBeNull();
    const second = await postLogin('13800001001', SEED_PASSWORD);
    expect(await second.json()).toEqual({ result: 'password-change-required' });
  });
});
