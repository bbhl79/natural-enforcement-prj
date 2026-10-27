// #239 改派呈批（T33）与回避后材料效力认定：全部验收框。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newUlid } from '../backend/identity/src/index.ts';
import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-27T06:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Case-reassign-239!';
const INITIAL_PASSWORD = 'Reassign-239!';

function square(polygonOffset: number): (readonly number[])[] {
  const west = 114 + polygonOffset;
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
let now = T0;
const clock = { now: () => new Date(now) };
const cookies = new Map<string, string>();
const passwords = new Map<string, string>();
let deptAId = '';
let stationAId = '';
let mainId = '';
let assistId = '';
let nextMainId = '';
let nextAssistId = '';
let stationClerkId = '';
let outOfScopeId = '';
let unqualifiedId = '';
let clerkMainId = '';
let clerkAssistId = '';
let flowMainId = '';
let flowAssistId = '';
let revalidateAssistId = '';
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
  passwords.set(code, INITIAL_PASSWORD);
  return person.id;
}

async function register(polygonOffset: number, code: string): Promise<{ id: string; code: string }> {
  const form = new FormData();
  form.set('sourceCode', '16');
  form.set('domain', 'land');
  form.set(
    'values',
    JSON.stringify({
      'clue.received_at': '2026-10-27',
      'clue.narrative': '巡查发现一处硬化地面',
      'clue.finder': '巡查员',
      'clue.patrol_no': `XC-239-${polygonOffset}`,
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
      cookie: await cookieOf(code),
      'idempotency-key': `reassign-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  return (await response.json()) as { id: string; code: string };
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

async function openCase(input: {
  readonly handlingOrgId: string;
  readonly poolCode: string;
  readonly intakeCode: string;
  readonly main: string;
  readonly assist: string;
  readonly drafter: string;
  readonly party: string;
}): Promise<string> {
  offset += 1;
  const registered = await register(offset, input.poolCode);
  const org = await postJson(`/api/clues/${registered.id}/assign-org`, input.poolCode, {
    orgUnitId: input.handlingOrgId,
    expectedStatus: 'in_pool',
    reason: '',
    designate: false,
  });
  expect(org.status, JSON.stringify(org.body)).toBe(200);
  const people = await postJson(`/api/clues/${registered.id}/assign-people`, input.intakeCode, {
    mainId: input.main,
    assistIds: [input.assist],
    expectedStatus: 'org_assigned',
  });
  expect(people.status, JSON.stringify(people.body)).toBe(200);
  const drafted = await postJson(`/api/clues/${registered.id}/filing-approval`, input.drafter, {
    content: { conclusion: 'file', partyNames: [input.party] },
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, input.drafter)).status).toBe(200);
  const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  const caseRow = await cloned.prisma.caseRecord.findFirstOrThrow({ where: { filingApprovalId: approvalId } });
  return caseRow.id;
}

function stationCase(party: string, main = mainId, assist = assistId, drafter = 'P-239-H1'): Promise<string> {
  return openCase({
    handlingOrgId: stationAId,
    poolCode: 'P-239-IN',
    intakeCode: 'P-239-ST',
    main,
    assist,
    drafter,
    party,
  });
}

interface HandlerRow {
  readonly personnelId: string;
  readonly role: string;
  readonly endedAt: Date | null;
}

async function activeHandlers(caseId: string): Promise<HandlerRow[]> {
  return cloned.prisma.caseHandler.findMany({
    where: { caseId, endedAt: null },
    orderBy: [{ role: 'asc' }, { assignedAt: 'asc' }],
    select: { personnelId: true, role: true, endedAt: true },
  });
}

async function allHandlers(caseId: string): Promise<HandlerRow[]> {
  return cloned.prisma.caseHandler.findMany({
    where: { caseId },
    orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }],
    select: { personnelId: true, role: true, endedAt: true },
  });
}

async function trailOf(action: string, resourceId: string) {
  return cloned.prisma.$queryRaw<Array<{ outcome: string | null; reason: string | null; detail: string | null }>>`
    SELECT outcome, reason, detail
    FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
    ORDER BY created_at ASC, id ASC
  `;
}

function reassignBody(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mainId: nextMainId,
    assistIds: [nextAssistId],
    reasonCode: 'transfer',
    note: '',
    ...partial,
  };
}

async function submitReassign(
  caseId: string,
  code: string,
  partial: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/cases/${caseId}/reassignments`, code, reassignBody(partial));
}

async function approveReassign(
  caseId: string,
  reassignmentId: string,
  code = 'P-239-HEAD',
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/cases/${caseId}/reassignments/${reassignmentId}/approve`, code, { opinion: '同意' });
}

async function declareAndRecuse(caseId: string, personId: string, code = 'P-239-H1'): Promise<string> {
  const declared = await postJson(`/api/cases/${caseId}/conflicts`, code, {
    personId,
    source: 'self',
    reason: '本人与当事人有利害关系',
  });
  expect(declared.status, JSON.stringify(declared.body)).toBe(200);
  const lineageId = String(declared.body.lineageId);
  const decided = await postJson(`/api/cases/${caseId}/conflicts/${lineageId}/decisions`, 'P-239-HEAD', {
    conclusion: 'recuse',
    reason: '同意回避',
  });
  expect(decided.status, JSON.stringify(decided.body)).toBe(200);
  return lineageId;
}

async function addMaterial(caseId: string, body: string, kind = 'investigation-record'): Promise<string> {
  const id = newUlid();
  await cloned.prisma.caseMaterial.create({ data: { id, caseId, kind, body } });
  return id;
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const app = await createApplication(
    cloned.connectionString,
    clock,
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
  await seedPerson('P-239-IN', '甲区内勤', deptAId, ['内勤'], '13900023901');
  await seedPerson('P-239-ST', '甲所内勤', stationAId, ['内勤'], '13900023902');
  stationClerkId = (await cloned.prisma.personnel.findFirstOrThrow({ where: { code: 'P-239-ST' } })).id;
  mainId = await seedPerson('P-239-H1', '主办甲', stationAId, ['经办'], '13900023903');
  assistId = await seedPerson('P-239-H2', '协办乙', stationAId, ['经办'], '13900023904');
  nextMainId = await seedPerson('P-239-H3', '新主办丙', stationAId, ['经办'], '13900023905');
  nextAssistId = await seedPerson('P-239-H4', '新协办丁', stationAId, ['经办'], '13900023906');
  await seedPerson('P-239-HEAD', '所级审批', stationAId, ['行政审批'], '13900023907');
  outOfScopeId = await seedPerson('P-239-DEPT-H', '区级经办', deptAId, ['经办'], '13900023908');
  unqualifiedId = await seedPerson('P-239-UNQ', '无证经办', stationAId, ['经办'], '13900023909');
  await cloned.prisma.personnel.update({
    where: { id: unqualifiedId },
    data: { enforcementCertNo: null, enforcementCertExpiresOn: null, enforcementCertStatus: 'valid' },
  });
  clerkMainId = await seedPerson('P-239-C1', '内勤案主办', stationAId, ['经办'], '13900023910');
  clerkAssistId = await seedPerson('P-239-C2', '内勤案协办', stationAId, ['经办'], '13900023911');
  flowMainId = await seedPerson('P-239-F1', 'N5案主办', stationAId, ['经办'], '13900023912');
  flowAssistId = await seedPerson('P-239-F2', 'N5案协办', stationAId, ['经办'], '13900023913');
  revalidateAssistId = await seedPerson('P-239-R1', '批准复验协办', stationAId, ['经办'], '13900023914');
}, 120_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  now = T0;
  cookies.clear();
});

describe('#239 改派呈批', () => {
  it('批准前名单不变；批准后名单更新，环节与主状态不变，留痕齐备', async () => {
    const caseId = await stationCase('改派甲');
    const before = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    const submitted = await submitReassign(caseId, 'P-239-H1');
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body).toMatchObject({ result: 'reassignment-submitted', status: 'pending_approval' });
    const reassignmentId = String(submitted.body.reassignmentId);
    expect((await activeHandlers(caseId)).map((row) => row.personnelId).sort()).toEqual([mainId, assistId].sort());

    const listedBefore = await getJson(`/api/cases/${caseId}/reassignments`, 'P-239-H1');
    expect(listedBefore.status).toBe(200);
    const pending = (listedBefore.body.reassignments as Array<Record<string, unknown>>)[0];
    expect(pending).toMatchObject({ id: reassignmentId, status: 'pending_approval', reasonName: '调岗' });

    const approved = await approveReassign(caseId, reassignmentId);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({
      result: 'reassignment-approved',
      status: 'approved',
      currentStage: 'E02',
      mainStatus: 'in_progress',
    });
    const after = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(after.currentStage).toBe(before.currentStage);
    expect(after.stageEntrySeq).toBe(before.stageEntrySeq);
    expect(after.status).toBe(before.status);
    expect(after.handlingOrgId).toBe(before.handlingOrgId);
    const active = await activeHandlers(caseId);
    expect(active.map((row) => row.personnelId).sort()).toEqual([nextMainId, nextAssistId].sort());
    const history = await allHandlers(caseId);
    expect(history.filter((row) => row.endedAt !== null).map((row) => row.personnelId).sort()).toEqual(
      [mainId, assistId].sort(),
    );
    const transitions = await cloned.prisma.caseTransition.findMany({ where: { caseId, transitionCode: 'T33' } });
    expect(transitions).toHaveLength(1);
    const submittedTrail = await trailOf('case.reassignment-submitted', caseId);
    expect(submittedTrail.some((row) => row.outcome === 'succeeded')).toBe(true);
    const approvedTrail = await trailOf('case.reassignment-approved', caseId);
    const succeeded = approvedTrail.find((row) => row.outcome === 'succeeded');
    expect(succeeded).toBeTruthy();
    expect(String(succeeded?.detail)).toContain('"nextHandlers"');
    expect(String(succeeded?.detail)).toContain(nextMainId);

    const listedAfter = await getJson(`/api/cases/${caseId}/reassignments`, 'P-239-H1');
    const former = (listedAfter.body.formerHandlers as Array<{ personnelId: string }>).map((row) => row.personnelId);
    expect(former.sort()).toEqual([mainId, assistId].sort());
    expect((listedAfter.body.everHandlerPersonnelIds as string[]).sort()).toEqual(
      [mainId, assistId, nextMainId, nextAssistId].sort(),
    );
  });

  it('原因为空 400；其他原因缺说明 400；业务行不变，失败留痕', async () => {
    const caseId = await stationCase('原因甲');
    const missing = await submitReassign(caseId, 'P-239-H1', { reasonCode: '' });
    expect(missing.status).toBe(400);
    expect(missing.body.reason).toBe('missing-reason');
    const noteMissing = await submitReassign(caseId, 'P-239-H1', { reasonCode: 'other', note: '' });
    expect(noteMissing.status).toBe(400);
    expect(noteMissing.body.reason).toBe('missing-reason-note');
    expect(await cloned.prisma.caseReassignment.count({ where: { caseId } })).toBe(0);
    expect((await activeHandlers(caseId)).map((row) => row.personnelId).sort()).toEqual([mainId, assistId].sort());
    const trails = await trailOf('case.reassignment-submitted', caseId);
    expect(trails.filter((row) => row.outcome === 'failed').map((row) => row.reason).sort()).toEqual([
      'missing-reason',
      'missing-reason-note',
    ]);
  });

  it('换完少于两人或缺执法资格：409 X14，业务行不变；批准时再校验', async () => {
    const caseId = await stationCase('人数甲');
    const tooFew = await submitReassign(caseId, 'P-239-H1', { assistIds: [] });
    expect(tooFew.status).toBe(409);
    expect(tooFew.body.reason).toBe('X14');
    const unqualified = await submitReassign(caseId, 'P-239-H1', { assistIds: [unqualifiedId] });
    expect(unqualified.status).toBe(409);
    expect(unqualified.body.reason).toBe('X14');
    expect(await cloned.prisma.caseReassignment.count({ where: { caseId } })).toBe(0);
    expect((await activeHandlers(caseId)).map((row) => row.personnelId).sort()).toEqual([mainId, assistId].sort());
    const trail = await trailOf('case.reassignment-submitted', caseId);
    expect(trail.filter((row) => row.reason === 'X14')).toHaveLength(2);

    const submitted = await submitReassign(caseId, 'P-239-H1', { assistIds: [revalidateAssistId] });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    await cloned.prisma.personnel.update({
      where: { id: revalidateAssistId },
      data: { enforcementCertNo: null },
    });
    const approved = await approveReassign(caseId, String(submitted.body.reassignmentId));
    expect(approved.status).toBe(409);
    expect(approved.body.reason).toBe('X14');
    expect(await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } })).toMatchObject({
      currentStage: 'E02',
      status: 'in_progress',
    });
    expect((await activeHandlers(caseId)).map((row) => row.personnelId).sort()).toEqual([mainId, assistId].sort());
    const approvedTrail = await trailOf('case.reassignment-approved', caseId);
    expect(approvedTrail.some((row) => row.outcome === 'failed' && row.reason === 'X14')).toBe(true);
  });

  it('新经办不属承办机构或其下属：409，业务行不变', async () => {
    const caseId = await stationCase('范围甲');
    const out = await submitReassign(caseId, 'P-239-H1', { assistIds: [outOfScopeId] });
    expect(out.status).toBe(409);
    expect(out.body.reason).toBe('handler-out-of-scope');
    expect(await cloned.prisma.caseReassignment.count({ where: { caseId } })).toBe(0);
    expect((await activeHandlers(caseId)).map((row) => row.personnelId).sort()).toEqual([mainId, assistId].sort());
    const trail = await trailOf('case.reassignment-submitted', caseId);
    expect(trail.some((row) => row.outcome === 'failed' && row.reason === 'handler-out-of-scope')).toBe(true);
  });

  it('主办或协办任一可用时内勤发起 403；两人都停用或调离时承办机构内勤成功；内勤编辑文书 403', async () => {
    const available = await stationCase('内勤甲');
    const denied = await submitReassign(available, 'P-239-ST');
    expect(denied.status).toBe(403);
    const edit = await postJson(`/api/cases/${available}/document-drafts`, 'P-239-ST');
    expect(edit.status).toBe(403);
    expect(edit.body.reason).toBe('clerk-cannot-edit');

    const stopped = await stationCase('内勤乙', clerkMainId, clerkAssistId, 'P-239-C1');
    for (const personnelId of [clerkMainId, clerkAssistId]) {
      const person = await cloned.prisma.personnel.findUniqueOrThrow({ where: { id: personnelId } });
      expect(person.deactivatedAt).toBeNull();
      const response = await postJson(`/api/admin/personnel/${personnelId}/deactivate`, 'P-ADMIN-HQ');
      expect(response.status, JSON.stringify(response.body)).toBe(200);
    }
    const stillOpen = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: stopped } });
    expect(stillOpen.status).toBe('in_progress');
    const byDeptClerk = await submitReassign(stopped, 'P-239-IN');
    expect(byDeptClerk.status).toBe(403);
    const byStationClerk = await submitReassign(stopped, 'P-239-ST');
    expect(byStationClerk.status, JSON.stringify(byStationClerk.body)).toBe(200);
    expect((await activeHandlers(stopped)).map((row) => row.personnelId).sort()).toEqual(
      [clerkMainId, clerkAssistId].sort(),
    );
    const approved = await approveReassign(stopped, String(byStationClerk.body.reassignmentId));
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect((await activeHandlers(stopped)).map((row) => row.personnelId).sort()).toEqual(
      [nextMainId, nextAssistId].sort(),
    );
  });

  it('N5：审核中两人都停用，经 #238 退回内勤后发起改派并批准，新经办接手，审批可继续', async () => {
    const caseId = await stationCase('N5甲', flowMainId, flowAssistId, 'P-239-F1');
    const e09 = newUlid();
    await cloned.prisma.caseStageInstance.create({
      data: {
        id: e09,
        caseId,
        stage: 'E09',
        entrySeq: 1,
        status: 'drafting',
        enteredAt: new Date(T0),
        enteredBy: flowMainId,
        transitionCode: 'T01',
      },
    });
    await cloned.prisma.caseRecord.update({ where: { id: caseId }, data: { currentStage: 'E09' } });
    for (const personnelId of [flowMainId, flowAssistId]) {
      const response = await postJson(`/api/admin/personnel/${personnelId}/deactivate`, 'P-ADMIN-HQ');
      expect(response.status, JSON.stringify(response.body)).toBe(200);
    }
    const returned = await postJson(`/api/cases/${caseId}/returns`, 'P-APPROVE-HQ', {
      reasonCode: 'R2',
      note: '两人都停用，退回内勤',
      targetKey: 'stage:E02',
      receiverId: stationClerkId,
    });
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    expect(returned.body.n5).toBe(true);
    const submitted = await submitReassign(caseId, 'P-239-ST');
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const approved = await approveReassign(caseId, String(submitted.body.reassignmentId));
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect((await activeHandlers(caseId)).map((row) => row.personnelId).sort()).toEqual(
      [nextMainId, nextAssistId].sort(),
    );
    const chain = await postJson(`/api/cases/${caseId}/approval-chains`, 'P-239-H3', { kind: 'decision-review' });
    expect(chain.status, JSON.stringify(chain.body)).toBe(200);
    expect(chain.body.result).toBe('approval-chain-opened');
  });

  it('受 X18 约束：已有进行中的审批链时发起 409；通用迁移入口不能直接套 T33', async () => {
    const caseId = await stationCase('X18甲');
    const chain = await postJson(`/api/cases/${caseId}/approval-chains`, 'P-239-H1', { kind: 'decision-review' });
    expect(chain.status, JSON.stringify(chain.body)).toBe(200);
    const blocked = await submitReassign(caseId, 'P-239-H1');
    expect(blocked.status).toBe(409);
    expect(blocked.body.reason).toBe('X18');
    expect(await cloned.prisma.caseReassignment.count({ where: { caseId } })).toBe(0);
    expect((await activeHandlers(caseId)).map((row) => row.personnelId).sort()).toEqual([mainId, assistId].sort());
    const trail = await trailOf('case.reassignment-submitted', caseId);
    expect(trail.some((row) => row.outcome === 'failed' && row.reason === 'X18')).toBe(true);

    const other = await stationCase('X18乙');
    const direct = await postJson(`/api/cases/${other}/transitions`, 'P-239-HEAD', { transitionId: 'T33' });
    expect(direct.status).toBe(409);
    expect(direct.body.reason).toBe('procedure-required');
    expect(await cloned.prisma.caseTransition.count({ where: { caseId: other, transitionCode: 'T33' } })).toBe(0);
  });

  it('回避改派：未引用生效决定 409；批准人与决定人不一致 409；一致时成功', async () => {
    const caseId = await stationCase('回避甲');
    const missing = await submitReassign(caseId, 'P-239-H1', { reasonCode: 'recusal' });
    expect(missing.status).toBe(409);
    expect(missing.body.reason).toBe('conflict-decision-required');

    const declared = await postJson(`/api/cases/${caseId}/conflicts`, 'P-239-H1', {
      personId: mainId,
      source: 'self',
      reason: '本人与当事人有利害关系',
    });
    expect(declared.status).toBe(200);
    const lineageId = String(declared.body.lineageId);
    const notEffective = await submitReassign(caseId, 'P-239-H1', {
      reasonCode: 'recusal',
      conflictLineageId: lineageId,
    });
    expect(notEffective.status).toBe(409);
    expect(notEffective.body.reason).toBe('conflict-decision-not-effective');

    const rejectedDecision = await postJson(`/api/cases/${caseId}/conflicts/${lineageId}/decisions`, 'P-239-HEAD', {
      conclusion: 'reject',
      reason: '理由不成立',
    });
    expect(rejectedDecision.status).toBe(200);
    const rejected = await submitReassign(caseId, 'P-239-H1', {
      reasonCode: 'recusal',
      conflictLineageId: lineageId,
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body.reason).toBe('conflict-decision-not-effective');

    const recused = await declareAndRecuse(caseId, mainId);
    const submitted = await submitReassign(caseId, 'P-239-H1', {
      reasonCode: 'recusal',
      conflictLineageId: recused,
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const refused = await approveReassign(caseId, String(submitted.body.reassignmentId), 'P-APPROVE-HQ');
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('conflict-decider-mismatch');
    expect((await activeHandlers(caseId)).map((row) => row.personnelId).sort()).toEqual([mainId, assistId].sort());
    const approved = await approveReassign(caseId, String(submitted.body.reassignmentId));
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect((await activeHandlers(caseId)).map((row) => row.personnelId).sort()).toEqual(
      [nextMainId, nextAssistId].sort(),
    );
    const trail = await trailOf('case.reassignment-approved', caseId);
    expect(trail.some((row) => row.outcome === 'failed' && row.reason === 'conflict-decider-mismatch')).toBe(true);
  });
});

describe('#239 回避后材料效力认定', () => {
  async function recusedCase(party: string): Promise<{ caseId: string; lineageId: string }> {
    const caseId = await stationCase(party);
    const lineageId = await declareAndRecuse(caseId, mainId);
    const submitted = await submitReassign(caseId, 'P-239-H1', {
      reasonCode: 'recusal',
      conflictLineageId: lineageId,
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const approved = await approveReassign(caseId, String(submitted.body.reassignmentId));
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    return { caseId, lineageId };
  }

  it('没有回避改派生效时不能认定；不是当前主办 409', async () => {
    const plain = await stationCase('认定甲');
    const materialId = await addMaterial(plain, '调查笔录原文');
    const blocked = await postJson(`/api/cases/${plain}/material-effectivities`, 'P-239-H1', {
      materialId,
      conclusion: 'valid',
      reason: '形式合法',
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.reason).toBe('invalid-state');

    const { caseId } = await recusedCase('认定乙');
    const other = await addMaterial(caseId, '另一份调查记录');
    const notMain = await postJson(`/api/cases/${caseId}/material-effectivities`, 'P-239-H1', {
      materialId: other,
      conclusion: 'valid',
      reason: '形式合法',
    });
    expect(notMain.status).toBe(409);
    expect(notMain.body.reason).toBe('not-main-handler');
  });

  it('逐件认定；无效材料在查询中标为无效；认定不产生呈批；只追加', async () => {
    const { caseId } = await recusedCase('认定丙');
    const first = await addMaterial(caseId, '调查笔录原文');
    const second = await addMaterial(caseId, '现场照片说明');
    const invalid = await postJson(`/api/cases/${caseId}/material-effectivities`, 'P-239-H3', {
      materialId: first,
      conclusion: 'invalid',
      reason: '未入卷，来源不明',
    });
    expect(invalid.status, JSON.stringify(invalid.body)).toBe(200);
    expect(invalid.body).toMatchObject({ result: 'material-effectivity-recorded', conclusionName: '无效' });
    const valid = await postJson(`/api/cases/${caseId}/material-effectivities`, 'P-239-H3', {
      materialId: second,
      conclusion: 'valid',
      reason: '形式合法',
    });
    expect(valid.status, JSON.stringify(valid.body)).toBe(200);
    now = T0 + 30_000;
    const correction = await postJson(`/api/cases/${caseId}/material-effectivities`, 'P-239-H3', {
      materialId: second,
      conclusion: 'needs-correction',
      reason: '缺签名，需补正',
    });
    expect(correction.status).toBe(200);

    const listed = await getJson(`/api/cases/${caseId}/reassignments`, 'P-239-H3');
    expect(listed.status).toBe(200);
    expect(listed.body.invalidMaterialIds).toEqual([first]);
    const materials = listed.body.materials as Array<Record<string, unknown>>;
    const firstView = materials.find((row) => row.materialId === first);
    expect((firstView?.effectiveness as Record<string, unknown>).conclusionName).toBe('无效');
    const secondView = materials.find((row) => row.materialId === second);
    expect((secondView?.effectiveness as Record<string, unknown>).conclusionName).toBe('需补正');

    expect(await cloned.prisma.caseApprovalChain.count({ where: { caseId, status: 'in_flight' } })).toBe(0);
    expect(await cloned.prisma.caseReassignment.count({ where: { caseId } })).toBe(1);
    expect(await cloned.prisma.caseMaterialEffectiveness.count({ where: { caseId } })).toBe(3);

    const older = await cloned.prisma.caseMaterialEffectiveness.findFirstOrThrow({
      where: { caseId, materialId: first },
    });
    await expect(
      cloned.prisma.$executeRaw`UPDATE case_material_effectiveness SET conclusion = 'valid' WHERE id = ${older.id}`,
    ).rejects.toThrow();
    await expect(
      cloned.prisma.$executeRaw`DELETE FROM case_material_effectiveness WHERE id = ${older.id}`,
    ).rejects.toThrow();

    const later = newUlid();
    await cloned.prisma.caseMaterialEffectiveness.create({
      data: {
        id: later,
        caseId,
        materialId: first,
        reassignmentId: String(
          (
            await cloned.prisma.caseReassignment.findFirstOrThrow({
              where: { caseId, status: 'approved' },
            })
          ).id,
        ),
        conclusion: 'valid',
        reason: '补正后有效',
        determinedBy: nextMainId,
        determinedAt: new Date(T0 + 60_000),
      },
    });
    const after = await getJson(`/api/cases/${caseId}/reassignments`, 'P-239-H3');
    expect(after.body.invalidMaterialIds).toEqual([]);
  });
});