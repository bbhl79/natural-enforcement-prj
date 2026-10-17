// #123 机构树：查看、新建下级、改名（含层级）。
// 断言打在 HTTP 状态码、响应体、机构表与名称版本表的行、留痕行上。断言打在克隆库上。
// 每个接口的四条必测（#105 Testing）：没有该码、跨区或无数据范围、监督、跨站请求。
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaAuditTrailFactory, type AuditTrailFactory } from '@natural-enforcement/audit';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-18T02:00:00.000Z');
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Org-tree-123!';
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SEAM_ERROR = '接缝①：业务写完后抛错（#123）';

const PHONES = {
  root: '13800012301',
  adminA: '13800012302',
  adminStation: '13800012303',
  intake: '13800012304',
  clerk: '13800012305',
  supervisor: '13800012306',
  homeless: '13800012307',
} as const;

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

let cloned: ClonedDatabase;
let baseUrl = '';
let seamUrl = '';
const closers: Array<() => Promise<void>> = [];
let passwordHash = '';
const org = { hq: '', deptA: '', deptB: '', station: '', deactivated: '' };
const people = { root: '', adminA: '', adminStation: '', intake: '', clerk: '', supervisor: '', homeless: '' };

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
  previous_value: string | null;
  source_ip: string | null;
};

async function audits(): Promise<AuditRecord[]> {
  return cloned.prisma.$queryRaw<AuditRecord[]>`
    SELECT id, action, outcome, reason, actor_id, org_unit_id, opcode,
           resource_type, resource_id, previous_value, source_ip
    FROM audit_trail
    ORDER BY created_at, id
  `;
}

function added(before: AuditRecord[], after: AuditRecord[]): AuditRecord[] {
  const known = new Set(before.map((row) => row.id));
  return after.filter((row) => !known.has(row.id));
}

/** 机构表与名称版本表的全部行（业务行），按主键排序。 */
async function orgRows(): Promise<string[]> {
  const units = await cloned.prisma.orgUnit.findMany({ orderBy: { id: 'asc' } });
  const names = await cloned.prisma.orgUnitNameVersion.findMany({ orderBy: { id: 'asc' } });
  return [...units, ...names].map((row) => JSON.stringify(row));
}

async function roleId(name: string): Promise<string> {
  return (await cloned.prisma.role.findFirstOrThrow({ where: { name, deactivatedAt: null } })).id;
}

async function addPerson(input: {
  code: string;
  phone: string;
  orgUnitId: string;
  role: string;
  assign?: boolean;
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
    },
  });
  if (input.assign !== false) {
    await cloned.prisma.personnelAssignment.create({
      data: { id: newUlid(), personnelId: id, orgUnitId: input.orgUnitId },
    });
  }
  await cloned.prisma.personnelRole.create({
    data: { id: newUlid(), personnelId: id, roleId: await roleId(input.role) },
  });
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

interface TreeNode {
  id: string;
  code: string;
  name: string;
  level: string;
  parentId: string | null;
  deactivatedAt: string | null;
  activePersonnel: number;
  names: Array<{ name: string; from: string; to: string | null }>;
}

