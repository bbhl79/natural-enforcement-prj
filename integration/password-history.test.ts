// #132 口令历史不得重复（ADR 0015 落地，#105「口令历史不重复」专项断言）。
// 断言打在 HTTP 状态码、响应体、人员行、口令历史行、留痕行上。断言打在克隆库上。
// 三处入口走同一道校验：本人改密（含首登、到期强制改密）、A10 重设初始口令、恢复时重设初始口令。
// 接缝②：双应用实例加屏障的并发改口令。历史深度经构造参数注入，测试可传 2。
import type { AddressInfo } from 'node:net';

import { hash, verify, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaAuditTrailFactory, type AuditTrailFactory } from '@natural-enforcement/audit';

import { createApplication, type ApplicationOverrides } from '../backend/server/src/persistence.module.ts';
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
let shallowUrl = '';
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

async function startApp(factory?: AuditTrailFactory, overrides: ApplicationOverrides = {}): Promise<string> {
  const app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(T0) },
    undefined,
    factory ? { ...overrides, auditTrailFactory: factory } : overrides,
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
  // 历史深度经构造参数注入，测试传 2（#105 Testing「口令历史」）。
  shallowUrl = await startApp(undefined, { passwordHistoryDepth: 2 });
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

/** 直接给某人插入口令历史行（newest 在前），用来布置窗口内外的散列。 */
async function seedHistory(personnelId: string, plains: readonly string[], oldParams = false): Promise<void> {
  for (let index = 0; index < plains.length; index += 1) {
    const plain = plains[index]!;
    await cloned.prisma.personnelPasswordHistory.create({
      data: {
        id: newUlid(),
        personnelId,
        passwordHash: oldParams ? await hash(plain) : await hash(plain, PINNED),
        // 越靠后的条目越早被换下：retiredAt 递减，读取按 retiredAt DESC, id DESC。
        retiredAt: new Date(T0 - (index + 1) * DAY_MS),
      },
    });
  }
}

describe('A10 重设初始口令：命中历史只回 unavailable（ADR 0015）', () => {
  const CURRENT = 'Reset-132-cur!';
  const HISTORY = ['Reset-132-h4!', 'Reset-132-h3!', 'Reset-132-h2!', 'Reset-132-h1!'] as const;
  const OUT_OF_WINDOW = 'Reset-132-h0!';
  let targetId = '';
  let currentHash = '';

  beforeAll(async () => {
    currentHash = await hash(CURRENT, PINNED);
    targetId = await addPerson({
      code: 'P-132-RST', phone: PHONES.resetTarget, orgUnitId: deptAId, roles: [], hash: currentHash,
    });
    // 4 条窗口内历史 + 1 条滑出窗口的旧散列（比对只取最近 depth-1 条，超出的一直保留）。
    await seedHistory(targetId, [...HISTORY, OUT_OF_WINDOW]);
  }, 120000);

  it('用当前口令或最近 4 条历史重设：回 unavailable，不出现 reused，人员行不变，写一行 account.password-rejected', async () => {
    for (const plain of [CURRENT, ...HISTORY]) {
      const before = await audits();
      const response = await resetPassword(PHONES.admin, targetId, plain);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({ result: 'non-compliant', rules: ['unavailable'] });
      expect(JSON.stringify(body)).not.toContain('reused');
      // 人员行不变，历史表不变。
      expect((await personnelRow(targetId)).passwordHash).toBe(currentHash);
      expect(await historyRows(targetId)).toHaveLength(5);
      // 写一行 account.password-rejected（failed，原因 reused，操作码 personnel.password.reset），
      // 不写成功的 account.password-reset。
      const rows = added(before, await audits());
      expect(rows.map((row) => [row.action, row.outcome, row.reason, row.opcode])).toEqual([
        ['account.password-rejected', 'failed', 'reused', RESET_OPCODE],
      ]);
      const entry = rows[0]!;
      expect(entry.subject_personnel_id).toBe(targetId);
      expect(entry.actor_id).toBe(people.admin);
      // 口令、散列、前值不进任何一列。
      expect(entry.previous_value).toBeNull();
      expect(entry.next_value).toBeNull();
      expect(entry.item_count).toBeNull();
      expect(JSON.stringify(entry)).not.toContain(plain);
    }
  }, 240000);

  it('滑出窗口的旧口令重新可用：200，旧散列追加进历史，上次改密时间留空', async () => {
    const before = await audits();
    const response = await resetPassword(PHONES.admin, targetId, OUT_OF_WINDOW);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'reset' });
    expect(added(before, await audits()).map((row) => [row.action, row.outcome])).toEqual([
      ['account.password-reset', 'succeeded'],
    ]);
    const rows = await historyRows(targetId);
    expect(rows).toHaveLength(6);
    // 追加的是被换下来的当前散列，最新一条排在最前。
    expect(rows[0]!.password_hash).toBe(currentHash);
    const row = await personnelRow(targetId);
    expect(row.passwordChangedAt).toBeNull();
    expect(row.lockedUntil).toBeNull();
    expect(row.passwordFailureCount).toBe(0);
  }, 120000);

  it('同时违反可公开规则时只回那些规则码，不做历史比对，不出现 unavailable，不写留痕', async () => {
    const before = await audits();
    // '1234' 违反多条可公开规则；即便它命中历史也轮不到比对（顺序：其余规则全部通过后才比历史）。
    const response = await resetPassword(PHONES.admin, targetId, '1234');
    expect(response.status).toBe(400);
    const body = await response.json() as { result: string; rules: string[] };
    expect(body.result).toBe('non-compliant');
    expect(body.rules).not.toContain('unavailable');
    expect(body.rules.length).toBeGreaterThan(0);
    expect(added(before, await audits())).toEqual([]);
  });

  it('历史条目带旧 argon2 参数时仍能命中', async () => {
    const legacyPlain = 'Legacy-132-pass!';
    const legacyId = await addPerson({
      code: 'P-132-LEG', phone: PHONES.oldParam, orgUnitId: deptAId, roles: [],
    });
    // 旧参数散列：argon2 默认参数（m=65536,t=3,p=4），与定版不同；参数写在 PHC 串里，照样能验证。
    await seedHistory(legacyId, [legacyPlain], true);
    const before = await audits();
    const response = await resetPassword(PHONES.admin, legacyId, legacyPlain);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ result: 'non-compliant', rules: ['unavailable'] });
    expect(added(before, await audits()).map((row) => [row.action, row.reason])).toEqual([
      ['account.password-rejected', 'reused'],
    ]);
  }, 120000);
});

