// #263 机关层利害关系：勾选后只提示。不阻断签出、呈批、迁移。取消勾选 409 并留痕。记录只追加。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-27T08:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Agency-conflict-263!';
const INITIAL_PASSWORD = 'Conflict-263!';
const SIGN_KINDS = ['trial-opinion', 'legal-opinion', 'decision'] as const;

function square(offset: number): (readonly number[])[] {
  const west = 113 + offset;
  return [
    [west, 23],
    [west + 0.1, 23],
    [west + 0.1, 23.1],
    [west, 23.1],
    [west, 23],
  ];
}

function geojsonPolygon(ring: readonly (readonly number[])[]): string {
  return JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} });
}

class RecordingStorage {
  async putVersion(fileKey: string): Promise<{ fileKey: string; versionId: string }> {
    return { fileKey, versionId: 'version-1' };
  }
  async readVersion(): Promise<Uint8Array> {
    return new Uint8Array(0);
  }
}

class RecordingQueue {
  async enqueue(): Promise<{ id: string }> {
    return { id: 'job-1' };
  }
  async waitForCompletion(): Promise<unknown> {
    return null;
  }
  async close(): Promise<void> {}
}

let cloned: ClonedDatabase;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
const cookies = new Map<string, string>();
const passwords = new Map<string, string>();
let stationAId = '';
let deptAId = '';
let handlerMainId = '';
let handlerAssistId = '';
let offset = 0;

