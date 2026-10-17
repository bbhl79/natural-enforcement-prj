// #126：管理台留痕查阅与导出（监督）。断言打在 HTTP 状态码、返回体、导出文件、留痕行与业务行上。
// 四条必测（#105 Testing）：没有该码、跨区、监督调人员接口、跨站。每个 403 用例同时断言失败留痕行存在、业务行不变。
// 接缝①：留痕工厂覆写为「业务写完后抛错」，断言不返回数据、各表不变。
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAuditTrail, prismaAuditTrailFactory, type AuditTrailFactory } from '@natural-enforcement/audit';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';
import { readXlsxSheet } from './xlsx-cells.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Audit-pass-126!';
const SEED_PASSWORD = 'Seed-pass-52';
const SEAM_ERROR = '接缝①：业务写完后抛错';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const HEADER = ['时间', '操作人工号', '操作', '对象', '所属机构', '结果'];

const PHONES = {
  superA: '13800012601',
  superB: '13800012602',
  superHq: '13800012603',
  adminA: '13800012604',
  clerkA: '13800012605',
  memberA: '13800012611',
  memberB: '13800012612',
};
const MEMBER_CERT = 'CERT-126-MEMBER';

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

type AuditRecord = {
  id: string;
  action: string;
  outcome: string;
  reason: string | null;
  actor_id: string | null;
  actor_code: string | null;
  subject_personnel_id: string | null;
  org_unit_id: string | null;
  opcode: string | null;
  resource_type: string | null;
  resource_id: string | null;
  item_count: number | null;
};

type Row = {
  id: string;
  action: string;
  outcome: string;
  category: string | null;
  time: string;
  actorCode: string;
  operation: string;
  object: string;
  orgName: string;
  anchored: boolean;
  result: string;
  tone: string;
};

type ListBody = {
  result?: string;
  reason?: string;
  rules?: string[];
  scope?: { orgUnitId: string; orgName: string; includesUnanchored: boolean };
  filter?: Record<string, unknown>;
  total?: number;
  rows?: Row[];
};

let cloned: ClonedDatabase;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
let passwordHash = '';
let hqId = '';
let deptAId = '';
let deptBId = '';
const ids: Record<string, string> = {};
const seeded: Record<string, string> = {};

