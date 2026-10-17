// #124 机构停用（含未办结前提）。断言打在 HTTP 状态码、响应体、机构表与任职表的行、留痕行上，库是克隆库。
// 四条必测（#105 Testing）：没有该码、跨区、监督、跨站请求。每个 403/409 用例同时断言失败留痕行存在、业务行不变。
// 接缝①：留痕工厂「业务写完后抛错」。接缝②：两个应用实例（两套连接池）加屏障的并发。接缝③：注入承办中事项计数。
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaAuditTrailFactory, type AuditTrailFactory } from '@natural-enforcement/audit';
import type { OpenItems, OpenItemsCounter } from '../backend/identity/src/index.ts';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-18T02:30:00.000Z');
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Org-deact-124!';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SEAM_ERROR = '接缝①：业务写完后抛错（#124）';

const PHONES = {
  root: '13800012401',
  adminA: '13800012402',
  intake: '13800012403',
  clerk: '13800012404',
  supervisor: '13800012405',
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

/** 接缝①：先照常写下留痕，再抛错。 */
const seam = { armed: false };
const failingFactory: AuditTrailFactory = {
  forClient(client) {
    const real = prismaAuditTrailFactory.forClient(client);
    return {
      async append(entry) {
        await real.append(entry);
        if (seam.armed) throw new Error(SEAM_ERROR);
      },
    };
  },
};

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

/** 接缝③：按机构注入未办结条数，没登记的机构为 0。 */
const openItemsByUnit = new Map<string, OpenItems>();
const counter: OpenItemsCounter = {
  countOpenItems: async (orgUnitId: string) => openItemsByUnit.get(orgUnitId) ?? { clues: 0, cases: 0 },
};

let cloned: ClonedDatabase;
let baseUrl = '';
let seamUrl = '';
let barrierUrl = '';
const closers: Array<() => Promise<void>> = [];
let passwordHash = '';
const org = { hq: '', deptA: '', deptB: '' };
const people = { root: '', adminA: '', intake: '', clerk: '', supervisor: '' };

type AuditRecord = {
  id: string;
  action: string;
  outcome: string;
  reason: string | null;
  actor_id: string | null;
  org_unit_id: string | null;
  opcode: string | null;
  resource_type: string | null;
  resource_id: string | null;
};

async function audits(): Promise<AuditRecord[]> {
  return cloned.prisma.$queryRaw<AuditRecord[]>`
    SELECT id, action, outcome, reason, actor_id, org_unit_id, opcode, resource_type, resource_id
    FROM audit_trail ORDER BY created_at, id
  `;
}

function added(before: AuditRecord[], after: AuditRecord[]): AuditRecord[] {
  const known = new Set(before.map((row) => row.id));
  return after.filter((row) => !known.has(row.id));
}

/** 业务行：机构表、名称版本表、任职表的全部行，按主键排序。 */
async function businessRows(): Promise<string[]> {
  const units = await cloned.prisma.orgUnit.findMany({ orderBy: { id: 'asc' } });
  const names = await cloned.prisma.orgUnitNameVersion.findMany({ orderBy: { id: 'asc' } });
  const assignments = await cloned.prisma.personnelAssignment.findMany({ orderBy: { id: 'asc' } });
  return [...units, ...names, ...assignments].map((row) => JSON.stringify(row));
}

let unitSeq = 0;
async function addUnit(level: 'district' | 'station', parentId: string, deactivatedAt: Date | null = null): Promise<string> {
  unitSeq += 1;
  const id = newUlid();
  const name = `停用测试${level === 'district' ? '区' : '所'}${unitSeq}`;
  await cloned.prisma.orgUnit.create({
    data: { id, code: `ORG-124-${unitSeq}`, name, level, parentId, deactivatedAt },
  });
  await cloned.prisma.orgUnitNameVersion.create({ data: { id: newUlid(), orgUnitId: id, name, version: 1 } });
  return id;
}

async function roleId(name: string): Promise<string> {
  return (await cloned.prisma.role.findFirstOrThrow({ where: { name, deactivatedAt: null } })).id;
}

let personSeq = 0;
async function addPerson(input: {
  orgUnitId: string;
  role: string;
  phone?: string;
  deactivated?: boolean;
}): Promise<string> {
  personSeq += 1;
  const id = newUlid();
  await cloned.prisma.personnel.create({
    data: {
      id,
      code: `P-124-${personSeq}`,
      name: `停用测试人员${personSeq}`,
      orgUnitId: input.orgUnitId,
      passwordHash,
      mobilePhone: input.phone ?? null,
      passwordChangedAt: new Date(T0 - 10 * DAY_MS),
      deactivatedAt: input.deactivated ? new Date(T0 - DAY_MS) : null,
    },
  });
  await cloned.prisma.personnelAssignment.create({ data: { id: newUlid(), personnelId: id, orgUnitId: input.orgUnitId } });
  await cloned.prisma.personnelRole.create({ data: { id: newUlid(), personnelId: id, roleId: await roleId(input.role) } });
  return id;
}

const cookies = new Map<string, string>();

async function signIn(phone: string, url = baseUrl): Promise<string> {
  const key = `${url} ${phone}`;
  const known = cookies.get(key);
  if (known) return known;
  const response = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: phone, password: PASSWORD, rememberMe: false }),
  });
  expect(response.status).toBe(200);
  const pair = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='))?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  cookies.set(key, pair);
  return pair;
}