function sessionCookie(response: Response): string {
  const found = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='));
  const pair = found?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

async function cookieOf(code: string, password?: string): Promise<string> {
  const known = cookies.get(code);
  if (known) return known;
  const current = password ?? passwords.get(code) ?? SEED_PASSWORD;
  const person = await cloned.prisma.personnel.findFirst({ where: { code, deactivatedAt: null } });
  if (!person?.mobilePhone) throw new Error(`缺少人员 ${code}`);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: person.mobilePhone, password: current, rememberMe: false }),
  });
  expect(login.status).toBe(200);
  const cookie = sessionCookie(login);
  if (current !== NEW_PASSWORD) {
    const changed = await fetch(`${baseUrl}/api/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ currentPassword: current, newPassword: NEW_PASSWORD }),
    });
    expect(changed.status).toBe(200);
    passwords.set(code, NEW_PASSWORD);
  }
  cookies.set(code, cookie);
  return cookie;
}

async function seedPerson(
  code: string,
  name: string,
  orgUnitId: string,
  roles: readonly string[],
  mobilePhone: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/admin/personnel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-ADMIN-HQ') },
    body: JSON.stringify({
      code,
      name,
      orgUnitId,
      mobilePhone,
      initialPassword: INITIAL_PASSWORD,
      roles: [...roles],
    }),
  });
  expect([200, 201]).toContain(response.status);
  const person = await cloned.prisma.personnel.findFirstOrThrow({ where: { code } });
  await cloned.prisma.personnel.update({
    where: { id: person.id },
    data: {
      enforcementCertNo: `ENF-${code}`,
      enforcementCertExpiresOn: new Date('2030-12-31T00:00:00.000Z'),
      enforcementCertStatus: 'valid',
    },
  });
  await cookieOf(code, INITIAL_PASSWORD);
  return person.id;
}

async function register(polygonOffset: number): Promise<{ id: string }> {
  const form = new FormData();
  form.set('sourceCode', '16');
  form.set('domain', 'land');
  form.set(
    'values',
    JSON.stringify({
      'clue.received_at': '2026-10-27',
      'clue.narrative': '巡查发现一处硬化地面',
      'clue.finder': '巡查员',
      'clue.patrol_no': `XC-263-${polygonOffset}`,
    }),
  );
  form.set(
    'spatial-source',
    new Blob([geojsonPolygon(square(polygonOffset))], { type: 'application/geo+json' }),
    'area.geojson',
  );
  const response = await fetch(`${baseUrl}/api/clues`, {
    method: 'POST',
    headers: {
      cookie: await cookieOf('P-263-IN'),
      'idempotency-key': `agency-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  return (await response.json()) as { id: string };
}

async function toHandlerAssigned(clueId: string): Promise<void> {
  const org = await fetch(`${baseUrl}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-263-IN') },
    body: JSON.stringify({ orgUnitId: stationAId, expectedStatus: 'in_pool', reason: '', designate: false }),
  });
  expect(org.status).toBe(200);
  const people = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-263-ST') },
    body: JSON.stringify({
      mainId: handlerMainId,
      assistIds: [handlerAssistId],
      expectedStatus: 'org_assigned',
    }),
  });
  expect(people.status, await people.clone().text()).toBe(200);
}

async function postJson(
  path: string,
  code: string,
  body: unknown = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function getJson(path: string, code: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { cookie: await cookieOf(code) },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function fileCase(): Promise<string> {
  offset += 1;
  const registered = await register(offset);
  await toHandlerAssigned(registered.id);
  const drafted = await postJson(`/api/clues/${registered.id}/filing-approval`, 'P-263-H1', {
    content: { conclusion: 'file', partyNames: ['张三'] },
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, 'P-263-H1')).status).toBe(200);
  const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return String(approved.body.caseId);
}

async function mark(caseId: string, checked: boolean, code = 'P-263-H1') {
  return postJson(`/api/cases/${caseId}/agency-conflict`, code, { checked });
}

interface TrailRow {
  readonly outcome: string;
  readonly reason: string | null;
  readonly detail: string | null;
  readonly opcode: string | null;
}

async function declareTrail(caseId: string): Promise<TrailRow[]> {
  return cloned.prisma.$queryRaw<TrailRow[]>`
    SELECT outcome, reason, detail, opcode
    FROM audit_trail
    WHERE action = 'case.conflict-declared' AND resource_id = ${caseId}
    ORDER BY created_at ASC, id ASC
  `;
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(T0) },
    undefined,
    {
      storagePort: new RecordingStorage() as never,
      queuePort: new RecordingQueue() as never,
      filingAdminReview: 'skip',
    },
  );
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();
  const orgOf = async (code: string) => {
    const org = await cloned.prisma.orgUnit.findUnique({ where: { code } });
    if (!org) throw new Error(`缺少种子机构 ${code}`);
    return org.id;
  };
  deptAId = await orgOf('ORG-DEPT-A');
  stationAId = await orgOf('ORG-STATION-A');
  await seedPerson('P-263-IN', '甲区内勤', deptAId, ['内勤'], '13900026301');
  await seedPerson('P-263-ST', '甲所内勤', stationAId, ['内勤'], '13900026302');
  handlerMainId = await seedPerson('P-263-H1', '主办甲', stationAId, ['经办'], '13900026303');
  handlerAssistId = await seedPerson('P-263-H2', '协办乙', stationAId, ['经办'], '13900026304');
}, 120_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  cookies.clear();
});

describe('#263 机关层利害关系', () => {
  it('勾选后界面数据带提示，签出、呈批和迁移都不被拒绝', async () => {
    const caseId = await fileCase();
    const marked = await mark(caseId, true);
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    expect(marked.body).toMatchObject({
      result: 'agency-conflict-marked',
      marked: true,
      warning: '本机关与本案当事人存在利害关系',
      outlet: '线下报请上级处理',
    });
    const listed = await getJson(`/api/cases/${caseId}/agency-conflict`, 'P-263-H1');
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({
      marked: true,
      warning: '本机关与本案当事人存在利害关系',
      outlet: '线下报请上级处理',
      markedBy: handlerMainId,
      orgUnitId: stationAId,
    });
    const success = (await declareTrail(caseId)).filter((row) => row.outcome === 'succeeded');
    expect(success).toEqual([
      expect.objectContaining({ opcode: 'doc.draft', reason: null }),
    ]);
    expect(success[0]?.detail).toContain('"layer":"agency"');

    for (const signKind of SIGN_KINDS) {
      const allowed = await postJson(`/api/cases/${caseId}/sign-checks`, 'P-263-H1', {
        personId: handlerMainId,
        signKind,
      });
      expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
      expect(allowed.body.result).toBe('sign-allowed');
    }
    const refused = await cloned.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM audit_trail
      WHERE action = 'case.sign-refused' AND resource_id = ${caseId}
    `;
    expect(refused).toEqual([]);

    const drafted = await postJson(`/api/cases/${caseId}/procedures`, 'P-263-H1', {
      kind: 'suspend',
      extendTogether: false,
    });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
    const approvalId = String(drafted.body.approvalId);
    const submitted = await postJson(`/api/procedures/${approvalId}/submit`, 'P-263-H1');
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const approved = await postJson(`/api/procedures/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.suspended).toBe(true);
    expect(row.currentStage).toBe('E02');
    const still = await cloned.prisma.caseAgencyConflict.findMany({ where: { caseId } });
    expect(still).toHaveLength(1);
  });

  it('已勾选后取消勾选返回 409，业务行不变，并留下失败留痕', async () => {
    const caseId = await fileCase();
    expect((await mark(caseId, true)).status).toBe(200);
    const before = await cloned.prisma.caseAgencyConflict.findMany({ where: { caseId } });
    expect(before).toHaveLength(1);
    const denied = await mark(caseId, false);
    expect(denied.status).toBe(409);
    expect(denied.body).toMatchObject({
      result: 'uncheck-forbidden',
      reason: 'uncheck-forbidden',
      message: '机关层利害关系不能取消勾选',
    });
    const after = await cloned.prisma.caseAgencyConflict.findMany({ where: { caseId } });
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    const failed = (await declareTrail(caseId)).filter((row) => row.reason === 'uncheck-forbidden');
    expect(failed).toEqual([expect.objectContaining({ outcome: 'failed', opcode: 'doc.draft' })]);
    expect(failed[0]?.detail).toContain('uncheck');
  });

  it('重复勾选返回 409，不追加第二行', async () => {
    const caseId = await fileCase();
    expect((await mark(caseId, true)).status).toBe(200);
    const again = await mark(caseId, true);
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('already-marked');
    expect(await cloned.prisma.caseAgencyConflict.count({ where: { caseId } })).toBe(1);
    const failed = (await declareTrail(caseId)).filter((row) => row.reason === 'already-marked');
    expect(failed).toEqual([expect.objectContaining({ outcome: 'failed' })]);
  });

  it('没有拟制权的人不能勾选', async () => {
    const caseId = await fileCase();
    const denied = await mark(caseId, true, 'P-APPROVE-HQ');
    expect(denied.status).toBe(403);
    expect(await cloned.prisma.caseAgencyConflict.count({ where: { caseId } })).toBe(0);
  });

  it('勾选行的更新和删除都被库层拒绝', async () => {
    const caseId = await fileCase();
    expect((await mark(caseId, true)).status).toBe(200);
    const row = await cloned.prisma.caseAgencyConflict.findFirstOrThrow({ where: { caseId } });
    await expect(cloned.prisma.$executeRaw`
      UPDATE case_agency_conflict SET marked_by = ${handlerMainId} WHERE id = ${row.id}
    `).rejects.toThrow();
    await expect(cloned.prisma.$executeRaw`
      DELETE FROM case_agency_conflict WHERE id = ${row.id}
    `).rejects.toThrow();
    const still = await cloned.prisma.caseAgencyConflict.findFirstOrThrow({ where: { id: row.id } });
    expect(still.markedBy).toBe(handlerMainId);
    expect(still.orgUnitId).toBe(stationAId);
  });
});
