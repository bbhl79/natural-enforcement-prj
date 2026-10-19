// #133 执法证登记与执法资格判定。
// 断言打在 HTTP 状态码、响应体、人员行的执法证三列、留痕行上。断言打在克隆库上。
// 四条必测（#105 Testing）：没有该码、跨区、监督、跨站请求。
// 每个 403 用例同时断言失败留痕行存在、业务行不变。
// 到期日界用可注入时钟测 UTC 15:59 与 16:00（北京时间 23:59 与次日 00:00）。
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaAuditTrailFactory, type AuditTrailFactory } from '@natural-enforcement/audit';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-18T02:00:00.000Z');
/** 北京时间 2026-10-17 23:59 与 2026-10-18 00:00（#105 故事 57 的日界）。 */
const BEFORE_MIDNIGHT = Date.parse('2026-10-17T15:59:00.000Z');
const AFTER_MIDNIGHT = Date.parse('2026-10-17T16:00:00.000Z');
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Person-133-ok!';
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SEAM_ERROR = '接缝①：业务写完后抛错（#133）';
const OLD_CERT_NO = 'GD-133-OLD-0001';
const NEW_CERT_NO = 'GD-133-NEW-0002';

const PHONES = {
  root: '13800013301',
  adminA: '13800013302',
  intake: '13800013303',
  clerk: '13800013304',
  supervisor: '13800013305',
  homeless: '13800013306',
  memberB: '13800013307',
  loose: '13800013308',
  off: '13800013309',
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
/** 可注入时钟：用例拨动这一处，不真实等待。 */
const clock = { current: T0, now(): Date { return new Date(clock.current); } };
const org = { hq: '', deptA: '', deptB: '', station: '' };
const people = { root: '', adminA: '', intake: '', clerk: '', supervisor: '', homeless: '', memberB: '', loose: '', off: '' };

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

/** 人员行的执法证三列（业务行）。 */
async function certRows(): Promise<string[]> {
  const rows = await cloned.prisma.$queryRaw<Array<{ row: unknown }>>`
    SELECT row_to_json(t)::text AS row FROM (
      SELECT id, enforcement_cert_no, enforcement_cert_expires_on, enforcement_cert_status
      FROM personnel
    ) t ORDER BY id
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
  cert?: { no: string; expiresOn: Date; status?: 'valid' | 'invalid' };
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
      enforcementCertStatus: input.cert?.status ?? 'valid',
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

interface CertBody {
  certNo: string;
  certExpiresOn: string;
  certStatus: string;
}

const certBody = (overrides: Partial<CertBody> = {}): CertBody => ({
  certNo: NEW_CERT_NO,
  certExpiresOn: '2031-09-16',
  certStatus: 'valid',
  ...overrides,
});

async function updateCert(
  phone: string,
  personnelId: string,
  payload: unknown,
  headers: Record<string, string> = {},
  url = baseUrl,
): Promise<Response> {
  return fetch(`${url}/api/admin/personnel/${personnelId}/cert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await signIn(phone, url), ...headers },
    body: JSON.stringify(payload),
  });
}

