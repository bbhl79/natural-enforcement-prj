// #242 案件阶段三类移送：单独呈批、管辖记载与结案、涉刑法审闸口与停表、
// X11 结案闸口、回证补传、T30 外部决定与人工出口 A／B。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-29T06:00:00.000Z');
const nowMs = T0;
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Case-transfer-242!';
const INITIAL_PASSWORD = 'Transfer-242!!';
const PDF = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF';

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
let reviewerId = '';
let legalId = '';
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
  cert: boolean,
  posts: readonly string[] = [],
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
      posts: [...posts],
    }),
  });
  expect([200, 201]).toContain(response.status);
  const person = await cloned.prisma.personnel.findFirstOrThrow({ where: { code } });
  if (cert) {
    await cloned.prisma.personnel.update({
      where: { id: person.id },
      data: {
        enforcementCertNo: `ENF-${code}`,
        enforcementCertExpiresOn: new Date('2030-12-31T00:00:00.000Z'),
        enforcementCertStatus: 'valid',
      },
    });
  }
  await cookieOf(code, INITIAL_PASSWORD);
  return person.id;
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

async function postForm(
  path: string,
  code: string,
  fields: Record<string, string>,
  files: readonly { readonly field: string; readonly fileName: string; readonly content: string }[] = [],
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  for (const file of files) {
    form.append(file.field, new Blob([file.content], { type: 'application/pdf' }), file.fileName);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { cookie: await cookieOf(code) },
    body: form,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function getJson(path: string, code: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { cookie: await cookieOf(code) } });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function register(polygonOffset: number): Promise<{ id: string }> {
  const form = new FormData();
  form.set('sourceCode', '16');
  form.set('domain', 'land');
  form.set(
    'values',
    JSON.stringify({
      'clue.received_at': '2026-10-29',
      'clue.narrative': '巡查发现一处硬化地面',
      'clue.finder': '巡查员',
      'clue.patrol_no': `XC-242-${polygonOffset}`,
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
      cookie: await cookieOf('P-242-IN'),
      'idempotency-key': `transfer-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  return (await response.json()) as { id: string };
}

async function toHandlerAssigned(clueId: string): Promise<void> {
  const org = await postJson(`/api/clues/${clueId}/assign-org`, 'P-242-IN', {
    orgUnitId: stationAId,
    expectedStatus: 'in_pool',
    reason: '',
    designate: false,
  });
  expect(org.status).toBe(200);
  const people = await postJson(`/api/clues/${clueId}/assign-people`, 'P-242-ST', {
    mainId: handlerMainId,
    assistIds: [handlerAssistId],
    expectedStatus: 'org_assigned',
  });
  expect(people.status).toBe(200);
}

function suggestion(violationRecordId: string): Record<string, unknown> {
  return {
    violationRecordId,
    kind: 'penalty',
    penaltyCodes: ['fine'],
    fineAmount: 5000,
    discretionReason: '从轻',
    fineBases: ['土地管理法第77条'],
    basisText: '土地管理法第77条',
    comparisonReason: '',
  };
}

/** 到 E04 并签出审理意见（冻结拟决定摘要）。 */
async function toE04(): Promise<string> {
  offset += 1;
  const registered = await register(offset);
  await toHandlerAssigned(registered.id);
  const drafted = await postJson(`/api/clues/${registered.id}/filing-approval`, 'P-242-H1', {
    content: { conclusion: 'file', partyNames: ['张三'] },
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, 'P-242-H1')).status).toBe(200);
  expect((await postJson(`/api/filing-approvals/${approvalId}/review`, 'P-242-RV', { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status).toBe(200);
  const caseId = String(approved.body.caseId);

  const violation = await postJson(`/api/cases/${caseId}/violations`, 'P-242-H1', {
    behaviorDescription: '硬化地面',
    parties: ['张三'],
    startedOn: '2026-10-01',
    endedOn: '2026-10-20',
    recognition: 'one-off',
  });
  expect(violation.status).toBe(200);
  const report = await postJson(`/api/cases/${caseId}/review-reports`, 'P-242-H1', {
    content: { suggestions: [suggestion(String(violation.body.id))] },
  });
  expect(report.status, JSON.stringify(report.body)).toBe(200);
  const reportId = String(report.body.approvalId);
  expect((await postJson(`/api/review-reports/${reportId}/submit`, 'P-242-H1')).status).toBe(200);
  expect((await postJson(`/api/review-reports/${reportId}/review`, 'P-242-RV', { opinion: '同意' })).status).toBe(200);
  expect((await postJson(`/api/review-reports/${reportId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' })).status).toBe(200);
  expect(
    (await postJson(`/api/cases/${caseId}/reviewer-designations`, 'P-242-HHEAD', { personnelId: reviewerId })).status,
  ).toBe(200);
  const signed = await postJson(`/api/cases/${caseId}/review-opinions`, 'P-242-RV', {
    kind: 'penalty',
    content: '审理意见',
  });
  expect(signed.status, JSON.stringify(signed.body)).toBe(200);
  return caseId;
}

async function legalReviewPass(caseId: string): Promise<void> {
  const started = await postJson(`/api/cases/${caseId}/legal-review`, 'P-242-H1', {
    receiverId: legalId,
    manualItems: [],
    criminalTransfer: true,
  });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const legalReviewId = String(started.body.legalReviewId);
  expect(
    (await postJson(`/api/legal-reviews/${legalReviewId}/opinions`, 'P-242-L1', {
      conclusion: 'pass',
      content: '法审意见：通过',
    })).status,
  ).toBe(200);
  const concluded = await postJson(`/api/legal-reviews/${legalReviewId}/sign`, 'P-242-HEAD', { opinion: '同意' });
  expect(concluded.status, JSON.stringify(concluded.body)).toBe(200);
}

async function draftTransfer(
  caseId: string,
  code: string,
  fields: Record<string, string>,
  files: readonly { readonly field: string; readonly fileName: string; readonly content: string }[] = [],
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postForm(`/api/cases/${caseId}/transfers`, code, fields, files);
}

async function submitTransfer(
  approvalId: string,
  code = 'P-242-H1',
  confirmedRuleKeys: readonly string[] = [],
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/transfers/${approvalId}/submit`, code, { confirmedRuleKeys: [...confirmedRuleKeys] });
}

async function reviewTransfer(approvalId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/transfers/${approvalId}/review`, 'P-242-RV', { opinion: '同意' });
}

async function approveTransfer(
  approvalId: string,
  code = 'P-APPROVE-HQ',
  confirmedRuleKeys: readonly string[] = [],
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/transfers/${approvalId}/approve`, code, {
    opinion: '同意',
    confirmedRuleKeys: [...confirmedRuleKeys],
  });
}

async function runProcedure(caseId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const drafted = await postJson(`/api/cases/${caseId}/procedures`, 'P-242-H1', body);
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/procedures/${approvalId}/submit`, 'P-242-H1')).status).toBe(200);
  expect((await postJson(`/api/procedures/${approvalId}/review`, 'P-242-RV', { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/procedures/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return approved.body;
}

async function caseView(caseId: string): Promise<Record<string, unknown>> {
  return (await getJson(`/api/cases/${caseId}`, 'P-242-RV')).body;
}

async function trails(action: string, resourceId: string): Promise<Array<{ outcome: string; reason: string | null; detail: string | null }>> {
  return cloned.prisma.$queryRaw`
    SELECT outcome, reason, detail
    FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
    ORDER BY created_at ASC, id ASC
  `;
}

async function deadlineEvents(caseId: string): Promise<Array<{ eventKind: string; transitionCode: string }>> {
  return cloned.prisma.$queryRaw`
    SELECT event_kind AS "eventKind", transition_code AS "transitionCode"
    FROM case_deadline_event
    WHERE case_id = ${caseId}
    ORDER BY created_at ASC, id ASC
  `;
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const app = await createApplication(cloned.connectionString, { now: () => new Date(nowMs) }, undefined, {
    storagePort: new RecordingStorage() as never,
    queuePort: new RecordingQueue() as never,
    filingAdminReview: 'one-level',
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
  await seedPerson('P-242-IN', '甲区内勤', deptAId, ['内勤'], '13900024201', false);
  await seedPerson('P-242-ST', '甲所内勤', stationAId, ['内勤'], '13900024202', false);
  handlerMainId = await seedPerson('P-242-H1', '主办甲', stationAId, ['经办'], '13900024203', true);
  handlerAssistId = await seedPerson('P-242-H2', '协办甲', stationAId, ['经办'], '13900024204', true);
  reviewerId = await seedPerson('P-242-RV', '甲区审理人', deptAId, ['行政审核'], '13900024205', false);
  legalId = await seedPerson('P-242-L1', '甲区法审', deptAId, ['法制审核'], '13900024206', false);
  await seedPerson('P-242-HEAD', '甲区法审负责人', deptAId, ['行政审核'], '13900024207', false, ['legal-review-lead']);
  await seedPerson('P-242-HHEAD', '甲所负责人', stationAId, ['行政审批', '行政审核'], '13900024208', false);
}, 180_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  cookies.clear();
});

describe('#242 移送呈批与记载', () => {
  it('立案呈批结论不含移送；管辖移送单独呈批、批准后写记载', async () => {
    offset += 1;
    const registered = await register(offset);
    await toHandlerAssigned(registered.id);
    const bad = await postJson(`/api/clues/${registered.id}/filing-approval`, 'P-242-H1', {
      content: { conclusion: 'transfer', receivingOrg: '某局' },
    });
    expect(bad.status).toBe(400);

    const filed = await postJson(`/api/clues/${registered.id}/filing-approval`, 'P-242-H1', {
      content: { conclusion: 'file', partyNames: ['李四'] },
    });
    expect(filed.status).toBe(200);
    const filingApprovalId = String(filed.body.approvalId);
    expect((await postJson(`/api/filing-approvals/${filingApprovalId}/submit`, 'P-242-H1')).status).toBe(200);
    expect((await postJson(`/api/filing-approvals/${filingApprovalId}/review`, 'P-242-RV', { opinion: '同意' })).status).toBe(200);
    const approved = await postJson(`/api/filing-approvals/${filingApprovalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
    expect(approved.status).toBe(200);
    const caseId = String(approved.body.caseId);

    const drafted = await draftTransfer(
      caseId,
      'P-242-H1',
      {
        kind: 'jurisdiction',
        receivingOrg: '某区市场监督管理局',
        documentNo: '穗自然资移〔2026〕11 号',
        letterDate: '',
        reason: '不属本部门管辖',
      },
      [{ field: 'attachment', fileName: '移送函.pdf', content: PDF }],
    );
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
    expect(drafted.body).toMatchObject({ kind: 'jurisdiction', status: 'drafting' });
    const approvalId = String(drafted.body.approvalId);
    expect((await submitTransfer(approvalId)).status).toBe(200);
    expect((await reviewTransfer(approvalId)).status).toBe(200);
    const done = await approveTransfer(approvalId);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ kind: 'jurisdiction', currentStage: 'E02' });

    const view = await getJson(`/api/cases/${caseId}/transfers`, 'P-242-H1');
    expect(view.status).toBe(200);
    const records = view.body.transfers as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: 'jurisdiction',
      receivingOrg: '某区市场监督管理局',
      documentNo: '穗自然资移〔2026〕11 号',
      reason: '不属本部门管辖',
      receiptCount: 0,
      receiptsComplete: false,
    });
    expect(view.body.receiptsComplete).toBe(false);
    expect((await caseView(caseId)).currentStage).toBe('E02');
    expect(await cloned.prisma.caseReturn.count({ where: { caseId } })).toBe(0);
  }, 60_000);

  it('管辖移送后：不属本部门管辖结案放行；无记载时拒绝', async () => {
    offset += 1;
    const registered = await register(offset);
    await toHandlerAssigned(registered.id);
    const filed = await postJson(`/api/clues/${registered.id}/filing-approval`, 'P-242-H1', {
      content: { conclusion: 'file', partyNames: ['王五'] },
    });
    const filingApprovalId = String(filed.body.approvalId);
    expect((await postJson(`/api/filing-approvals/${filingApprovalId}/submit`, 'P-242-H1')).status).toBe(200);
    expect((await postJson(`/api/filing-approvals/${filingApprovalId}/review`, 'P-242-RV', { opinion: '同意' })).status).toBe(200);
    const approved = await postJson(`/api/filing-approvals/${filingApprovalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
    const caseId = String(approved.body.caseId);

    await runProcedure(caseId, { kind: 'terminate', reason: 'outside-jurisdiction' });
    const blocked = await postJson(`/api/cases/${caseId}/procedures`, 'P-242-H1', {
      kind: 'close',
      reason: 'outside-jurisdiction',
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toBe('结案原因为不属本部门管辖时，须已有管辖移送记载');

    const drafted = await draftTransfer(caseId, 'P-242-H1', {
      kind: 'jurisdiction',
      receivingOrg: '某市城市管理和综合执法局',
      documentNo: '穗自然资移〔2026〕12 号',
      reason: '不属本部门管辖',
    });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
    const approvalId = String(drafted.body.approvalId);
    const warned = await submitTransfer(approvalId);
    expect(warned.status).toBe(200);
    expect(warned.body.warnings).toEqual([expect.objectContaining({ code: 'X03' })]);
    expect((await submitTransfer(approvalId, 'P-242-H1', ['X03'])).status).toBe(200);
    expect((await reviewTransfer(approvalId)).status).toBe(200);
    expect((await approveTransfer(approvalId)).status).toBe(200);

    const closed = await runProcedure(caseId, { kind: 'close', reason: 'outside-jurisdiction' });
    expect(closed).toMatchObject({ status: 'closed' });
    expect((await caseView(caseId)).status).toBe('closed');
  }, 60_000);

  it('结案后补传回证成功并留痕；回证齐全查询更新', async () => {
    offset += 1;
    const registered = await register(offset);
    await toHandlerAssigned(registered.id);
    const filed = await postJson(`/api/clues/${registered.id}/filing-approval`, 'P-242-H1', {
      content: { conclusion: 'file', partyNames: ['赵六'] },
    });
    const filingApprovalId = String(filed.body.approvalId);
    expect((await postJson(`/api/filing-approvals/${filingApprovalId}/submit`, 'P-242-H1')).status).toBe(200);
    expect((await postJson(`/api/filing-approvals/${filingApprovalId}/review`, 'P-242-RV', { opinion: '同意' })).status).toBe(200);
    const approved = await postJson(`/api/filing-approvals/${filingApprovalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
    const caseId = String(approved.body.caseId);
    await runProcedure(caseId, { kind: 'terminate', reason: 'outside-jurisdiction' });
    const drafted = await draftTransfer(caseId, 'P-242-H1', {
      kind: 'jurisdiction',
      receivingOrg: '某区农业农村局',
      documentNo: '穗自然资移〔2026〕13 号',
      reason: '不属本部门管辖',
    });
    const approvalId = String(drafted.body.approvalId);
    await submitTransfer(approvalId, 'P-242-H1', ['X03']);
    await reviewTransfer(approvalId);
    expect((await approveTransfer(approvalId)).status).toBe(200);
    await runProcedure(caseId, { kind: 'close', reason: 'outside-jurisdiction' });

    const transferId = String(
      ((await getJson(`/api/cases/${caseId}/transfers`, 'P-242-H1')).body.transfers as Array<Record<string, unknown>>)[0].id,
    );
    const uploaded = await postForm(`/api/cases/${caseId}/transfers/${transferId}/receipts`, 'P-242-H1', {}, [
      { field: 'receipt', fileName: '回证.pdf', content: PDF },
    ]);
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(200);
    expect(uploaded.body).toMatchObject({ result: 'receipt-uploaded', fileCount: 1, receiptsComplete: true });
    expect((await trails('case.transfer-receipt-uploaded', caseId)).length).toBe(1);
    const view = await getJson(`/api/cases/${caseId}/transfers`, 'P-242-H1');
    expect(view.body.receiptsComplete).toBe(true);

    await cloned.prisma.caseRecord.update({ where: { id: caseId }, data: { status: 'finalized' } });
    const denied = await postForm(`/api/cases/${caseId}/transfers/${transferId}/receipts`, 'P-242-H1', {}, [
      { field: 'receipt', fileName: '再补.pdf', content: PDF },
    ]);
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('X12');
  }, 60_000);
it('党纪政务移送：不要求法审，批准即记载、侧链不改环节', async () => {
    const caseId = await toE04();
    const drafted = await draftTransfer(caseId, 'P-242-H1', {
      kind: 'party-discipline',
      receivingOrg: '某区纪委监委',
      documentNo: '穗自然资移〔2026〕31 号',
      reason: '需追究党纪政务责任',
    });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
    const approvalId = String(drafted.body.approvalId);
    expect((await submitTransfer(approvalId)).status).toBe(200);
    expect((await reviewTransfer(approvalId)).status).toBe(200);
    const approved = await approveTransfer(approvalId);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({ kind: 'party-discipline', currentStage: 'E04' });
    const view = await getJson(`/api/cases/${caseId}/transfers`, 'P-242-H1');
    expect((view.body.transfers as Array<Record<string, unknown>>)[0]).toMatchObject({ kind: 'party-discipline' });
    expect((await caseView(caseId)).currentStage).toBe('E04');
    const gate = await postJson(`/api/cases/${caseId}/closeout-gate`, 'P-APPROVE-HQ');
    expect(gate.status).toBe(200);
  }, 90_000);
});

describe('#242 涉刑移送与 X11', () => {
  it('未法审通过批准 409；法审通过后批准；三个工作日提示；停表事件', async () => {
    const caseId = await toE04();
    const drafted = await draftTransfer(caseId, 'P-242-H1', {
      kind: 'criminal',
      receivingOrg: '某市公安局某分局',
      documentNo: '穗自然资移〔2026〕21 号',
      letterDate: '2026-10-29',
      reason: '涉嫌非法占用农用地罪',
    });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
    const approvalId = String(drafted.body.approvalId);

    // 附录 A「呈批前须法审通过」：未取得法审通过时提交即 409。
    const blocked = await submitTransfer(approvalId);
    expect(blocked.status).toBe(409);
    expect(blocked.body.reason).toBe('legal-review-required');
    expect((await trails('case.transfer-submitted', caseId))[0]).toMatchObject({ outcome: 'failed', reason: 'legal-review-required' });

    await legalReviewPass(caseId);
    const submitted = await submitTransfer(approvalId);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(typeof submitted.body.decisionDueOn).toBe('string');
    expect((await reviewTransfer(approvalId)).status).toBe(200);

    const gate = await postJson(`/api/cases/${caseId}/closeout-gate`, 'P-APPROVE-HQ');
    expect(gate.status).toBe(409);
    expect(gate.body.reason).toBe('X11');

    const approved = await approveTransfer(approvalId);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({ kind: 'criminal', kindName: '涉刑移送' });

    const events = await deadlineEvents(caseId);
    expect(events).toEqual([expect.objectContaining({ eventKind: 'stop', transitionCode: 'T29' })]);
    const rows = await cloned.prisma.caseDeadlineRow.findMany({
      where: { caseId, ruleKey: 'criminal-transfer.decision' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dayCount).toBe(3);
    expect(rows[0]?.dayBasis).toBe('working');
    const markers = await getJson(`/api/cases/${caseId}/markers`, 'P-242-RV');
    expect(markers.body.active).toEqual(expect.arrayContaining(['criminal-transfer']));

    const passed = await postJson(`/api/cases/${caseId}/closeout-gate`, 'P-APPROVE-HQ');
    expect(passed.status).toBe(200);
    expect(passed.body.receiptsComplete).toBe(false);
  }, 90_000);

  it('T30 记载只追加；不进退回列表；出口互斥；A 回 E02 次序号加 1；B 不前移', async () => {
    const caseId = await toE04();
    const drafted = await draftTransfer(caseId, 'P-242-H1', {
      kind: 'criminal',
      receivingOrg: '某市公安局某分局',
      documentNo: '穗自然资移〔2026〕22 号',
      reason: '涉嫌犯罪',
    });
    const approvalId = String(drafted.body.approvalId);
    await legalReviewPass(caseId);
    expect((await submitTransfer(approvalId)).status).toBe(200);
    expect((await reviewTransfer(approvalId)).status).toBe(200);
    expect((await approveTransfer(approvalId)).status).toBe(200);
    const stageAfterTransfer = (await caseView(caseId)).currentStage;

    const recorded = await postJson(`/api/cases/${caseId}/criminal-decisions`, 'P-242-H1', {
      source: 'police',
      notifiedOn: '2026-10-28',
      reason: '不予立案，退回案卷',
      caseReturned: true,
      returnedList: ['案卷一卷'],
      reviewRequested: true,
      reviewOn: '2026-10-29',
      reviewResult: '已提请复议',
    });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200);
    expect(recorded.body.warnings).toEqual([expect.objectContaining({ level: 'warn', code: 'criminal-decision.review' })]);
    expect((await caseView(caseId)).currentStage).toBe(stageAfterTransfer);
    expect(await cloned.prisma.caseReturn.count({ where: { caseId } })).toBe(0);

    const second = await postJson(`/api/cases/${caseId}/criminal-decisions`, 'P-242-H1', {
      source: 'procuratorate',
      notifiedOn: '2026-10-29',
      reason: '不构成犯罪',
      caseReturned: false,
    });
    expect(second.status).toBe(200);
    const decisions = (await getJson(`/api/cases/${caseId}/transfers`, 'P-242-H1')).body.criminalDecisions as Array<
      Record<string, unknown>
    >;
    expect(decisions).toHaveLength(2);

    const decisionId = String(recorded.body.decisionId);
    const outletB = await postJson(`/api/cases/${caseId}/criminal-decisions/${decisionId}/outlets`, 'P-242-H1', {
      outlet: 'close-or-other',
      reason: '依法结案',
    });
    expect(outletB.status, JSON.stringify(outletB.body)).toBe(200);
    const outletBId = String(outletB.body.outletId);
    expect((await postJson(`/api/criminal-outlets/${outletBId}/submit`, 'P-242-H1')).status).toBe(200);

    const conflicting = await postJson(`/api/cases/${caseId}/criminal-decisions/${decisionId}/outlets`, 'P-242-H1', {
      outlet: 'investigate-again',
      illegalStateCleared: 'no',
      illegalStateNote: '违法状态仍未消除',
      penaltyBasis: '土地管理法第77条',
    });
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.reason).toBe('outlet-conflict');

    const approvedB = await postJson(`/api/criminal-outlets/${outletBId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
    expect(approvedB.status, JSON.stringify(approvedB.body)).toBe(200);
    expect((await caseView(caseId)).currentStage).toBe(stageAfterTransfer);
    expect(await deadlineEvents(caseId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventKind: 'continue', transitionCode: 'T30' })]),
    );

    const secondDecisionId = String(second.body.decisionId);
    const outletA = await postJson(`/api/cases/${caseId}/criminal-decisions/${secondDecisionId}/outlets`, 'P-242-H1', {
      outlet: 'investigate-again',
      illegalStateCleared: 'no',
      illegalStateNote: '违法状态仍未消除',
      penaltyBasis: '土地管理法第77条',
    });
    expect(outletA.status, JSON.stringify(outletA.body)).toBe(200);
    const outletAId = String(outletA.body.outletId);
    expect((await postJson(`/api/criminal-outlets/${outletAId}/submit`, 'P-242-H1')).status).toBe(200);
    const approvedA = await postJson(`/api/criminal-outlets/${outletAId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
    expect(approvedA.status, JSON.stringify(approvedA.body)).toBe(200);
    expect(approvedA.body).toMatchObject({ currentStage: 'E02', stageEntrySeq: 2, continued: true });
    const view = await caseView(caseId);
    expect(view.currentStage).toBe('E02');
    expect(view.stageEntrySeq).toBe(2);
    expect(await cloned.prisma.caseReturn.count({ where: { caseId } })).toBe(0);
  }, 120_000);
});