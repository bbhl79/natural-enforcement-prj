// #129 人员编辑与调岗（含岗位标记、根机构守卫 ADR 0014）。
// 断言打在 HTTP 状态码、响应体、人员与机构相关各表的行、留痕行上。断言打在克隆库上。
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
const PASSWORD = 'Person-129-ok!';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SEAM_ERROR = '接缝①：业务写完后抛错（#129）';
const ROOT_GUARD_MESSAGE_PART = '根机构上只剩这一名系统管理人员';

const PHONES = {
  root: '13800012901',
  root2: '13800012902',
  adminA: '13800012903',
  intake: '13800012904',
  clerk: '13800012905',
  supervisor: '13800012906',
  homeless: '13800012907',
  memberB: '13800012908',
  editor: '13800012909',
  roleTarget: '13800012910',
  pair1a: '13800012911',
  pair1b: '13800012912',
  pair2a: '13800012913',
  pair2b: '13800012914',
  mover: '13800012915',
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
const org = { hq: '', deptA: '', deptB: '', station: '', deactivated: '' };
const people = {
  root: '', root2: '', adminA: '', intake: '', clerk: '', supervisor: '', homeless: '',
  memberB: '', editor: '', roleTarget: '', mover: '',
};

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
  posts?: string[];
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
  for (const post of input.posts ?? []) {
    await cloned.prisma.personnelPost.create({ data: { id: newUlid(), personnelId: id, post } });
  }
  return id;
}

const cookies = new Map<string, string>();

async function login(phone: string, url = baseUrl): Promise<Response> {
  return fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: phone, password: PASSWORD, rememberMe: false }),
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

interface EditBody {
  name: string;
  mobilePhone: string;
  roles: string[];
  posts: string[];
}

async function edit(
  phone: string,
  id: string,
  payload: unknown,
  headers: Record<string, string> = {},
  url = baseUrl,
): Promise<Response> {
  return fetch(`${url}/api/admin/personnel/${id}/edit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await signIn(phone, url), ...headers },
    body: JSON.stringify(payload),
  });
}

async function transfer(
  phone: string,
  id: string,
  orgUnitId: unknown,
  headers: Record<string, string> = {},
  url = baseUrl,
): Promise<Response> {
  return fetch(`${url}/api/admin/personnel/${id}/transfer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await signIn(phone, url), ...headers },
    body: JSON.stringify({ orgUnitId }),
  });
}

async function destinations(
  phone: string,
  id: string,
  headers: Record<string, string> = {},
  url = baseUrl,
): Promise<Response> {
  return fetch(`${url}/api/admin/personnel/${id}/transfer-destinations`, {
    headers: { cookie: await signIn(phone, url), ...headers },
  });
}

async function opcodesOf(cookie: string): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } });
  return ((await response.json()) as { opcodes: string[] }).opcodes;
}

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

/** 当前人员未失效的角色名（升序）。 */
async function activeRoles(personnelId: string): Promise<string[]> {
  const rows = await cloned.prisma.personnelRole.findMany({
    where: { personnelId, deactivatedAt: null },
    include: { role: true },
  });
  return rows.map((row) => row.role.name).sort();
}

/** 当前人员未失效的岗位标记（升序）。 */
async function activePosts(personnelId: string): Promise<string[]> {
  const rows = await cloned.prisma.personnelPost.findMany({ where: { personnelId, deactivatedAt: null } });
  return rows.map((row) => row.post).sort();
}

