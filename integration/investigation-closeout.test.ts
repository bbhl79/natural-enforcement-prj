// #236 调查环节与收尾：笔录两人、作废、中止停表、恢复续表、终止、撤案、不可抗力结案。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-27T06:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Case-close-236!';
const INITIAL_PASSWORD = 'Close-236!!';
const LIMITATION_EXIT = {
  ruleId: 'cfg.rule.limitation-discovery-exit.test',
  beforeHearing: [
    { kind: 'terminate' as const, transitionId: 'T05' },
    { kind: 'withdraw' as const, transitionId: 'T06' },
  ],
  afterHearing: {
    outcomeCode: 'O2',
    outcomeLabel: '不予行政处罚',
    transitionId: 'configured-exit',
    applyInThisTicket: false as const,
  },
};

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
    body: JSON.stringify({ code, name, orgUnitId, mobilePhone, initialPassword: INITIAL_PASSWORD, roles: [...roles] }),
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
      'clue.patrol_no': `XC-236-${polygonOffset}`,
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
      cookie: await cookieOf('P-236-IN'),
      'idempotency-key': `close-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  return (await response.json()) as { id: string };
}

async function toHandlerAssigned(clueId: string): Promise<void> {
  const org = await fetch(`${baseUrl}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-236-IN') },
    body: JSON.stringify({ orgUnitId: stationAId, expectedStatus: 'in_pool', reason: '', designate: false }),
  });
  expect(org.status).toBe(200);
  const people = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-236-ST') },
    body: JSON.stringify({ mainId: handlerMainId, assistIds: [handlerAssistId], expectedStatus: 'org_assigned' }),
  });
  expect(people.status).toBe(200);
}

