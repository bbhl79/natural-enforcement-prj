// #130 人员停用、恢复与结束全部会话（含遗留口径①：停用态人员禁止编辑与调岗）。
// 断言打在 HTTP 状态码、响应体、人员与任职相关各表的行、会话与记住我各表的行、留痕行上。断言打在克隆库上。
// 每个接口的四条必测（#105 Testing）：没有该码、跨区、监督、跨站请求。
// 每个 403/409 用例同时断言失败留痕行存在、业务行不变。
// 接缝①：留痕工厂「业务写完后抛错」。接缝②：两个应用实例（两套连接池）加屏障的并发。
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaAuditTrailFactory, type AuditTrailFactory } from '@natural-enforcement/audit';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-18T03:00:00.000Z');
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Person-130-ok!';
const NEW_PASSWORD = 'Person-130-new!';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SEAM_ERROR = '接缝①：业务写完后抛错（#130）';
const ROOT_GUARD_MESSAGE_PART = '根机构上只剩这一名系统管理人员';
const DEACTIVATED_OPCODE = 'personnel.profile.deactivate';
const RESTORE_OPCODE = 'personnel.profile.restore';
const SESSIONS_OPCODE = 'personnel.sessions.end';

const PHONES = {
  root1: '13800013001',
  root2: '13800013002',
  adminA: '13800013003',
  intake: '13800013004',
  clerk: '13800013005',
  supervisor: '13800013006',
  target: '13800013007',
  targetB: '13800013008',
  homeless: '13800013009',
  seam: '13800013011',
  plain: '13800013013',
  restored: '13800013014',
  lockedOff: '13800013015',
  offPerson: '13800013016',
  active: '13800013017',
  residual: '13800013018',
  sessions: '13800013019',
  noSessions: '13800013020',
  seamRestore: '13800013021',
  seamSessions: '13800013022',
  editOff: '13800013023',
  transferOff: '13800013024',
  pairA: '13800013025',
  pairB: '13800013026',
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

/** 接缝①：先照常写下留痕，再抛错。armed 为假时与默认工厂相同。 */
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

/** 接缝②：屏障。指定动作的成功留痕写下后（业务行已写、事务未提交、锁仍持有）停住，等放行。 */
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
let seamUrl = '';
let barrierUrl = '';
const closers: Array<() => Promise<void>> = [];
let passwordHash = '';
const org = { hq: '', deptA: '', deptB: '', station: '', offStation: '' };
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
  opcode: string | null;
  resource_type: string | null;
  resource_id: string | null;
  previous_value: string | null;
  next_value: string | null;
  target_org_unit_id: string | null;
  target_org_unit_basis: string | null;
};

async function audits(): Promise<AuditRecord[]> {
  return cloned.prisma.$queryRaw<AuditRecord[]>`
    SELECT id, action, outcome, reason, actor_id, actor_code, subject_personnel_id, subject_code, org_unit_id,
           opcode, resource_type, resource_id, previous_value, next_value,
           target_org_unit_id, target_org_unit_basis
    FROM audit_trail
    ORDER BY created_at, id
  `;
}

function added(before: AuditRecord[], after: AuditRecord[]): AuditRecord[] {
  const known = new Set(before.map((row) => row.id));
  return after.filter((row) => !known.has(row.id));
}

/** 业务行：人员、名称版本、任职、人员—角色、人员—岗位标记、机构六张表的全部行。 */
async function businessRows(): Promise<string[]> {
  const rows = await cloned.prisma.$queryRaw<Array<{ row: unknown }>>`
    SELECT row_to_json(t)::text AS row FROM (
      SELECT 'personnel' AS tbl, id, row_to_json(p)::text AS body FROM personnel p
      UNION ALL SELECT 'personnel_name_version', id, row_to_json(v)::text FROM personnel_name_version v
      UNION ALL SELECT 'personnel_assignment', id, row_to_json(a)::text FROM personnel_assignment a
      UNION ALL SELECT 'personnel_role', id, row_to_json(r)::text FROM personnel_role r
      UNION ALL SELECT 'personnel_post', id, row_to_json(s)::text FROM personnel_post s
      UNION ALL SELECT 'org_unit', id, row_to_json(o)::text FROM org_unit o
    ) t ORDER BY tbl, id
  `;
  return rows.map((item) => String(item.row));
}

/** 会话与记住我的行：结束会话类用例的「业务行不变」。 */
async function credentialRows(): Promise<string[]> {
  const rows = await cloned.prisma.$queryRaw<Array<{ row: unknown }>>`
    SELECT row_to_json(t)::text AS row FROM (
      SELECT 'auth_session' AS tbl, id, row_to_json(s)::text AS body FROM auth_session s
      UNION ALL SELECT 'auth_remember_me', id, row_to_json(r)::text FROM auth_remember_me r
      UNION ALL SELECT 'personnel', id, row_to_json(p)::text FROM personnel p
    ) t ORDER BY tbl, id
  `;
  return rows.map((item) => String(item.row));
}

async function roleId(name: string): Promise<string> {
  return (await cloned.prisma.role.findFirstOrThrow({ where: { name, deactivatedAt: null } })).id;
}