async function deactivate(
  phone: string,
  orgUnitId: string,
  headers: Record<string, string> = {},
  url = baseUrl,
): Promise<Response> {
  return fetch(`${url}/api/admin/org-units/${orgUnitId}/deactivate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await signIn(phone, url), ...headers },
    body: '{}',
  });
}

async function register(phone: string, parentId: string, name: string, url = baseUrl): Promise<Response> {
  return fetch(`${url}/api/admin/org-units`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await signIn(phone, url) },
    body: JSON.stringify({ parentId, name, level: 'station' }),
  });
}

async function deactivatedAtOf(id: string): Promise<Date | null> {
  return (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { id } })).deactivatedAt;
}

async function startApp(overrides: Parameters<typeof createApplication>[3]): Promise<string> {
  const app = await createApplication(cloned.connectionString, { now: () => new Date(T0) }, undefined, overrides);
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

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const byCode = async (code: string) => (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code } })).id;
  org.hq = await byCode('ORG-HQ');
  org.deptA = await byCode('ORG-DEPT-A');
  org.deptB = await byCode('ORG-DEPT-B');
  passwordHash = await hash(PASSWORD, PINNED);
  people.root = await addPerson({ orgUnitId: org.hq, role: '系统管理', phone: PHONES.root });
  people.adminA = await addPerson({ orgUnitId: org.deptA, role: '系统管理', phone: PHONES.adminA });
  people.intake = await addPerson({ orgUnitId: org.hq, role: '内勤', phone: PHONES.intake });
  people.clerk = await addPerson({ orgUnitId: org.deptA, role: '经办', phone: PHONES.clerk });
  people.supervisor = await addPerson({ orgUnitId: org.deptA, role: '监督', phone: PHONES.supervisor });
  baseUrl = await startApp({ openItemsCounter: counter });
  seamUrl = await startApp({ auditTrailFactory: failingFactory });
  barrierUrl = await startApp({ auditTrailFactory: barrierFactory });
}, 60_000);

afterAll(async () => {
  seam.armed = false;
  barrier.release.resolve();
  for (const close of closers) await close();
  await cloned?.close();
});

describe('POST /api/admin/org-units/:id/deactivate：成功与重复', () => {
  it('前提都满足：200 deactivated，置停用时间，写一行 org.unit.deactivated；树上标出已停用', async () => {
    const station = await addUnit('station', org.deptA);
    await signIn(PHONES.adminA);
    const before = await audits();
    const response = await deactivate(PHONES.adminA, station);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ result: 'deactivated', orgUnit: { id: station, deactivatedAt: expect.any(String) } });
    const at = await deactivatedAtOf(station);
    expect(at?.toISOString()).toBe(body.orgUnit.deactivatedAt);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'org.unit.deactivated', outcome: 'succeeded', reason: null, actor_id: people.adminA,
        org_unit_id: station, opcode: 'org.unit.deactivate', resource_type: 'org-unit', resource_id: station,
      }),
    ]);
    const tree = await fetch(`${baseUrl}/api/org-units`, { headers: { cookie: await signIn(PHONES.adminA) } });
    const node = (await tree.json()).orgUnits.find((unit: { id: string }) => unit.id === station);
    expect(node.deactivatedAt).toBe(body.orgUnit.deactivatedAt);
  });

  it('重复停用：200 unchanged，首次停用时间不变，不写行，不写留痕', async () => {
    const station = await addUnit('station', org.deptA);
    expect((await deactivate(PHONES.adminA, station)).status).toBe(200);
    const first = await deactivatedAtOf(station);
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await deactivate(PHONES.adminA, station);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: 'unchanged',
      orgUnit: { id: station, deactivatedAt: first?.toISOString() },
    });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('只有已停用的下级、只有已结束的任职：照常停用', async () => {
    const district = await addUnit('district', org.hq);
    await addUnit('station', district, new Date(T0 - DAY_MS));
    const moved = await addPerson({ orgUnitId: district, role: '经办' });
    await cloned.prisma.personnelAssignment.updateMany({
      where: { personnelId: moved, orgUnitId: district },
      data: { endedAt: new Date(T0 - DAY_MS) },
    });
    const response = await deactivate(PHONES.root, district);
    expect(response.status).toBe(200);
    expect(await deactivatedAtOf(district)).not.toBeNull();
  });
});

describe('四种拒绝：409 invalid-state，失败留痕存在，机构仍未停用', () => {
  async function refused(phone: string, id: string, actorId: string, reason: string) {
    await signIn(phone);
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await deactivate(phone, id);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(await businessRows()).toEqual(rowsBefore);
    expect(await deactivatedAtOf(id)).toBeNull();
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'org.unit.deactivated', outcome: 'failed', reason, actor_id: actorId,
        org_unit_id: id, opcode: 'org.unit.deactivate', resource_type: 'org-unit', resource_id: id,
      }),
    ]);
    return body;
  }

  it('根机构 → org-unit-root', async () => {
    const body = await refused(PHONES.root, org.hq, people.root, 'org-unit-root');
    expect(body).toEqual({ result: 'invalid-state', message: '根机构不能停用。' });
  });

  it('有未停用下级 → org-has-active-children（已停用的下级不算）', async () => {
    const district = await addUnit('district', org.hq);
    await addUnit('station', district);
    await addUnit('station', district, new Date(T0 - DAY_MS));
    const body = await refused(PHONES.root, district, people.root, 'org-has-active-children');
    expect(body).toEqual({ result: 'invalid-state', message: expect.stringContaining('1 个未停用的下级机构') });
  });

  it('有生效任职，人员已停用也算 → org-has-assignments', async () => {
    const station = await addUnit('station', org.deptA);
    await addPerson({ orgUnitId: station, role: '经办', deactivated: true });
    const body = await refused(PHONES.adminA, station, people.adminA, 'org-has-assignments');
    expect(body).toEqual({ result: 'invalid-state', message: expect.stringContaining('1 条生效任职') });
    expect(body).not.toHaveProperty('reason');
  });

  it('未办结前提（接缝③注入线索 1、案件 2）→ reason org-has-open-items、openItems 条数、可读原因含「3 条」', async () => {
    const station = await addUnit('station', org.deptA);
    openItemsByUnit.set(station, { clues: 1, cases: 2 });
    const body = await refused(PHONES.adminA, station, people.adminA, 'org-has-open-items');
    expect(body).toEqual({
      result: 'invalid-state',
      reason: 'org-has-open-items',
      openItems: { clues: 1, cases: 2 },
      message: '本机构还有 3 条未办结的线索或案件（线索 1 条、案件 2 条），全部办结后才能停用。',
    });
    expect(body.message).toContain('3 条');
  });

  it('计数为 0 时照常停用', async () => {
    const station = await addUnit('station', org.deptA);
    openItemsByUnit.set(station, { clues: 0, cases: 0 });
    expect((await deactivate(PHONES.adminA, station)).status).toBe(200);
    expect(await deactivatedAtOf(station)).not.toBeNull();
  });

  it('几条同时不满足只返回第一条：下级 + 任职 + 未办结 → 下级；任职 + 未办结 → 任职', async () => {
    const district = await addUnit('district', org.hq);
    await addUnit('station', district);
    await addPerson({ orgUnitId: district, role: '经办' });
    openItemsByUnit.set(district, { clues: 4, cases: 0 });
    await refused(PHONES.root, district, people.root, 'org-has-active-children');

    const station = await addUnit('station', org.deptA);
    await addPerson({ orgUnitId: station, role: '经办' });
    openItemsByUnit.set(station, { clues: 0, cases: 1 });
    await refused(PHONES.adminA, station, people.adminA, 'org-has-assignments');
  });
});

describe('四条必测：403 + authz.denied，业务行不变', () => {
  async function denied(phone: string, id: string, actorId: string, reason: string) {
    await signIn(phone);
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await deactivate(phone, id);
    expect(response.status).toBe(403);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ reason });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', outcome: 'failed', reason, actor_id: actorId,
        opcode: 'org.unit.deactivate', resource_type: 'org-unit', resource_id: id,
      }),
    ]);
    return text;
  }

  it.each([
    ['没有该码（内勤）', 'intake'],
    ['没有该码（经办）', 'clerk'],
    ['监督', 'supervisor'],
  ] as const)('%s → 403 permission-denied', async (_label, who) => {
    const station = await addUnit('station', org.deptA);
    await denied(PHONES[who], station, people[who], 'permission-denied');
  });

  it('跨区：区 A 管理停用区 B 下的所 → 403 scope-denied；有未办结事项也不暴露条数', async () => {
    const station = await addUnit('station', org.deptB);
    openItemsByUnit.set(station, { clues: 1, cases: 2 });
    const text = await denied(PHONES.adminA, station, people.adminA, 'scope-denied');
    expect(text).not.toContain('openItems');
    expect(text).not.toContain('条');
    expect(await deactivatedAtOf(station)).toBeNull();
  });

  it('跨区：区 A 管理停用根机构 → 403 scope-denied（越权先于根机构判定）', async () => {
    await denied(PHONES.adminA, org.hq, people.adminA, 'scope-denied');
  });

  it('不存在的机构 → 403 scope-denied', async () => {
    await denied(PHONES.root, newUlid(), people.root, 'scope-denied');
  });

  it('跨站请求（外站 Origin、Sec-Fetch-Site: cross-site）被拒，业务行不变，不写留痕', async () => {
    const station = await addUnit('station', org.deptA);
    const crossSite: Array<Record<string, string>> = [
      { origin: 'https://evil.example' },
      { 'sec-fetch-site': 'cross-site' },
    ];
    await signIn(PHONES.root);
    for (const headers of crossSite) {
      const rowsBefore = await businessRows();
      const before = await audits();
      const response = await deactivate(PHONES.root, station, headers);
      expect(response.status, JSON.stringify(headers)).toBe(403);
      expect(await businessRows()).toEqual(rowsBefore);
      expect(added(before, await audits())).toEqual([]);
    }
    expect(await deactivatedAtOf(station)).toBeNull();
  });
});

describe('接缝①：留痕工厂覆写为「业务写完后抛错」', () => {
  it('停用：请求失败，机构仍未停用，不写留痕', async () => {
    const station = await addUnit('station', org.deptA);
    await signIn(PHONES.root, seamUrl);
    const rowsBefore = await businessRows();
    const before = await audits();
    seam.armed = true;
    try {
      expect((await deactivate(PHONES.root, station, {}, seamUrl)).status).toBe(500);
    } finally {
      seam.armed = false;
    }
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });
});

describe('接缝②：停用与在该机构下新建下级并发（两套连接加屏障），只有一方成功', () => {
  it('新建下级先拿到上级行锁：停用等它提交后看到新下级，409 org-has-active-children', async () => {
    const district = await addUnit('district', org.hq);
    await signIn(PHONES.root, barrierUrl);
    await signIn(PHONES.root);
    armBarrier('org.unit.registered');
    const registering = register(PHONES.root, district, '并发新建的所', barrierUrl);
    await barrier.entered.promise;
    const deactivating = deactivate(PHONES.root, district);
    expect(await settledWithin(deactivating, 400)).toBe(false);
    barrier.release.resolve();
    const [registered, refused] = await Promise.all([registering, deactivating]);
    expect(registered.status).toBe(200);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ result: 'invalid-state', message: expect.stringContaining('下级机构') });
    expect(await deactivatedAtOf(district)).toBeNull();
    expect(await cloned.prisma.orgUnit.count({ where: { parentId: district } })).toBe(1);
  });

  it('停用先拿到行锁：新建下级等它提交后看到已停用，409 invalid-state，不留下已停用机构下的新下级', async () => {
    const district = await addUnit('district', org.hq);
    await signIn(PHONES.root, barrierUrl);
    await signIn(PHONES.root);
    armBarrier('org.unit.deactivated');
    const deactivating = deactivate(PHONES.root, district, {}, barrierUrl);
    await barrier.entered.promise;
    const registering = register(PHONES.root, district, '并发新建的所');
    expect(await settledWithin(registering, 400)).toBe(false);
    barrier.release.resolve();
    const [deactivated, refused] = await Promise.all([deactivating, registering]);
    expect(deactivated.status).toBe(200);
    expect(refused.status).toBe(409);
    expect(await deactivatedAtOf(district)).not.toBeNull();
    expect(await cloned.prisma.orgUnit.count({ where: { parentId: district } })).toBe(0);
  });
});
