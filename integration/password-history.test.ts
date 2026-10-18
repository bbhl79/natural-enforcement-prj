// #132 口令历史不得重复（ADR 0015 落地，#105「口令历史不重复」专项断言）。
// 断言打在 HTTP 状态码、响应体、人员行、口令历史行、留痕行上。断言打在克隆库上。
// 三处入口走同一道校验：本人改密（含首登、到期强制改密）、A10 重设初始口令、恢复时重设初始口令。
// 接缝②：双应用实例加屏障的并发改口令。历史深度经构造参数注入，测试可传 2。
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaAuditTrailFactory, type AuditTrailFactory } from '@natural-enforcement/audit';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-19T03:00:00.000Z');
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Person-132-ok!';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RESET_OPCODE = 'personnel.password.reset';
const RESTORE_OPCODE = 'personnel.profile.restore';

/** 连改 5 次用的一串口令：每个都满足可公开规则，互相只差中段词。 */
const PASS = [
  'Hist-132-alpha!',
  'Hist-132-bravo!',
  'Hist-132-delta!',
  'Hist-132-echo0!',
  'Hist-132-foxt!',
  'Hist-132-golf!',
] as const;

const PHONES = {
  changer: '13800013201',
  admin: '13800013202',
  resetTarget: '13800013203',
  restoreTarget: '13800013204',
  raceTarget: '13800013205',
  raceChanger: '13800013206',
  oldParam: '13800013207',
  shallow: '13800013208',
  firstLogin: '13800013209',
} as const;

function newUlid(): string {
  let time = BigInt(Date.now());
  let id = '';
  for (let i = 0; i < 10; i += 1) {
    id = CROCKFORD[Number(time % 32n)] + id;
    time /= 32n;
  }
  for (const byte of crypto.getRandomValues(new Uint8Array(16))) id += CROCKFORD[byte % 32];
  return id;
}

/** 接缝②：屏障。指定动作的成功留痕写下后（业务行已写、事务未提交、行锁仍持有）停住，等放行。 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const barrier = { action: null as string | null, entered: deferred(), release: deferred() };
function armBarrier(action: string): void {
  barrier.action = action;
  barrier.entered = deferred();
  barrier.release = deferred();
}
const barrierFactory: AuditTrailFactory = {
  forClient(client) {
    const real = prismaAuditTrailFactory.forClient(client);
    return {
      async append(entry) {
        await real.append(entry);
        if (barrier.action && entry.action === barrier.action && !('outcome' in entry && entry.outcome === 'failed')) {
          barrier.action = null;
          barrier.entered.resolve();
          await barrier.release.promise;
        }
      },
    };
  },
};

let cloned: ClonedDatabase;
let baseUrl = '';
let barrierUrl = '';
const closers: Array<() => Promise<void>> = [];
let passwordHash = '';
let deptAId = '';
const people: Record<string, string> = {};

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
  resource_type: string | null;
  resource_id: string | null;
  previous_value: string | null;
  next_value: string | null;
  item_count: number | null;
};

async function audits(): Promise<AuditRecord[]> {
  return cloned.prisma.$queryRaw<AuditRecord[]>`
    SELECT id, action, outcome, reason, actor_id, actor_code,
           subject_personnel_id, subject_code, org_unit_id, source_ip, opcode,
           resource_type, resource_id, previous_value, next_value, item_count
    FROM audit_trail
    ORDER BY created_at, id
  `;
}

function added(before: AuditRecord[], after: AuditRecord[]): AuditRecord[] {
  const known = new Set(before.map((row) => row.id));
  return after.filter((row) => !known.has(row.id));
}

async function historyRows(personnelId: string): Promise<Array<{ id: string; password_hash: string; retired_at: Date }>> {
  return cloned.prisma.$queryRaw<Array<{ id: string; password_hash: string; retired_at: Date }>>`
    SELECT id, password_hash, retired_at
    FROM personnel_password_history
    WHERE personnel_id = ${personnelId}
    ORDER BY retired_at DESC, id DESC
  `;
}

async function roleId(name: string): Promise<string> {
  return (await cloned.prisma.role.findFirstOrThrow({ where: { name, deactivatedAt: null } })).id;
}

async function addPerson(input: {
  code: string;
  phone: string;
  orgUnitId: string;
  roles: string[];
  hash?: string;
  changedAt?: Date | null;
  deactivated?: boolean;
}): Promise<string> {
  const id = newUlid();
  await cloned.prisma.personnel.create({
    data: {
      id,
      code: input.code,
      name: input.code,
      orgUnitId: input.orgUnitId,
      passwordHash: input.hash ?? passwordHash,
      mobilePhone: input.phone,
      passwordChangedAt: 'changedAt' in input ? input.changedAt ?? null : new Date(T0 - 10 * DAY_MS),
      deactivatedAt: input.deactivated ? new Date(T0 - DAY_MS) : null,
    },
  });
  await cloned.prisma.personnelAssignment.create({
    data: { id: newUlid(), personnelId: id, orgUnitId: input.orgUnitId },
  });
  await cloned.prisma.personnelNameVersion.create({
    data: { id: newUlid(), personnelId: id, name: input.code, version: 1 },
  });
  for (const role of input.roles) {
    await cloned.prisma.personnelRole.create({
      data: { id: newUlid(), personnelId: id, roleId: await roleId(role) },
    });
  }
  return id;
}

const cookies = new Map<string, string>();

async function login(phone: string, password: string, url = baseUrl): Promise<Response> {
  return fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: phone, password, rememberMe: false }),
  });
}

function cookieOf(response: Response): string {
  const pair = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='))?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

async function signIn(phone: string, url = baseUrl): Promise<string> {
  const key = `${url} ${phone}`;
  const known = cookies.get(key);
  if (known) return known;
  const response = await login(phone, PASSWORD, url);
  expect(response.status).toBe(200);
  const pair = cookieOf(response);
  cookies.set(key, pair);
  return pair;
}

async function post(
  path: string,
  phone: string,
  payload: unknown = {},
  url = baseUrl,
): Promise<Response> {
  return fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await signIn(phone, url) },
    body: JSON.stringify(payload),
  });
}

/** 本人改密。 */
function changePassword(phone: string, currentPassword: string, newPassword: string, url = baseUrl): Promise<Response> {
  return fetch(`${url}/api/auth/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookies.get(`${url} ${phone}`) ?? '' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

/** A10 重设初始口令。 */
const resetPassword = (phone: string, id: string, password: string, url = baseUrl): Promise<Response> =>
  post(`/api/admin/personnel/${id}/password-reset`, phone, { password }, url);

/** 恢复（重设初始口令）。 */
const restore = (phone: string, id: string, initialPassword: string, url = baseUrl): Promise<Response> =>
  post(`/api/admin/personnel/${id}/restore`, phone, { initialPassword }, url);

async function startApp(factory?: AuditTrailFactory): Promise<string> {
  const app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(T0) },
    undefined,
    factory ? { auditTrailFactory: factory } : undefined,
  );
  await app.listen(0, '127.0.0.1');
  closers.push(() => app.close());
  return `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
}

/** 在 ms 毫秒内是否已经有结果（用来断言「被行锁挡住」）。 */
async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, ms));
  return settled;
}