describe('恢复：初始口令命中历史（ADR 0015，#105 D7）', () => {
  const CURRENT = 'Restore-132-cur!';

  it('命中回 unavailable，人员仍为停用，留痕操作码为 personnel.profile.restore', async () => {
    const currentHash = await hash(CURRENT, PINNED);
    const targetId = await addPerson({
      code: 'P-132-RES', phone: PHONES.restoreTarget, orgUnitId: deptAId, roles: [],
      hash: currentHash, deactivated: true,
    });
    await seedHistory(targetId, ['Restore-132-h1!']);
    const before = await audits();
    // 命中当前口令。
    const hitCurrent = await restore(PHONES.admin, targetId, CURRENT);
    expect(hitCurrent.status).toBe(400);
    expect(await hitCurrent.json()).toEqual({ result: 'non-compliant', rules: ['unavailable'] });
    // 命中历史。
    const hitHistory = await restore(PHONES.admin, targetId, 'Restore-132-h1!');
    expect(hitHistory.status).toBe(400);
    const body = await hitHistory.json();
    expect(body).toEqual({ result: 'non-compliant', rules: ['unavailable'] });
    expect(JSON.stringify(body)).not.toContain('reused');
    // 人员仍为停用，历史表与人员行不变。
    expect((await personnelRow(targetId)).deactivatedAt).not.toBeNull();
    expect((await personnelRow(targetId)).passwordHash).toBe(currentHash);
    expect(await historyRows(targetId)).toHaveLength(1);
    // 两次拒绝各写一行 account.password-rejected（failed，reused），操作码 personnel.profile.restore；
    // 不写 personnel.restored，也不写成功的 account.password-reset。
    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason, row.opcode])).toEqual([
      ['account.password-rejected', 'failed', 'reused', RESTORE_OPCODE],
      ['account.password-rejected', 'failed', 'reused', RESTORE_OPCODE],
    ]);
    expect(rows[0]!.subject_personnel_id).toBe(targetId);
    expect(rows[0]!.previous_value).toBeNull();
    people.restoreTarget = targetId;
  }, 120000);

  it('停用、恢复后，用停用前的口令重设仍被拒；恢复后历史照样生效', async () => {
    const targetId = people.restoreTarget;
    // 用一个窗口外的新口令恢复：200，停用前的当前散列被追加进历史。
    const before = await audits();
    const restored = await restore(PHONES.admin, targetId, 'Restore-132-new!');
    expect(restored.status).toBe(200);
    const actions = added(before, await audits()).map((row) => row.action);
    expect(actions).toContain('personnel.restored');
    expect(actions).toContain('account.password-reset');
    expect((await personnelRow(targetId)).deactivatedAt).toBeNull();
    // 停用前的口令（CURRENT）已在历史里：重设命中，仍被拒。
    const rejected = await resetPassword(PHONES.admin, targetId, CURRENT);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ result: 'non-compliant', rules: ['unavailable'] });
  }, 120000);
});