/** Asia/Shanghai 日历日。 */
function shanghaiDate(at: Date): string {
  return new Date(at.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 测试跑在真实时钟上（留痕行的写入时间是库的 now()）：取昨天到今天，覆盖本文件写下的全部行。 */
function range(): { from: string; to: string } {
  const now = new Date();
  return { from: shanghaiDate(new Date(now.getTime() - DAY_MS)), to: shanghaiDate(now) };
}

async function audits(): Promise<AuditRecord[]> {
  return cloned.prisma.$queryRaw<AuditRecord[]>`
    SELECT id, action, outcome, reason, actor_id, actor_code, subject_personnel_id,
           org_unit_id, opcode, resource_type, resource_id, item_count
    FROM audit_trail ORDER BY created_at, id`;
}

function added(before: AuditRecord[], after: AuditRecord[]): AuditRecord[] {
  const known = new Set(before.map((row) => row.id));
  return after.filter((row) => !known.has(row.id));
}

async function snapshot(): Promise<Record<string, string[]>> {
  const tables: Record<string, string[]> = {};
  for (const table of ['audit_trail', 'personnel', 'org_unit', 'personnel_role', 'auth_session']) {
    const rows = await cloned.prisma.$queryRawUnsafe<Array<{ line: string }>>(
      `SELECT row_to_json(t)::text AS line FROM ${table} t ORDER BY id`,
    );
    tables[table] = rows.map((row) => row.line);
  }
  return tables;
}

/** 业务行：除留痕与会话（登录本身会写）以外的表。 */
function business(snap: Record<string, string[]>): Record<string, string[]> {
  return { personnel: snap.personnel!, org_unit: snap.org_unit!, personnel_role: snap.personnel_role! };
}

/** 种子与本文件里全部人员的手机号和执法证号，加上口令与口令散列。 */
async function sensitiveLiterals(): Promise<string[]> {
  const literals = new Set<string>([PASSWORD, SEED_PASSWORD]);
  for (const person of await cloned.prisma.personnel.findMany()) {
    if (person.mobilePhone) literals.add(person.mobilePhone);
    if (person.enforcementCertNo) literals.add(person.enforcementCertNo);
    if (person.passwordHash) literals.add(person.passwordHash);
  }
  return [...literals];
}

async function addPerson(code: string, phone: string, orgUnitId: string, roleName?: string, certNo?: string): Promise<string> {
  const id = newUlid();
  await cloned.prisma.personnel.create({
    data: {
      id,
      code,
      name: code,
      orgUnitId,
      passwordHash,
      mobilePhone: phone,
      passwordChangedAt: new Date(Date.now() - 10 * DAY_MS),
      enforcementCertNo: certNo ?? null,
      enforcementCertExpiresOn: certNo ? new Date('2099-12-31T00:00:00.000Z') : null,
    },
  });
  await cloned.prisma.personnelAssignment.create({ data: { id: newUlid(), personnelId: id, orgUnitId } });
  if (roleName) {
    const role = await cloned.prisma.role.findFirstOrThrow({ where: { name: roleName, deactivatedAt: null } });
    await cloned.prisma.personnelRole.create({ data: { id: newUlid(), personnelId: id, roleId: role.id } });
  }
  return id;
}

const cookies = new Map<string, string>();
async function login(phone: string): Promise<string> {
  const known = cookies.get(phone);
  if (known) return known;
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: phone, password: PASSWORD, rememberMe: false }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
  cookies.set(phone, cookie);
  return cookie;
}

function post(path: string, cookie: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, ...headers },
    body: JSON.stringify(body),
  });
}

async function query(phone: string, filter: Record<string, unknown> = {}): Promise<ListBody> {
  const response = await post('/api/admin/audit/query', await login(phone), { ...range(), ...filter });
  expect(response.status).toBe(200);
  return await response.json() as ListBody;
}

async function exportFile(phone: string, filter: Record<string, unknown> = {}): Promise<{ response: Response; file: Buffer }> {
  const response = await post('/api/admin/audit/export', await login(phone), { ...range(), ...filter });
  const file = Buffer.from(await response.arrayBuffer());
  return { response, file };
}

