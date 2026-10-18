// #128 人员登记、列表与卡片（含岗位标记）。
// 断言打在 HTTP 状态码、响应体、人员相关各表的行、留痕行上。断言打在克隆库上。
// 每个接口的四条必测（#105 Testing）：没有该码、跨区或无数据范围、监督、跨站请求。
// 每个 403/409 用例同时断言失败留痕行存在、业务行不变。
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaAuditTrailFactory, type AuditTrailFactory } from '@natural-enforcement/audit';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-18T02:00:00.000Z');
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Person-128-ok!';
const INITIAL = 'Gz@Field2026';
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SEAM_ERROR = '接缝①：业务写完后抛错（#128）';
const CERT_NO = 'CERT-128-VALID';

const PHONES = {
  root: '13800012801',
  adminA: '13800012802',
  intake: '13800012803',
  clerk: '13800012804',
  supervisor: '13800012805',
  homeless: '13800012806',
  memberB: '13800012807',
  retired: '13800012808',
  loose: '13800012809',
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
const people = {
  root: '', adminA: '', intake: '', clerk: '', supervisor: '', homeless: '', memberB: '', retired: '', loose: '',
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
  source_ip: string | null;
  target_org_unit_id: string | null;
  target_org_unit_basis: string | null;
};

async function audits(): Promise<AuditRecord[]> {
  return cloned.prisma.$queryRaw<AuditRecord[]>`
    SELECT id, action, outcome, reason, actor_id, actor_code, subject_personnel_id, subject_code, org_unit_id,
           opcode, resource_type, resource_id, previous_value, next_value, source_ip,
           target_org_unit_id, target_org_unit_basis
    FROM audit_trail
    ORDER BY created_at, id
  `;
}

function added(before: AuditRecord[], after: AuditRecord[]): AuditRecord[] {
  const known = new Set(before.map((row) => row.id));
  return after.filter((row) => !known.has(row.id));
}

/** 人员、名称版本、任职、人员—角色、人员—岗位标记五张表的全部行（业务行）。 */
async function personnelRows(): Promise<string[]> {
  const rows = await cloned.prisma.$queryRaw<Array<{ row: unknown }>>`
    SELECT row_to_json(t)::text AS row FROM (
      SELECT 'personnel' AS tbl, id, row_to_json(p)::text AS body FROM personnel p
      UNION ALL SELECT 'personnel_name_version', id, row_to_json(v)::text FROM personnel_name_version v
      UNION ALL SELECT 'personnel_assignment', id, row_to_json(a)::text FROM personnel_assignment a
      UNION ALL SELECT 'personnel_role', id, row_to_json(r)::text FROM personnel_role r
      UNION ALL SELECT 'personnel_post', id, row_to_json(s)::text FROM personnel_post s
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
  role: string;
  assign?: boolean;
  deactivated?: boolean;
  cert?: { no: string; expiresOn: Date };
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
      enforcementCertNo: input.cert?.no ?? null,
      enforcementCertExpiresOn: input.cert?.expiresOn ?? null,
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

async function login(phone: string, password = PASSWORD, url = baseUrl): Promise<Response> {
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

async function list(phone: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}/api/admin/personnel`, { headers: { cookie: await signIn(phone), ...headers } });
}

async function card(phone: string, id: string, headers: Record<string, string> = {}, url = baseUrl): Promise<Response> {
  return fetch(`${url}/api/admin/personnel/${id}`, { headers: { cookie: await signIn(phone, url), ...headers } });
}

interface RegisterBody {
  code: string;
  name: string;
  orgUnitId: string;
  mobilePhone: string;
  initialPassword: string;
  roles: string[];
  posts: string[];
  certNo?: string;
  certExpiresOn?: string;
}

let serial = 0;
function body(overrides: Partial<RegisterBody> = {}): RegisterBody {
  serial += 1;
  return {
    code: `P-128-N${String(serial).padStart(2, '0')}`,
    name: `新人员${serial}`,
    orgUnitId: org.deptA,
    mobilePhone: `139001280${String(serial).padStart(2, '0')}`,
    initialPassword: INITIAL,
    roles: ['经办'],
    posts: [],
    ...overrides,
  };
}

