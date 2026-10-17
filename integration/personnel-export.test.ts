// #125：人员导出写入共用留痕表，ExportAudit 停写（ADR 0013）。
// 断言打在 HTTP 状态码、返回体、留痕行和 export_audit 行数上。
// 四条必测（#105 Testing）：没有该码、跨区、监督、跨站。每个 403 用例同时断言留痕行与业务行。
// 接缝①：留痕工厂覆写为「业务写完后抛错」，断言不返回数据、留痕不变。
import type { AddressInfo } from 'node:net';

import { hash, type HashOptions } from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaAuditTrailFactory, type AuditTrailFactory } from '@natural-enforcement/audit';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const MINUTE_MS = 60 * 1000;
const T0 = Date.parse('2026-10-17T02:00:00.000Z');
const PINNED: HashOptions = { type: 2, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const PASSWORD = 'Export-pass-125!';
const SEED_PASSWORD = 'Seed-pass-52';
const OPCODE = 'personnel.profile.export';
const SEAM_ERROR = '接缝①：业务写完后抛错';
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const ADMIN_A_PHONE = '13800012501';
const CLERK_A_PHONE = '13800012502';
const SUPER_B_PHONE = '13800012503';
const MEMBER_PHONE = '13800012511';
const GONE_PHONE = '13800012512';
const MEMBER_CERT = 'CERT-125-MEMBER';

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
  item_count: number | null;
};

type ExportBody = {
  result?: string;
  reason?: string;
  orgUnitId?: string;
  itemCount?: number;
  personnel?: Array<Record<string, unknown>>;
};

let cloned: ClonedDatabase;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
let passwordHash = '';
let deptAId = '';
let deptBId = '';
let adminAId = '';
let clerkAId = '';
let superBId = '';

async function audits(): Promise<AuditRecord[]> {
  return cloned.prisma.$queryRaw<AuditRecord[]>`
    SELECT id, action, outcome, reason, actor_id, actor_code, subject_personnel_id, subject_code,
           org_unit_id, opcode, resource_type, resource_id, item_count
    FROM audit_trail
    ORDER BY created_at, id
  `;
}

function added(before: AuditRecord[], after: AuditRecord[]): AuditRecord[] {
  const known = new Set(before.map((row) => row.id));
  return after.filter((row) => !known.has(row.id));
}

/** 留痕表与人员表的全部行，按主键排序。 */
async function snapshot(): Promise<Record<string, string[]>> {
  const audit = await cloned.prisma.$queryRaw<Array<{ line: string }>>`
    SELECT row_to_json(t)::text AS line FROM audit_trail t ORDER BY id`;
  const personnel = await cloned.prisma.$queryRaw<Array<{ line: string }>>`
    SELECT row_to_json(t)::text AS line FROM personnel t ORDER BY id`;
  const exportAudit = await cloned.prisma.$queryRaw<Array<{ line: string }>>`
    SELECT row_to_json(t)::text AS line FROM export_audit t ORDER BY id`;
  return {
    audit_trail: audit.map((row) => row.line),
    personnel: personnel.map((row) => row.line),
    export_audit: exportAudit.map((row) => row.line),
  };
}

/** 库里全部人员的手机号、执法证号、口令散列，以及测试口令：返回体和留痕里一个都不许出现。 */
async function sensitiveLiterals(): Promise<string[]> {
  const people = await cloned.prisma.personnel.findMany();
  const literals = new Set<string>([PASSWORD, SEED_PASSWORD]);
  for (const person of people) {
    if (person.mobilePhone) literals.add(person.mobilePhone);
    if (person.enforcementCertNo) literals.add(person.enforcementCertNo);
    if (person.passwordHash) literals.add(person.passwordHash);
  }
  return [...literals];
}

async function expectNoSensitive(text: string): Promise<void> {
  for (const literal of await sensitiveLiterals()) {
    expect(text.includes(literal), `出现敏感字面量 ${literal}`).toBe(false);
  }
}