function cells(row: Row): string[] {
  return [row.time, row.actorCode, row.operation, row.object, row.orgName, row.result];
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  hqId = (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-HQ' } })).id;
  deptAId = (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-A' } })).id;
  deptBId = (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-B' } })).id;
  passwordHash = await hash(PASSWORD, PINNED);
  ids.superA = await addPerson('P-126-SUPER-A', PHONES.superA, deptAId, '监督');
  ids.superB = await addPerson('P-126-SUPER-B', PHONES.superB, deptBId, '监督');
  ids.superHq = await addPerson('P-126-SUPER-HQ', PHONES.superHq, hqId, '监督');
  ids.adminA = await addPerson('P-126-ADM-A', PHONES.adminA, deptAId, '系统管理');
  ids.clerkA = await addPerson('P-126-CLERK-A', PHONES.clerkA, deptAId, '经办');
  ids.memberA = await addPerson('P-126-MEM-A', PHONES.memberA, deptAId, undefined, MEMBER_CERT);
  ids.memberB = await addPerson('P-126-MEM-B', PHONES.memberB, deptBId);

  // 几行已知的留痕：甲区、乙区、无所属机构（未对上人员的登录失败）、甲区的一次解锁被拒。
  const trail = new PrismaAuditTrail(cloned.prisma);
  const party = { actorId: ids.adminA, actorCode: 'P-126-ADM-A', sourceIp: '203.0.113.26' };
  await trail.append({ ...party, action: 'account.unlocked', subjectPersonnelId: ids.memberA, subjectCode: 'P-126-MEM-A', orgUnitId: deptAId });
  await trail.append({ ...party, action: 'account.unlocked', subjectPersonnelId: ids.memberB, subjectCode: 'P-126-MEM-B', orgUnitId: deptBId });
  await trail.append({
    action: 'login.failed', reason: 'unknown-identifier', actorId: null, actorCode: null,
    subjectPersonnelId: null, subjectCode: null, orgUnitId: null, sourceIp: '203.0.113.27',
  });
  await trail.append({
    action: 'authz.denied', outcome: 'failed', actorId: ids.clerkA, actorCode: 'P-126-CLERK-A',
    subjectPersonnelId: null, subjectCode: null, orgUnitId: deptAId, sourceIp: null, reason: 'permission-denied',
    opcode: 'personnel.locked.release', resourceType: 'personnel', resourceId: ids.memberA, previousValue: null,
  });
  for (const row of await audits()) {
    if (row.action === 'account.unlocked' && row.org_unit_id === deptAId) seeded.unlockA = row.id;
    if (row.action === 'account.unlocked' && row.org_unit_id === deptBId) seeded.unlockB = row.id;
    if (row.action === 'login.failed') seeded.unanchored = row.id;
    if (row.action === 'authz.denied') seeded.deniedA = row.id;
  }

  const app = await createApplication(cloned.connectionString, { now: () => new Date() }, undefined, {
    auditTrailFactory: failingFactory,
  });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();
}, 60_000);

afterAll(async () => {
  seam.armed = false;
  await closeApp();
  await cloned?.close();
});

describe('POST /api/admin/audit/query：数据范围', () => {
  it('区 A 监督看不到区 B 的行，也看不到无所属机构的行', async () => {
    const body = await query(PHONES.superA);
    expect(body.scope).toEqual({ orgUnitId: deptAId, orgName: '第一执法支队', includesUnanchored: false });
    const rowIds = (body.rows ?? []).map((row) => row.id);
    expect(rowIds).toContain(seeded.unlockA);
    expect(rowIds).toContain(seeded.deniedA);
    expect(rowIds).not.toContain(seeded.unlockB);
    expect(rowIds).not.toContain(seeded.unanchored);
    expect((body.rows ?? []).every((row) => row.anchored)).toBe(true);
    expect(body.total).toBe(body.rows?.length);
  });

  it('区 B 监督只看到区 B 的行', async () => {
    const rowIds = ((await query(PHONES.superB)).rows ?? []).map((row) => row.id);
    expect(rowIds).toContain(seeded.unlockB);
    expect(rowIds).not.toContain(seeded.unlockA);
    expect(rowIds).not.toContain(seeded.unanchored);
  });

  it('根机构监督看到各区的行和无所属机构的行', async () => {
    const body = await query(PHONES.superHq);
    expect(body.scope).toEqual({ orgUnitId: hqId, orgName: '自然执法总队', includesUnanchored: true });
    const rows = body.rows ?? [];
    const rowIds = rows.map((row) => row.id);
    for (const id of [seeded.unlockA, seeded.unlockB, seeded.unanchored, seeded.deniedA]) expect(rowIds).toContain(id);
    const unanchored = rows.find((row) => row.id === seeded.unanchored);
    expect(unanchored).toMatchObject({
      anchored: false, orgName: '无所属机构', operation: '登录', object: '未对上人员', result: '失败：未对上人员', tone: 'red',
      category: 'auth-session',
    });
    const denied = rows.find((row) => row.id === seeded.deniedA);
    expect(denied).toMatchObject({
      actorCode: 'P-126-CLERK-A', operation: '解锁', object: '人员 P-126-MEM-A', orgName: '第一执法支队',
      result: '被拒绝：没有权限', category: 'unlock-reset',
    });
  });

  it('根机构监督把范围收到某个区时，无所属机构的行不出现', async () => {
    const body = await query(PHONES.superHq, { orgUnitId: deptBId });
    expect(body.scope?.includesUnanchored).toBe(false);
    const rowIds = (body.rows ?? []).map((row) => row.id);
    expect(rowIds).toContain(seeded.unlockB);
    expect(rowIds).not.toContain(seeded.unlockA);
    expect(rowIds).not.toContain(seeded.unanchored);
  });

  it('系统管理同样可查阅本范围', async () => {
    const rowIds = ((await query(PHONES.adminA)).rows ?? []).map((row) => row.id);
    expect(rowIds).toContain(seeded.unlockA);
    expect(rowIds).not.toContain(seeded.unlockB);
  });
});

describe('跨区被拒的行（ADR 0011：授权拒绝的所属机构取操作者当时的任职）', () => {
  it('区 A 监督越区查阅被拒：这一行归区 A，区 A 监督看得到、对象写区 B 的名称；区 B 监督看不到', async () => {
    const cookie = await login(PHONES.superA);
    expect((await post('/api/admin/audit/query', cookie, { ...range(), orgUnitId: deptBId })).status).toBe(403);
    const deptBName = (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { id: deptBId } })).name;
    const rowsA = (await query(PHONES.superA)).rows ?? [];
    const denied = rowsA.find((row) => row.action === 'authz.denied' && row.operation === '查阅管理台留痕' && row.object === deptBName);
    expect(denied, '区 A 监督的越区查阅被拒行').toBeDefined();
    expect(denied).toMatchObject({ actorCode: 'P-126-SUPER-A', orgName: '第一执法支队', result: '被拒绝：超出数据范围' });
    const rowsB = (await query(PHONES.superB)).rows ?? [];
    expect(rowsB.map((row) => row.id)).not.toContain(denied?.id);
  });
});