async function addPerson(input: {
  code: string;
  phone: string;
  orgUnitId: string;
  roles: string[];
  assign?: boolean;
  deactivated?: boolean;
  locked?: boolean;
}): Promise<string> {
  const id = newUlid();
  await cloned.prisma.personnel.create({
    data: {
      id,
      code: input.code,
      name: input.code,
      orgUnitId: input.orgUnitId,
      passwordHash,
      mobilePhone: input.phone,
      passwordChangedAt: new Date(T0 - 10 * DAY_MS),
      deactivatedAt: input.deactivated ? new Date(T0 - DAY_MS) : null,
      lockedUntil: input.locked ? new Date(T0 + DAY_MS) : null,
      passwordFailureCount: input.locked ? 5 : 0,
    },
  });
  if (input.assign !== false) {
    await cloned.prisma.personnelAssignment.create({
      data: { id: newUlid(), personnelId: id, orgUnitId: input.orgUnitId },
    });
  }
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

async function login(phone: string, url = baseUrl, rememberMe = false): Promise<Response> {
  return fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: phone, password: PASSWORD, rememberMe }),
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
  const response = await login(phone, url);
  expect(response.status).toBe(200);
  const pair = cookieOf(response);
  cookies.set(key, pair);
  return pair;
}

async function post(
  path: string,
  phone: string,
  payload: unknown = {},
  headers: Record<string, string> = {},
  url = baseUrl,
): Promise<Response> {
  return fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await signIn(phone, url), ...headers },
    body: JSON.stringify(payload),
  });
}

const deactivate = (phone: string, id: string, headers = {}, url = baseUrl): Promise<Response> =>
  post(`/api/admin/personnel/${id}/deactivate`, phone, {}, headers, url);

const restore = (
  phone: string,
  id: string,
  payload: unknown,
  headers = {},
  url = baseUrl,
): Promise<Response> => post(`/api/admin/personnel/${id}/restore`, phone, payload, headers, url);

const endSessions = (phone: string, id: string, headers = {}, url = baseUrl): Promise<Response> =>
  post(`/api/admin/personnel/${id}/end-sessions`, phone, {}, headers, url);

const edit = (phone: string, id: string, payload: unknown): Promise<Response> =>
  post(`/api/admin/personnel/${id}/edit`, phone, payload);

const transfer = (phone: string, id: string, orgUnitId: unknown): Promise<Response> =>
  post(`/api/admin/personnel/${id}/transfer`, phone, { orgUnitId });

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

/** 在 ms 毫秒内是否已经有结果（用来断言「被锁挡住」）。 */
async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, ms));
  return settled;
}

async function personnelRow(id: string) {
  return cloned.prisma.personnel.findUniqueOrThrow({ where: { id } });
}

async function currentOrg(personnelId: string): Promise<string | null> {
  const row = await cloned.prisma.personnelAssignment.findFirst({
    where: { personnelId, endedAt: null },
    orderBy: { startedAt: 'desc' },
  });
  return row?.orgUnitId ?? null;
}

async function activeSessions(personnelId: string): Promise<number> {
  return cloned.prisma.authSession.count({ where: { personnelId, endedAt: null } });
}