async function addPerson(input: {
  code: string;
  phone: string;
  orgUnitId: string;
  roleName?: string;
  certNo?: string;
  deactivated?: boolean;
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
      passwordChangedAt: new Date(T0 - 10 * 24 * 60 * MINUTE_MS),
      enforcementCertNo: input.certNo ?? null,
      enforcementCertExpiresOn: input.certNo ? new Date('2099-12-31T00:00:00.000Z') : null,
      deactivatedAt: input.deactivated ? new Date(T0 - MINUTE_MS) : null,
    },
  });
  await cloned.prisma.personnelAssignment.create({
    data: { id: newUlid(), personnelId: id, orgUnitId: input.orgUnitId },
  });
  if (input.roleName) {
    const role = await cloned.prisma.role.findFirstOrThrow({
      where: { name: input.roleName, deactivatedAt: null },
    });
    await cloned.prisma.personnelRole.create({
      data: { id: newUlid(), personnelId: id, roleId: role.id },
    });
  }
  return id;
}

async function login(phone: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: phone, password: PASSWORD, rememberMe: false }),
  });
  expect(response.status).toBe(200);
  return response.headers.getSetCookie().map((item) => item.split(';')[0]).join('; ');
}

function exportFor(
  cookie: string,
  orgUnitId: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/api/admin/personnel/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, ...headers },
    body: JSON.stringify({ orgUnitId }),
  });
}

/** 403 用例的共同断言：只多一行 authz.denied，不写 personnel.exported，人员与 export_audit 行不变。 */
async function expectDenied(
  cookie: string,
  orgUnitId: string,
  expected: { reason: string; actorId: string; actorCode: string; actorOrgId: string },
): Promise<void> {
  const before = await snapshot();
  const auditsBefore = await audits();
  const response = await exportFor(cookie, orgUnitId);
  expect(response.status).toBe(403);
  const body = await response.json() as ExportBody;
  expect(body).toEqual({ reason: expected.reason });
  const rows = added(auditsBefore, await audits());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    action: 'authz.denied',
    outcome: 'failed',
    reason: expected.reason,
    actor_id: expected.actorId,
    actor_code: expected.actorCode,
    subject_personnel_id: null,
    org_unit_id: expected.actorOrgId,
    opcode: OPCODE,
    resource_type: 'org-unit',
    resource_id: orgUnitId,
    item_count: null,
  });
  const after = await snapshot();
  expect(after.personnel).toEqual(before.personnel);
  expect(after.export_audit).toEqual(before.export_audit);
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  deptAId = (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-A' } })).id;
  deptBId = (await cloned.prisma.orgUnit.findUniqueOrThrow({ where: { code: 'ORG-DEPT-B' } })).id;
  passwordHash = await hash(PASSWORD, PINNED);
  adminAId = await addPerson({ code: 'P-125-ADM-A', phone: ADMIN_A_PHONE, orgUnitId: deptAId, roleName: '系统管理' });
  clerkAId = await addPerson({ code: 'P-125-CLERK-A', phone: CLERK_A_PHONE, orgUnitId: deptAId, roleName: '经办' });
  superBId = await addPerson({ code: 'P-125-SUPER-B', phone: SUPER_B_PHONE, orgUnitId: deptBId, roleName: '监督' });
  await addPerson({ code: 'P-125-MEMBER', phone: MEMBER_PHONE, orgUnitId: deptAId, certNo: MEMBER_CERT });
  await addPerson({ code: 'P-125-GONE', phone: GONE_PHONE, orgUnitId: deptAId, deactivated: true });
  const app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(T0) },
    undefined,
    { auditTrailFactory: failingFactory },
  );
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