async function getTree(phone: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}/api/org-units`, { headers: { cookie: await signIn(phone), ...headers } });
}

async function register(
  phone: string,
  body: { parentId: string | null; name: string; level: string },
  headers: Record<string, string> = {},
  url = baseUrl,
): Promise<Response> {
  return fetch(`${url}/api/admin/org-units`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await signIn(phone, url), ...headers },
    body: JSON.stringify(body),
  });
}

async function rename(
  phone: string,
  orgUnitId: string,
  name: string,
  headers: Record<string, string> = {},
  url = baseUrl,
): Promise<Response> {
  return fetch(`${url}/api/admin/org-units/${orgUnitId}/rename`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await signIn(phone, url), ...headers },
    body: JSON.stringify({ name }),
  });
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
      code: 'ORG-123-OFF',
      name: '已停用区',
      level: 'district',
      parentId: org.hq,
      deactivatedAt: new Date(T0 - DAY_MS),
    },
  });
  await cloned.prisma.orgUnitNameVersion.create({
    data: { id: newUlid(), orgUnitId: org.deactivated, name: '已停用区', version: 1 },
  });
  passwordHash = await hash(PASSWORD, PINNED);
  people.root = await addPerson({ code: 'P-123-ROOT', phone: PHONES.root, orgUnitId: org.hq, role: '系统管理' });
  people.adminA = await addPerson({ code: 'P-123-ADM-A', phone: PHONES.adminA, orgUnitId: org.deptA, role: '系统管理' });
  people.adminStation = await addPerson({
    code: 'P-123-ADM-ST', phone: PHONES.adminStation, orgUnitId: org.station, role: '系统管理',
  });
  people.intake = await addPerson({ code: 'P-123-INTAKE', phone: PHONES.intake, orgUnitId: org.hq, role: '内勤' });
  people.clerk = await addPerson({ code: 'P-123-CLERK', phone: PHONES.clerk, orgUnitId: org.deptA, role: '经办' });
  people.supervisor = await addPerson({
    code: 'P-123-SUPER', phone: PHONES.supervisor, orgUnitId: org.deptA, role: '监督',
  });
  people.homeless = await addPerson({
    code: 'P-123-NONE', phone: PHONES.homeless, orgUnitId: org.deptA, role: '系统管理', assign: false,
  });
  baseUrl = await startApp();
  seamUrl = await startApp(failingFactory);
}, 60_000);

afterAll(async () => {
  seam.armed = false;
  for (const close of closers) await close();
  await cloned?.close();
});

describe('机构层级（迁移与库层兜底）', () => {
  it('种子机构按深度回填层级，根机构为市', async () => {
    const units = await cloned.prisma.orgUnit.findMany({ where: { id: { in: [org.hq, org.deptA, org.station] } } });
    const levels = Object.fromEntries(units.map((unit) => [unit.id, unit.level]));
    expect(levels).toEqual({ [org.hq]: 'city', [org.deptA]: 'district', [org.station]: 'station' });
  });

  it('库层拒绝不认识的层级、市下直接挂所、根机构不是市', async () => {
    await expect(cloned.prisma.orgUnit.create({
      data: { id: newUlid(), code: 'ORG-123-KE', name: '科', level: 'section', parentId: org.deptA },
    })).rejects.toThrow();
    await expect(cloned.prisma.orgUnit.create({
      data: { id: newUlid(), code: 'ORG-123-BAD', name: '市下所', level: 'station', parentId: org.hq },
    })).rejects.toThrow();
    await expect(cloned.prisma.orgUnit.create({
      data: { id: newUlid(), code: 'ORG-123-ROOT', name: '另一根', level: 'district', parentId: null },
    })).rejects.toThrow();
  });
});

describe('GET /api/org-units', () => {
  it('根机构系统管理拿到整棵树，含已停用节点并标出，字段齐全', async () => {
    const response = await getTree(PHONES.root);
    expect(response.status).toBe(200);
    const body = await response.json() as { result: string; rootId: string; orgUnits: TreeNode[] };
    expect(body.result).toBe('listed');
    expect(body.rootId).toBe(org.hq);
    const ids = body.orgUnits.map((unit) => unit.id);
    expect(ids).toEqual(expect.arrayContaining([org.hq, org.deptA, org.deptB, org.station, org.deactivated]));
    const off = body.orgUnits.find((unit) => unit.id === org.deactivated)!;
    expect(off.deactivatedAt).toBe(new Date(T0 - DAY_MS).toISOString());
    const station = body.orgUnits.find((unit) => unit.id === org.station)!;
    expect(station).toMatchObject({ level: 'station', parentId: org.deptA, deactivatedAt: null });
    expect(station.activePersonnel).toBeGreaterThanOrEqual(2);
    expect(Object.keys(station).sort()).toEqual(
      ['activePersonnel', 'code', 'deactivatedAt', 'id', 'level', 'name', 'names', 'parentId'],
    );
    expect(station.names).toEqual([{ name: station.name, from: expect.any(String), to: null }]);
  });

  it('区 A 人员的结果不含区 B 任何节点', async () => {
    const response = await getTree(PHONES.adminA);
    expect(response.status).toBe(200);
    const body = await response.json() as { rootId: string; orgUnits: TreeNode[] };
    expect(body.rootId).toBe(org.deptA);
    const ids = body.orgUnits.map((unit) => unit.id);
    expect(ids).toContain(org.station);
    expect(ids).not.toContain(org.deptB);
    expect(ids).not.toContain(org.hq);
    expect(ids).not.toContain(org.deactivated);
    expect(body.orgUnits.every((unit) => unit.id === org.deptA || unit.parentId !== org.hq)).toBe(true);
  });

  it('所里的人员只拿到本所', async () => {
    const response = await getTree(PHONES.adminStation);
    expect(response.status).toBe(200);
    const body = await response.json() as { orgUnits: TreeNode[] };
    expect(body.orgUnits.map((unit) => unit.id)).toEqual([org.station]);
  });

  it('内勤也能取树，不写留痕', async () => {
    const before = await audits();
    const response = await getTree(PHONES.intake);
    expect(response.status).toBe(200);
    const body = await response.json() as { orgUnits: TreeNode[] };
    expect(body.orgUnits.map((unit) => unit.id)).toEqual(expect.arrayContaining([org.hq, org.deptA, org.deptB]));
    expect(added(before, await audits())).toEqual([]);
  });

  it('没有该码（经办）→ 403 permission-denied + authz.denied', async () => {
    const before = await audits();
    const response = await getTree(PHONES.clerk);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', outcome: 'failed', reason: 'permission-denied',
        actor_id: people.clerk, opcode: 'org.tree.read', resource_type: 'org-unit',
      }),
    ]);
  });

  it('监督 → 403 + authz.denied', async () => {
    const before = await audits();
    const response = await getTree(PHONES.supervisor);
    expect(response.status).toBe(403);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({ action: 'authz.denied', actor_id: people.supervisor, opcode: 'org.tree.read' }),
    ]);
  });

  it('树查询不带根节点参数，没有数据范围（无当前任职）→ 403 scope-denied + authz.denied', async () => {
    const before = await audits();
    const response = await getTree(PHONES.homeless);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({ action: 'authz.denied', reason: 'scope-denied', actor_id: people.homeless }),
    ]);
  });

  it('跨站读请求被拒（Sec-Fetch-Site 或 Origin），不写留痕', async () => {
    const before = await audits();
    const bySite = await getTree(PHONES.root, { 'sec-fetch-site': 'cross-site' });
    expect(bySite.status).toBe(403);
    const byOrigin = await getTree(PHONES.root, { origin: 'https://evil.example' });
    expect(byOrigin.status).toBe(403);
    expect(added(before, await audits())).toEqual([]);
    const sameOrigin = await getTree(PHONES.root, { 'sec-fetch-site': 'same-origin' });
    expect(sameOrigin.status).toBe(200);
  });
});

describe('POST /api/admin/org-units（新建下级）', () => {
  it('市下建区、区下建所成功，写机构、首个名称版本和 org.unit.registered', async () => {
    const before = await audits();
    const district = await register(PHONES.root, { parentId: org.hq, name: '  新建区 ', level: 'district' });
    expect(district.status).toBe(200);
    const created = await district.json() as { result: string; orgUnit: { id: string; code: string; name: string; level: string; parentId: string } };
    expect(created).toMatchObject({ result: 'registered', orgUnit: { name: '新建区', level: 'district', parentId: org.hq } });
    expect(created.orgUnit.code).toBe(`ORG-${created.orgUnit.id}`);
    const station = await register(PHONES.root, { parentId: created.orgUnit.id, name: '新建所', level: 'station' });
    expect(station.status).toBe(200);
    const stationBody = await station.json() as { orgUnit: { id: string } };
    const rows = await cloned.prisma.orgUnit.findMany({ where: { id: { in: [created.orgUnit.id, stationBody.orgUnit.id] } } });
    expect(rows.map((row) => row.level).sort()).toEqual(['district', 'station']);
    expect(await cloned.prisma.orgUnitNameVersion.count({ where: { orgUnitId: stationBody.orgUnit.id, version: 1, name: '新建所' } })).toBe(1);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'org.unit.registered', outcome: 'succeeded', actor_id: people.root,
        org_unit_id: created.orgUnit.id, opcode: 'org.unit.register', resource_type: 'org-unit', resource_id: created.orgUnit.id,
      }),
      expect.objectContaining({ action: 'org.unit.registered', org_unit_id: stationBody.orgUnit.id }),
    ]);
  });

  it('区系统管理在本区下建所成功', async () => {
    const response = await register(PHONES.adminA, { parentId: org.deptA, name: '甲区新所', level: 'station' });
    expect(response.status).toBe(200);
  });

  const mismatched: Array<[string, () => string, string]> = [
    ['市下建所', () => org.hq, 'station'],
    ['市下建市', () => org.hq, 'city'],
    ['区下建区', () => org.deptA, 'district'],
    ['区下建市', () => org.deptA, 'city'],
    ['所下建所', () => org.station, 'station'],
    ['所下建区', () => org.station, 'district'],
    ['所下建市', () => org.station, 'city'],
    ['层级取值不认识', () => org.hq, '科'],
  ];
  it.each(mismatched)('%s → 400 org-level-mismatch，机构表不变，不写留痕', async (_label, parentOf, level) => {
    const rowsBefore = await orgRows();
    const before = await audits();
    const response = await register(PHONES.root, { parentId: parentOf(), name: '层级不符', level });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ result: 'non-compliant', rules: ['org-level-mismatch'] });
    expect(await orgRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('名称为空 → 400 org-name-required，不写留痕', async () => {
    const before = await audits();
    const response = await register(PHONES.root, { parentId: org.hq, name: '   ', level: 'district' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ result: 'non-compliant', rules: ['org-name-required'] });
    expect(added(before, await audits())).toEqual([]);
  });

  it('越权先 403：区 A 管理在区 B 下建区（层级也不符）→ 403 scope-denied + authz.denied，机构表不变', async () => {
    const rowsBefore = await orgRows();
    const before = await audits();
    const response = await register(PHONES.adminA, { parentId: org.deptB, name: '越权', level: 'district' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(await orgRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', actor_id: people.adminA,
        opcode: 'org.unit.register', resource_type: 'org-unit', resource_id: org.deptB,
      }),
    ]);
  });

  it('在已停用的区下建所 → 409 invalid-state + 失败留痕，机构表不变', async () => {
    const rowsBefore = await orgRows();
    const before = await audits();
    const response = await register(PHONES.root, { parentId: org.deactivated, name: '停用区下的所', level: 'station' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ result: 'invalid-state' });
    expect(await orgRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'org.unit.registered', outcome: 'failed', reason: 'org-unit-deactivated',
        actor_id: people.root, org_unit_id: org.deactivated, resource_id: org.deactivated, opcode: 'org.unit.register',
      }),
    ]);
  });

  it('新建根机构仍被拒 → 403 scope-denied + authz.denied，机构表不变', async () => {
    const rowsBefore = await orgRows();
    const before = await audits();
    const response = await register(PHONES.root, { parentId: null, name: '另一个市', level: 'city' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(await orgRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({ action: 'authz.denied', reason: 'scope-denied', opcode: 'org.unit.register' }),
    ]);
  });

  const deniedBy: Array<[string, string]> = [
    ['没有该码（内勤）', PHONES.intake],
    ['没有该码（经办）', PHONES.clerk],
    ['监督', PHONES.supervisor],
  ];
  it.each(deniedBy)('%s → 403 permission-denied + authz.denied，机构表不变', async (_label, phone) => {
    const rowsBefore = await orgRows();
    const before = await audits();
    const response = await register(phone, { parentId: org.deptA, name: '越权所', level: 'station' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(await orgRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({ action: 'authz.denied', reason: 'permission-denied', opcode: 'org.unit.register' }),
    ]);
  });

  it('跨站写请求被拒，机构表不变，不写留痕', async () => {
    const rowsBefore = await orgRows();
    const before = await audits();
    const response = await register(
      PHONES.root,
      { parentId: org.hq, name: '跨站区', level: 'district' },
      { origin: 'https://evil.example' },
    );
    expect(response.status).toBe(403);
    expect(await orgRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });
});

describe('POST /api/admin/org-units/:id/rename（改名）', () => {
  it('改名追加名称版本，previousValue 写旧名；树上能查到历史名称和使用期间', async () => {
    const original = (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { id: org.deptB } })).name;
    const before = await audits();
    const first = await rename(PHONES.root, org.deptB, '第二执法支队（一改）');
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ result: 'renamed', orgUnit: { id: org.deptB, name: '第二执法支队（一改）' } });
    const second = await rename(PHONES.root, org.deptB, '第二执法支队（二改）');
    expect(second.status).toBe(200);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'org.unit.renamed', outcome: 'succeeded', org_unit_id: org.deptB,
        opcode: 'org.unit.rename', resource_id: org.deptB, previous_value: original,
      }),
      expect.objectContaining({ action: 'org.unit.renamed', previous_value: '第二执法支队（一改）' }),
    ]);
    const tree = await (await getTree(PHONES.root)).json() as { orgUnits: TreeNode[] };
    const node = tree.orgUnits.find((unit) => unit.id === org.deptB)!;
    expect(node.name).toBe('第二执法支队（二改）');
    expect(node.names.map((item) => item.name)).toEqual([original, '第二执法支队（一改）', '第二执法支队（二改）']);
    expect(node.names[0]!.to).toBe(node.names[1]!.from);
    expect(node.names[1]!.to).toBe(node.names[2]!.from);
    expect(node.names[2]!.to).toBeNull();
  });

  it('与现名相同 → 200 unchanged，不追加版本，不写留痕', async () => {
    const current = (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { id: org.station } })).name;
    const rowsBefore = await orgRows();
    const before = await audits();
    const response = await rename(PHONES.root, org.station, current);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'unchanged', orgUnit: { id: org.station, name: current } });
    expect(await orgRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('名称超长 → 400 org-name-too-long，不写留痕', async () => {
    const before = await audits();
    const response = await rename(PHONES.root, org.station, '甲'.repeat(101));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ result: 'non-compliant', rules: ['org-name-too-long'] });
    expect(added(before, await audits())).toEqual([]);
  });

  it('跨区：区 A 管理改区 B → 403 scope-denied + authz.denied，业务行不变', async () => {
    const rowsBefore = await orgRows();
    const before = await audits();
    const response = await rename(PHONES.adminA, org.deptB, '越权改名');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(await orgRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', actor_id: people.adminA,
        opcode: 'org.unit.rename', resource_id: org.deptB,
      }),
    ]);
  });

  it.each(deniedByRename())('%s → 403 permission-denied + authz.denied，业务行不变', async (_label, phone) => {
    const rowsBefore = await orgRows();
    const before = await audits();
    const response = await rename(phone, org.deptA, '越权改名');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(await orgRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({ action: 'authz.denied', reason: 'permission-denied', opcode: 'org.unit.rename' }),
    ]);
  });

  it('跨站写请求被拒，业务行不变，不写留痕', async () => {
    const rowsBefore = await orgRows();
    const before = await audits();
    const response = await rename(PHONES.root, org.deptA, '跨站改名', { 'sec-fetch-site': 'cross-site' });
    expect(response.status).toBe(403);
    expect(await orgRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });
});

function deniedByRename(): Array<[string, string]> {
  return [
    ['没有该码（内勤）', PHONES.intake],
    ['没有该码（经办）', PHONES.clerk],
    ['监督', PHONES.supervisor],
  ];
}

describe('接缝①：留痕工厂覆写为「业务写完后抛错」', () => {
  it('新建下级：请求失败，机构、名称版本、留痕各表的行不变', async () => {
    await signIn(PHONES.root, seamUrl);
    const rowsBefore = await orgRows();
    const before = await audits();
    seam.armed = true;
    try {
      const response = await register(PHONES.root, { parentId: org.hq, name: '接缝区', level: 'district' }, {}, seamUrl);
      expect(response.status).toBe(500);
    } finally {
      seam.armed = false;
    }
    expect(await orgRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('改名：请求失败，机构现名与名称版本不变，不写留痕', async () => {
    await signIn(PHONES.root, seamUrl);
    const rowsBefore = await orgRows();
    const before = await audits();
    seam.armed = true;
    try {
      const response = await rename(PHONES.root, org.deptA, '接缝改名', {}, seamUrl);
      expect(response.status).toBe(500);
    } finally {
      seam.armed = false;
    }
    expect(await orgRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });
});