/** 当前任职机构；没有当前任职为 null。 */
async function currentOrg(personnelId: string): Promise<string | null> {
  const row = await cloned.prisma.personnelAssignment.findFirst({
    where: { personnelId, endedAt: null },
    orderBy: { startedAt: 'desc' },
  });
  return row?.orgUnitId ?? null;
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const byCode = async (code: string) => (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code } })).id;
  org.hq = await byCode('ORG-HQ');
  org.deptA = await byCode('ORG-DEPT-A');
  org.deptB = await byCode('ORG-DEPT-B');
  org.station = await byCode('ORG-STATION-A');
  org.deactivated = newUlid();
  await cloned.prisma.orgUnit.create({
    data: {
      id: org.deactivated,
      code: 'ORG-129-OFF',
      name: '已停用所',
      level: 'station',
      parentId: org.deptA,
      deactivatedAt: new Date(T0 - DAY_MS),
    },
  });
  await cloned.prisma.orgUnitNameVersion.create({
    data: { id: newUlid(), orgUnitId: org.deactivated, name: '已停用所', version: 1 },
  });
  passwordHash = await hash(PASSWORD, PINNED);
  // 种子里唯一的根机构系统管理 P-ADMIN-HQ 先停用：根机构守卫的计数只由本文件的夹具决定。
  const seededAdmin = await cloned.prisma.personnel.findUniqueOrThrow({ where: { code: 'P-ADMIN-HQ' } });
  await cloned.prisma.personnel.update({
    where: { id: seededAdmin.id },
    data: { deactivatedAt: new Date(T0 - DAY_MS) },
  });
  people.root = await addPerson({ code: 'P-129-ROOT1', phone: PHONES.root, orgUnitId: org.hq, roles: ['系统管理', '经办'] });
  people.root2 = await addPerson({ code: 'P-129-ROOT2', phone: PHONES.root2, orgUnitId: org.hq, roles: ['系统管理', '经办'] });
  people.adminA = await addPerson({ code: 'P-129-ADM-A', phone: PHONES.adminA, orgUnitId: org.deptA, roles: ['系统管理'] });
  people.intake = await addPerson({ code: 'P-129-INTAKE', phone: PHONES.intake, orgUnitId: org.hq, roles: ['内勤'] });
  people.clerk = await addPerson({ code: 'P-129-CLERK', phone: PHONES.clerk, orgUnitId: org.station, roles: ['经办'] });
  people.supervisor = await addPerson({ code: 'P-129-SUPER', phone: PHONES.supervisor, orgUnitId: org.deptA, roles: ['监督'] });
  people.homeless = await addPerson({
    code: 'P-129-NONE', phone: PHONES.homeless, orgUnitId: org.deptA, roles: ['系统管理'], assign: false,
  });
  people.memberB = await addPerson({ code: 'P-129-MEM-B', phone: PHONES.memberB, orgUnitId: org.deptB, roles: ['经办'] });
  people.editor = await addPerson({
    code: 'P-129-EDIT', phone: PHONES.editor, orgUnitId: org.deptA, roles: ['经办'], posts: ['legal-review-lead'],
  });
  people.roleTarget = await addPerson({ code: 'P-129-ROLE', phone: PHONES.roleTarget, orgUnitId: org.deptA, roles: ['经办'] });
  people.mover = await addPerson({ code: 'P-129-MOVER', phone: PHONES.mover, orgUnitId: org.deptA, roles: ['经办'] });
  baseUrl = await startApp();
  seamUrl = await startApp(failingFactory);
  barrierUrl = await startApp(barrierFactory);
  // 先登录：登录本身写 login.succeeded，各用例的「新增留痕」只看接口这一步。
  for (const phone of [PHONES.root, PHONES.root2, PHONES.adminA, PHONES.intake, PHONES.clerk,
    PHONES.supervisor, PHONES.homeless, PHONES.memberB, PHONES.roleTarget, PHONES.mover]) {
    await signIn(phone);
  }
  await signIn(PHONES.root, seamUrl);
  await signIn(PHONES.root, barrierUrl);
}, 60_000);

afterAll(async () => {
  seam.armed = false;
  barrier.release.resolve();
  for (const close of closers) await close();
  await cloned?.close();
});

/** 编辑用的请求体：默认与 P-129-EDIT 的当前态一致（差异全空）。 */
function editBody(overrides: Partial<EditBody> = {}): EditBody {
  return {
    name: 'P-129-EDIT',
    mobilePhone: PHONES.editor,
    roles: ['经办'],
    posts: ['legal-review-lead'],
    ...overrides,
  };
}