describe('POST /api/admin/personnel/export', () => {
  it('系统管理导出本机构：留痕多一行 personnel.exported，itemCount 等于导出条数，ExportAudit 行数不变', async () => {
    const cookie = await login(ADMIN_A_PHONE);
    const exportAuditBefore = await cloned.prisma.exportAudit.count();
    const before = await audits();
    const response = await exportFor(cookie, deptAId);
    expect(response.status).toBe(200);
    const body = await response.json() as ExportBody;
    const expected = await cloned.prisma.personnel.findMany({
      where: { orgUnitId: deptAId, deactivatedAt: null },
      orderBy: { code: 'asc' },
    });
    expect(expected.length).toBeGreaterThan(1);
    expect(body).toEqual({
      result: 'exported',
      orgUnitId: deptAId,
      itemCount: expected.length,
      personnel: expected.map((person) => ({ id: person.id, code: person.code, name: person.name })),
    });
    const codes = (body.personnel ?? []).map((row) => row.code);
    expect(codes).toContain('P-125-MEMBER');
    expect(codes).not.toContain('P-125-GONE');
    for (const row of body.personnel ?? []) {
      expect(Object.keys(row).sort()).toEqual(['code', 'id', 'name']);
    }

    const rows = added(before, await audits());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'personnel.exported',
      outcome: 'succeeded',
      reason: null,
      actor_id: adminAId,
      actor_code: 'P-125-ADM-A',
      subject_personnel_id: null,
      subject_code: null,
      org_unit_id: deptAId,
      opcode: OPCODE,
      resource_type: 'org-unit',
      resource_id: deptAId,
      item_count: expected.length,
    });
    expect(await cloned.prisma.exportAudit.count()).toBe(exportAuditBefore);

    const [line] = await cloned.prisma.$queryRaw<Array<{ line: string }>>`
      SELECT row_to_json(t)::text AS line FROM audit_trail t WHERE id = ${rows[0]!.id}`;
    await expectNoSensitive(JSON.stringify(body));
    await expectNoSensitive(line!.line);
  });

  it('没有该码：403 permission-denied，写 authz.denied，不返回数据', async () => {
    const cookie = await login(CLERK_A_PHONE);
    await expectDenied(cookie, deptAId, {
      reason: 'permission-denied',
      actorId: clerkAId,
      actorCode: 'P-125-CLERK-A',
      actorOrgId: deptAId,
    });
  });

  it('跨区：403 scope-denied，写 authz.denied，不返回数据', async () => {
    const cookie = await login(ADMIN_A_PHONE);
    await expectDenied(cookie, deptBId, {
      reason: 'scope-denied',
      actorId: adminAId,
      actorCode: 'P-125-ADM-A',
      actorOrgId: deptAId,
    });
  });

  it('监督导出本区人员：403 permission-denied，写 authz.denied', async () => {
    const cookie = await login(SUPER_B_PHONE);
    await expectDenied(cookie, deptBId, {
      reason: 'permission-denied',
      actorId: superBId,
      actorCode: 'P-125-SUPER-B',
      actorOrgId: deptBId,
    });
  });

  it('跨站请求被拒：外站 Origin 与 Sec-Fetch-Site: cross-site 都得 403，不写留痕', async () => {
    const cookie = await login(ADMIN_A_PHONE);
    const before = await snapshot();
    const crossSite: Array<Record<string, string>> = [
      { origin: 'https://evil.example' },
      { 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of crossSite) {
      const response = await exportFor(cookie, deptAId, headers);
      expect(response.status, JSON.stringify(headers)).toBe(403);
      expect(await response.text()).not.toContain('P-125-MEMBER');
    }
    expect(await snapshot()).toEqual(before);
  });

  it('接缝①：留痕写入失败时不返回数据，留痕与 ExportAudit 不变', async () => {
    const cookie = await login(ADMIN_A_PHONE);
    const before = await snapshot();
    seam.armed = true;
    try {
      const response = await exportFor(cookie, deptAId);
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).not.toContain('P-125-MEMBER');
      expect(text).not.toContain('P-125-ADM-A');
    } finally {
      seam.armed = false;
    }
    expect(await snapshot()).toEqual(before);

    // 解除覆写后同一导出照常成功，证明上面的不变来自回滚。
    const retried = await exportFor(cookie, deptAId);
    expect(retried.status).toBe(200);
  });
});