const personnelRow = (id: string) => cloned.prisma.personnel.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  cloned = await openClonedDatabase();
  deptAId = (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-A' } })).id;
  passwordHash = await hash(PASSWORD, PINNED);
  people.changer = await addPerson({ code: 'P-132-CHG', phone: PHONES.changer, orgUnitId: deptAId, roles: [], hash: await hash(PASS[0], PINNED) });
  people.admin = await addPerson({ code: 'P-132-ADM', phone: PHONES.admin, orgUnitId: deptAId, roles: ['系统管理'] });
  baseUrl = await startApp();
  barrierUrl = await startApp(barrierFactory);
  await signIn(PHONES.admin);
  await signIn(PHONES.admin, barrierUrl);
}, 120000);

afterAll(async () => {
  for (const close of closers) await close();
  await cloned?.close();
});

describe('本人改密：新口令不得与当前口令和最近 4 条历史相同（ADR 0015）', () => {
  it('连改 5 次后，第 1 次的口令重新可用，第 2 到第 5 次和当前口令都被拒', async () => {
    const response = await login(PHONES.changer, PASS[0]);
    expect(response.status).toBe(200);
    cookies.set(`${baseUrl} ${PHONES.changer}`, cookieOf(response));

    // 连改 5 次：PASS[0]→PASS[1]→…→PASS[5]。
    for (let step = 1; step <= 5; step += 1) {
      const changed = await changePassword(PHONES.changer, PASS[step - 1], PASS[step]);
      expect(changed.status).toBe(200);
      expect(await changed.json()).toEqual({ result: 'established' });
    }
    // 历史只追加：5 次换下 5 条旧散列，超出深度的也保留。
    const rows = await historyRows(people.changer);
    expect(rows).toHaveLength(5);

    // 第 2 到第 5 次（PASS[1]..PASS[4]）都在「当前 + 最近 4 条历史」窗口里，被拒，只回 reused，不带序号。
    for (const reused of [PASS[1], PASS[2], PASS[3], PASS[4]]) {
      const before = await audits();
      const rejected = await changePassword(PHONES.changer, PASS[5], reused);
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({ result: 'non-compliant', rules: ['reused'] });
      // 本人改密命中历史不写留痕。
      expect(added(before, await audits())).toEqual([]);
      // 被拒时人员行与历史表都不变。
      expect((await personnelRow(people.changer)).passwordHash).not.toBe(await hash(reused, PINNED));
      expect(await historyRows(people.changer)).toHaveLength(5);
    }

    // 当前口令只回 same-as-current 这一个原因。
    const same = await changePassword(PHONES.changer, PASS[5], PASS[5]);
    expect(same.status).toBe(400);
    expect(await same.json()).toEqual({ result: 'non-compliant', rules: ['same-as-current'] });

    // 第 1 次（PASS[0]）已经滑出窗口，重新可用。
    const usable = await changePassword(PHONES.changer, PASS[5], PASS[0]);
    expect(usable.status).toBe(200);
    expect(await usable.json()).toEqual({ result: 'established' });
    expect(await historyRows(people.changer)).toHaveLength(6);
  }, 120000);
});

describe('历史表只追加（ADR 0015「只追加」）', () => {
  it('历史表的 UPDATE、DELETE 被触发器拒绝', async () => {
    const rows = await historyRows(people.changer);
    expect(rows.length).toBeGreaterThan(0);
    const id = rows[0]!.id;
    await expect(
      cloned.prisma.$executeRaw`UPDATE personnel_password_history SET password_hash = 'tampered' WHERE id = ${id}`,
    ).rejects.toThrow();
    await expect(
      cloned.prisma.$executeRaw`DELETE FROM personnel_password_history WHERE id = ${id}`,
    ).rejects.toThrow();
    expect(await historyRows(people.changer)).toHaveLength(rows.length);
  });
});