async function activeRemember(personnelId: string): Promise<number> {
  return cloned.prisma.authRememberMe.count({ where: { personnelId, endedAt: null } });
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const byCode = async (code: string) => (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code } })).id;
  org.hq = await byCode('ORG-HQ');
  org.deptA = await byCode('ORG-DEPT-A');
  org.deptB = await byCode('ORG-DEPT-B');
  org.station = await byCode('ORG-STATION-A');
  org.offStation = newUlid();
  await cloned.prisma.orgUnit.create({
    data: {
      id: org.offStation,
      code: 'ORG-130-OFF',
      name: '已停用所',
      level: 'station',
      parentId: org.deptA,
      deactivatedAt: new Date(T0 - DAY_MS),
    },
  });
  await cloned.prisma.orgUnitNameVersion.create({
    data: { id: newUlid(), orgUnitId: org.offStation, name: '已停用所', version: 1 },
  });
  passwordHash = await hash(PASSWORD, PINNED);
  // 种子里的根机构系统管理 P-ADMIN-HQ 先停用：根机构守卫的计数只由本文件的夹具决定（写法照 #129）。
  const seededAdmin = await cloned.prisma.personnel.findUniqueOrThrow({ where: { code: 'P-ADMIN-HQ' } });
  await cloned.prisma.personnel.update({
    where: { id: seededAdmin.id },
    data: { deactivatedAt: new Date(T0 - DAY_MS) },
  });
  people.root1 = await addPerson({ code: 'P-130-ROOT1', phone: PHONES.root1, orgUnitId: org.hq, roles: ['系统管理', '经办'] });
  people.root2 = await addPerson({ code: 'P-130-ROOT2', phone: PHONES.root2, orgUnitId: org.hq, roles: ['系统管理', '经办'] });
  people.adminA = await addPerson({ code: 'P-130-ADM-A', phone: PHONES.adminA, orgUnitId: org.deptA, roles: ['系统管理'] });
  people.intake = await addPerson({ code: 'P-130-INTAKE', phone: PHONES.intake, orgUnitId: org.hq, roles: ['内勤'] });
  people.clerk = await addPerson({ code: 'P-130-CLERK', phone: PHONES.clerk, orgUnitId: org.station, roles: ['经办'] });
  people.supervisor = await addPerson({ code: 'P-130-SUPER', phone: PHONES.supervisor, orgUnitId: org.deptA, roles: ['监督'] });
  people.target = await addPerson({ code: 'P-130-TARGET', phone: PHONES.target, orgUnitId: org.deptA, roles: ['经办'] });
  people.targetB = await addPerson({ code: 'P-130-TGT-B', phone: PHONES.targetB, orgUnitId: org.deptB, roles: ['经办'] });
  people.homeless = await addPerson({
    code: 'P-130-NONE', phone: PHONES.homeless, orgUnitId: org.deptA, roles: ['系统管理'], assign: false,
  });
  people.seam = await addPerson({ code: 'P-130-SEAM', phone: PHONES.seam, orgUnitId: org.deptA, roles: ['经办'] });
  people.plain = await addPerson({ code: 'P-130-PLAIN', phone: PHONES.plain, orgUnitId: org.hq, roles: ['经办'] });
  people.residOff = await addPerson({ code: 'P-130-RESID2', phone: '13800013027', orgUnitId: org.deptA, roles: ['经办'] });
  people.restored = await addPerson({
    code: 'P-130-REST', phone: PHONES.restored, orgUnitId: org.deptA, roles: ['经办'], deactivated: true,
  });
  people.lockedOff = await addPerson({
    code: 'P-130-LOCK', phone: PHONES.lockedOff, orgUnitId: org.deptA, roles: ['经办'], deactivated: true, locked: true,
  });
  people.offPerson = await addPerson({
    code: 'P-130-OFF', phone: PHONES.offPerson, orgUnitId: org.offStation, roles: ['经办'], deactivated: true,
  });
  people.active = await addPerson({ code: 'P-130-ACTIVE', phone: PHONES.active, orgUnitId: org.deptA, roles: ['经办'] });
  people.residual = await addPerson({
    code: 'P-130-RESID', phone: PHONES.residual, orgUnitId: org.deptA, roles: ['经办'],
  });
  people.sessions = await addPerson({ code: 'P-130-SESS', phone: PHONES.sessions, orgUnitId: org.deptA, roles: ['经办'] });
  people.noSessions = await addPerson({ code: 'P-130-NOSESS', phone: PHONES.noSessions, orgUnitId: org.deptA, roles: ['经办'] });
  people.seamRestore = await addPerson({
    code: 'P-130-SEAMR', phone: PHONES.seamRestore, orgUnitId: org.deptA, roles: ['经办'], deactivated: true,
  });
  people.seamSessions = await addPerson({ code: 'P-130-SEAMS', phone: PHONES.seamSessions, orgUnitId: org.deptA, roles: ['经办'] });
  people.editOff = await addPerson({
    code: 'P-130-EDOFF', phone: PHONES.editOff, orgUnitId: org.deptA, roles: ['经办'], deactivated: true,
  });
  people.transferOff = await addPerson({
    code: 'P-130-TROFF', phone: PHONES.transferOff, orgUnitId: org.deptA, roles: ['经办'], deactivated: true,
  });
  people.pairA = await addPerson({ code: 'P-130-C1A', phone: PHONES.pairA, orgUnitId: org.hq, roles: ['系统管理', '经办'] });
  people.pairB = await addPerson({ code: 'P-130-C1B', phone: PHONES.pairB, orgUnitId: org.hq, roles: ['系统管理', '经办'] });

  baseUrl = await startApp();
  seamUrl = await startApp(failingFactory);
  barrierUrl = await startApp(barrierFactory);
  // 先登录：登录本身写 login.succeeded，各用例的「新增留痕」只看接口这一步。
  for (const phone of [PHONES.root1, PHONES.root2, PHONES.adminA, PHONES.intake, PHONES.clerk,
    PHONES.supervisor, PHONES.target, PHONES.targetB, PHONES.active,
    PHONES.sessions, PHONES.seamSessions, PHONES.plain]) {
    await signIn(phone);
  }
  await signIn(PHONES.root1, seamUrl);
  await signIn(PHONES.adminA, seamUrl);
  await signIn(PHONES.root1, barrierUrl);
}, 90_000);

afterAll(async () => {
  seam.armed = false;
  barrier.release.resolve();
  for (const close of closers) await close();
  await cloned?.close();
});