describe('重设后首登强制改密（ADR 0015「首登强制改密」）', () => {
  it('重设后首登改回初始口令被拒，改回重设前的旧口令也被拒', async () => {
    const OLD = 'First-132-old!';
    const INIT = 'First-132-init!';
    const targetId = await addPerson({
      code: 'P-132-FL', phone: PHONES.firstLogin, orgUnitId: deptAId, roles: [],
      hash: await hash(OLD, PINNED), changedAt: null,
    });
    // 管理员重设初始口令：OLD 被换下进历史。
    expect((await resetPassword(PHONES.admin, targetId, INIT)).status).toBe(200);
    // 首登：强制改密。
    const firstLogin = await login(PHONES.firstLogin, INIT);
    expect(firstLogin.status).toBe(200);
    expect(await firstLogin.json()).toEqual({ result: 'password-change-required' });
    cookies.set(`${baseUrl} ${PHONES.firstLogin}`, cookieOf(firstLogin));
    // 改回初始口令：等于当前口令，只回 same-as-current。
    const same = await changePassword(PHONES.firstLogin, INIT, INIT);
    expect(same.status).toBe(400);
    expect(await same.json()).toEqual({ result: 'non-compliant', rules: ['same-as-current'] });
    // 改回重设前的旧口令：命中历史，回 reused，不写留痕。
    const before = await audits();
    const reused = await changePassword(PHONES.firstLogin, INIT, OLD);
    expect(reused.status).toBe(400);
    expect(await reused.json()).toEqual({ result: 'non-compliant', rules: ['reused'] });
    expect(added(before, await audits())).toEqual([]);
    // 换成窗口外的新口令：成功。
    const changed = await changePassword(PHONES.firstLogin, INIT, 'First-132-next!');
    expect(changed.status).toBe(200);
  }, 180000);
});

