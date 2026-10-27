// #237 人员层利害关系：声明即暂停签出，决定人两级，调查不中断，记录只追加。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { CaseConflictService } from '../backend/server/src/case-conflict.service.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-27T06:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Case-conflict-237!';
const INITIAL_PASSWORD = 'Conflict-237!';
const SIGN_KINDS = ['trial-opinion', 'legal-opinion', 'decision'] as const;

function square(offset: number): (readonly number[])[] {
  const west = 114 + offset;
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
let app: Awaited<ReturnType<typeof createApplication>>;
let conflicts: CaseConflictService;
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
const cookies = new Map<string, string>();
const passwords = new Map<string, string>();
let stationAId = '';
let deptAId = '';
let handlerMainId = '';
let handlerAssistId = '';
let signerId = '';
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

async function register(polygonOffset: number): Promise<{ id: string; code: string }> {
  const form = new FormData();
  form.set('sourceCode', '16');
  form.set('domain', 'land');
  form.set(
    'values',
    JSON.stringify({
      'clue.received_at': '2026-10-27',
      'clue.narrative': '巡查发现一处硬化地面',
      'clue.finder': '巡查员',
      'clue.patrol_no': `XC-237-${polygonOffset}`,
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
      cookie: await cookieOf('P-237-IN'),
      'idempotency-key': `conflict-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  return (await response.json()) as { id: string; code: string };
}

async function toHandlerAssigned(clueId: string): Promise<void> {
  const org = await fetch(`${baseUrl}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-237-IN') },
    body: JSON.stringify({ orgUnitId: stationAId, expectedStatus: 'in_pool', reason: '', designate: false }),
  });
  expect(org.status).toBe(200);
  const people = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-237-ST') },
    body: JSON.stringify({
      mainId: handlerMainId,
      assistIds: [handlerAssistId],
      expectedStatus: 'org_assigned',
    }),
  });
  expect(people.status).toBe(200);
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
  const drafted = await postJson(`/api/clues/${registered.id}/filing-approval`, 'P-237-H1', {
    content: { conclusion: 'file', partyNames: ['张三'] },
  });
  expect(drafted.status).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, 'P-237-H1')).status).toBe(200);
  const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status).toBe(200);
  return String(approved.body.caseId);
}