describe('POST /api/admin/personnel/:id/deactivate（停用）', () => {
  it('停用成功：人员置失效时间，写 personnel.deactivated；这次请求不结束对方会话', async () => {
    const before = await audits();
    const response = await deactivate(PHONES.adminA, people.target);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'deactivated' });
    expect((await personnelRow(people.target)).deactivatedAt).not.toBeNull();
    // 会话在下一次请求时结束（#105 故事 36）：停用这次不动会话表。
    expect(await activeSessions(people.target)).toBe(1);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.deactivated', outcome: 'succeeded', reason: null,
        actor_id: people.adminA, actor_code: 'P-130-ADM-A',
        subject_personnel_id: people.target, subject_code: 'P-130-TARGET',
        org_unit_id: org.deptA, opcode: DEACTIVATED_OPCODE,
        resource_type: 'personnel', resource_id: people.target,
        previous_value: null, next_value: null,
      }),
    ]);
  });

  it('停用后对方下一次请求即被带回登录页：401，会话与记住我结束，写 session.ended（personnel-deactivated）', async () => {
    // residual 先登录并带上「记住我」，再被停用；此后它自己发一次请求。
    const first = await login(PHONES.residual, baseUrl, true);
    expect(first.status).toBe(200);
    const sid = cookieOf(first);
    expect((await deactivate(PHONES.adminA, people.residual)).status).toBe(200);
    expect(await activeSessions(people.residual)).toBe(1);
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/admin/personnel`, { headers: { cookie: sid } });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ reason: 'not-authenticated' });
    expect(await activeSessions(people.residual)).toBe(0);
    expect(await activeRemember(people.residual)).toBe(0);
    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.reason])).toEqual([
      ['session.ended', 'personnel-deactivated'],
      ['authz.denied', 'not-authenticated'],
    ]);
    // 停用后不能再登录。
    const again = await login(PHONES.residual);
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual({ result: 'deactivated' });
  });

  it('重复停用：200，不写行，不改首次停用时间', async () => {
    const first = await personnelRow(people.target);
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await deactivate(PHONES.adminA, people.target);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'deactivated' });
    expect((await personnelRow(people.target)).deactivatedAt).toEqual(first.deactivatedAt);
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('没有当前任职的人员：锚点视同根机构，区系统管理够不着，根机构系统管理可以停用', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const denied = await deactivate(PHONES.adminA, people.homeless);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ reason: 'scope-denied' });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', actor_id: people.adminA,
        opcode: DEACTIVATED_OPCODE, resource_id: people.homeless,
        target_org_unit_id: org.hq, target_org_unit_basis: 'object',
      }),
    ]);
    const allowed = await deactivate(PHONES.root1, people.homeless);
    expect(allowed.status).toBe(200);
    expect((await personnelRow(people.homeless)).deactivatedAt).not.toBeNull();
    // 还原夹具。
    await cloned.prisma.personnel.update({ where: { id: people.homeless }, data: { deactivatedAt: null } });
  });

  const deniedBy: Array<[string, string]> = [
    ['没有该码（内勤）', PHONES.intake],
    ['没有该码（经办）', PHONES.clerk],
    ['监督', PHONES.supervisor],
  ];
  it.each(deniedBy)('%s → 403 permission-denied + authz.denied，业务行不变', async (_label, phone) => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await deactivate(phone, people.active);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', outcome: 'failed', reason: 'permission-denied',
        opcode: DEACTIVATED_OPCODE, resource_type: 'personnel', resource_id: people.active,
      }),
    ]);
  });

  it('跨区：区 A 系统管理停用区 B 人员 → 403 scope-denied + authz.denied，业务行不变', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await deactivate(PHONES.adminA, people.targetB);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', actor_id: people.adminA,
        opcode: DEACTIVATED_OPCODE, resource_type: 'personnel', resource_id: people.targetB,
        target_org_unit_id: org.deptB, target_org_unit_basis: 'object',
      }),
    ]);
  });

  it('跨站写请求被拒，业务行不变，不写留痕', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    expect((await deactivate(PHONES.root1, people.active, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await deactivate(PHONES.root1, people.active, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('守卫一：不能停用自己 → 403 permission-denied + authz.denied，业务行不变', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await deactivate(PHONES.adminA, people.adminA);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'permission-denied', actor_id: people.adminA,
        opcode: DEACTIVATED_OPCODE, resource_type: 'personnel', resource_id: people.adminA,
        subject_personnel_id: null, target_org_unit_id: org.deptA, target_org_unit_basis: 'object',
      }),
    ]);
  });

  it('人员不存在 → 404，不写留痕', async () => {
    const before = await audits();
    const response = await deactivate(PHONES.adminA, '01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ result: 'not-found' });
    expect(added(before, await audits())).toEqual([]);
  });

  it('守卫二（ADR 0014）只管「根机构任职 + 系统管理角色」：停用根机构上的非管理人员、停用区里的系统管理都照常放行', async () => {
    // 单次请求碰不到守卫：操作者本人必然就是根机构上另一名未停用的系统管理人员。
    // 守卫拦住的是并发交错，见下面的接缝②用例。
    expect((await deactivate(PHONES.root1, people.plain)).status).toBe(200);
    expect((await deactivate(PHONES.root1, people.adminA)).status).toBe(200);
    await cloned.prisma.personnel.updateMany({
      where: { id: { in: [people.plain, people.adminA] } },
      data: { deactivatedAt: null },
    });
  });

  it('接缝②：两名根机构系统管理并发互相停用，只有一方成功，另一方 409 root-admin-required', async () => {
    const suspended = await isolate([people.pairA, people.pairB]);
    try {
      await signIn(PHONES.pairA, barrierUrl);
      await signIn(PHONES.pairA);
      await signIn(PHONES.pairB);
      armBarrier('personnel.deactivated');
      // 先手：pairA 停用 pairB，成功留痕写下后停在事务里（咨询锁仍持有）。
      const first = deactivate(PHONES.pairA, people.pairB, {}, barrierUrl);
      await barrier.entered.promise;
      // 后手：pairB 停用 pairA，在咨询锁上等待。
      const second = deactivate(PHONES.pairB, people.pairA);
      expect(await settledWithin(second, 400)).toBe(false);
      const before = await audits();
      barrier.release.resolve();
      const [winner, loser] = await Promise.all([first, second]);
      expect(winner.status).toBe(200);
      expect(loser.status).toBe(409);
      expect(await loser.json()).toEqual({
        result: 'invalid-state',
        reason: 'root-admin-required',
        message: expect.stringContaining(ROOT_GUARD_MESSAGE_PART),
      });
      expect((await personnelRow(people.pairB)).deactivatedAt).not.toBeNull();
      expect((await personnelRow(people.pairA)).deactivatedAt).toBeNull();
      expect(added(before, await audits())).toEqual([
        expect.objectContaining({
          action: 'personnel.deactivated', outcome: 'succeeded', reason: null,
          actor_id: people.pairA, subject_personnel_id: people.pairB,
        }),
        expect.objectContaining({
          action: 'personnel.deactivated', outcome: 'failed', reason: 'root-admin-required',
          actor_id: people.pairB, subject_personnel_id: people.pairA,
        }),
      ]);
      // 还原夹具。
      await cloned.prisma.personnel.update({ where: { id: people.pairB }, data: { deactivatedAt: null } });
    } finally {
      await unsuspend(suspended);
    }
  });

  it('接缝①：留痕写入抛错，请求失败，人员行不停用', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    seam.armed = true;
    try {
      const response = await deactivate(PHONES.adminA, people.seam, {}, seamUrl);
      expect(response.status).toBe(500);
    } finally {
      seam.armed = false;
    }
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
    expect((await personnelRow(people.seam)).deactivatedAt).toBeNull();
  });
});

describe('POST /api/admin/personnel/:id/restore（恢复）', () => {
  it('恢复成功：置回未停用、写入新的初始口令、上次改密时间留空，写 personnel.restored 与 account.password-reset', async () => {
    const before = await audits();
    const response = await restore(PHONES.adminA, people.restored, { initialPassword: NEW_PASSWORD });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'restored', orgUnitId: org.deptA });
    expect(await personnelRow(people.restored)).toMatchObject({
      deactivatedAt: null,
      passwordChangedAt: null,
      lockedUntil: null,
      passwordFailureCount: 0,
    });
    expect((await personnelRow(people.restored)).passwordHash).not.toBe(passwordHash);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.restored', outcome: 'succeeded', reason: null,
        actor_id: people.adminA, actor_code: 'P-130-ADM-A',
        subject_personnel_id: people.restored, subject_code: 'P-130-REST',
        org_unit_id: org.deptA, opcode: RESTORE_OPCODE,
        resource_type: 'personnel', resource_id: people.restored,
      }),
      expect.objectContaining({
        action: 'account.password-reset', outcome: 'succeeded',
        actor_id: people.adminA, subject_personnel_id: people.restored, org_unit_id: org.deptA,
      }),
    ]);
  });

  it('恢复被锁的人：同时解锁，另写一行 account.unlocked', async () => {
    const before = await audits();
    const response = await restore(PHONES.adminA, people.lockedOff, { initialPassword: NEW_PASSWORD });
    expect(response.status).toBe(200);
    expect(await personnelRow(people.lockedOff)).toMatchObject({ lockedUntil: null, passwordFailureCount: 0 });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({ action: 'personnel.restored', outcome: 'succeeded' }),
      expect.objectContaining({ action: 'account.password-reset', outcome: 'succeeded' }),
      expect.objectContaining({
        action: 'account.unlocked', outcome: 'succeeded',
        actor_id: people.adminA, subject_personnel_id: people.lockedOff,
      }),
    ]);
  });

  it('恢复后：新初始口令登录被强制改密，旧口令不再可用', async () => {
    // residual 在上一节被停用（本人发过一次请求，会话与记住我已在当时结束）。
    expect((await restore(PHONES.adminA, people.residual, { initialPassword: NEW_PASSWORD })).status).toBe(200);
    const before = await audits();
    const fresh = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobilePhone: PHONES.residual, password: NEW_PASSWORD, rememberMe: false }),
    });
    expect(fresh.status).toBe(200);
    expect(await fresh.json()).toEqual({ result: 'password-change-required' });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'login.password-change-required', outcome: 'succeeded',
        subject_personnel_id: people.residual,
      }),
    ]);
    // 旧口令不再可用。
    const oldPassword = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mobilePhone: PHONES.residual, password: PASSWORD, rememberMe: false }),
    });
    expect(oldPassword.status).toBe(401);
    expect(await oldPassword.json()).toEqual({ result: 'invalid-credential' });
  });

  it('结束残余会话与「记住我」：停用前登录的会话在恢复时结束，每段写 session.ended（admin-ended）', async () => {
    const first = await login('13800013027', baseUrl, true);
    expect(first.status).toBe(200);
    const sid = cookieOf(first);
    expect((await deactivate(PHONES.adminA, people.residOff)).status).toBe(200);
    expect(await activeSessions(people.residOff)).toBe(1);
    expect(await activeRemember(people.residOff)).toBe(1);
    const before = await audits();
    const response = await restore(PHONES.adminA, people.residOff, { initialPassword: NEW_PASSWORD });
    expect(response.status).toBe(200);
    expect(await activeSessions(people.residOff)).toBe(0);
    expect(await activeRemember(people.residOff)).toBe(0);
    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.reason])).toEqual([
      ['personnel.restored', null],
      ['account.password-reset', null],
      ['session.ended', 'admin-ended'],
    ]);
    expect(await cloned.prisma.authSession.findFirstOrThrow({
      where: { personnelId: people.residOff },
      orderBy: { createdAt: 'desc' },
    })).toMatchObject({ endReason: 'admin-ended' });
    expect(await cloned.prisma.authRememberMe.findFirstOrThrow({
      where: { personnelId: people.residOff },
      orderBy: { createdAt: 'desc' },
    })).toMatchObject({ endReason: 'admin-ended' });
    // 旧会话不能再用来发请求。
    expect((await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: sid } })).status).toBe(401);
  });

  it('恢复未停用的人 → 409 invalid-state（not-deactivated），人员行与口令不变', async () => {
    const rowsBefore = await credentialRows();
    const before = await audits();
    const response = await restore(PHONES.adminA, people.active, { initialPassword: NEW_PASSWORD });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      result: 'invalid-state',
      reason: 'not-deactivated',
      message: expect.stringContaining('这个人员没有停用'),
    });
    expect(await credentialRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.restored', outcome: 'failed', reason: 'not-deactivated',
        actor_id: people.adminA, subject_personnel_id: people.active,
        opcode: RESTORE_OPCODE, resource_type: 'personnel', resource_id: people.active,
      }),
    ]);
  });

  it('原机构已停用：不带新机构 → 409 invalid-state（org-unit-required），人员仍停用', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await restore(PHONES.adminA, people.offPerson, { initialPassword: NEW_PASSWORD });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      result: 'invalid-state',
      reason: 'org-unit-required',
      message: expect.stringContaining('原任职机构已停用'),
    });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.restored', outcome: 'failed', reason: 'org-unit-required',
        opcode: RESTORE_OPCODE, resource_type: 'personnel', resource_id: people.offPerson,
      }),
    ]);
  });

  it('原机构已停用：新机构已停用 → 409 invalid-state（org-unit-deactivated），人员仍停用', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await restore(PHONES.adminA, people.offPerson, {
      initialPassword: NEW_PASSWORD,
      orgUnitId: org.offStation,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      result: 'invalid-state',
      reason: 'org-unit-deactivated',
      message: expect.stringContaining('已停用'),
    });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.restored', outcome: 'failed', reason: 'org-unit-deactivated',
        opcode: RESTORE_OPCODE,
      }),
    ]);
  });

  it('原机构已停用：新机构超出数据范围 → 403 scope-denied + authz.denied，人员仍停用', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await restore(PHONES.adminA, people.offPerson, {
      initialPassword: NEW_PASSWORD,
      orgUnitId: org.deptB,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', actor_id: people.adminA,
        opcode: RESTORE_OPCODE, resource_type: 'org-unit', resource_id: org.deptB,
        target_org_unit_id: org.deptB, target_org_unit_basis: 'object',
      }),
    ]);
  });

  it('原机构已停用：带合格新机构 → 200，恢复与调岗同事务完成，另写 personnel.transferred', async () => {
    const before = await audits();
    const response = await restore(PHONES.adminA, people.offPerson, {
      initialPassword: NEW_PASSWORD,
      orgUnitId: org.station,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'restored', orgUnitId: org.station });
    expect(await personnelRow(people.offPerson)).toMatchObject({ deactivatedAt: null, orgUnitId: org.station });
    expect(await currentOrg(people.offPerson)).toBe(org.station);
    const assignments = await cloned.prisma.personnelAssignment.findMany({
      where: { personnelId: people.offPerson },
      orderBy: { startedAt: 'asc' },
    });
    expect(assignments).toHaveLength(2);
    expect(assignments[0]).toMatchObject({ orgUnitId: org.offStation });
    expect(assignments[0].endedAt).not.toBeNull();
    expect(assignments[1]).toMatchObject({ orgUnitId: org.station, endedAt: null });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.restored', outcome: 'succeeded', org_unit_id: org.offStation,
        subject_personnel_id: people.offPerson,
      }),
      expect.objectContaining({
        action: 'personnel.transferred', outcome: 'succeeded', org_unit_id: org.offStation,
        previous_value: '已停用所', next_value: '甲区执法所', opcode: RESTORE_OPCODE,
      }),
      expect.objectContaining({ action: 'account.password-reset', outcome: 'succeeded' }),
    ]);
  });

  it('口令不合规 → 400 non-compliant，不写留痕，人员仍停用', async () => {
    const rowsBefore = await credentialRows();
    const before = await audits();
    const response = await restore(PHONES.adminA, people.seamRestore, { initialPassword: 'abc' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { result: string; rules: string[] };
    expect(body.result).toBe('non-compliant');
    expect(body.rules).toContain('too-short');
    expect(await credentialRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  const restoreDeniedBy: Array<[string, string]> = [
    ['没有该码（内勤）', PHONES.intake],
    ['没有该码（经办）', PHONES.clerk],
    ['监督', PHONES.supervisor],
  ];
  it.each(restoreDeniedBy)('恢复：%s → 403 permission-denied + authz.denied，业务行不变', async (_label, phone) => {
    const rowsBefore = await credentialRows();
    const before = await audits();
    const response = await restore(phone, people.noSessions, { initialPassword: NEW_PASSWORD });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(await credentialRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', outcome: 'failed', reason: 'permission-denied',
        opcode: RESTORE_OPCODE, resource_type: 'personnel', resource_id: people.noSessions,
      }),
    ]);
  });

  it('恢复：跨区 → 403 scope-denied + authz.denied，业务行不变', async () => {
    const offB = await addPerson({
      code: 'P-130-OFF-B', phone: '13800013090', orgUnitId: org.deptB, roles: ['经办'], deactivated: true,
    });
    const rowsBefore = await credentialRows();
    const before = await audits();
    const response = await restore(PHONES.adminA, offB, { initialPassword: NEW_PASSWORD });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(await credentialRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', opcode: RESTORE_OPCODE,
        resource_id: offB, target_org_unit_id: org.deptB, target_org_unit_basis: 'object',
      }),
    ]);
  });

  it('恢复：跨站写请求被拒，业务行不变，不写留痕', async () => {
    const rowsBefore = await credentialRows();
    const before = await audits();
    const payload = { initialPassword: NEW_PASSWORD };
    expect((await restore(PHONES.adminA, people.noSessions, payload, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await restore(PHONES.adminA, people.noSessions, payload, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(await credentialRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('守卫一：不能恢复自己 → 403 permission-denied + authz.denied，业务行不变', async () => {
    const rowsBefore = await credentialRows();
    const before = await audits();
    const response = await restore(PHONES.adminA, people.adminA, { initialPassword: NEW_PASSWORD });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(await credentialRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'permission-denied', actor_id: people.adminA,
        opcode: RESTORE_OPCODE, resource_type: 'personnel', resource_id: people.adminA,
        subject_personnel_id: null, target_org_unit_id: org.deptA, target_org_unit_basis: 'object',
      }),
    ]);
  });

  it('恢复：人员不存在 → 404，不写留痕', async () => {
    const before = await audits();
    const response = await restore(PHONES.adminA, '01ARZ3NDEKTSV4RRFFQ69G5FAV', { initialPassword: NEW_PASSWORD });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ result: 'not-found' });
    expect(added(before, await audits())).toEqual([]);
  });

  it('接缝①：恢复请求失败，人员仍停用，口令散列不变，不写留痕', async () => {
    const rowsBefore = await credentialRows();
    const before = await audits();
    seam.armed = true;
    try {
      const response = await restore(PHONES.adminA, people.seamRestore, { initialPassword: NEW_PASSWORD }, {}, seamUrl);
      expect(response.status).toBe(500);
    } finally {
      seam.armed = false;
    }
    expect(await credentialRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
    expect((await personnelRow(people.seamRestore)).deactivatedAt).not.toBeNull();
  });
});

describe('POST /api/admin/personnel/:id/end-sessions（结束全部会话）', () => {
  it('结束全部会话：每段写 session.ended（admin-ended），另写一行 personnel.sessions-ended，口令不变', async () => {
    // beforeAll 已登录一段；这里再登录一段并带上「记住我」。
    const second = await login(PHONES.sessions, baseUrl, true);
    expect(second.status).toBe(200);
    const sid = cookieOf(second);
    const hashBefore = (await personnelRow(people.sessions)).passwordHash;
    const changedBefore = (await personnelRow(people.sessions)).passwordChangedAt;
    const activeBefore = await activeSessions(people.sessions);
    expect(activeBefore).toBeGreaterThan(0);
    const before = await audits();
    const response = await endSessions(PHONES.adminA, people.sessions);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'ended' });
    expect(await activeSessions(people.sessions)).toBe(0);
    expect(await activeRemember(people.sessions)).toBe(0);
    const row = await personnelRow(people.sessions);
    expect(row.passwordHash).toBe(hashBefore);
    expect(row.passwordChangedAt).toEqual(changedBefore);
    const rows = added(before, await audits());
    expect(rows.map((item) => [item.action, item.reason])).toEqual([
      ...Array.from({ length: activeBefore }, () => ['session.ended', 'admin-ended']),
      ['personnel.sessions-ended', null],
    ]);
    expect(rows.at(-1)).toEqual(expect.objectContaining({
      outcome: 'succeeded', actor_id: people.adminA, actor_code: 'P-130-ADM-A',
      subject_personnel_id: people.sessions, subject_code: 'P-130-SESS',
      org_unit_id: org.deptA, opcode: SESSIONS_OPCODE,
      resource_type: 'personnel', resource_id: people.sessions,
    }));
    // 对方的会话立刻不可用。
    expect((await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: sid } })).status).toBe(401);
  });

  it('没有会话时也返回 200，只写一行 personnel.sessions-ended', async () => {
    const before = await audits();
    const response = await endSessions(PHONES.adminA, people.noSessions);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'ended' });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.sessions-ended', outcome: 'succeeded',
        subject_personnel_id: people.noSessions, opcode: SESSIONS_OPCODE,
      }),
    ]);
  });

  const sessionsDeniedBy: Array<[string, string]> = [
    ['没有该码（内勤）', PHONES.intake],
    ['没有该码（经办）', PHONES.clerk],
    ['监督', PHONES.supervisor],
  ];
  it.each(sessionsDeniedBy)('结束会话：%s → 403 permission-denied + authz.denied，会话行不变', async (_label, phone) => {
    const rowsBefore = await credentialRows();
    const before = await audits();
    const response = await endSessions(phone, people.target);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(await credentialRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', outcome: 'failed', reason: 'permission-denied',
        opcode: SESSIONS_OPCODE, resource_type: 'personnel', resource_id: people.target,
      }),
    ]);
  });

  it('结束会话：跨区 → 403 scope-denied + authz.denied，会话行不变', async () => {
    const rowsBefore = await credentialRows();
    const before = await audits();
    const response = await endSessions(PHONES.adminA, people.targetB);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(await credentialRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', opcode: SESSIONS_OPCODE,
        resource_id: people.targetB, target_org_unit_id: org.deptB, target_org_unit_basis: 'object',
      }),
    ]);
  });

  it('结束会话：跨站写请求被拒，会话行不变，不写留痕', async () => {
    const rowsBefore = await credentialRows();
    const before = await audits();
    expect((await endSessions(PHONES.root1, people.targetB, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await endSessions(PHONES.root1, people.targetB, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(await credentialRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('守卫一：不能结束自己的会话 → 403 permission-denied + authz.denied，会话行不变', async () => {
    const rowsBefore = await credentialRows();
    const before = await audits();
    const response = await endSessions(PHONES.adminA, people.adminA);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(await credentialRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'permission-denied', actor_id: people.adminA,
        opcode: SESSIONS_OPCODE, resource_id: people.adminA, subject_personnel_id: null,
        target_org_unit_id: org.deptA, target_org_unit_basis: 'object',
      }),
    ]);
  });

  it('结束会话：人员不存在 → 404，不写留痕', async () => {
    const before = await audits();
    const response = await endSessions(PHONES.adminA, '01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ result: 'not-found' });
    expect(added(before, await audits())).toEqual([]);
  });

  it('接缝①：结束会话请求失败，会话行与留痕不变', async () => {
    const rowsBefore = await credentialRows();
    const before = await audits();
    seam.armed = true;
    try {
      const response = await endSessions(PHONES.adminA, people.seamSessions, {}, seamUrl);
      expect(response.status).toBe(500);
    } finally {
      seam.armed = false;
    }
    expect(await credentialRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
    expect(await activeSessions(people.seamSessions)).toBe(1);
  });
});

describe('停用态人员禁止编辑与调岗（PR #148 复核遗留①，本票定口径）', () => {
  it('编辑已停用人员 → 409 invalid-state（personnel-deactivated），按要改的项各写一行失败留痕，业务行不变', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await edit(PHONES.adminA, people.editOff, {
      name: '改名不生效',
      mobilePhone: '13900013001',
      roles: ['法制审核'],
      posts: ['legal-review-lead'],
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      result: 'invalid-state',
      reason: 'personnel-deactivated',
      message: expect.stringContaining('已停用'),
    });
    expect(await businessRows()).toEqual(rowsBefore);
    const rows = added(before, await audits());
    expect(rows.map((row) => [row.action, row.outcome, row.reason])).toEqual([
      ['personnel.renamed', 'failed', 'personnel-deactivated'],
      ['personnel.mobile-changed', 'failed', 'personnel-deactivated'],
      ['personnel.role-revoked', 'failed', 'personnel-deactivated'],
      ['personnel.role-granted', 'failed', 'personnel-deactivated'],
      ['personnel.post-granted', 'failed', 'personnel-deactivated'],
    ]);
    expect(rows[0]).toEqual(expect.objectContaining({
      actor_id: people.adminA, subject_personnel_id: people.editOff,
      opcode: 'personnel.profile.update', previous_value: 'P-130-EDOFF',
    }));
    expect(rows[2]).toEqual(expect.objectContaining({ next_value: '经办' }));
    expect(rows[3]).toEqual(expect.objectContaining({ next_value: '法制审核' }));
    expect(rows[4]).toEqual(expect.objectContaining({ next_value: 'legal-review-lead' }));
  });

  it('编辑已停用人员但什么都没改 → 200，不写行、不写留痕（没有改动就没有动作）', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await edit(PHONES.adminA, people.editOff, {
      name: 'P-130-EDOFF',
      mobilePhone: PHONES.editOff,
      roles: ['经办'],
      posts: [],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'updated' });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('调岗已停用人员 → 409 invalid-state（personnel-deactivated），写一行 personnel.transferred 失败留痕，业务行不变', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await transfer(PHONES.adminA, people.transferOff, org.station);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      result: 'invalid-state',
      reason: 'personnel-deactivated',
      message: expect.stringContaining('已停用'),
    });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(await currentOrg(people.transferOff)).toBe(org.deptA);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.transferred', outcome: 'failed', reason: 'personnel-deactivated',
        actor_id: people.adminA, subject_personnel_id: people.transferOff,
        opcode: 'personnel.profile.update', next_value: '甲区执法所',
      }),
    ]);
  });
});

/** 让 keep 成为根机构上仅有的未停用系统管理人员：其余的临时停用，返回被停用的 id。 */
async function isolate(keep: string[]): Promise<string[]> {
  const admins = await cloned.prisma.personnel.findMany({
    where: {
      deactivatedAt: null,
      assignments: { some: { endedAt: null, orgUnitId: org.hq } },
      personnelRoles: { some: { deactivatedAt: null, role: { deactivatedAt: null, name: '系统管理' } } },
    },
  });
  const suspended: string[] = [];
  for (const admin of admins) {
    if (keep.includes(admin.id)) continue;
    await cloned.prisma.personnel.update({ where: { id: admin.id }, data: { deactivatedAt: new Date(T0 - DAY_MS) } });
    suspended.push(admin.id);
  }
  return suspended;
}

async function unsuspend(suspended: string[]): Promise<void> {
  for (const id of suspended) {
    await cloned.prisma.personnel.update({ where: { id }, data: { deactivatedAt: null } });
  }
  // 被临时停用期间发过请求的人，会话已经结束：丢掉缓存的 Cookie，下次用到时重新登录。
  cookies.clear();
}
