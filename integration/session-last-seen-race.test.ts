// 会话活动时间只允许向前。并发或重跑加载时，先读到旧时间的请求可能后写。
// 本用例先在未提交事务里把活动时间拨到更晚，并持有行锁。
// 会话查询读到的仍是旧时间，于是带着更早的时钟去写，并排在这次提交之后。
// 查询必须成功。活动时间停在更晚的一次。随后用更早的时钟再查一次，仍须成功，且时间不回退。
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';
import { newUlid } from './ulid-helpers.ts';

const MINUTE_MS = 60 * 1000;
const T0 = Date.parse('2026-11-06T00:00:00.000Z');
const T_EARLY = T0 + MINUTE_MS;
const T_LATE = T0 + 2 * MINUTE_MS;
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Seen-race-69!';
const PHONE = '13800006901';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const clock = { millis: T0 };

let cloned: ClonedDatabase;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};

function pairOf(cookies: string[], name: string): string {
  const found = cookies.find((item) => item.startsWith(`${name}=`));
  if (!found) throw new Error(`缺少 ${name}`);
  return found.split(';')[0] ?? '';
}

function digestOf(cookie: string): string {
  return createHash('sha256').update(cookie.slice('__Host-sid='.length)).digest('hex');
}

async function postLogin(): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: PHONE, password: PASSWORD, rememberMe: false }),
  });
}

async function getSession(cookie: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } });
}

/** 等当前克隆库里出现一个处于锁等待的连接（并发用例的确定性屏障）。 */
async function waitForLockWait(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await cloned.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;
    if (Number(rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('等待并发事务进入锁等待超时');
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const dept = await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-A' } });
  const passwordHash = await hash(PASSWORD, PINNED);
  const personId = newUlid();
  await cloned.prisma.personnel.create({
    data: {
      id: personId,
      code: 'P-69-SEEN',
      name: '丁活动',
      orgUnitId: dept.id,
      passwordHash,
      mobilePhone: PHONE,
      passwordChangedAt: new Date(T0 - 10 * 24 * 60 * MINUTE_MS),
    },
  });
  await cloned.prisma.personnelAssignment.create({
    data: { id: newUlid(), personnelId: personId, orgUnitId: dept.id },
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

describe('会话活动时间并发推进', () => {
  it('后到的更早活动时间不把会话查询变成 500，时间停在更晚的一次', async () => {
    clock.millis = T0;
    const login = await postLogin();
    expect(login.status).toBe(200);
    const cookie = pairOf(login.headers.getSetCookie(), '__Host-sid');
    const session = await cloned.prisma.authSession.findUniqueOrThrow({
      where: { secretHash: digestOf(cookie) },
    });
    expect(session.lastSeenAt.getTime()).toBe(T0);
    expect(session.endedAt).toBeNull();

    // 未提交的更晚时间对会话查询不可见。查询读到 T0 后，用 T_EARLY 去写，并等这把锁。
    const holding = deferred();
    const release = deferred();
    const ahead = cloned.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE auth_session SET last_seen_at = ${new Date(T_LATE)} WHERE id = ${session.id}
      `;
      holding.resolve();
      await release.promise;
    }, { maxWait: 10_000, timeout: 30_000 });
    await holding.promise;

    clock.millis = T_EARLY;
    const pending = getSession(cookie);
    await waitForLockWait();
    release.resolve();
    const response = await pending;
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(JSON.parse(text).result).toBe('authenticated');
    await ahead;

    const row = await cloned.prisma.authSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.endedAt).toBeNull();
    expect(row.lastSeenAt.getTime()).toBe(T_LATE);

    // 重跑加载：时钟仍停在更早的时刻。查询成功，活动时间不回退。
    const again = await getSession(cookie);
    const againText = await again.text();
    expect(again.status, againText).toBe(200);
    expect(JSON.parse(againText).result).toBe('authenticated');
    const after = await cloned.prisma.authSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.lastSeenAt.getTime()).toBe(T_LATE);
    expect(after.endedAt).toBeNull();
  });
});