describe('POST /api/admin/personnel/:id/edit（编辑）', () => {
  it('改名：追加名称版本、同步当前姓名，写 personnel.renamed，前值是旧名', async () => {
    const before = await audits();
    const response = await edit(PHONES.adminA, people.editor, editBody({ name: ' 邓雅 ' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'updated' });
    const versions = await cloned.prisma.personnelNameVersion.findMany({
      where: { personnelId: people.editor },
      orderBy: { version: 'asc' },
    });
    expect(versions.map((row) => [row.name, row.version])).toEqual([['P-129-EDIT', 1], ['邓雅', 2]]);
    expect(await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: people.editor } })).toMatchObject({
      name: '邓雅',
    });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.renamed', outcome: 'succeeded', reason: null,
        actor_id: people.adminA, actor_code: 'P-129-ADM-A',
        subject_personnel_id: people.editor, subject_code: 'P-129-EDIT',
        org_unit_id: org.deptA, opcode: 'personnel.profile.update',
        resource_type: 'personnel', resource_id: people.editor,
        previous_value: 'P-129-EDIT', next_value: null,
      }),
    ]);
  });

  it('改手机号：写 personnel.mobile-changed，前值留空，留痕里没有手机号', async () => {
    const nextPhone = '13900129001';
    const before = await audits();
    const response = await edit(PHONES.adminA, people.editor, editBody({ name: '邓雅', mobilePhone: nextPhone }));
    expect(response.status).toBe(200);
    expect(await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: people.editor } })).toMatchObject({
      mobilePhone: nextPhone,
    });
    const rows = added(before, await audits());
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'personnel.mobile-changed', outcome: 'succeeded',
        previous_value: null, next_value: null, opcode: 'personnel.profile.update',
      }),
    ]);
    expect(JSON.stringify(rows).includes(nextPhone)).toBe(false);
  });

  it('手机号已被他人占用 → 409 already-exists + 失败留痕，业务行不变（同请求里的改名也回滚）', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await edit(PHONES.adminA, people.editor, editBody({ name: '不该留下', mobilePhone: PHONES.memberB }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ result: 'already-exists', conflict: 'mobile-phone' });
    expect(await businessRows()).toEqual(rowsBefore);
    const rows = added(before, await audits());
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'personnel.mobile-changed', outcome: 'failed', reason: 'already-exists',
        actor_id: people.adminA, subject_personnel_id: people.editor,
        opcode: 'personnel.profile.update', resource_type: 'personnel', resource_id: people.editor,
      }),
    ]);
    expect(JSON.stringify(rows).includes(PHONES.memberB)).toBe(false);
  });

  it('换角色：摘除给旧行置失效时间，授予插入新行，各写一行留痕，后值是角色名', async () => {
    const before = await audits();
    const response = await edit(PHONES.adminA, people.editor, editBody({
      name: '邓雅', mobilePhone: '13900129001', roles: ['法制审核', '内勤'],
    }));
    expect(response.status).toBe(200);
    expect(await activeRoles(people.editor)).toEqual(['内勤', '法制审核'].sort());
    const revoked = await cloned.prisma.personnelRole.findMany({
      where: { personnelId: people.editor, deactivatedAt: { not: null } },
      include: { role: true },
    });
    expect(revoked.map((row) => row.role.name)).toEqual(['经办']);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({ action: 'personnel.role-revoked', outcome: 'succeeded', next_value: '经办' }),
      expect.objectContaining({ action: 'personnel.role-granted', outcome: 'succeeded', next_value: '内勤' }),
      expect.objectContaining({ action: 'personnel.role-granted', outcome: 'succeeded', next_value: '法制审核' }),
    ]);
  });

  it('重复提交同样的编辑（重复授予或摘除、什么都没改）→ 200，不写行、不写留痕', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await edit(PHONES.adminA, people.editor, editBody({
      name: '邓雅', mobilePhone: '13900129001', roles: ['法制审核', '内勤'],
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'updated' });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('岗位标记：加与摘各写对应留痕，后值写标记取值，摘除给旧行置失效时间', async () => {
    const before = await audits();
    const response = await edit(PHONES.adminA, people.editor, editBody({
      name: '邓雅', mobilePhone: '13900129001', roles: ['法制审核', '内勤'], posts: ['legal-affairs-leader'],
    }));
    expect(response.status).toBe(200);
    expect(await activePosts(people.editor)).toEqual(['legal-affairs-leader']);
    const revoked = await cloned.prisma.personnelPost.findMany({
      where: { personnelId: people.editor, deactivatedAt: { not: null } },
    });
    expect(revoked.map((row) => row.post)).toEqual(['legal-review-lead']);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({ action: 'personnel.post-revoked', outcome: 'succeeded', next_value: 'legal-review-lead' }),
      expect.objectContaining({ action: 'personnel.post-granted', outcome: 'succeeded', next_value: 'legal-affairs-leader' }),
    ]);
  });

  it('重复加或摘岗位标记 → 200，不写留痕', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const same = editBody({ name: '邓雅', mobilePhone: '13900129001', roles: ['法制审核', '内勤'], posts: ['legal-affairs-leader'] });
    expect((await edit(PHONES.adminA, people.editor, same)).status).toBe(200);
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('加减岗位标记前后，本人会话的操作码清单不变（菜单等价性不受影响）', async () => {
    const cookie = await signIn(PHONES.roleTarget);
    const before = await opcodesOf(cookie);
    expect((await edit(PHONES.adminA, people.roleTarget, {
      name: 'P-129-ROLE', mobilePhone: PHONES.roleTarget, roles: ['经办'], posts: ['legal-review-lead', 'legal-affairs-leader'],
    })).status).toBe(200);
    expect(await opcodesOf(cookie)).toEqual(before);
    expect((await edit(PHONES.adminA, people.roleTarget, {
      name: 'P-129-ROLE', mobilePhone: PHONES.roleTarget, roles: ['经办'], posts: [],
    })).status).toBe(200);
    expect(await opcodesOf(cookie)).toEqual(before);
    expect(await activePosts(people.roleTarget)).toEqual([]);
  });

  it('改角色后对方下一次请求即按新角色授权（故事 34）', async () => {
    const response = await login(PHONES.roleTarget);
    expect(response.status).toBe(200);
    const cookie = cookieOf(response);
    expect(await opcodesOf(cookie)).not.toContain('personnel.profile.read');
    expect((await fetch(`${baseUrl}/api/admin/personnel`, { headers: { cookie } })).status).toBe(403);
    const before = await audits();
    const edited = await edit(PHONES.adminA, people.roleTarget, {
      name: 'P-129-ROLE', mobilePhone: PHONES.roleTarget, roles: ['系统管理'], posts: [],
    });
    expect(edited.status).toBe(200);
    expect(added(before, await audits()).map((row) => [row.action, row.next_value])).toEqual([
      ['personnel.role-revoked', '经办'],
      ['personnel.role-granted', '系统管理'],
    ]);
    // 同一会话，不重新登录：清单与授权都按新角色。
    expect(await opcodesOf(cookie)).toContain('personnel.profile.read');
    expect((await fetch(`${baseUrl}/api/admin/personnel`, { headers: { cookie } })).status).toBe(200);
    // 还原夹具：roleTarget 回到经办。
    expect((await edit(PHONES.adminA, people.roleTarget, {
      name: 'P-129-ROLE', mobilePhone: PHONES.roleTarget, roles: ['经办'], posts: [],
    })).status).toBe(200);
  });

  it('给自己改姓名、手机号可以（原型 P6 selfEdit）；给自己改角色或岗位标记 → 403 permission-denied', async () => {
    const before = await audits();
    const allowed = await edit(PHONES.root, people.root, {
      name: 'P-129-ROOT1', mobilePhone: '13900129002', roles: ['系统管理', '经办'], posts: [],
    });
    expect(allowed.status).toBe(200);
    expect(added(before, await audits()).map((row) => row.action)).toEqual(['personnel.mobile-changed']);

    const rowsBefore = await businessRows();
    const deniedBefore = await audits();
    const denied = await edit(PHONES.root, people.root, {
      name: 'P-129-ROOT1', mobilePhone: '13900129002', roles: ['经办'], posts: [],
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ reason: 'permission-denied' });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(deniedBefore, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', outcome: 'failed', reason: 'permission-denied',
        actor_id: people.root, subject_personnel_id: null,
        opcode: 'personnel.profile.update', resource_type: 'personnel', resource_id: people.root,
        target_org_unit_id: org.hq, target_org_unit_basis: 'object',
      }),
    ]);
    // 还原夹具。
    expect((await edit(PHONES.root, people.root, {
      name: 'P-129-ROOT1', mobilePhone: PHONES.root, roles: ['系统管理', '经办'], posts: [],
    })).status).toBe(200);
  });

  it('给自己加岗位标记 → 403 permission-denied + authz.denied，业务行不变', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await edit(PHONES.adminA, people.adminA, {
      name: 'P-129-ADM-A', mobilePhone: PHONES.adminA, roles: ['系统管理'], posts: ['legal-review-lead'],
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'permission-denied',
        actor_id: people.adminA, opcode: 'personnel.profile.update', resource_id: people.adminA,
      }),
    ]);
  });

  it('校验不过 → 400 non-compliant，业务行不变，不写留痕', async () => {
    const cases: Array<[Partial<EditBody>, string[]]> = [
      [{ name: '  ' }, ['personnel-name-required']],
      [{ name: '甲'.repeat(101) }, ['personnel-name-too-long']],
      [{ mobilePhone: '' }, ['mobile-phone-required']],
      [{ mobilePhone: '138000129' }, ['mobile-phone-invalid']],
      [{ roles: [] }, ['roles-required']],
      [{ roles: ['经办', '管理员'] }, ['role-unknown']],
      [{ posts: ['法制审核负责人'] }, ['post-unknown']],
    ];
    for (const [overrides, rules] of cases) {
      const rowsBefore = await businessRows();
      const before = await audits();
      const response = await edit(PHONES.adminA, people.clerk, editBody(overrides));
      expect(response.status, JSON.stringify(overrides)).toBe(400);
      expect(await response.json()).toEqual({ result: 'non-compliant', rules });
      expect(await businessRows()).toEqual(rowsBefore);
      expect(added(before, await audits())).toEqual([]);
    }
  });

  it('人员不存在 → 404，不写留痕', async () => {
    const before = await audits();
    const response = await edit(PHONES.root, newUlid(), editBody());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ result: 'not-found' });
    expect(added(before, await audits())).toEqual([]);
  });

  it('没有当前任职的人员视同根机构：根机构系统管理能编辑，区系统管理 403 scope-denied', async () => {
    const before = await audits();
    const response = await edit(PHONES.adminA, people.homeless, {
      name: 'P-129-NONE', mobilePhone: PHONES.homeless, roles: ['系统管理'], posts: [],
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', actor_id: people.adminA,
        opcode: 'personnel.profile.update', resource_id: people.homeless,
        target_org_unit_id: org.hq, target_org_unit_basis: 'object',
      }),
    ]);
  });

  const deniedBy: Array<[string, string]> = [
    ['没有该码（内勤）', PHONES.intake],
    ['没有该码（经办）', PHONES.clerk],
    ['监督', PHONES.supervisor],
  ];
  it.each(deniedBy)('%s → 403 permission-denied + authz.denied，业务行不变', async (_label, phone) => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await edit(phone, people.editor, editBody({ name: '邓雅', mobilePhone: '13900129001', roles: ['法制审核', '内勤'], posts: ['legal-affairs-leader'] }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', outcome: 'failed', reason: 'permission-denied',
        opcode: 'personnel.profile.update', resource_type: 'personnel', resource_id: people.editor,
      }),
    ]);
  });

  it('跨区：区 A 系统管理编辑区 B 人员 → 403 scope-denied + authz.denied，业务行不变', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await edit(PHONES.adminA, people.memberB, {
      name: '越区改名', mobilePhone: PHONES.memberB, roles: ['经办'], posts: [],
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', actor_id: people.adminA,
        opcode: 'personnel.profile.update', resource_type: 'personnel', resource_id: people.memberB,
        target_org_unit_id: org.deptB, target_org_unit_basis: 'object',
      }),
    ]);
  });

  it('跨站写请求被拒，业务行不变，不写留痕', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const payload = editBody({ name: '邓雅', mobilePhone: '13900129001', roles: ['法制审核', '内勤'], posts: ['legal-affairs-leader'] });
    expect((await edit(PHONES.root, people.editor, payload, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await edit(PHONES.root, people.editor, payload, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });
});

describe('POST /api/admin/personnel/:id/transfer（调岗）', () => {
  it('调岗成功：旧任职置结束时间、插入新任职、同步当前归属，写 personnel.transferred，前值原机构名、后值新机构名', async () => {
    const before = await audits();
    const response = await transfer(PHONES.adminA, people.mover, org.station);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'transferred', orgUnitId: org.station });
    const assignments = await cloned.prisma.personnelAssignment.findMany({
      where: { personnelId: people.mover },
      orderBy: { startedAt: 'asc' },
    });
    expect(assignments).toHaveLength(2);
    // 结束时间与开始时间由服务取墙钟（同 #128 登记），只断言闭环形态。
    expect(assignments[0]).toMatchObject({ orgUnitId: org.deptA });
    expect(assignments[0].endedAt).not.toBeNull();
    expect(assignments[1]).toMatchObject({ orgUnitId: org.station, endedAt: null });
    expect(await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: people.mover } })).toMatchObject({
      orgUnitId: org.station,
    });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.transferred', outcome: 'succeeded', reason: null,
        actor_id: people.adminA, actor_code: 'P-129-ADM-A',
        subject_personnel_id: people.mover, subject_code: 'P-129-MOVER',
        org_unit_id: org.deptA, opcode: 'personnel.profile.update',
        resource_type: 'personnel', resource_id: people.mover,
        previous_value: '第一执法支队', next_value: '甲区执法所',
      }),
    ]);
  });

  it('目的地不限数据范围：区 A 系统管理把人调去区 B → 200', async () => {
    const before = await audits();
    const response = await transfer(PHONES.adminA, people.mover, org.deptB);
    expect(response.status).toBe(200);
    expect(await currentOrg(people.mover)).toBe(org.deptB);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.transferred', outcome: 'succeeded',
        previous_value: '甲区执法所', next_value: '第二执法支队',
      }),
    ]);
    // 调回甲区，还原夹具。人已在区 B，锚点变了：区 A 系统管理够不着，由根机构系统管理调回。
    expect((await transfer(PHONES.root, people.mover, org.deptA)).status).toBe(200);
    // 还原后 mover 的当前任职在 deptA：断言留痕又写了一行。
    expect(await currentOrg(people.mover)).toBe(org.deptA);
  });

  it('没有当前任职的人员：调岗建立首条任职并同步当前归属（#105:230）', async () => {
    const before = await audits();
    const response = await transfer(PHONES.root, people.homeless, org.deptB);
    expect(response.status).toBe(200);
    const assignments = await cloned.prisma.personnelAssignment.findMany({ where: { personnelId: people.homeless } });
    expect(assignments).toEqual([expect.objectContaining({ orgUnitId: org.deptB, endedAt: null })]);
    expect(await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: people.homeless } })).toMatchObject({
      orgUnitId: org.deptB,
    });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.transferred', outcome: 'succeeded',
        previous_value: null, next_value: '第二执法支队', org_unit_id: null,
      }),
    ]);
    // 还原夹具：结束这条任职，当前归属还原为建夹具时的机构。
    await cloned.prisma.personnelAssignment.updateMany({
      where: { personnelId: people.homeless },
      data: { endedAt: new Date(T0) },
    });
    await cloned.prisma.personnel.update({ where: { id: people.homeless }, data: { orgUnitId: org.deptA } });
  });

  it('目的地就是当前任职机构 → 200 unchanged，不写行、不写留痕', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await transfer(PHONES.adminA, people.clerk, org.station);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'unchanged' });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('调入已停用机构 → 409 invalid-state + 失败留痕 org-unit-deactivated，业务行不变', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await transfer(PHONES.adminA, people.clerk, org.deactivated);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      result: 'invalid-state',
      message: '所选机构已停用，请选择在用的机构。',
    });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.transferred', outcome: 'failed', reason: 'org-unit-deactivated',
        actor_id: people.adminA, subject_personnel_id: people.clerk,
        opcode: 'personnel.profile.update', next_value: '已停用所',
      }),
    ]);
  });

  it('给自己调岗 → 403 permission-denied + authz.denied，业务行不变', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await transfer(PHONES.adminA, people.adminA, org.deptB);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', outcome: 'failed', reason: 'permission-denied',
        actor_id: people.adminA, opcode: 'personnel.profile.update',
        resource_type: 'personnel', resource_id: people.adminA,
      }),
    ]);
  });

  it('缺目的地 → 400 non-compliant org-unit-required，业务行不变，不写留痕', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await transfer(PHONES.root, people.clerk, '  ');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ result: 'non-compliant', rules: ['org-unit-required'] });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('目的地不存在 → 403 scope-denied + authz.denied，业务行不变', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const nowhere = newUlid();
    const response = await transfer(PHONES.root, people.clerk, nowhere);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(await businessRows()).toEqual(rowsBefore);
    // 树外机构解析不出目标机构：拒绝行按操作者任职兜底（ADR 0011 修正 actor-fallback）。
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied',
        opcode: 'personnel.profile.update', resource_type: 'org-unit', resource_id: nowhere,
        target_org_unit_basis: 'actor-fallback',
      }),
    ]);
  });

  it('人员不存在 → 404，不写留痕', async () => {
    const before = await audits();
    const response = await transfer(PHONES.root, newUlid(), org.deptA);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ result: 'not-found' });
    expect(added(before, await audits())).toEqual([]);
  });

  const deniedBy: Array<[string, string]> = [
    ['没有该码（内勤）', PHONES.intake],
    ['没有该码（经办）', PHONES.clerk],
    ['监督', PHONES.supervisor],
  ];
  it.each(deniedBy)('%s → 403 permission-denied + authz.denied，业务行不变', async (_label, phone) => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await transfer(phone, people.mover, org.deptB);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', outcome: 'failed', reason: 'permission-denied',
        opcode: 'personnel.profile.update', resource_id: people.mover,
      }),
    ]);
  });

  it('跨区：区 A 系统管理调岗区 B 人员 → 403 scope-denied + authz.denied，业务行不变', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    const response = await transfer(PHONES.adminA, people.memberB, org.deptA);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', actor_id: people.adminA,
        opcode: 'personnel.profile.update', resource_id: people.memberB,
        target_org_unit_id: org.deptB, target_org_unit_basis: 'object',
      }),
    ]);
  });

  it('跨站写请求被拒，业务行不变，不写留痕', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    expect((await transfer(PHONES.root, people.mover, org.deptB, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await transfer(PHONES.root, people.mover, org.deptB, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });
});

describe('GET /api/admin/personnel/:id/transfer-destinations（调岗目的地清单）', () => {
  it('返回全树未停用的机构（目的地不限数据范围），含区 B，不含已停用所，读取不写留痕', async () => {
    const before = await audits();
    const response = await destinations(PHONES.adminA, people.mover);
    expect(response.status).toBe(200);
    const json = await response.json() as { result: string; orgUnits: Array<{ id: string; name: string; parentId: string | null }> };
    expect(json.result).toBe('listed');
    const ids = json.orgUnits.map((unit) => unit.id);
    expect(ids).toEqual(expect.arrayContaining([org.hq, org.deptA, org.deptB, org.station]));
    expect(ids).not.toContain(org.deactivated);
    expect(json.orgUnits.find((unit) => unit.id === org.station)).toEqual({
      id: org.station, name: '甲区执法所', parentId: org.deptA,
    });
    expect(added(before, await audits())).toEqual([]);
  });

  it('人员不存在 → 404，不写留痕', async () => {
    const before = await audits();
    const response = await destinations(PHONES.root, newUlid());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ result: 'not-found' });
    expect(added(before, await audits())).toEqual([]);
  });

  const deniedBy: Array<[string, string]> = [
    ['没有该码（内勤）', PHONES.intake],
    ['没有该码（经办）', PHONES.clerk],
    ['监督', PHONES.supervisor],
  ];
  it.each(deniedBy)('%s → 403 permission-denied + authz.denied', async (_label, phone) => {
    const before = await audits();
    const response = await destinations(phone, people.mover);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', outcome: 'failed', reason: 'permission-denied',
        opcode: 'personnel.profile.update', resource_id: people.mover,
      }),
    ]);
  });

  it('跨区：区 A 系统管理读区 B 人员的目的地清单 → 403 scope-denied + authz.denied', async () => {
    const before = await audits();
    const response = await destinations(PHONES.adminA, people.memberB);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', actor_id: people.adminA,
        opcode: 'personnel.profile.update', resource_id: people.memberB,
      }),
    ]);
  });

  it('跨站读请求被拒（Sec-Fetch-Site 或 Origin），不写留痕', async () => {
    const before = await audits();
    expect((await destinations(PHONES.root, people.mover, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await destinations(PHONES.root, people.mover, { origin: 'https://evil.example' })).status).toBe(403);
    expect(added(before, await audits())).toEqual([]);
  });
});

