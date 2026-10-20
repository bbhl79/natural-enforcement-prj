// #116：同一毫秒内登录两次时，被挤下线的那段不确定。
// 断言打在 HTTP 状态码、库里的会话行、会话 id 的先后和留痕行上。
// 时钟冻结在同一毫秒，制造「认证时间相同」的情形——正是排序键要定先后的场合。
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const MINUTE_MS = 60 * 1000;
const T0 = Date.parse('2026-10-20T00:00:00.000Z');
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Order-pass-116!';
const PHONE = '13800011601';
const SESSION_CAPACITY = 50;
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
  action: string;
  outcome: string;
  reason: string | null;
  subject_personnel_id: string | null;
};

let cloned: ClonedDatabase;
let app: Awaited<ReturnType<typeof createApplication>>;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
let personId = '';

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

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const dept = await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-A' } });
  const passwordHash = await hash(PASSWORD, PINNED);
  personId = newUlid();
  await cloned.prisma.personnel.create({
    data: {
      id: personId,
      code: 'P-116-A',
      name: '甲同毫秒',
      orgUnitId: dept.id,
      passwordHash,
      mobilePhone: PHONE,
      passwordChangedAt: new Date(T0 - 10 * 24 * 60 * MINUTE_MS),
    },
  });
  await cloned.prisma.personnelAssignment.create({
    data: { id: newUlid(), personnelId: personId, orgUnitId: dept.id },
  });
  // 复制源上不能有别人的会话占名额。
  await cloned.prisma.authSession.updateMany({
    where: { endedAt: null },
    data: { endedAt: new Date(T0), endReason: 'logout' },
  });
  // 时钟冻结：四次登录的认证时间落在同一毫秒。
  app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(T0) },
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

describe('同一毫秒内的会话挤占', () => {
  it('挤下线的是先建立的那一段', async () => {
    // 前三段占满本人的 3 段上限，第四次登录触发挤占。四次都不带 Cookie，即四台设备。
    const secrets: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const response = await postLogin();
      expect(response.status).toBe(200);
      secrets.push(pairOf(response.headers.getSetCookie(), '__Host-sid'));
    }
    const rows = [];
    for (const secret of secrets) {
      rows.push(
        await cloned.prisma.authSession.findUniqueOrThrow({ where: { secretHash: digestOf(secret) } }),
      );
    }
    // 四段的认证时间落在同一毫秒——正是排序键要定先后的场合。
    expect(new Set(rows.map((row) => row.authenticatedAt.getTime())).size).toBe(1);
    // 被挤下线的是先建立的那一段（按建立先后判定，不靠 id 排序）。
    expect(rows[0].endedAt).not.toBeNull();
    expect(rows[0].endReason).toBe('displaced');
    expect(rows[1].endedAt).toBeNull();
    expect(rows[2].endedAt).toBeNull();
    expect(rows[3].endedAt).toBeNull();
    // 会话 id 由进程内单调生成器给出，同一毫秒内后建立的那段更大。
    expect(rows[0].id < rows[1].id).toBe(true);
    expect(rows[1].id < rows[2].id).toBe(true);
    expect(rows[2].id < rows[3].id).toBe(true);
    const audits = await cloned.prisma.$queryRaw<AuditRecord[]>`
      SELECT action, outcome, reason, subject_personnel_id
      FROM audit_trail
      WHERE action = 'session.ended' AND reason = 'displaced'
    `;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ outcome: 'succeeded', subject_personnel_id: personId });
  });
});