describe('POST /api/admin/audit/query：筛选与本次查阅留痕', () => {
  it('按类别筛选：解锁与重设口令只含解锁与被拒的解锁；认证与会话只含登录与会话', async () => {
    const unlock = await query(PHONES.superHq, { category: 'unlock-reset' });
    expect(new Set((unlock.rows ?? []).map((row) => row.category))).toEqual(new Set(['unlock-reset']));
    expect((unlock.rows ?? []).map((row) => row.id).sort()).toEqual([seeded.unlockA, seeded.unlockB, seeded.deniedA].sort());
    const auth = await query(PHONES.superHq, { category: 'auth-session' });
    expect((auth.rows ?? []).length).toBeGreaterThan(1);
    expect((auth.rows ?? []).every((row) => row.operation === '登录' || row.operation === '结束会话')).toBe(true);
  });

  it('按操作人工号与结果筛选', async () => {
    const byActor = await query(PHONES.superHq, { actorCode: 'P-126-ADM-A', category: 'unlock-reset' });
    expect((byActor.rows ?? []).map((row) => row.id).sort()).toEqual([seeded.unlockA, seeded.unlockB].sort());
    const failed = await query(PHONES.superHq, { outcome: 'failed' });
    expect((failed.rows ?? []).every((row) => row.outcome === 'failed')).toBe(true);
    expect((failed.rows ?? []).map((row) => row.id)).toContain(seeded.unanchored);
  });

  it('查阅写一行 audit.viewed；本次写的这一行不在本次结果里，下一次才出现', async () => {
    await login(PHONES.superA);
    const before = await audits();
    const first = await query(PHONES.superA);
    const rows = added(before, await audits());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'audit.viewed', outcome: 'succeeded', reason: null, actor_id: ids.superA, actor_code: 'P-126-SUPER-A',
      subject_personnel_id: null, org_unit_id: deptAId, opcode: 'audit.admin.read',
      resource_type: 'org-unit', resource_id: deptAId, item_count: null,
    });
    const viewedId = rows[0]!.id;
    expect((first.rows ?? []).map((row) => row.id)).not.toContain(viewedId);
    const second = await query(PHONES.superA);
    const shown = (second.rows ?? []).find((row) => row.id === viewedId);
    expect(shown).toMatchObject({ actorCode: 'P-126-SUPER-A', operation: '查阅管理台留痕', object: '管理台留痕', result: '成功' });
    expect(second.total).toBe((first.total ?? 0) + 1);
  });

  it('筛选条件不合法：400，不写留痕', async () => {
    const cookie = await login(PHONES.superA);
    const before = await audits();
    for (const body of [
      { from: '2026-10-18', to: '2026-10-17' },
      { from: '2026-02-30', to: '2026-03-01' },
      { ...range(), category: 'everything' },
      { ...range(), outcome: 'maybe' },
    ]) {
      const response = await post('/api/admin/audit/query', cookie, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ result: 'non-compliant', rules: ['invalid-filter'] });
    }
    expect(added(before, await audits())).toEqual([]);
  });
});