async function card(phone: string, personnelId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/admin/personnel/${personnelId}`, { headers: { cookie: await signIn(phone) } });
}

async function listOf(phone: string): Promise<Response> {
  return fetch(`${baseUrl}/api/admin/personnel`, { headers: { cookie: await signIn(phone) } });
}

async function startApp(factory?: AuditTrailFactory): Promise<string> {
  const app = await createApplication(
    cloned.connectionString,
    clock,
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
  passwordHash = await hash(PASSWORD, PINNED);
  people.root = await addPerson({ code: 'P-133-ROOT', phone: PHONES.root, orgUnitId: org.hq, role: '系统管理' });
  people.adminA = await addPerson({ code: 'P-133-ADM-A', phone: PHONES.adminA, orgUnitId: org.deptA, role: '系统管理' });
  people.intake = await addPerson({ code: 'P-133-INTAKE', phone: PHONES.intake, orgUnitId: org.hq, role: '内勤' });
  people.clerk = await addPerson({ code: 'P-133-CLERK', phone: PHONES.clerk, orgUnitId: org.station, role: '经办' });
  people.supervisor = await addPerson({ code: 'P-133-SUPER', phone: PHONES.supervisor, orgUnitId: org.deptA, role: '监督' });
  people.homeless = await addPerson({
    code: 'P-133-NONE', phone: PHONES.homeless, orgUnitId: org.deptA, role: '系统管理', assign: false,
  });
  people.memberB = await addPerson({ code: 'P-133-MEM-B', phone: PHONES.memberB, orgUnitId: org.deptB, role: '经办' });
  // 没有当前任职的目标人员：视同挂在根机构（A10 口径）。
  people.loose = await addPerson({ code: 'P-133-LOOSE', phone: PHONES.loose, orgUnitId: org.hq, role: '经办', assign: false });
  people.off = await addPerson({
    code: 'P-133-OFF', phone: PHONES.off, orgUnitId: org.deptA, role: '经办', deactivated: true,
    cert: { no: OLD_CERT_NO, expiresOn: new Date('2027-06-30T00:00:00.000Z') },
  });
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
  clock.current = T0;
  for (const close of closers) await close();
  await cloned?.close();
});

describe('POST /api/admin/personnel/:id/cert（执法证登记）', () => {
  it('首次登记：写入证号、有效期、证件状态，写一行 cert.updated，前值为空，留痕里没有证号', async () => {
    const before = await audits();
    const response = await updateCert(PHONES.adminA, people.clerk, certBody());
    expect(response.status).toBe(200);
    // 返回体不回显证号（#105 错误码表说明）。
    expect(await response.text()).toEqual('{"result":"updated"}');
    expect(await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: people.clerk } })).toMatchObject({
      enforcementCertNo: NEW_CERT_NO,
      enforcementCertExpiresOn: new Date('2031-09-16T00:00:00.000Z'),
      enforcementCertStatus: 'valid',
    });
    const rows = added(before, await audits());
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'cert.updated', outcome: 'succeeded', reason: null,
        actor_id: people.adminA, actor_code: 'P-133-ADM-A',
        subject_personnel_id: people.clerk, subject_code: 'P-133-CLERK',
        org_unit_id: org.station, opcode: 'personnel.cert.update',
        resource_type: 'personnel', resource_id: people.clerk,
        previous_value: null, next_value: null,
      }),
    ]);
    expect(JSON.stringify(rows).includes(NEW_CERT_NO)).toBe(false);
  });

  it('换发新证：证号与有效期直接改成新值，前值只写旧有效期和旧状态，不写旧证号', async () => {
    await cloned.prisma.personnel.update({
      where: { id: people.memberB },
      data: {
        enforcementCertNo: OLD_CERT_NO,
        enforcementCertExpiresOn: new Date('2027-06-30T00:00:00.000Z'),
        enforcementCertStatus: 'invalid',
      },
    });
    const before = await audits();
    const response = await updateCert(PHONES.root, people.memberB, certBody({ certStatus: 'valid' }));
    expect(response.status).toBe(200);
    expect(await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: people.memberB } })).toMatchObject({
      enforcementCertNo: NEW_CERT_NO,
      enforcementCertExpiresOn: new Date('2031-09-16T00:00:00.000Z'),
      enforcementCertStatus: 'valid',
    });
    const rows = added(before, await audits());
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'cert.updated', outcome: 'succeeded',
        previous_value: 'expiresOn=2027-06-30;status=invalid',
      }),
    ]);
    const text = JSON.stringify(rows);
    expect(text.includes(OLD_CERT_NO)).toBe(false);
    expect(text.includes(NEW_CERT_NO)).toBe(false);
  });

  it('登记为「失效」：证件状态写 invalid，卡片与列表的执法证情况为失效', async () => {
    expect((await updateCert(PHONES.adminA, people.clerk, certBody({ certStatus: 'invalid' }))).status).toBe(200);
    expect(await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: people.clerk } }))
      .toMatchObject({ enforcementCertStatus: 'invalid' });
    const opened = await (await card(PHONES.adminA, people.clerk)).json() as { personnel: { cert: unknown } };
    expect(opened.personnel.cert).toEqual({ no: NEW_CERT_NO, expiresOn: '2031-09-16', status: 'invalid' });
    const list = await (await listOf(PHONES.adminA)).json() as { personnel: Array<{ code: string; certStatus: string }> };
    expect(list.personnel.find((row) => row.code === 'P-133-CLERK')?.certStatus).toBe('invalid');
    // 列表不交出证号（#105:231）。
    expect(JSON.stringify(list).includes(NEW_CERT_NO)).toBe(false);
    // 恢复为有效：有效期在 30 天外，情况回到有效。
    expect((await updateCert(PHONES.adminA, people.clerk, certBody({ certStatus: 'valid' }))).status).toBe(200);
    const valid = await (await card(PHONES.adminA, people.clerk)).json() as { personnel: { cert: unknown } };
    expect(valid.personnel.cert).toEqual({ no: NEW_CERT_NO, expiresOn: '2031-09-16', status: 'valid' });
  });

  it('证件状态为「失效」时不再按有效期推导：已过期的失效证一样是失效', async () => {
    expect((await updateCert(PHONES.adminA, people.clerk, certBody({ certExpiresOn: '2026-09-30', certStatus: 'invalid' }))).status).toBe(200);
    const opened = await (await card(PHONES.adminA, people.clerk)).json() as { personnel: { cert: { status: string } } };
    expect(opened.personnel.cert.status).toBe('invalid');
    expect((await updateCert(PHONES.adminA, people.clerk, certBody({ certExpiresOn: '2031-09-16' }))).status).toBe(200);
  });

  it('到期当天仍有效（临期），次日零点起已过期：UTC 15:59 与 16:00（#105 故事 57）', async () => {
    expect((await updateCert(PHONES.root, people.loose, certBody({ certExpiresOn: '2026-10-17' }))).status).toBe(200);
    clock.current = BEFORE_MIDNIGHT;
    const before = await (await card(PHONES.root, people.loose)).json() as { personnel: { cert: { status: string } } };
    expect(before.personnel.cert.status).toBe('expiring');
    clock.current = AFTER_MIDNIGHT;
    const after = await (await card(PHONES.root, people.loose)).json() as { personnel: { cert: { status: string } } };
    expect(after.personnel.cert.status).toBe('expired');
    clock.current = T0;
  });

  const invalid: Array<[string, Partial<CertBody>, string[]]> = [
    ['缺证号', { certNo: '  ' }, ['cert-no-required']],
    ['证号超长', { certNo: 'X'.repeat(65) }, ['cert-no-too-long']],
    ['缺有效期', { certExpiresOn: '' }, ['cert-expires-on-required']],
    ['有效期不是真实日历日', { certExpiresOn: '2031-02-30' }, ['cert-expires-on-invalid']],
    ['有效期格式不对', { certExpiresOn: '2031/09/16' }, ['cert-expires-on-invalid']],
    ['缺证件状态', { certStatus: '' }, ['cert-status-unknown']],
    ['证件状态取值不认识', { certStatus: '暂扣' }, ['cert-status-unknown']],
    ['证件状态写中文', { certStatus: '有效' }, ['cert-status-unknown']],
  ];
  it.each(invalid)('%s → 400 non-compliant，人员行不变，不写留痕', async (_label, overrides, rules) => {
    const rowsBefore = await certRows();
    const before = await audits();
    const response = await updateCert(PHONES.root, people.clerk, certBody(overrides));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ result: 'non-compliant', rules });
    expect(await certRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('三项都不合规时按证号、有效期、状态的顺序列全部规则码', async () => {
    const response = await updateCert(PHONES.root, people.clerk, { certNo: '', certExpiresOn: '', certStatus: '' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      result: 'non-compliant',
      rules: ['cert-no-required', 'cert-expires-on-required', 'cert-status-unknown'],
    });
  });

  it('人员不存在 → 404，不写留痕', async () => {
    const before = await audits();
    const response = await updateCert(PHONES.root, newUlid(), certBody());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ result: 'not-found' });
    expect(added(before, await audits())).toEqual([]);
  });

  it('已停用人员 → 409 invalid-state（personnel-deactivated），按项写 cert.updated 失败留痕，人员行不变', async () => {
    const rowsBefore = await certRows();
    const before = await audits();
    const response = await updateCert(PHONES.adminA, people.off, certBody());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      result: 'invalid-state',
      reason: 'personnel-deactivated',
      message: expect.stringContaining('已停用'),
    });
    // 界面不露操作码与原始原因码之外的内容：返回体不带证号。
    expect(JSON.stringify(body).includes(NEW_CERT_NO)).toBe(false);
    expect(await certRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'cert.updated', outcome: 'failed', reason: 'personnel-deactivated',
        actor_id: people.adminA, actor_code: 'P-133-ADM-A',
        subject_personnel_id: people.off, subject_code: 'P-133-OFF',
        org_unit_id: org.deptA, opcode: 'personnel.cert.update',
        resource_type: 'personnel', resource_id: people.off,
        previous_value: 'expiresOn=2027-06-30;status=valid',
      }),
    ]);
    expect(JSON.stringify(added(before, await audits())).includes(NEW_CERT_NO)).toBe(false);
  });

  it('没有当前任职的人员视同根机构：根机构系统管理能登记，区系统管理 403 scope-denied', async () => {
    expect((await updateCert(PHONES.root, people.loose, certBody())).status).toBe(200);
    const rowsBefore = await certRows();
    const before = await audits();
    const response = await updateCert(PHONES.adminA, people.loose, certBody());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(await certRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', actor_id: people.adminA,
        opcode: 'personnel.cert.update', resource_type: 'personnel', resource_id: people.loose,
        target_org_unit_id: org.hq, target_org_unit_basis: 'object',
      }),
    ]);
  });

  it('跨区：区 A 系统管理登记区 B 人员 → 403 scope-denied + authz.denied，人员行不变', async () => {
    const rowsBefore = await certRows();
    const before = await audits();
    const response = await updateCert(PHONES.adminA, people.memberB, certBody());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(await certRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', outcome: 'failed', reason: 'scope-denied', actor_id: people.adminA,
        opcode: 'personnel.cert.update', resource_type: 'personnel', resource_id: people.memberB,
        target_org_unit_id: org.deptB, target_org_unit_basis: 'object',
      }),
    ]);
  });

  const deniedBy: Array<[string, string, string]> = [
    ['没有该码（内勤）', PHONES.intake, 'P-133-INTAKE'],
    ['没有该码（经办）', PHONES.clerk, 'P-133-CLERK'],
    ['监督', PHONES.supervisor, 'P-133-SUPER'],
  ];
  it.each(deniedBy)('%s → 403 permission-denied + authz.denied，人员行不变', async (_label, phone, code) => {
    const rowsBefore = await certRows();
    const before = await audits();
    const response = await updateCert(phone, people.clerk, certBody());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'permission-denied' });
    expect(await certRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', outcome: 'failed', reason: 'permission-denied', actor_code: code,
        opcode: 'personnel.cert.update', resource_type: 'personnel', resource_id: people.clerk,
      }),
    ]);
  });

  it('没有数据范围（无当前任职）→ 403 scope-denied + authz.denied，人员行不变', async () => {
    const rowsBefore = await certRows();
    const before = await audits();
    const response = await updateCert(PHONES.homeless, people.clerk, certBody());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ reason: 'scope-denied' });
    expect(await certRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([
      expect.objectContaining({
        action: 'authz.denied', reason: 'scope-denied', actor_id: people.homeless,
        opcode: 'personnel.cert.update',
        // 对象机构解析得出（对方任职机构），拒绝行按它归属（ADR 0011 修正）。
        target_org_unit_id: org.station, target_org_unit_basis: 'object',
      }),
    ]);
  });

  it('跨站写请求被拒，人员行不变，不写留痕', async () => {
    const rowsBefore = await certRows();
    const before = await audits();
    expect((await updateCert(PHONES.root, people.clerk, certBody(), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await updateCert(PHONES.root, people.clerk, certBody(), { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(await certRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });

  it('库里全部执法证号都不出现在本次登记写的留痕行里', async () => {
    const before = await audits();
    expect((await updateCert(PHONES.root, people.clerk, certBody({ certNo: 'GD-133-SCAN-0003' }))).status).toBe(200);
    const rows = added(before, await audits());
    const text = JSON.stringify(rows);
    const secrets = await cloned.prisma.personnel.findMany({ select: { enforcementCertNo: true } });
    for (const row of secrets) {
      if (row.enforcementCertNo) expect(text.includes(row.enforcementCertNo), row.enforcementCertNo).toBe(false);
    }
  });
});

describe('接缝①：留痕工厂覆写为「业务写完后抛错」', () => {
  it('执法证登记：请求失败，人员行的证号、有效期、证件状态都不变', async () => {
    const rowsBefore = await certRows();
    const before = await audits();
    seam.armed = true;
    try {
      const response = await updateCert(PHONES.root, people.clerk, certBody({ certNo: 'GD-133-SEAM-0004' }), {}, seamUrl);
      expect(response.status).toBe(500);
    } finally {
      seam.armed = false;
    }
    expect(await certRows()).toEqual(rowsBefore);
    expect(added(before, await audits())).toEqual([]);
  });
});

describe('证件状态列（#133：NOT NULL + CHECK，只取有效、失效）', () => {
  it('表外取值被库层拒绝，空值被拒绝', async () => {
    await expect(cloned.prisma.$executeRaw`
      UPDATE personnel SET enforcement_cert_status = 'revoked' WHERE id = ${people.clerk}
    `).rejects.toThrow();
    await expect(cloned.prisma.$executeRaw`
      UPDATE personnel SET enforcement_cert_status = NULL WHERE id = ${people.clerk}
    `).rejects.toThrow();
    expect(await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: people.clerk } }))
      .toMatchObject({ enforcementCertStatus: 'valid' });
  });

  it('存量人员回填为有效：种子里已登记执法证的人员仍是有效', async () => {
    const seeded = await cloned.prisma.personnel.findUniqueOrThrow({ where: { code: 'P-CLERK-A' } });
    expect(seeded.enforcementCertStatus).toBe('valid');
    expect(seeded.enforcementCertNo).toBe('CERT-VALID-A');
  });
});