async function postJson(path: string, code: string, body: unknown = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function getJson(path: string, code: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { cookie: await cookieOf(code) } });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function fileCase(): Promise<string> {
  offset += 1;
  const registered = await register(offset);
  await toHandlerAssigned(registered.id);
  const drafted = await postJson(`/api/clues/${registered.id}/filing-approval`, 'P-236-H1', {
    content: { conclusion: 'file', partyNames: ['张三'] },
  });
  expect(drafted.status).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, 'P-236-H1')).status).toBe(200);
  expect((await postJson(`/api/filing-approvals/${approvalId}/review`, 'P-236-RV', { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status).toBe(200);
  return String(approved.body.caseId);
}

async function runProcedure(caseId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const drafted = await postJson(`/api/cases/${caseId}/procedures`, 'P-236-H1', body);
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/procedures/${approvalId}/submit`, 'P-236-H1')).status).toBe(200);
  expect((await postJson(`/api/procedures/${approvalId}/review`, 'P-236-RV', { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/procedures/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return approved.body;
}

async function deadlineEvents(caseId: string): Promise<Array<{ eventKind: string; basisLabel: string; basisNote: string }>> {
  return cloned.prisma.caseDeadlineEvent.findMany({
    where: { caseId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { eventKind: true, basisLabel: true, basisNote: true },
  });
}

async function trails(action: string, resourceId: string): Promise<Array<{ outcome: string; reason: string | null }>> {
  return cloned.prisma.$queryRaw<Array<{ outcome: string; reason: string | null }>>`
    SELECT outcome, reason
    FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
    ORDER BY created_at ASC, id ASC
  `;
}

async function confirmationRows(resourceId: string): Promise<Array<{ outcome: string; detail: string | null }>> {
  return cloned.prisma.$queryRaw<Array<{ outcome: string; detail: string | null }>>`
    SELECT outcome, detail
    FROM audit_trail
    WHERE action = 'case.rule-confirmed' AND resource_id = ${resourceId}
    ORDER BY created_at ASC, id ASC
  `;
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const app = await createApplication(cloned.connectionString, { now: () => new Date(T0) }, undefined, {
    storagePort: new RecordingStorage() as never,
    queuePort: new RecordingQueue() as never,
    filingAdminReview: 'one-level',
    limitationDiscoveryExit: LIMITATION_EXIT,
  });
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
  await seedPerson('P-236-IN', '甲区内勤', deptAId, ['内勤'], '13900023601');
  await seedPerson('P-236-ST', '甲所内勤', stationAId, ['内勤'], '13900023602');
  handlerMainId = await seedPerson('P-236-H1', '主办甲', stationAId, ['经办'], '13900023603');
  handlerAssistId = await seedPerson('P-236-H2', '协办乙', stationAId, ['经办'], '13900023604');
  await seedPerson('P-236-RV', '所内审核', stationAId, ['行政审核'], '13900023605');
}, 180_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  cookies.clear();
});

describe('#236 调查收尾', () => {
  it('一名在场承办人员保存笔录为 409 X20，两名可以保存', async () => {
    const caseId = await fileCase();
    const denied = await postJson(`/api/cases/${caseId}/inquiries`, 'P-236-H1', {
      occurredAt: '2026-10-27T01:00:00.000Z',
      place: '现场',
      interviewee: '张三',
      officerIds: [handlerMainId],
      attachmentName: '笔录.txt',
    });
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('X20');
    expect(JSON.stringify(denied.body)).toContain('处罚办法第 17 条第 2 款');
    expect(await cloned.prisma.caseInquiryRecord.count({ where: { caseId } })).toBe(0);
    expect(await trails('case.inquiry-recorded', caseId)).toEqual([
      expect.objectContaining({ outcome: 'failed', reason: 'X20' }),
    ]);

    const saved = await postJson(`/api/cases/${caseId}/inquiries`, 'P-236-H1', {
      occurredAt: '2026-10-27T01:00:00.000Z',
      place: '现场',
      interviewee: '张三',
      officerIds: [handlerMainId, handlerAssistId],
      attachmentName: '笔录.txt',
    });
    expect(saved.status).toBe(200);
    const view = await getJson(`/api/cases/${caseId}/investigation`, 'P-236-H1');
    expect(view.body.inquiries).toEqual([
      expect.objectContaining({ officerIds: [handlerMainId, handlerAssistId], attachmentName: '笔录.txt' }),
    ]);
  });

  it('作废必须有理由且仍可查询；协办不能作废；审理开始后不能作废', async () => {
    const caseId = await fileCase();
    const created = await postJson(`/api/cases/${caseId}/violations`, 'P-236-H1', {
      behaviorDescription: '硬化地面',
      parties: ['张三'],
      startedOn: '2026-10-01',
      endedOn: '2026-10-20',
      recognition: 'one-off',
    });
    expect(created.status).toBe(200);
    const recordId = String(created.body.id);
    const missing = await postJson(`/api/cases/${caseId}/violations/${recordId}/void`, 'P-236-H1', { reason: '  ' });
    expect(missing.status).toBe(400);
    expect(missing.body.reason).toBe('missing-void-reason');
    const assist = await postJson(`/api/cases/${caseId}/violations/${recordId}/void`, 'P-236-H2', { reason: '记错了' });
    expect(assist.status).toBe(409);
    expect(assist.body.reason).toBe('not-main-handler');

    await cloned.prisma.caseRecord.update({ where: { id: caseId }, data: { currentStage: 'E04' } });
    const hearing = await postJson(`/api/cases/${caseId}/violations/${recordId}/void`, 'P-236-H1', { reason: '记错了' });
    expect(hearing.status).toBe(409);
    expect(hearing.body.reason).toBe('hearing-started');
    const row = await cloned.prisma.caseViolationRecord.findUniqueOrThrow({ where: { id: recordId } });
    expect(row.status).toBe('active');

    await cloned.prisma.caseRecord.update({ where: { id: caseId }, data: { currentStage: 'E02' } });
    const voided = await postJson(`/api/cases/${caseId}/violations/${recordId}/void`, 'P-236-H1', { reason: '记错当事人' });
    expect(voided.status).toBe(200);
    const view = await getJson(`/api/cases/${caseId}/investigation`, 'P-236-H1');
    const violations = view.body.violations as Array<{ id: string; status: string; statusName: string }>;
    expect(violations).toEqual([expect.objectContaining({ id: recordId, status: 'voided', statusName: '作废' })]);
    expect(await cloned.prisma.caseViolationRecord.count({ where: { id: recordId } })).toBe(1);
  });

  it('中止不选延长也能批准，并各写一条停表和续表；中止期间调查报告呈批为 X02', async () => {
    const caseId = await fileCase();
    const view = await getJson(`/api/cases/${caseId}/investigation`, 'P-236-H1');
    expect(view.body.prompts).toMatchObject({ extendDeadline: '是否同时办延长办案期限' });
    const approved = await runProcedure(caseId, { kind: 'suspend' });
    expect(approved).toMatchObject({ status: 'in_progress', suspended: true, transitionId: 'T03' });
    expect(await deadlineEvents(caseId)).toEqual([
      { eventKind: 'stop', basisLabel: '业务不计入', basisNote: '依据待法制部门确认' },
    ]);
    const again = await postJson(`/api/cases/${caseId}/procedures`, 'P-236-H1', { kind: 'suspend' });
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('invalid-state');
    expect(await deadlineEvents(caseId)).toHaveLength(1);

    const report = await postJson(`/api/cases/${caseId}/transitions`, 'P-APPROVE-HQ', { transitionId: 'T08' });
    expect(report.status).toBe(409);
    expect(report.body.reason).toBe('X02');
    const suspended = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(suspended.suspended).toBe(true);

    const resumed = await runProcedure(caseId, { kind: 'resume' });
    expect(resumed).toMatchObject({ suspended: false, transitionId: 'T04' });
    expect(await deadlineEvents(caseId)).toEqual([
      { eventKind: 'stop', basisLabel: '业务不计入', basisNote: '依据待法制部门确认' },
      { eventKind: 'continue', basisLabel: '业务不计入', basisNote: '依据待法制部门确认' },
    ]);
    const actions = ['case.procedure-drafted', 'case.procedure-submitted', 'case.procedure-reviewed', 'case.procedure-approved', 'case.transitioned'];
    for (const action of actions) {
      const rows = await trails(action, caseId);
      expect(rows.some((row) => row.outcome === 'succeeded')).toBe(true);
    }
  });

  it('通用迁移入口不能直接套用中止', async () => {
    const caseId = await fileCase();
    const denied = await postJson(`/api/cases/${caseId}/transitions`, 'P-APPROVE-HQ', { transitionId: 'T03' });
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('procedure-required');
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.suspended).toBe(false);
    expect(await trails('case.transitioned', caseId)).toEqual([
      expect.objectContaining({ outcome: 'failed', reason: 'procedure-required' }),
    ]);
  });

  it('终止原因不在枚举内拒绝；批准后进入待收尾，通用迁移降为警告，其他呈批为 X03', async () => {
    const caseId = await fileCase();
    const bad = await postJson(`/api/cases/${caseId}/procedures`, 'P-236-H1', { kind: 'terminate', reason: 'death' });
    expect(bad.status).toBe(400);
    expect(bad.body.reason).toBe('invalid-reason');
    const approved = await runProcedure(caseId, { kind: 'terminate', reason: 'other' });
    expect(approved).toMatchObject({ status: 'terminated_pending', suspended: false });
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.status).toBe('terminated_pending');
    const moved = await postJson(`/api/cases/${caseId}/transitions`, 'P-APPROVE-HQ', { transitionId: 'T08' });
    expect(moved.status).toBe(200);
    expect(moved.body.result).toBe('warnings');
    const movedWarnings = moved.body.warnings as Array<{ code: string; ruleKey: string; message: string; level: string }>;
    expect(movedWarnings[0]).toMatchObject({
      level: 'warn',
      code: 'X03',
      ruleKey: 'X03',
      message: '待收尾状态下只能撤案或结案',
    });
    const stayed = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(stayed.status).toBe('terminated_pending');
    const draft = await postJson(`/api/cases/${caseId}/procedures`, 'P-236-H1', { kind: 'suspend' });
    expect(draft.status).toBe(200);
    expect(draft.body.result).toBe('warnings');
    expect((draft.body.warnings as Array<{ ruleKey: string }>)[0]?.ruleKey).toBe('X03');
    expect(await cloned.prisma.caseProcedureApproval.count({ where: { caseId, kind: 'suspend' } })).toBe(0);
  });

  it('确认 X03 后重提才落呈批和开链，并追加确认留痕；未知规则键 400 且不落库', async () => {
    const caseId = await fileCase();
    await runProcedure(caseId, { kind: 'terminate', reason: 'other' });
    const unknown = await postJson(`/api/cases/${caseId}/procedures`, 'P-236-H1', {
      kind: 'suspend',
      confirmedRuleKeys: ['NO-SUCH'],
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.reason).toBe('unknown-rule-key');
    expect(await cloned.prisma.caseProcedureApproval.count({ where: { caseId, kind: 'suspend' } })).toBe(0);

    const drafted = await postJson(`/api/cases/${caseId}/procedures`, 'P-236-H1', {
      kind: 'suspend',
      confirmedRuleKeys: ['X03'],
    });
    expect(drafted.status).toBe(200);
    expect(drafted.body.result).toBe('procedure-drafted');
    const draftTrail = await confirmationRows(caseId);
    expect(draftTrail).toHaveLength(1);
    expect(draftTrail[0]?.outcome).toBe('succeeded');
    const draftDetail = JSON.parse(draftTrail[0]?.detail ?? '{}') as {
      confirmerId: string;
      step: string;
      ruleKeys: Array<{ ruleKey: string; version: string }>;
      warnings: Array<{ ruleKey: string; code: string }>;
    };
    expect(draftDetail.step).toBe('procedure-draft:suspend');
    expect(draftDetail.confirmerId).toBe(handlerMainId);
    expect(draftDetail.ruleKeys).toEqual([{ ruleKey: 'X03', version: '1' }]);
    expect(draftDetail.warnings[0]?.ruleKey).toBe('X03');

    const chainHeld = await postJson(`/api/cases/${caseId}/approval-chains`, 'P-236-H1', { kind: 'suspend' });
    expect(chainHeld.status).toBe(200);
    expect(chainHeld.body.result).toBe('warnings');
    expect(await cloned.prisma.caseApprovalChain.count({ where: { caseId, kind: 'suspend' } })).toBe(0);
    const chain = await postJson(`/api/cases/${caseId}/approval-chains`, 'P-236-H1', {
      kind: 'suspend',
      confirmedRuleKeys: ['X03'],
    });
    expect(chain.status).toBe(200);
    expect(chain.body.result).toBe('approval-chain-opened');
    expect(await cloned.prisma.caseApprovalChain.count({ where: { caseId, status: 'in_flight' } })).toBe(1);
    const chainTrail = await confirmationRows(caseId);
    expect(chainTrail).toHaveLength(2);
    const chainDetail = JSON.parse(chainTrail[1]?.detail ?? '{}') as { step: string };
    expect(chainDetail.step).toBe('open-approval-chain:suspend');
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.status).toBe('terminated_pending');
  });

  it('撤案原因不对拒绝；撤案后终态，再写为 X12', async () => {
    const caseId = await fileCase();
    await runProcedure(caseId, { kind: 'terminate', reason: 'fact-not-established' });
    const bad = await postJson(`/api/cases/${caseId}/procedures`, 'P-236-H1', { kind: 'withdraw', reason: 'force-majeure' });
    expect(bad.status).toBe(409);
    expect(bad.body.reason).toBe('invalid-withdraw-reason');
    const approved = await runProcedure(caseId, { kind: 'withdraw', reason: 'limitation-expired' });
    expect(approved).toMatchObject({ status: 'withdrawn' });
    const inquiry = await postJson(`/api/cases/${caseId}/inquiries`, 'P-236-H1', {
      occurredAt: '2026-10-27T01:00:00.000Z',
      place: '现场',
      interviewee: '张三',
      officerIds: [handlerMainId, handlerAssistId],
      attachmentName: '笔录.txt',
    });
    expect(inquiry.status).toBe(409);
    expect(inquiry.body.reason).toBe('X12');
    const transition = await postJson(`/api/cases/${caseId}/transitions`, 'P-APPROVE-HQ', { transitionId: 'T03' });
    expect(transition.status).toBe(409);
    expect(transition.body.reason).toBe('X12');
  });

  it('结案选不属本部门管辖拒绝；不可抗力结案成功', async () => {
    const caseId = await fileCase();
    await runProcedure(caseId, { kind: 'terminate', reason: 'force-majeure' });
    const blocked = await postJson(`/api/cases/${caseId}/procedures`, 'P-236-H1', {
      kind: 'close',
      reason: 'outside-jurisdiction',
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.reason).toBe('branch-not-open');
    expect(blocked.body.message).toBe('该分支未开放');
    const still = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(still.status).toBe('terminated_pending');
    const approved = await runProcedure(caseId, { kind: 'close', reason: 'force-majeure' });
    expect(approved).toMatchObject({ status: 'closed' });
  });

  it('退回理由必填；退回后留痕，案件主状态不变', async () => {
    const caseId = await fileCase();
    const drafted = await postJson(`/api/cases/${caseId}/procedures`, 'P-236-H1', { kind: 'suspend', extendTogether: false });
    expect(drafted.status).toBe(200);
    const approvalId = String(drafted.body.approvalId);
    expect((await postJson(`/api/procedures/${approvalId}/submit`, 'P-236-H1')).status).toBe(200);
    const missing = await postJson(`/api/procedures/${approvalId}/return`, 'P-236-RV', { opinion: '  ' });
    expect(missing.status).toBe(400);
    expect(missing.body.reason).toBe('missing-return-reason');
    const returned = await postJson(`/api/procedures/${approvalId}/return`, 'P-236-RV', { opinion: '补材料' });
    expect(returned.status).toBe(200);
    expect(returned.body.status).toBe('drafting');
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.status).toBe('in_progress');
    expect(row.suspended).toBe(false);
    expect(await trails('case.procedure-submitted', caseId)).toEqual([expect.objectContaining({ outcome: 'succeeded' })]);
    expect(await trails('case.procedure-returned', caseId)).toEqual([
      expect.objectContaining({ outcome: 'failed', reason: 'missing-return-reason' }),
      expect.objectContaining({ outcome: 'succeeded' }),
    ]);
  });

  it('书面告知可以登记并读回', async () => {
    const caseId = await fileCase();
    const saved = await postJson(`/api/cases/${caseId}/party-notices`, 'P-236-H1', {
      occasion: 'suspend',
      note: '已书面告知当事人',
    });
    expect(saved.status).toBe(200);
    const view = await getJson(`/api/cases/${caseId}/investigation`, 'P-236-H1');
    expect(view.body.notices).toEqual([expect.objectContaining({ occasion: 'suspend', note: '已书面告知当事人' })]);
    expect(view.body.prompts).toMatchObject({ partyNotice: '须在三个工作日内书面告知当事人' });
  });

  it('调查阶段可以因已过追诉时效终止调查', async () => {
    const caseId = await fileCase();
    const approved = await runProcedure(caseId, { kind: 'terminate', reason: 'limitation-expired' });
    expect(approved).toMatchObject({ status: 'terminated_pending', transitionId: 'T05' });
  });

  it('审理开始后以已过追诉时效终止调查，只回配置的出口且不改案件', async () => {
    const caseId = await fileCase();
    await cloned.prisma.caseRecord.update({ where: { id: caseId }, data: { currentStage: 'E04' } });
    const denied = await postJson(`/api/cases/${caseId}/procedures`, 'P-236-H1', {
      kind: 'terminate',
      reason: 'limitation-expired',
    });
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('post-hearing-limitation');
    expect(denied.body.outcomeCode).toBe('O2');
    expect(denied.body.transitionId).toBe('configured-exit');
    expect(denied.body.outlet).toBe('不予行政处罚');
    expect(denied.body.applyInThisTicket).toBe(false);
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.status).toBe('in_progress');
    expect(row.currentStage).toBe('E04');
    expect(await cloned.prisma.caseProcedureApproval.count({ where: { caseId } })).toBe(0);
  });
});