describe('POST /api/admin/audit/export', () => {
  it('同一筛选条件下，导出文件的行与查阅结果完全一致；导出写 audit.exported（带条数）', async () => {
    const filter = { category: 'unlock-reset' };
    const listed = await query(PHONES.superHq, filter);
    const before = await audits();
    const { response, file } = await exportFile(PHONES.superHq, filter);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet');
    const { from, to } = range();
    const filename = `管理台留痕_${from.replace(/-/g, '')}-${to.replace(/-/g, '')}.xlsx`;
    expect(response.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent(filename)}`);
    const sheet = readXlsxSheet(file);
    expect(sheet.rows[0]).toEqual(HEADER);
    expect(sheet.rows.slice(1)).toEqual((listed.rows ?? []).map(cells));
    expect(response.headers.get('x-item-count')).toBe(String(listed.rows?.length));

    const rows = added(before, await audits());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'audit.exported', outcome: 'succeeded', actor_id: ids.superHq, actor_code: 'P-126-SUPER-HQ',
      org_unit_id: hqId, opcode: 'audit.admin.export', resource_type: 'org-unit', resource_id: hqId,
      item_count: listed.rows?.length,
    });
  });

  it('不筛类别时，导出的行 = 查阅结果加上这次查阅自己写的一行；本次导出写的行下一次查阅才出现', async () => {
    const listed = await query(PHONES.superA);
    const viewed = (await audits()).filter((row) => row.action === 'audit.viewed' && row.actor_id === ids.superA).at(-1)!;
    const before = await audits();
    const { response, file } = await exportFile(PHONES.superA);
    expect(response.status).toBe(200);
    const exported = readXlsxSheet(file).rows.slice(1);
    expect(exported.slice(1)).toEqual((listed.rows ?? []).map(cells));
    expect(exported[0]?.slice(1)).toEqual(['P-126-SUPER-A', '查阅管理台留痕', '管理台留痕', '第一执法支队', '成功']);
    const exportedRow = added(before, await audits())[0]!;
    expect(exportedRow.action).toBe('audit.exported');
    expect(exportedRow.item_count).toBe(exported.length);
    const next = await query(PHONES.superA);
    expect(next.rows?.[0]).toMatchObject({ id: exportedRow.id, operation: '导出管理台留痕', result: '成功' });
    expect((next.rows ?? []).map((row) => row.id)).toContain(viewed.id);
  });

  it('区 A 监督导出的文件里没有区 B 和无所属机构的行', async () => {
    const { response, file } = await exportFile(PHONES.superA, { category: 'unlock-reset' });
    expect(response.status).toBe(200);
    const rows = readXlsxSheet(file).rows.slice(1);
    expect(rows.map((row) => row[3]).sort()).toEqual(['人员 P-126-MEM-A', '人员 P-126-MEM-A']);
    expect(rows.every((row) => row[4] === '第一执法支队')).toBe(true);
  });
});

describe('不出现手机号与执法证号', () => {
  it('用库里全部人员的手机号和执法证号扫描查阅响应和导出文件的每个单元格', async () => {
    const literals = await sensitiveLiterals();
    expect(literals).toContain(PHONES.memberA);
    expect(literals).toContain(MEMBER_CERT);
    expect(literals).toContain('13800001011');
    const responses: string[] = [];
    const cellsSeen: string[] = [];
    for (const phone of [PHONES.superHq, PHONES.superA, PHONES.adminA]) {
      const response = await post('/api/admin/audit/query', await login(phone), range());
      responses.push(await response.text());
      const { file } = await exportFile(phone);
      const sheet = readXlsxSheet(file);
      cellsSeen.push(...sheet.rows.flat());
      responses.push(sheet.xml);
    }
    expect(cellsSeen.length).toBeGreaterThan(HEADER.length * 3);
    for (const literal of literals) {
      for (const cell of cellsSeen) expect(cell.includes(literal), `单元格出现敏感字面量 ${literal}`).toBe(false);
      for (const text of responses) expect(text.includes(literal), `响应出现敏感字面量 ${literal}`).toBe(false);
    }
  });
});

describe('四条必测', () => {
  async function expectDenied(
    path: string,
    phone: string,
    body: unknown,
    expected: { reason: string; actorId: string; actorCode: string; actorOrgId: string; opcode: string; resourceType: string; resourceId: string },
  ): Promise<void> {
    const cookie = await login(phone);
    const before = await snapshot();
    const auditsBefore = await audits();
    const response = path.startsWith('GET ')
      ? await fetch(`${baseUrl}${path.slice(4)}`, { headers: { cookie } })
      : await post(path, cookie, body);
    expect(response.status, path).toBe(403);
    expect(await response.json()).toEqual({ reason: expected.reason });
    const rows = added(auditsBefore, await audits());
    expect(rows, path).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'authz.denied', outcome: 'failed', reason: expected.reason, actor_id: expected.actorId,
      actor_code: expected.actorCode, subject_personnel_id: null, org_unit_id: expected.actorOrgId,
      opcode: expected.opcode, resource_type: expected.resourceType, resource_id: expected.resourceId, item_count: null,
    });
    expect(business(await snapshot())).toEqual(business(before));
  }

  it('没有该码（经办）：查阅与导出都 403 permission-denied，写 authz.denied，不写 audit.viewed/exported', async () => {
    for (const [path, opcode] of [['/api/admin/audit/query', 'audit.admin.read'], ['/api/admin/audit/export', 'audit.admin.export']] as const) {
      await expectDenied(path, PHONES.clerkA, range(), {
        reason: 'permission-denied', actorId: ids.clerkA, actorCode: 'P-126-CLERK-A', actorOrgId: deptAId,
        opcode, resourceType: 'org-unit', resourceId: deptAId,
      });
    }
    await expectDenied('GET /api/admin/audit/summary', PHONES.clerkA, null, {
      reason: 'permission-denied', actorId: ids.clerkA, actorCode: 'P-126-CLERK-A', actorOrgId: deptAId,
      opcode: 'audit.admin.read', resourceType: 'org-unit', resourceId: deptAId,
    });
  });

  it('跨区：区 A 监督查阅或导出区 B，403 scope-denied，写 authz.denied', async () => {
    for (const [path, opcode] of [['/api/admin/audit/query', 'audit.admin.read'], ['/api/admin/audit/export', 'audit.admin.export']] as const) {
      await expectDenied(path, PHONES.superA, { ...range(), orgUnitId: deptBId }, {
        reason: 'scope-denied', actorId: ids.superA, actorCode: 'P-126-SUPER-A', actorOrgId: deptAId,
        opcode, resourceType: 'org-unit', resourceId: deptBId,
      });
    }
    // 区监督也不能把范围放大到根机构（无所属机构的行因此看不到）
    await expectDenied('/api/admin/audit/query', PHONES.superA, { ...range(), orgUnitId: hqId }, {
      reason: 'scope-denied', actorId: ids.superA, actorCode: 'P-126-SUPER-A', actorOrgId: deptAId,
      opcode: 'audit.admin.read', resourceType: 'org-unit', resourceId: hqId,
    });
  });

  it('监督调人员接口：403 permission-denied，写 authz.denied（人员导出、被锁人员列表、解锁、重设口令）', async () => {
    await expectDenied('/api/admin/personnel/export', PHONES.superA, { orgUnitId: deptAId }, {
      reason: 'permission-denied', actorId: ids.superA, actorCode: 'P-126-SUPER-A', actorOrgId: deptAId,
      opcode: 'personnel.profile.export', resourceType: 'org-unit', resourceId: deptAId,
    });
    await expectDenied('/api/admin/personnel/export', PHONES.superHq, { orgUnitId: hqId }, {
      reason: 'permission-denied', actorId: ids.superHq, actorCode: 'P-126-SUPER-HQ', actorOrgId: hqId,
      opcode: 'personnel.profile.export', resourceType: 'org-unit', resourceId: hqId,
    });
    await expectDenied(`/api/admin/personnel/${ids.memberA}/unlock`, PHONES.superA, {}, {
      reason: 'permission-denied', actorId: ids.superA, actorCode: 'P-126-SUPER-A', actorOrgId: deptAId,
      opcode: 'personnel.locked.release', resourceType: 'personnel', resourceId: ids.memberA,
    });
    await expectDenied(`/api/admin/personnel/${ids.memberA}/password-reset`, PHONES.superA, { password: 'Reset-pass-126!' }, {
      reason: 'permission-denied', actorId: ids.superA, actorCode: 'P-126-SUPER-A', actorOrgId: deptAId,
      opcode: 'personnel.password.reset', resourceType: 'personnel', resourceId: ids.memberA,
    });
    const cookie = await login(PHONES.superA);
    const auditsBefore = await audits();
    const list = await fetch(`${baseUrl}/api/admin/locked-personnel`, { headers: { cookie } });
    expect(list.status).toBe(403);
    expect(await list.json()).toEqual({ reason: 'permission-denied' });
    expect(added(auditsBefore, await audits())).toMatchObject([
      { action: 'authz.denied', reason: 'permission-denied', actor_id: ids.superA, opcode: 'personnel.locked.read' },
    ]);
  });

  it('跨站请求被拒：外站 Origin 与 Sec-Fetch-Site: cross-site 都 403，不写留痕，不返回数据', async () => {
    const cookie = await login(PHONES.superHq);
    const before = await snapshot();
    const crossSite: Array<Record<string, string>> = [{ origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }];
    for (const path of ['/api/admin/audit/query', '/api/admin/audit/export']) {
      for (const headers of crossSite) {
        const response = await post(path, cookie, range(), headers);
        expect(response.status, `${path} ${JSON.stringify(headers)}`).toBe(403);
        const text = await response.text();
        expect(text).not.toContain('P-126-MEM-A');
        expect(text).not.toContain('PK');
      }
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe('接缝①：留痕写入失败', () => {
  it('查阅与导出都 500，不交出数据，各表不变', async () => {
    const cookie = await login(PHONES.superHq);
    const before = await snapshot();
    seam.armed = true;
    try {
      for (const path of ['/api/admin/audit/query', '/api/admin/audit/export']) {
        const response = await post(path, cookie, range());
        expect(response.status, path).toBe(500);
        const text = await response.text();
        expect(text).not.toContain('P-126-MEM-A');
        expect(text).not.toContain('PK');
      }
    } finally {
      seam.armed = false;
    }
    // 会话的最近活动时间由会话守卫照常刷新，不属于本动作的业务行
    const after = await snapshot();
    expect(after.audit_trail).toEqual(before.audit_trail);
    expect(business(after)).toEqual(business(before));
    expect((await post('/api/admin/audit/query', cookie, range())).status).toBe(200);
  });
});

describe('GET /api/admin/audit/summary（管理台首页今日条数）', () => {
  it('返回本范围今日条数，不写 audit.viewed', async () => {
    const cookie = await login(PHONES.superB);
    const today = shanghaiDate(new Date());
    const expected = (await query(PHONES.superB, { from: today, to: today })).total ?? 0;
    const before = await audits();
    const response = await fetch(`${baseUrl}/api/admin/audit/summary`, { headers: { cookie } });
    expect(response.status).toBe(200);
    // 上一步查阅本身写了一行 audit.viewed，今日条数因此多 1
    expect(await response.json()).toEqual({ result: 'counted', today: expected + 1 });
    expect(added(before, await audits())).toEqual([]);
  });
});