describe('并发改口令（ADR 0015「并发」，接缝②）', () => {
  it('两个 A10 重设并发：一个 200，一个 409，历史只多一行，失败方写 account.password-rejected', async () => {
    const targetId = await addPerson({
      code: 'P-132-RACE', phone: PHONES.raceTarget, orgUnitId: deptAId, roles: [],
      hash: await hash('Race-132-base!', PINNED),
    });
    const historyBefore = await historyRows(targetId);
    armBarrier('account.password-reset');
    // 先手：重设成功后停在事务里（人员行锁仍持有）。
    const first = resetPassword(PHONES.admin, targetId, 'Race-132-win!', barrierUrl);
    await barrier.entered.promise;
    // 后手：另一个重设带着第一步读到的旧期望散列，条件更新在行锁上等待。
    const second = resetPassword(PHONES.admin, targetId, 'Race-132-lose!');
    expect(await settledWithin(second, 400)).toBe(false);
    const before = await audits();
    barrier.release.resolve();
    const [winner, loser] = await Promise.all([first, second]);
    expect(winner.status).toBe(200);
    expect(loser.status).toBe(409);
    expect(await loser.json()).toEqual({ result: 'concurrent-change' });
    // 历史只多一行（成功那一次换下的散列）；当前散列是成功那一次的。
    const rows = await historyRows(targetId);
    expect(rows).toHaveLength(historyBefore.length + 1);
    const row = await personnelRow(targetId);
    expect(await verify(row.passwordHash!, 'Race-132-win!')).toBe(true);
    // 失败方有一行 account.password-rejected（concurrent-change）；不写第二次成功 reset。
    const addedRows = added(before, await audits());
    expect(addedRows.map((item) => [item.action, item.outcome, item.reason, item.opcode])).toEqual([
      ['account.password-reset', 'succeeded', null, null],
      ['account.password-rejected', 'failed', 'concurrent-change', RESET_OPCODE],
    ]);
  }, 180000);

  it('重设与本人改密并发：本人一方 409，拒绝留痕操作码为空', async () => {
    const targetId = await addPerson({
      code: 'P-132-RAC2', phone: PHONES.raceChanger, orgUnitId: deptAId, roles: [],
      hash: await hash(PASSWORD, PINNED),
    });
    people.raceChanger = targetId;
    const ownLogin = await login(PHONES.raceChanger, PASSWORD);
    expect(ownLogin.status).toBe(200);
    cookies.set(`${baseUrl} ${PHONES.raceChanger}`, cookieOf(ownLogin));
    const historyBefore = await historyRows(targetId);
    armBarrier('account.password-reset');
    // 先手：管理员重设，停在事务里。
    const first = resetPassword(PHONES.admin, targetId, 'Race-132-admin!', barrierUrl);
    await barrier.entered.promise;
    // 后手：本人改密，认证读到未提交的旧散列，条件更新在行锁上等待。
    const second = changePassword(PHONES.raceChanger, PASSWORD, 'Race-132-own!');
    expect(await settledWithin(second, 400)).toBe(false);
    const before = await audits();
    barrier.release.resolve();
    const [winner, loser] = await Promise.all([first, second]);
    expect(winner.status).toBe(200);
    expect(loser.status).toBe(409);
    expect(await loser.json()).toEqual({ result: 'concurrent-change' });
    // 历史只多一行；当前散列是重设那一次的；本人一方的旧口令没有进历史。
    const rows = await historyRows(targetId);
    expect(rows).toHaveLength(historyBefore.length + 1);
    const row = await personnelRow(targetId);
    expect(await verify(row.passwordHash!, 'Race-132-admin!')).toBe(true);
    // 本人改密的拒绝行：原因 concurrent-change，操作码为空（ADR 0015 留痕字段）。
    const addedRows = added(before, await audits());
    expect(addedRows.map((item) => [item.action, item.outcome, item.reason, item.opcode])).toEqual([
      ['account.password-reset', 'succeeded', null, null],
      ['session.ended', 'succeeded', 'admin-ended', null],
      ['account.password-rejected', 'failed', 'concurrent-change', null],
    ]);
    expect(addedRows[0]!.subject_personnel_id).toBe(targetId);
    // 本人改密拒绝行的资源列（ADR 0011 追加节）：资源类型 personnel，资源标识为本人。
    expect(addedRows[2]!.resource_type).toBe('personnel');
    expect(addedRows[2]!.resource_id).toBe(targetId);
  }, 180000);
});

describe('历史深度注入（#105 Testing：测试可传 2）', () => {
  it('深度 2 时只比当前加 1 条历史：连改两次后第 1 个口令重新可用，第 2 个仍被拒', async () => {
    const targetId = await addPerson({
      code: 'P-132-DEP2', phone: PHONES.shallow, orgUnitId: deptAId, roles: [],
      hash: await hash('Depth-132-one!', PINNED),
    });
    const login1 = await login(PHONES.shallow, 'Depth-132-one!', shallowUrl);
    expect(login1.status).toBe(200);
    cookies.set(`${shallowUrl} ${PHONES.shallow}`, cookieOf(login1));
    expect((await changePassword(PHONES.shallow, 'Depth-132-one!', 'Depth-132-two!', shallowUrl)).status).toBe(200);
    expect((await changePassword(PHONES.shallow, 'Depth-132-two!', 'Depth-132-six!', shallowUrl)).status).toBe(200);
    // 窗口 = 当前（six）+ 最近 1 条历史（two）。
    const rejected = await changePassword(PHONES.shallow, 'Depth-132-six!', 'Depth-132-two!', shallowUrl);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ result: 'non-compliant', rules: ['reused'] });
    // 第 1 个口令（one）已滑出深度 2 的窗口，重新可用。
    const usable = await changePassword(PHONES.shallow, 'Depth-132-six!', 'Depth-132-one!', shallowUrl);
    expect(usable.status).toBe(200);
    // 历史行照旧只追加：两次换下两条。
    expect(await historyRows(targetId)).toHaveLength(3);
  }, 180000);
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