async function declare(
  caseId: string,
  input: { personId: string; source: string; reason: string },
  code = 'P-237-H1',
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/cases/${caseId}/conflicts`, code, input);
}

interface SignTrailRow {
  readonly outcome: string;
  readonly reason: string | null;
  readonly detail: string | null;
}

async function signTrail(caseId: string): Promise<SignTrailRow[]> {
  return cloned.prisma.$queryRaw<SignTrailRow[]>`
    SELECT outcome, reason, detail
    FROM audit_trail
    WHERE action = 'case.sign-refused' AND resource_id = ${caseId}
    ORDER BY created_at ASC, id ASC
  `;
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(T0) },
    undefined,
    {
      storagePort: new RecordingStorage() as never,
      queuePort: new RecordingQueue() as never,
      filingAdminReview: 'skip',
    },
  );
  conflicts = app.get(CaseConflictService);
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
  await seedPerson('P-237-IN', '甲区内勤', deptAId, ['内勤'], '13900023701');
  await seedPerson('P-237-ST', '甲所内勤', stationAId, ['内勤'], '13900023702');
  handlerMainId = await seedPerson('P-237-H1', '主办甲', stationAId, ['经办'], '13900023703');
  handlerAssistId = await seedPerson('P-237-H2', '协办乙', stationAId, ['经办'], '13900023704');
  signerId = await seedPerson('P-237-SIGN', '法审丙', stationAId, ['法制审核'], '13900023705');
  await seedPerson('P-237-HEAD', '所级审批', stationAId, ['行政审批'], '13900023706');
}, 120_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  cookies.clear();
});

describe('#237 人员层利害关系', () => {
  it('声明后 activeConflicts 返回该记录；审理、法审、决定签出各 409，并各写一条失败留痕', async () => {
    const caseId = await fileCase();
    const declared = await declare(caseId, {
      personId: signerId,
      source: 'other',
      reason: '与当事人有亲属关系',
    });
    expect(declared.status).toBe(200);
    expect(declared.body.status).toBe('declared');
    const active = await conflicts.activeConflicts(caseId, signerId);
    expect(active).toEqual([
      expect.objectContaining({
        personId: signerId,
        source: 'other',
        status: 'declared',
        reason: '与当事人有亲属关系',
      }),
    ]);
    const actor = { personnelId: signerId, authenticated: true };
    for (const signKind of SIGN_KINDS) {
      const before = (await signTrail(caseId)).length;
      const refused = await conflicts.assertCanSign(actor, caseId, signerId, signKind);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        result: 'sign-refused',
        reason: 'conflict-active',
        message: '声明期间签出被拒',
        outlet: '等待回避决定',
      });
      const rows = await signTrail(caseId);
      expect(rows).toHaveLength(before + 1);
      expect(rows.at(-1)).toMatchObject({ outcome: 'failed', reason: 'conflict-active' });
      expect(rows.at(-1)?.detail).toContain('声明期间签出被拒');
      expect(rows.at(-1)?.detail).toContain('等待回避决定');
    }
  });

  it('决定驳回后状态为驳回，签出恢复，原声明行仍在', async () => {
    const caseId = await fileCase();
    const declared = await declare(caseId, {
      personId: signerId,
      source: 'other',
      reason: '可能影响公正',
    });
    expect(declared.status).toBe(200);
    const lineageId = String(declared.body.lineageId);
    const decided = await postJson(`/api/cases/${caseId}/conflicts/${lineageId}/decisions`, 'P-237-HEAD', {
      conclusion: 'reject',
      reason: '理由不成立',
    });
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({ status: 'rejected', statusName: '驳回', conclusion: 'reject' });
    const active = await conflicts.activeConflicts(caseId, signerId);
    expect(active).toEqual([]);
    const allowed = await conflicts.assertCanSign(
      { personnelId: signerId, authenticated: true },
      caseId,
      signerId,
      'trial-opinion',
    );
    expect(allowed).toMatchObject({ status: 200, body: { result: 'sign-allowed' } });
    expect(await signTrail(caseId)).toEqual([]);
    const events = await cloned.prisma.personConflictEvent.findMany({
      where: { caseId, lineageId },
      orderBy: { seq: 'asc' },
    });
    expect(events.map((row) => row.status)).toEqual(['declared', 'rejected']);
    const listed = await getJson(`/api/cases/${caseId}/conflicts`, 'P-237-H1');
    expect(listed.status).toBe(200);
    const records = listed.body.records as Array<{ status: string; statusName: string }>;
    expect(records.map((row) => row.statusName)).toEqual(['声明', '驳回']);
  });

  it('决定回避后状态为生效，承办人仍不能签出，activeConflicts 能查到', async () => {
    const caseId = await fileCase();
    const declared = await declare(caseId, {
      personId: handlerMainId,
      source: 'self',
      reason: '本人与当事人有利害关系',
    });
    expect(declared.status).toBe(200);
    const lineageId = String(declared.body.lineageId);
    const decided = await postJson(`/api/cases/${caseId}/conflicts/${lineageId}/decisions`, 'P-237-HEAD', {
      conclusion: 'recuse',
      reason: '同意回避',
    });
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({ status: 'effective', statusName: '生效', conclusionName: '回避' });
    const active = await conflicts.activeConflicts(caseId, handlerMainId);
    expect(active.map((row) => row.status)).toEqual(['effective']);
    const refused = await conflicts.assertCanSign(
      { personnelId: handlerMainId, authenticated: true },
      caseId,
      handlerMainId,
      'decision',
    );
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ message: '声明期间签出被拒', outlet: '等待回避决定' });
  });

  it('本人申请由非承办机构负责人决定返回 409；当事人申请由承办机构负责人决定返回 409', async () => {
    const selfCase = await fileCase();
    const selfDeclared = await declare(selfCase, {
      personId: handlerMainId,
      source: 'self',
      reason: '本人申请回避',
    });
    expect(selfDeclared.status).toBe(200);
    const selfDenied = await postJson(
      `/api/cases/${selfCase}/conflicts/${String(selfDeclared.body.lineageId)}/decisions`,
      'P-APPROVE-HQ',
      { conclusion: 'recuse', reason: '越级决定' },
    );
    expect(selfDenied.status).toBe(409);
    expect(selfDenied.body.reason).toBe('decider-mismatch');
    expect(await conflicts.activeConflicts(selfCase, handlerMainId)).toEqual([
      expect.objectContaining({ status: 'declared' }),
    ]);

    const partyCase = await fileCase();
    const partyDeclared = await declare(partyCase, {
      personId: signerId,
      source: 'party',
      reason: '当事人申请该人回避',
    });
    expect(partyDeclared.status).toBe(200);
    const partyDenied = await postJson(
      `/api/cases/${partyCase}/conflicts/${String(partyDeclared.body.lineageId)}/decisions`,
      'P-237-HEAD',
      { conclusion: 'reject', reason: '所级审批越权' },
    );
    expect(partyDenied.status).toBe(409);
    expect(partyDenied.body.reason).toBe('decider-mismatch');
    const partyAllowed = await postJson(
      `/api/cases/${partyCase}/conflicts/${String(partyDeclared.body.lineageId)}/decisions`,
      'P-APPROVE-HQ',
      { conclusion: 'reject', reason: '主管部门驳回' },
    );
    expect(partyAllowed.status).toBe(200);
    expect(partyAllowed.body.status).toBe('rejected');
  });

  it('承办人处于声明期间仍能登记笔录和违法记录', async () => {
    const caseId = await fileCase();
    const declared = await declare(caseId, {
      personId: handlerMainId,
      source: 'self',
      reason: '声明期间继续调查',
    });
    expect(declared.status).toBe(200);
    const transcript = await postJson(`/api/cases/${caseId}/investigation-entries`, 'P-237-H1', {
      kind: 'transcript',
      summary: '询问笔录',
    });
    const violation = await postJson(`/api/cases/${caseId}/investigation-entries`, 'P-237-H1', {
      kind: 'violation',
      summary: '违法记录',
    });
    expect(transcript.status).toBe(200);
    expect(transcript.body).toMatchObject({ result: 'investigation-recorded', kind: 'transcript', kindName: '笔录' });
    expect(violation.status).toBe(200);
    expect(violation.body).toMatchObject({ kind: 'violation', kindName: '违法记录' });
    const rows = await cloned.prisma.caseInvestigationEntry.findMany({
      where: { caseId },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((row) => row.kind).sort()).toEqual(['transcript', 'violation']);
    expect(await signTrail(caseId)).toEqual([]);
  });

  it('利害关系、回避决定、调查登记的更新和删除都被库层拒绝', async () => {
    const caseId = await fileCase();
    const declared = await declare(caseId, {
      personId: signerId,
      source: 'other',
      reason: '只追加探针',
    });
    expect(declared.status).toBe(200);
    const lineageId = String(declared.body.lineageId);
    expect((await postJson(`/api/cases/${caseId}/conflicts/${lineageId}/decisions`, 'P-237-HEAD', {
      conclusion: 'reject',
      reason: '驳回后仍不许改行',
    })).status).toBe(200);
    expect((await postJson(`/api/cases/${caseId}/investigation-entries`, 'P-237-H1', {
      kind: 'transcript',
      summary: '只追加的笔录',
    })).status).toBe(200);
    const event = await cloned.prisma.personConflictEvent.findFirstOrThrow({ where: { caseId, seq: 1 } });
    const decision = await cloned.prisma.personConflictDecision.findFirstOrThrow({ where: { caseId } });
    const entry = await cloned.prisma.caseInvestigationEntry.findFirstOrThrow({ where: { caseId } });
    await expect(cloned.prisma.$executeRaw`
      UPDATE person_conflict_event SET status = 'effective' WHERE id = ${event.id}
    `).rejects.toThrow();
    await expect(cloned.prisma.$executeRaw`
      DELETE FROM person_conflict_event WHERE id = ${event.id}
    `).rejects.toThrow();
    await expect(cloned.prisma.$executeRaw`
      UPDATE person_conflict_decision SET conclusion = 'recuse' WHERE id = ${decision.id}
    `).rejects.toThrow();
    await expect(cloned.prisma.$executeRaw`
      DELETE FROM person_conflict_decision WHERE id = ${decision.id}
    `).rejects.toThrow();
    await expect(cloned.prisma.$executeRaw`
      UPDATE case_investigation_entry SET summary = '改写' WHERE id = ${entry.id}
    `).rejects.toThrow();
    await expect(cloned.prisma.$executeRaw`
      DELETE FROM case_investigation_entry WHERE id = ${entry.id}
    `).rejects.toThrow();
    const still = await cloned.prisma.personConflictEvent.findFirstOrThrow({ where: { id: event.id } });
    expect(still.status).toBe('declared');
  });

  it('法审接收人候选去掉有声明或生效记录的人', async () => {
    const caseId = await fileCase();
    const declared = await declare(caseId, {
      personId: signerId,
      source: 'other',
      reason: '法审候选人应被排除',
    });
    expect(declared.status).toBe(200);
    const filtered = await postJson(`/api/cases/${caseId}/legal-review-candidates`, 'P-237-H1', {
      personIds: [signerId, handlerAssistId, handlerMainId],
    });
    expect(filtered.status).toBe(200);
    expect(filtered.body.personIds).toEqual([handlerAssistId, handlerMainId]);
  });
});
