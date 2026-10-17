// #98：连续口令错误锁定、停用文案与来源地址闸。
// 断言打在 HTTP 状态码、结果码和留痕行上。时间用可注入时钟拨动。
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const MINUTE_MS = 60 * 1000;
const T0 = Date.parse('2026-05-01T00:00:00.000Z');
const clock = { millis: T0 };
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Lock-pass-98!';
const WRONG = 'wrong-password';
const PHONE = '13800009811';
const WINDOW_PHONE = '13800009812';
const FRESH_PHONE = '13800009813';
const BOTH_PHONE = '13800009815';
const GATE_PHONE = '13800009821';
const OTHER_PHONE = '13800009822';
const PW_PHONE = '13800009841';
const HIT_PHONE = '13800009871';
const OFF_PHONE = '13800009872';
const SHARE_PHONE = '13800009881';
const IP = '203.0.113.11';
const WINDOW_IP = '203.0.113.12';
const WINDOW_IP_AFTER = '203.0.113.14';
const FRESH_IP = '203.0.113.13';
const BOTH_IP = '203.0.113.15';
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
  source_ip: string | null;
};

let cloned: ClonedDatabase;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
let deptId = '';
let passwordHash = '';

async function audits(): Promise<AuditRecord[]> {
  return cloned.prisma.$queryRaw<AuditRecord[]>`
    SELECT id, action, outcome, reason, source_ip
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

function postPassword(cookie: string, currentPassword: string, newPassword: string, source: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      'x-forwarded-for': source,
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

function postLogin(mobilePhone: string, password: string, source: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': source,
    },
    body: JSON.stringify({ mobilePhone, password, rememberMe: false }),
  });
}

async function addPerson(code: string, phone: string, passwordChangedAt: Date | null): Promise<void> {
  await cloned.prisma.personnel.create({
    data: {
      id: newUlid(),
      code,
      name: code,
      orgUnitId: deptId,
      passwordHash,
      mobilePhone: phone,
      passwordChangedAt,
    },
  });
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const dept = await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-A' } });
  deptId = dept.id;
  passwordHash = await hash(PASSWORD, PINNED);
  await addPerson('P-98-LOCK', PHONE, new Date(T0 - 10 * 24 * 60 * 60 * 1000));
  await addPerson('P-98-WIN', WINDOW_PHONE, new Date(T0 - 10 * 24 * 60 * 60 * 1000));
  await addPerson('P-98-NEW', FRESH_PHONE, null);
  await addPerson('P-98-BOTH', BOTH_PHONE, new Date(T0 - 10 * 24 * 60 * 60 * 1000));
  await addPerson('P-98-GATE', GATE_PHONE, new Date(T0 - 10 * 24 * 60 * 60 * 1000));
  await addPerson('P-98-OTHER', OTHER_PHONE, new Date(T0 - 10 * 24 * 60 * 60 * 1000));
  await addPerson('P-98-PW', PW_PHONE, new Date(T0 - 10 * 24 * 60 * 60 * 1000));
  await addPerson('P-98-HIT', HIT_PHONE, new Date(T0 - 10 * 24 * 60 * 60 * 1000));
  await addPerson('P-98-OFF', OFF_PHONE, new Date(T0 - 10 * 24 * 60 * 60 * 1000));
  await addPerson('P-98-SHARE', SHARE_PHONE, new Date(T0 - 10 * 24 * 60 * 60 * 1000));
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

describe('POST /api/auth/login 锁定', () => {
  it('连续 5 次口令错误锁定 30 分钟，锁定期内再试不延长，到期后从零计数', async () => {
    clock.millis = T0;
    const before = await audits();
    for (let i = 0; i < 4; i += 1) {
      const response = await postLogin(PHONE, WRONG, IP);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ result: 'invalid-credential' });
    }
    const fifth = await postLogin(PHONE, WRONG, IP);
    expect(fifth.status).toBe(401);
    expect(await fifth.json()).toEqual({ result: 'locked' });

    clock.millis = T0 + MINUTE_MS;
    const during = await postLogin(PHONE, PASSWORD, IP);
    expect(during.status).toBe(401);
    expect(await during.json()).toEqual({ result: 'locked' });

    clock.millis = T0 + 30 * MINUTE_MS - 1;
    const still = await postLogin(PHONE, PASSWORD, IP);
    expect(still.status).toBe(401);
    expect(await still.json()).toEqual({ result: 'locked' });

    clock.millis = T0 + 30 * MINUTE_MS;
    const recount = await postLogin(PHONE, WRONG, IP);
    expect(recount.status).toBe(401);
    expect(await recount.json()).toEqual({ result: 'invalid-credential' });
    const entered = await postLogin(PHONE, PASSWORD, IP);
    expect(entered.status).toBe(200);
    expect(await entered.json()).toEqual({ result: 'established' });

    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['login.failed', 'failed', 'bad-credential'],
      ['login.failed', 'failed', 'bad-credential'],
      ['login.failed', 'failed', 'bad-credential'],
      ['login.failed', 'failed', 'bad-credential'],
      ['login.locked', 'failed', null],
      ['login.locked-retry', 'failed', null],
      ['login.locked-retry', 'failed', null],
      ['login.failed', 'failed', 'bad-credential'],
      ['login.succeeded', 'succeeded', null],
    ]);
  });

  it('15 分钟窗口过期后重新计数，口令正确后失败次数清零', async () => {
    clock.millis = T0;
    for (let i = 0; i < 4; i += 1) {
      const response = await postLogin(WINDOW_PHONE, WRONG, WINDOW_IP);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ result: 'invalid-credential' });
    }
    clock.millis = T0 + 15 * MINUTE_MS;
    const restarted = await postLogin(WINDOW_PHONE, WRONG, WINDOW_IP);
    expect(restarted.status).toBe(401);
    expect(await restarted.json()).toEqual({ result: 'invalid-credential' });
    for (let i = 0; i < 3; i += 1) {
      const response = await postLogin(WINDOW_PHONE, WRONG, WINDOW_IP);
      expect(await response.json()).toEqual({ result: 'invalid-credential' });
    }
    const fifth = await postLogin(WINDOW_PHONE, WRONG, WINDOW_IP);
    expect(fifth.status).toBe(401);
    expect(await fifth.json()).toEqual({ result: 'locked' });

    clock.millis = T0 + 15 * MINUTE_MS + 30 * MINUTE_MS;
    const entered = await postLogin(WINDOW_PHONE, PASSWORD, WINDOW_IP);
    expect(entered.status).toBe(200);
    expect(await entered.json()).toEqual({ result: 'established' });
    for (let i = 0; i < 4; i += 1) {
      const response = await postLogin(WINDOW_PHONE, WRONG, WINDOW_IP_AFTER);
      expect(await response.json()).toEqual({ result: 'invalid-credential' });
    }
  });

  it('认证器确认口令正确就清零，即使随后必须改口令', async () => {
    clock.millis = T0;
    for (let i = 0; i < 4; i += 1) {
      const response = await postLogin(FRESH_PHONE, WRONG, FRESH_IP);
      expect(await response.json()).toEqual({ result: 'invalid-credential' });
    }
    const required = await postLogin(FRESH_PHONE, PASSWORD, FRESH_IP);
    expect(required.status).toBe(200);
    expect(await required.json()).toEqual({ result: 'password-change-required' });
    for (let i = 0; i < 4; i += 1) {
      const response = await postLogin(FRESH_PHONE, WRONG, FRESH_IP);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ result: 'invalid-credential' });
    }
  });

  it('停用与锁定同时命中时返回停用', async () => {
    clock.millis = T0;
    for (let i = 0; i < 5; i += 1) {
      await postLogin(BOTH_PHONE, WRONG, BOTH_IP);
    }
    await cloned.prisma.personnel.update({
      where: { mobilePhone: BOTH_PHONE },
      data: { deactivatedAt: new Date(T0) },
    });
    const before = await audits();
    const response = await postLogin(BOTH_PHONE, PASSWORD, BOTH_IP);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ result: 'deactivated' });
    expect(response.headers.getSetCookie()).toEqual([]);
    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['login.deactivated', 'failed', null],
    ]);
  });

  it('同一地址第 10 次仍按当次结果留痕，第 11 次与口令错误相同，另一地址不受影响', async () => {
    clock.millis = T0;
    const gateIp = '203.0.113.21';
    const otherIp = '203.0.113.22';
    for (let i = 0; i < 9; i += 1) {
      const response = await postLogin(`138000098${String(30 + i)}`, WRONG, gateIp);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ result: 'invalid-credential' });
    }
    const beforeTenth = await audits();
    const tenth = await postLogin(GATE_PHONE, WRONG, gateIp);
    const tenthText = await tenth.text();
    expect(tenth.status).toBe(401);
    expect(JSON.parse(tenthText)).toEqual({ result: 'invalid-credential' });
    const tenthRows = added(beforeTenth, await audits());
    expect(tenthRows.map((row) => [row.action, row.outcome, row.reason, row.source_ip])).toEqual([
      ['login.failed', 'failed', 'bad-credential', gateIp],
    ]);

    const beforeEleventh = await audits();
    const eleventh = await postLogin(GATE_PHONE, PASSWORD, gateIp);
    const eleventhText = await eleventh.text();
    expect(eleventh.status).toBe(tenth.status);
    expect(eleventhText).toBe(tenthText);
    expect(eleventh.headers.getSetCookie()).toEqual([]);
    const eleventhRows = added(beforeEleventh, await audits());
    expect(eleventhRows.map((row) => [row.action, row.outcome, row.reason, row.source_ip])).toEqual([
      ['login.source-limited', 'failed', null, gateIp],
    ]);

    for (let i = 0; i < 3; i += 1) {
      const response = await postLogin(GATE_PHONE, WRONG, otherIp);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ result: 'invalid-credential' });
    }
    const locking = await postLogin(GATE_PHONE, WRONG, otherIp);
    expect(locking.status).toBe(401);
    expect(await locking.json()).toEqual({ result: 'locked' });

    const other = await postLogin(OTHER_PHONE, PASSWORD, otherIp);
    expect(other.status).toBe(200);
    expect(await other.json()).toEqual({ result: 'established' });
  });

  it('改口令连错当前口令计入同一失败次数，不计入地址闸，不结束会话', async () => {
    clock.millis = T0;
    const ip = '203.0.113.41';
    const laterIp = '203.0.113.42';
    const login = await postLogin(PW_PHONE, PASSWORD, ip);
    expect(login.status).toBe(200);
    const pair = cookiePair(login);
    const before = await audits();
    for (let i = 0; i < 4; i += 1) {
      const response = await postPassword(pair, WRONG, 'New-pass-98!', ip);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ result: 'invalid-credential' });
    }
    const fifth = await postPassword(pair, WRONG, 'New-pass-98!', ip);
    expect(fifth.status).toBe(401);
    expect(await fifth.json()).toEqual({ result: 'locked' });
    clock.millis = T0 + MINUTE_MS;
    const sixth = await postPassword(pair, PASSWORD, 'New-pass-98!', ip);
    expect(sixth.status).toBe(401);
    expect(await sixth.json()).toEqual({ result: 'locked' });
    const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: pair } });
    expect(session.status).toBe(200);
    expect((await session.json()).result).toBe('authenticated');
    const passwordRows = added(before, await audits());
    expect(passwordRows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['login.failed', 'failed', 'bad-credential'],
      ['login.failed', 'failed', 'bad-credential'],
      ['login.failed', 'failed', 'bad-credential'],
      ['login.failed', 'failed', 'bad-credential'],
      ['login.locked', 'failed', null],
      ['login.locked-retry', 'failed', null],
    ]);

    for (let i = 0; i < 9; i += 1) {
      const response = await postLogin(`138000097${String(i).padStart(2, '0')}`, WRONG, ip);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ result: 'invalid-credential' });
    }
    const beforeTenth = await audits();
    await postLogin('13800009709', WRONG, ip);
    const afterTenth = await audits();
    expect(added(beforeTenth, afterTenth).map((row) => [row.action, row.reason])).toEqual([
      ['login.failed', 'unknown-identifier'],
    ]);
    const eleventh = await postLogin('13800009710', WRONG, ip);
    expect(eleventh.status).toBe(401);
    expect(await eleventh.json()).toEqual({ result: 'invalid-credential' });
    expect(added(afterTenth, await audits()).map((row) => row.action)).toEqual(['login.source-limited']);

    clock.millis = T0 + 30 * MINUTE_MS;
    const oldPassword = await postLogin(PW_PHONE, PASSWORD, laterIp);
    expect(oldPassword.status).toBe(200);
    expect(await oldPassword.json()).toEqual({ result: 'established' });
    const newPassword = await postLogin(PW_PHONE, 'New-pass-98!', laterIp);
    expect(newPassword.status).toBe(401);
    expect(await newPassword.json()).toEqual({ result: 'invalid-credential' });
  });

  it('地址闸窗口过期后重新计数，满 30 分钟后解除', async () => {
    clock.millis = T0;
    const ip = '203.0.113.51';
    for (let i = 0; i < 9; i += 1) {
      await postLogin(`138000095${String(i).padStart(2, '0')}`, WRONG, ip);
    }
    clock.millis = T0 + 15 * MINUTE_MS;
    const beforeGap = await audits();
    await postLogin('13800009509', WRONG, ip);
    await postLogin('13800009510', WRONG, ip);
    expect(added(beforeGap, await audits()).map((row) => row.action)).toEqual([
      'login.failed',
      'login.failed',
    ]);

    const blockIp = '203.0.113.52';
    clock.millis = T0;
    for (let i = 0; i < 10; i += 1) {
      await postLogin(`138000094${String(i).padStart(2, '0')}`, WRONG, blockIp);
    }
    clock.millis = T0 + 30 * MINUTE_MS - 1;
    const beforeBlocked = await audits();
    await postLogin('13800009410', WRONG, blockIp);
    expect(added(beforeBlocked, await audits()).map((row) => row.action)).toEqual(['login.source-limited']);
    clock.millis = T0 + 30 * MINUTE_MS;
    const beforeReleased = await audits();
    await postLogin('13800009411', WRONG, blockIp);
    expect(added(beforeReleased, await audits()).map((row) => row.action)).toEqual(['login.failed']);
  });

  it('地址闸计数在新进程里归零', async () => {
    clock.millis = T0;
    const ip = '203.0.113.53';
    for (let i = 0; i < 10; i += 1) {
      await postLogin(`138000093${String(i).padStart(2, '0')}`, WRONG, ip);
    }
    const beforeBlocked = await audits();
    await postLogin('13800009310', WRONG, ip);
    expect(added(beforeBlocked, await audits()).map((row) => row.action)).toEqual(['login.source-limited']);

    const restarted = await createApplication(cloned.connectionString, { now: () => new Date(clock.millis) });
    await restarted.listen(0, '127.0.0.1');
    const address = restarted.getHttpServer().address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ mobilePhone: '13800009311', password: WRONG, rememberMe: false }),
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ result: 'invalid-credential' });
    } finally {
      await restarted.close();
    }
    const latest = await audits();
    expect(latest[latest.length - 1]?.action).toBe('login.failed');
  });

  it('使地址计数达到 10 的锁定仍按锁定留痕，停用不计入地址闸', async () => {
    clock.millis = T0;
    const accountIp = '203.0.113.71';
    const gateIp = '203.0.113.72';
    for (let i = 0; i < 4; i += 1) {
      const response = await postLogin(HIT_PHONE, WRONG, accountIp);
      expect(await response.json()).toEqual({ result: 'invalid-credential' });
    }
    for (let i = 0; i < 9; i += 1) {
      await postLogin(`138000092${String(i).padStart(2, '0')}`, WRONG, gateIp);
    }
    const beforeHit = await audits();
    const hit = await postLogin(HIT_PHONE, WRONG, gateIp);
    expect(hit.status).toBe(401);
    expect(await hit.json()).toEqual({ result: 'locked' });
    expect(added(beforeHit, await audits()).map((row) => [row.action, row.source_ip])).toEqual([
      ['login.locked', gateIp],
    ]);
    const beforeGate = await audits();
    const gated = await postLogin(HIT_PHONE, PASSWORD, gateIp);
    const gatedText = await gated.text();
    const sample = await postLogin('13800009209', WRONG, '203.0.113.73');
    const sampleText = await sample.text();
    expect(gated.status).toBe(sample.status);
    expect(gatedText).toBe(sampleText);
    expect(added(beforeGate, await audits()).map((row) => row.action)).toEqual([
      'login.source-limited',
      'login.failed',
    ]);

    const offIp = '203.0.113.74';
    await cloned.prisma.personnel.update({
      where: { mobilePhone: OFF_PHONE },
      data: { deactivatedAt: new Date(T0) },
    });
    for (let i = 0; i < 9; i += 1) {
      await postLogin(`138000091${String(i).padStart(2, '0')}`, WRONG, offIp);
    }
    const beforeOff = await audits();
    const off = await postLogin(OFF_PHONE, PASSWORD, offIp);
    expect(await off.json()).toEqual({ result: 'deactivated' });
    await postLogin('13800009109', WRONG, offIp);
    expect(added(beforeOff, await audits()).map((row) => row.action)).toEqual([
      'login.deactivated',
      'login.failed',
    ]);
  });

  it('登录失败和改口令失败共用同一个 15 分钟窗口', async () => {
    clock.millis = T0;
    const ip = '203.0.113.81';
    const login = await postLogin(SHARE_PHONE, PASSWORD, ip);
    const pair = cookiePair(login);
    for (let i = 0; i < 3; i += 1) {
      const response = await postLogin(SHARE_PHONE, WRONG, ip);
      expect(await response.json()).toEqual({ result: 'invalid-credential' });
    }
    const fourth = await postPassword(pair, WRONG, 'New-pass-98!', ip);
    expect(fourth.status).toBe(400);
    expect(await fourth.json()).toEqual({ result: 'invalid-credential' });
    const fifth = await postPassword(pair, WRONG, 'New-pass-98!', ip);
    expect(fifth.status).toBe(401);
    expect(await fifth.json()).toEqual({ result: 'locked' });
    const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: pair } });
    expect((await session.json()).result).toBe('authenticated');
  });
});