async function register(
  phone: string,
  payload: unknown,
  headers: Record<string, string> = {},
  url = baseUrl,
): Promise<Response> {
  return fetch(`${url}/api/admin/personnel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await signIn(phone, url), ...headers },
    body: JSON.stringify(payload),
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

/** 库里全部手机号和执法证号（含种子），用作字面量扫描。 */
async function secrets(): Promise<string[]> {
  const rows = await cloned.prisma.personnel.findMany({ select: { mobilePhone: true, enforcementCertNo: true } });
  return rows.flatMap((row) => [row.mobilePhone, row.enforcementCertNo]).filter((item): item is string => !!item);
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
      code: 'ORG-128-OFF',
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
  people.root = await addPerson({ code: 'P-128-ROOT', phone: PHONES.root, orgUnitId: org.hq, role: '系统管理' });
  people.adminA = await addPerson({ code: 'P-128-ADM-A', phone: PHONES.adminA, orgUnitId: org.deptA, role: '系统管理' });
  people.intake = await addPerson({ code: 'P-128-INTAKE', phone: PHONES.intake, orgUnitId: org.hq, role: '内勤' });
  people.clerk = await addPerson({
    code: 'P-128-CLERK', phone: PHONES.clerk, orgUnitId: org.station, role: '经办',
    cert: { no: CERT_NO, expiresOn: new Date('2026-11-01T00:00:00.000Z') },
  });
  people.supervisor = await addPerson({ code: 'P-128-SUPER', phone: PHONES.supervisor, orgUnitId: org.deptA, role: '监督' });
  people.homeless = await addPerson({
    code: 'P-128-NONE', phone: PHONES.homeless, orgUnitId: org.deptA, role: '系统管理', assign: false,
  });
  people.memberB = await addPerson({ code: 'P-128-MEM-B', phone: PHONES.memberB, orgUnitId: org.deptB, role: '经办' });
  people.retired = await addPerson({
    code: 'P-128-RETIRED', phone: PHONES.retired, orgUnitId: org.deptA, role: '经办', deactivated: true,
  });
  people.loose = await addPerson({ code: 'P-128-LOOSE', phone: PHONES.loose, orgUnitId: org.deptA, role: '经办', assign: false });
  baseUrl = await startApp();
  seamUrl = await startApp(failingFactory);
  // 先登录：登录本身写 login.succeeded，各用例的「新增留痕」只看接口这一步。
  for (const phone of [PHONES.root, PHONES.adminA, PHONES.intake, PHONES.clerk, PHONES.supervisor, PHONES.homeless]) {
    await signIn(phone);
  }
  await signIn(PHONES.root, seamUrl);
}, 60_000);

afterAll(async () => {
  seam.armed = false;
  for (const close of closers) await close();
  await cloned?.close();
});

interface ListRow {
  id: string;
  code: string;
  name: string;
  orgUnitId: string | null;
  orgName: string | null;
  roles: string[];
  certStatus: string;
  deactivatedAt: string | null;
}

describe('GET /api/admin/personnel（人员列表）', () => {
  it('根机构系统管理拿到全市人员，含已停用人员和没有当前任职的人员，不写留痕', async () => {
    const before = await audits();
    const response = await list(PHONES.root);
    expect(response.status).toBe(200);
    const json = await response.json() as { result: string; rootId: string; orgUnits: Array<{ id: string }>; personnel: ListRow[] };
    expect(json.result).toBe('listed');
    expect(json.rootId).toBe(org.hq);
    const codes = json.personnel.map((row) => row.code);
    expect(codes).toEqual(expect.arrayContaining(['P-128-MEM-B', 'P-128-RETIRED', 'P-128-LOOSE', 'P-CLERK-A', 'P-CLERK-B']));
    expect(codes).toEqual([...codes].sort());
    expect(json.orgUnits.map((unit) => unit.id)).toEqual(expect.arrayContaining([org.hq, org.deptB, org.deactivated]));
    const retired = json.personnel.find((row) => row.code === 'P-128-RETIRED')!;
    expect(retired.deactivatedAt).toBe(new Date(T0 - DAY_MS).toISOString());
    const loose = json.personnel.find((row) => row.code === 'P-128-LOOSE')!;
    expect(loose).toMatchObject({ orgUnitId: null, orgName: null });
    const clerk = json.personnel.find((row) => row.code === 'P-128-CLERK')!;
    expect(clerk).toEqual({
      id: people.clerk, code: 'P-128-CLERK', name: 'P-128-CLERK', orgUnitId: org.station, orgName: '甲区执法所',
      roles: ['经办'], certStatus: 'expiring', deactivatedAt: null,
    });
    expect(json.personnel.find((row) => row.code === 'P-CLERK-A')?.certStatus).toBe('valid');
    expect(json.personnel.find((row) => row.code === 'P-CLERK-B')?.certStatus).toBe('expired');
    expect(json.personnel.find((row) => row.code === 'P-BOTH-A')?.roles).toEqual(['经办', '监督']);
    expect(added(before, await audits())).toEqual([]);
  });

  it('列表响应不含任何手机号和执法证号', async () => {
    const text = await (await list(PHONES.root)).text();
    for (const secret of await secrets()) expect(text.includes(secret), secret).toBe(false);
  });

  it('区 A 系统管理只拿到本区及下级的人员，没有区 B，没有无任职的人员', async () => {
    const response = await list(PHONES.adminA);
    expect(response.status).toBe(200);
    const json = await response.json() as { rootId: string; personnel: ListRow[] };
    expect(json.rootId).toBe(org.deptA);
    const codes = json.personnel.map((row) => row.code);
    expect(codes).toEqual(expect.arrayContaining(['P-128-CLERK', 'P-128-RETIRED', 'P-CLERK-A', 'P-LEGAL-ST']));
    expect(codes).not.toContain('P-128-MEM-B');
    expect(codes).not.toContain('P-CLERK-B');
    expect(codes).not.toContain('P-128-LOOSE');
    expect(codes).not.toContain('P-128-ROOT');
  });

  const deniedBy: Array<[string, string, string]> = [
    ['没有该码（内勤）', PHONES.intake, 'P-128-INTAKE'],
    ['没有该码（经办）', PHONES.clerk, 'P-128-CLERK'],
    ['监督', PHONES.supervisor, 'P-128-SUPER'],
  ];
  it.each(deniedBy)('%s → 403 permission-denied + authz.denied', async (_label, phone, code) => {
    const before = await audits();
    const response = await list(phone);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', outcome: 'failed', reason: 'permission-denied', actor_code: code,
        opcode: 'personnel.profile.read', resource_type: 'org-unit',
      }),
    ]);
  });

  it('没有数据范围（无当前任职）→ 403 scope-denied + authz.denied', async () => {
    const before = await audits();
    const response = await list(PHONES.homeless);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({ action: 'authz.denied', reason: 'scope-denied', actor_id: people.homeless, opcode: 'personnel.profile.read' }),
    ]);
  });

  it('跨站读请求被拒（Sec-Fetch-Site 或 Origin），不写留痕', async () => {
    const before = await audits();
    expect((await list(PHONES.root, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await list(PHONES.root, { origin: 'https://evil.example' })).status).toBe(403);
    expect(added(before, await audits())).toEqual([]);
  });
});

describe('GET /api/admin/personnel/:id（人员卡片）', () => {
  it('打开卡片返回完整手机号和执法证，写一行 personnel.viewed，留痕里只有工号', async () => {
    const before = await audits();
    const response = await card(PHONES.adminA, people.clerk);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: 'viewed',
      personnel: {
        id: people.clerk,
        code: 'P-128-CLERK',
        name: 'P-128-CLERK',
        mobilePhone: PHONES.clerk,
        orgUnitId: org.station,
        orgName: '甲区执法所',
        orgParentName: '第一执法支队',
        roles: ['经办'],
        posts: [],
        passwordChangedAt: new Date(T0 - 10 * DAY_MS).toISOString(),
        deactivatedAt: null,
        cert: { no: CERT_NO, expiresOn: '2026-11-01', status: 'expiring' },
      },
    });
    const rows = added(before, await audits());
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'personnel.viewed', outcome: 'succeeded', reason: null,
        actor_id: people.adminA, actor_code: 'P-128-ADM-A',
        subject_personnel_id: people.clerk, subject_code: 'P-128-CLERK',
        org_unit_id: org.station, opcode: 'personnel.profile.read', resource_type: 'personnel', resource_id: people.clerk,
        previous_value: null, next_value: null,
      }),
    ]);
    const text = JSON.stringify(rows);
    expect(text.includes(PHONES.clerk)).toBe(false);
    expect(text.includes(CERT_NO)).toBe(false);
  });

  it('每次打开都写一行', async () => {
    const before = await audits();
    await card(PHONES.adminA, people.retired);
    await card(PHONES.adminA, people.retired);
    expect(added(before, await audits()).map((row) => row.action)).toEqual(['personnel.viewed', 'personnel.viewed']);
  });

  it('当前机构是根机构或上级是根机构时不带上级名（原型 P6:69 分局一级只写本名）', async () => {
    const dept = await (await card(PHONES.root, people.retired)).json() as { personnel: { orgName: string | null; orgParentName: string | null } };
    expect(dept.personnel.orgName).toBe('第一执法支队');
    expect(dept.personnel.orgParentName).toBeNull();
    const root = await (await card(PHONES.root, people.intake)).json() as { personnel: { orgName: string | null; orgParentName: string | null } };
    expect(root.personnel.orgName).toBe('自然执法总队');
    expect(root.personnel.orgParentName).toBeNull();
  });

  it('没有当前任职的人员视同根机构：根机构系统管理能看，区系统管理 403 scope-denied', async () => {
    expect((await card(PHONES.root, people.loose)).status).toBe(200);
    const before = await audits();
    const response = await card(PHONES.adminA, people.loose);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', resource_id: people.loose,
        target_org_unit_id: org.hq, target_org_unit_basis: 'object',
      }),
    ]);
  });

  it('跨区：区 A 系统管理打开区 B 人员 → 403 scope-denied + authz.denied，不写 personnel.viewed', async () => {
    const before = await audits();
    const response = await card(PHONES.adminA, people.memberB);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', actor_id: people.adminA,
        opcode: 'personnel.profile.read', resource_type: 'personnel', resource_id: people.memberB,
        // 接 #119（34fa3cc）：被拒留痕的数据范围按目标人员所在机构判断
        target_org_unit_id: org.deptB, target_org_unit_basis: 'object',
      }),
    ]);
  });

  const deniedBy: Array<[string, string]> = [
    ['没有该码（内勤）', PHONES.intake],
    ['没有该码（经办）', PHONES.clerk],
    ['监督', PHONES.supervisor],
  ];
  it.each(deniedBy)('%s → 403 permission-denied + authz.denied', async (_label, phone) => {
    const before = await audits();
    const response = await card(phone, people.retired);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({ action: 'authz.denied', reason: 'permission-denied', opcode: 'personnel.profile.read' }),
    ]);
  });

  it('人员不存在 → 404，不写留痕', async () => {
    const before = await audits();
    const response = await card(PHONES.root, newUlid());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ result: 'not-found' });
    expect(added(before, await audits())).toEqual([]);
  });

  it('跨站读请求被拒，不写留痕', async () => {
    const before = await audits();
    expect((await card(PHONES.root, people.clerk, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await card(PHONES.root, people.clerk, { origin: 'https://evil.example' })).status).toBe(403);
    expect(added(before, await audits())).toEqual([]);
  });
});

describe('POST /api/admin/personnel（登记）', () => {
  it('登记成功：人员、名称版本、任职、人员—角色、岗位标记与留痕同事务；口令修改时间与执法证留空', async () => {
    const payload = body({ roles: ['经办', '法制审核', '经办'], posts: ['legal-review-lead', 'legal-affairs-leader'], name: ' 邓雅 ' });
    const before = await audits();
    const response = await register(PHONES.root, payload);
    expect(response.status).toBe(200);
    const json = await response.json() as { result: string; personnel: { id: string; code: string; name: string; orgUnitId: string } };
    expect(json).toEqual({ result: 'registered', personnel: { id: expect.stringMatching(ULID), code: payload.code, name: '邓雅', orgUnitId: org.deptA } });
    const id = json.personnel.id;
    const row = await cloned.prisma.personnel.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      code: payload.code, name: '邓雅', orgUnitId: org.deptA, mobilePhone: payload.mobilePhone,
      passwordChangedAt: null, enforcementCertNo: null, enforcementCertExpiresOn: null, deactivatedAt: null,
    });
    expect(row.passwordHash?.startsWith('$argon2id$')).toBe(true);
    expect(await cloned.prisma.personnelNameVersion.findMany({ where: { personnelId: id } }))
      .toEqual([expect.objectContaining({ name: '邓雅', version: 1 })]);
    expect(await cloned.prisma.personnelAssignment.findMany({ where: { personnelId: id } }))
      .toEqual([expect.objectContaining({ orgUnitId: org.deptA, endedAt: null })]);
    const roles = await cloned.prisma.personnelRole.findMany({ where: { personnelId: id }, include: { role: true } });
    expect(roles.map((item) => item.role.name).sort()).toEqual(['法制审核', '经办'].sort());
    const posts = await cloned.prisma.personnelPost.findMany({ where: { personnelId: id } });
    expect(posts.map((item) => item.post).sort()).toEqual(['legal-affairs-leader', 'legal-review-lead']);
    const parties = {
      outcome: 'succeeded', reason: null, actor_id: people.root, actor_code: 'P-128-ROOT',
      subject_personnel_id: id, subject_code: payload.code, org_unit_id: org.deptA,
      opcode: 'personnel.profile.register', resource_type: 'personnel', resource_id: id, previous_value: null,
    };
    const rows = added(before, await audits());
    expect(rows).toEqual([
      expect.objectContaining({ ...parties, action: 'personnel.registered', next_value: null }),
      expect.objectContaining({ ...parties, action: 'personnel.post-granted', next_value: 'legal-review-lead' }),
      expect.objectContaining({ ...parties, action: 'personnel.post-granted', next_value: 'legal-affairs-leader' }),
    ]);
    const text = JSON.stringify(rows);
    expect(text.includes(payload.mobilePhone)).toBe(false);
    expect(text.includes(INITIAL)).toBe(false);
  });

  it('登记时填执法证：写入人员行的证号和有效期，卡片能看到；留痕里没有证号（#105:232）', async () => {
    const certNo = 'GD-128-CERT-0001';
    const payload = body({ certNo: ` ${certNo} `, certExpiresOn: '2027-06-30' });
    const before = await audits();
    const response = await register(PHONES.root, payload);
    expect(response.status).toBe(200);
    const { personnel } = await response.json() as { personnel: { id: string } };
    expect(await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: personnel.id } })).toMatchObject({
      enforcementCertNo: certNo, enforcementCertExpiresOn: new Date('2027-06-30T00:00:00.000Z'),
    });
    const rows = added(before, await audits());
    expect(rows.map((row) => row.action)).toEqual(['personnel.registered']);
    expect(JSON.stringify(rows).includes(certNo)).toBe(false);
    const opened = await (await card(PHONES.root, personnel.id)).json() as { personnel: { cert: unknown } };
    expect(opened.personnel.cert).toEqual({ no: certNo, expiresOn: '2027-06-30', status: 'valid' });
  });

  it('执法证只填一项、证号超长、有效期不是真实日期 → 400，人员各表不变，不写留痕', async () => {
    const cases: Array<[Partial<RegisterBody>, string[]]> = [
      [{ certNo: 'GD-128-ONLY' }, ['cert-expires-on-required']],
      [{ certExpiresOn: '2027-06-30' }, ['cert-no-required']],
      [{ certNo: 'X'.repeat(65), certExpiresOn: '2027-06-30' }, ['cert-no-too-long']],
      [{ certNo: 'GD-128-BAD', certExpiresOn: '2027-02-30' }, ['cert-expires-on-invalid']],
      [{ certNo: 'GD-128-BAD', certExpiresOn: '2027/06/30' }, ['cert-expires-on-invalid']],
    ];
    for (const [overrides, rules] of cases) {
      const rowsBefore = await personnelRows();
      const before = await audits();
      const response = await register(PHONES.root, body(overrides));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ result: 'non-compliant', rules });
      expect(await personnelRows()).toEqual(rowsBefore);
      expect(added(before, await audits())).toEqual([]);
    }
  });

  it('新人员用初始口令登录被强制改密', async () => {
    const payload = body();
    expect((await register(PHONES.adminA, payload)).status).toBe(200);
    const response = await login(payload.mobilePhone, INITIAL);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: 'password-change-required' });
    const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: cookieOf(response) } });
    expect(await session.json()).toMatchObject({ result: 'password-change-required', opcodes: [] });
  });

  it('加了岗位标记后，本人会话的操作码清单与同角色、无标记的人员相同', async () => {
    const marked = body({ posts: ['legal-review-lead', 'legal-affairs-leader'], roles: ['行政审核'] });
    const plain = body({ roles: ['行政审核'] });
    expect((await register(PHONES.root, marked)).status).toBe(200);
    expect((await register(PHONES.root, plain)).status).toBe(200);
    await cloned.prisma.personnel.updateMany({
      where: { code: { in: [marked.code, plain.code] } },
      data: { passwordChangedAt: new Date(T0 - DAY_MS) },
    });
    const opcodesOf = async (phone: string): Promise<string[]> => {
      const response = await login(phone, INITIAL);
      expect(response.status).toBe(200);
      const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: cookieOf(response) } });
      return ((await session.json()) as { opcodes: string[] }).opcodes;
    };
    const markedCodes = await opcodesOf(marked.mobilePhone);
    expect(markedCodes.length).toBeGreaterThan(0);
    expect(markedCodes).toEqual(await opcodesOf(plain.mobilePhone));
  });

  const missing: Array<[string, Partial<RegisterBody>, string[]]> = [
    ['缺工号', { code: '' }, ['personnel-code-required']],
    ['缺姓名', { name: '  ' }, ['personnel-name-required']],
    ['缺手机号', { mobilePhone: '' }, ['mobile-phone-required']],
    ['手机号格式不对', { mobilePhone: '12345' }, ['mobile-phone-invalid']],
    ['缺初始口令', { initialPassword: '' }, ['password-required']],
    ['缺角色', { roles: [] }, ['roles-required']],
    ['角色不认识', { roles: ['经办', '管理员'] }, ['role-unknown']],
    ['岗位标记不认识', { posts: ['法制审核负责人'] }, ['post-unknown']],
    ['口令不合规（过短、含工号）', { code: 'TH0360', initialPassword: 'Th0360abc' }, ['too-short', 'contains-code']],
  ];
  it.each(missing)('%s → 400 non-compliant，人员各表不变，不写留痕', async (_label, overrides, rules) => {
    const rowsBefore = await personnelRows();
    const before = await audits();
    const response = await register(PHONES.root, body(overrides));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ result: 'non-compliant', rules });
    expect(await personnelRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('缺机构 → 400 org-unit-required，不写留痕', async () => {
    const rowsBefore = await personnelRows();
    const before = await audits();
    const response = await register(PHONES.adminA, body({ orgUnitId: '' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ result: 'non-compliant', rules: ['org-unit-required'] });
    expect(await personnelRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('工号重复 → 409 already-exists + 失败留痕，人员各表不变', async () => {
    const rowsBefore = await personnelRows();
    const before = await audits();
    const response = await register(PHONES.root, body({ code: 'P-CLERK-A' }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ result: 'already-exists', conflict: 'personnel-code' });
    expect(await personnelRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.registered', outcome: 'failed', reason: 'already-exists', actor_id: people.root,
        subject_personnel_id: null, org_unit_id: org.deptA, opcode: 'personnel.profile.register',
      }),
    ]);
  });

  it('手机号重复 → 409 already-exists + 失败留痕，人员各表不变', async () => {
    const rowsBefore = await personnelRows();
    const before = await audits();
    const response = await register(PHONES.root, body({ mobilePhone: PHONES.memberB }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ result: 'already-exists', conflict: 'mobile-phone' });
    expect(await personnelRows()).toEqual(rowsBefore);
    const rows = added(before, await audits());
    expect(rows).toEqual([
      expect.objectContaining({ action: 'personnel.registered', outcome: 'failed', reason: 'already-exists' }),
    ]);
    expect(JSON.stringify(rows).includes(PHONES.memberB)).toBe(false);
  });

  it('机构越权：区 A 系统管理登记到区 B → 403 scope-denied + authz.denied，人员各表不变', async () => {
    const rowsBefore = await personnelRows();
    const before = await audits();
    const response = await register(PHONES.adminA, body({ orgUnitId: org.deptB, code: '' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(await personnelRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', actor_id: people.adminA,
        opcode: 'personnel.profile.register', resource_type: 'org-unit', resource_id: org.deptB,
        // 接 #119（34fa3cc）：被拒留痕的数据范围按登记目标机构判断
        target_org_unit_id: org.deptB, target_org_unit_basis: 'object',
      }),
    ]);
  });

  it('机构已停用 → 409 invalid-state + 失败留痕 org-unit-deactivated，人员各表不变', async () => {
    const rowsBefore = await personnelRows();
    const before = await audits();
    const response = await register(PHONES.adminA, body({ orgUnitId: org.deactivated }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ result: 'invalid-state' });
    expect(await personnelRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'personnel.registered', outcome: 'failed', reason: 'org-unit-deactivated',
        actor_id: people.adminA, org_unit_id: org.deactivated, resource_type: 'org-unit', resource_id: org.deactivated,
      }),
    ]);
  });

  const deniedBy: Array<[string, string]> = [
    ['没有该码（内勤）', PHONES.intake],
    ['没有该码（经办）', PHONES.clerk],
    ['监督', PHONES.supervisor],
  ];
  it.each(deniedBy)('%s → 403 permission-denied + authz.denied，人员各表不变', async (_label, phone) => {
    const rowsBefore = await personnelRows();
    const before = await audits();
    const response = await register(phone, body());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(await personnelRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({ action: 'authz.denied', reason: 'permission-denied', opcode: 'personnel.profile.register' }),
    ]);
  });

  it('没有数据范围（无当前任职）→ 403 scope-denied + authz.denied，人员各表不变', async () => {
    const rowsBefore = await personnelRows();
    const before = await audits();
    const response = await register(PHONES.homeless, body());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(await personnelRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({ action: 'authz.denied', reason: 'scope-denied', actor_id: people.homeless }),
    ]);
  });

  it('跨站写请求被拒，人员各表不变，不写留痕', async () => {
    const rowsBefore = await personnelRows();
    const before = await audits();
    expect((await register(PHONES.root, body(), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await register(PHONES.root, body(), { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(await personnelRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });
});

describe('接 #126（PR #143）：监督调用人员名单、人员卡片一律 403', () => {
  it('监督调人员名单 → 403 permission-denied，写 authz.denied 失败留痕，人员各表不变，不写 personnel.viewed', async () => {
    const rowsBefore = await personnelRows();
    const before = await audits();
    const response = await list(PHONES.supervisor);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(await personnelRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', outcome: 'failed', reason: 'permission-denied',
        actor_id: people.supervisor, actor_code: 'P-128-SUPER', opcode: 'personnel.profile.read',
      }),
    ]);
  });

  it('监督调人员卡片 → 403 permission-denied，写 authz.denied 失败留痕，人员各表不变，不写 personnel.viewed，不返回手机号', async () => {
    const rowsBefore = await personnelRows();
    const before = await audits();
    const response = await card(PHONES.supervisor, people.clerk);
    expect(response.status).toBe(403);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ reason: 'permission-denied' });
    expect(text.includes(PHONES.clerk)).toBe(false);
    expect(await personnelRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', outcome: 'failed', reason: 'permission-denied',
        actor_id: people.supervisor, opcode: 'personnel.profile.read',
        resource_type: 'personnel', resource_id: people.clerk,
      }),
    ]);
  });
});

describe('接缝①：留痕工厂覆写为「业务写完后抛错」', () => {
  it('登记：请求失败，人员各表与留痕不变', async () => {
    const rowsBefore = await personnelRows();
    const before = await audits();
    seam.armed = true;
    try {
      const response = await register(PHONES.root, body({ posts: ['legal-review-lead'] }), {}, seamUrl);
      expect(response.status).toBe(500);
    } finally {
      seam.armed = false;
    }
    expect(await personnelRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('卡片：personnel.viewed 写不成时不返回数据，不留痕', async () => {
    const before = await audits();
    seam.armed = true;
    try {
      const response = await card(PHONES.root, people.clerk, {}, seamUrl);
      expect(response.status).toBe(500);
      expect((await response.text()).includes(PHONES.clerk)).toBe(false);
    } finally {
      seam.armed = false;
    }
    expect(added(before, await audits())).toEqual([]);
  });
});

describe('岗位标记表只失效不删除', () => {
  it('同一人员同一标记只能有一行未失效；删除被拒；失效后不能再改', async () => {
    const id = people.memberB;
    const first = newUlid();
    await cloned.prisma.personnelPost.create({ data: { id: first, personnelId: id, post: 'legal-review-lead' } });
    await expect(cloned.prisma.personnelPost.create({
      data: { id: newUlid(), personnelId: id, post: 'legal-review-lead' },
    })).rejects.toThrow();
    await expect(cloned.prisma.personnelPost.create({
      data: { id: newUlid(), personnelId: id, post: 'section-chief' },
    })).rejects.toThrow();
    await expect(cloned.prisma.personnelPost.delete({ where: { id: first } })).rejects.toThrow();
    await cloned.prisma.personnelPost.update({ where: { id: first }, data: { deactivatedAt: new Date(T0) } });
    await expect(cloned.prisma.personnelPost.update({
      where: { id: first }, data: { deactivatedAt: new Date(T0 + 1000) },
    })).rejects.toThrow();
    await cloned.prisma.personnelPost.create({ data: { id: newUlid(), personnelId: id, post: 'legal-review-lead' } });
  });
});