describe('根机构守卫（ADR 0014）：摘除系统管理角色、调岗出根机构', () => {
  /** 让 pair 成为根机构上仅有的两名未停用系统管理：其余的临时停用，测完还原。 */
  const suspended: string[] = [];
  async function isolate(pair: string[]): Promise<void> {
    const admins = await cloned.prisma.personnel.findMany({
      where: {
        deactivatedAt: null,
        assignments: { some: { endedAt: null, orgUnitId: org.hq } },
        personnelRoles: { some: { deactivatedAt: null, role: { deactivatedAt: null, name: '系统管理' } } },
      },
    });
    for (const admin of admins) {
      if (pair.includes(admin.id)) continue;
      await cloned.prisma.personnel.update({ where: { id: admin.id }, data: { deactivatedAt: new Date(T0 - DAY_MS) } });
      suspended.push(admin.id);
    }
  }
  async function restore(): Promise<void> {
    for (const id of suspended.splice(0)) {
      await cloned.prisma.personnel.update({ where: { id }, data: { deactivatedAt: null } });
    }
  }

  it('守卫只管「根机构任职 + 系统管理角色」：调出非管理员、摘除非根机构人员的系统管理都照常放行', async () => {
    // 调出根机构：目标不持有系统管理角色，不进守卫。
    const before = await audits();
    expect((await transfer(PHONES.root, people.intake, org.deptA)).status).toBe(200);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({ action: 'personnel.transferred', outcome: 'succeeded', next_value: '第一执法支队' }),
    ]);
    // 摘除系统管理：目标当前不任职在根机构，不进守卫。
    const revokeBefore = await audits();
    const response = await edit(PHONES.root, people.adminA, {
      name: 'P-129-ADM-A', mobilePhone: PHONES.adminA, roles: ['经办'], posts: [],
    });
    expect(response.status).toBe(200);
    expect(await activeRoles(people.adminA)).toEqual(['经办']);
    expect(added(revokeBefore, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.role-revoked', outcome: 'succeeded', next_value: '系统管理',
        actor_id: people.root, subject_personnel_id: people.adminA,
      }),
      expect.objectContaining({
        action: 'personnel.role-granted', outcome: 'succeeded', next_value: '经办',
        actor_id: people.root, subject_personnel_id: people.adminA,
      }),
    ]);
    // 还原夹具：intake 调回根机构，adminA 恢复系统管理。
    expect((await transfer(PHONES.root, people.intake, org.hq)).status).toBe(200);
    expect((await edit(PHONES.root, people.adminA, {
      name: 'P-129-ADM-A', mobilePhone: PHONES.adminA, roles: ['系统管理'], posts: [],
    })).status).toBe(200);
    expect(await activeRoles(people.adminA)).toEqual(['系统管理']);
  });

  it('接缝②：两名根机构系统管理并发互相摘除系统管理，只有一方成功，另一方 409 root-admin-required', async () => {
    const pair1a = await addPerson({ code: 'P-129-C1A', phone: PHONES.pair1a, orgUnitId: org.hq, roles: ['系统管理', '经办'] });
    const pair1b = await addPerson({ code: 'P-129-C1B', phone: PHONES.pair1b, orgUnitId: org.hq, roles: ['系统管理', '经办'] });
    await isolate([pair1a, pair1b]);
    try {
      await signIn(PHONES.pair1a, barrierUrl);
      await signIn(PHONES.pair1a);
      await signIn(PHONES.pair1b);
      const keep = (id: string) => ({ name: id === pair1a ? 'P-129-C1A' : 'P-129-C1B', mobilePhone: id === pair1a ? PHONES.pair1a : PHONES.pair1b, roles: ['经办'], posts: [] });
      armBarrier('personnel.role-revoked');
      // 先手：pair1a 摘 pair1b 的系统管理，成功留痕写下后停在事务里（咨询锁仍持有）。
      const first = edit(PHONES.pair1a, pair1b, keep(pair1b), {}, barrierUrl);
      await barrier.entered.promise;
      // 后手：pair1b 摘 pair1a 的系统管理，在咨询锁上等待。
      const second = edit(PHONES.pair1b, pair1a, keep(pair1a));
      expect(await settledWithin(second, 400)).toBe(false);
      const rowsBefore = await businessRows();
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
      // 只有一方成功：pair1b 的系统管理被摘，pair1a 的还在。
      expect(await activeRoles(pair1b)).not.toContain('系统管理');
      expect(await activeRoles(pair1a)).toContain('系统管理');
      // 失败一方：失败留痕存在（先手的成功留痕也在快照之后提交），失败请求涉及的行不变。
      const rows = added(before, await audits());
      expect(rows).toEqual([
        expect.objectContaining({
          action: 'personnel.role-revoked', outcome: 'succeeded', reason: null,
          actor_id: pair1a, subject_personnel_id: pair1b, next_value: '系统管理',
        }),
        expect.objectContaining({
          action: 'personnel.role-revoked', outcome: 'failed', reason: 'root-admin-required',
          actor_id: pair1b, subject_personnel_id: pair1a,
          opcode: 'personnel.profile.update', next_value: '系统管理',
        }),
      ]);
      const after = await businessRows();
      expect(after.filter((row) => row.includes(pair1a))).toEqual(rowsBefore.filter((row) => row.includes(pair1a)));
    } finally {
      await restore();
    }
  });

  it('接缝②：两名根机构系统管理并发互相调出根机构，只有一方成功，另一方 409 root-admin-required', async () => {
    const pair2a = await addPerson({ code: 'P-129-C2A', phone: PHONES.pair2a, orgUnitId: org.hq, roles: ['系统管理', '经办'] });
    const pair2b = await addPerson({ code: 'P-129-C2B', phone: PHONES.pair2b, orgUnitId: org.hq, roles: ['系统管理', '经办'] });
    await isolate([pair2a, pair2b]);
    try {
      await signIn(PHONES.pair2a, barrierUrl);
      await signIn(PHONES.pair2a);
      await signIn(PHONES.pair2b);
      armBarrier('personnel.transferred');
      const first = transfer(PHONES.pair2a, pair2b, org.deptA, {}, barrierUrl);
      await barrier.entered.promise;
      const second = transfer(PHONES.pair2b, pair2a, org.deptB);
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
      expect(await currentOrg(pair2b)).toBe(org.deptA);
      expect(await currentOrg(pair2a)).toBe(org.hq);
      // 先手的成功留痕在快照之后提交，与失败一方的失败留痕一前一后。
      expect(added(before, await audits())).toEqual([
        expect.objectContaining({
          action: 'personnel.transferred', outcome: 'succeeded', reason: null,
          actor_id: pair2a, subject_personnel_id: pair2b, next_value: '第一执法支队',
        }),
        expect.objectContaining({
          action: 'personnel.transferred', outcome: 'failed', reason: 'root-admin-required',
          actor_id: pair2b, subject_personnel_id: pair2a, next_value: '第二执法支队',
        }),
      ]);
    } finally {
      await restore();
    }
  });

  it('接缝②：机构停用与调入并发，只有一方成功（补 #124 留下的用例）', async () => {
    const makeStation = async (code: string): Promise<string> => {
      const id = newUlid();
      await cloned.prisma.orgUnit.create({
        data: { id, code, name: code, level: 'station', parentId: org.deptA },
      });
      await cloned.prisma.orgUnitNameVersion.create({ data: { id: newUlid(), orgUnitId: id, name: code, version: 1 } });
      return id;
    };
    // 情形一：调岗先拿到目的地共享锁，停用等它提交后看到生效任职 → 409 org-has-assignments。
    const stationA = await makeStation('ORG-129-CA');
    armBarrier('personnel.transferred');
    const moving = transfer(PHONES.root, people.mover, stationA, {}, barrierUrl);
    await barrier.entered.promise;
    const deactivating = fetch(`${baseUrl}/api/admin/org-units/${stationA}/deactivate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: await signIn(PHONES.root) },
      body: '{}',
    });
    expect(await settledWithin(deactivating, 400)).toBe(false);
    barrier.release.resolve();
    const [moved, refusedDeactivate] = await Promise.all([moving, deactivating]);
    expect(moved.status).toBe(200);
    expect(refusedDeactivate.status).toBe(409);
    expect(await refusedDeactivate.json()).toEqual({
      result: 'invalid-state',
      message: expect.stringContaining('生效任职'),
    });
    expect(await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { id: stationA } })).toMatchObject({ deactivatedAt: null });
    expect(await currentOrg(people.mover)).toBe(stationA);

    // 情形二：停用先拿到行锁，调岗等它提交后看到已停用 → 409 invalid-state，人没有调进已停用机构。
    const stationB = await makeStation('ORG-129-CB');
    armBarrier('org.unit.deactivated');
    const deactivating2 = fetch(`${barrierUrl}/api/admin/org-units/${stationB}/deactivate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: await signIn(PHONES.root, barrierUrl) },
      body: '{}',
    });
    await barrier.entered.promise;
    const before = await audits();
    const rowsBefore = await businessRows();
    const moving2 = transfer(PHONES.root, people.mover, stationB);
    expect(await settledWithin(moving2, 400)).toBe(false);
    barrier.release.resolve();
    const [deactivated, refusedTransfer] = await Promise.all([deactivating2, moving2]);
    expect(deactivated.status).toBe(200);
    expect(refusedTransfer.status).toBe(409);
    expect(await refusedTransfer.json()).toEqual({
      result: 'invalid-state',
      message: '所选机构已停用，请选择在用的机构。',
    });
    expect(await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { id: stationB } }).then((row) => row.deactivatedAt)).not.toBeNull();
    // 失败一方：失败留痕存在（先手停用的成功留痕也在快照之后提交），业务行与失败前一致（mover 仍在情形一的所里）。
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'org.unit.deactivated', outcome: 'succeeded', reason: null,
        actor_id: people.root, resource_type: 'org-unit', resource_id: stationB,
      }),
      expect.objectContaining({
        action: 'personnel.transferred', outcome: 'failed', reason: 'org-unit-deactivated',
        actor_id: people.root, subject_personnel_id: people.mover,
      }),
    ]);
    const after = await businessRows();
    expect(after.filter((row) => row.includes(people.mover))).toEqual(rowsBefore.filter((row) => row.includes(people.mover)));
    expect(await currentOrg(people.mover)).toBe(stationA);
    // 还原夹具：mover 调回甲区。
    expect((await transfer(PHONES.root, people.mover, org.deptA)).status).toBe(200);
  });
});

describe('接缝①：留痕工厂覆写为「业务写完后抛错」', () => {
  it('编辑：请求失败，业务行与留痕不变', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    seam.armed = true;
    try {
      const response = await edit(PHONES.root, people.editor, editBody({
        name: '接缝改名', mobilePhone: '13900129001', roles: ['法制审核', '内勤'], posts: ['legal-affairs-leader', 'legal-review-lead'],
      }), {}, seamUrl);
      expect(response.status).toBe(500);
    } finally {
      seam.armed = false;
    }
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('调岗：请求失败，业务行与留痕不变', async () => {
    const rowsBefore = await businessRows();
    const before = await audits();
    seam.armed = true;
    try {
      const response = await transfer(PHONES.root, people.mover, org.station, {}, seamUrl);
      expect(response.status).toBe(500);
    } finally {
      seam.armed = false;
    }
    expect(await businessRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
    expect(await currentOrg(people.mover)).toBe(org.deptA);
  });
});
