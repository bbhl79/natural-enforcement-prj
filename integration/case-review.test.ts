// #240 调查终结与审理：T08 报告呈批、审理人指定与更换、case.review.record、T09 回流、T09a 异议呈批。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-27T06:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Case-review-240!';
const INITIAL_PASSWORD = 'Review-240!!';
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
let deptBId = '';
let handlerMainId = '';
let dualId = '';
let reviewerId = '';
let reviewer2Id = '';
let conflictedId = '';
let outOfScopeId = '';
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
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/admin/personnel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-ADMIN-HQ') },
    body: JSON.stringify({ code, name, orgUnitId, mobilePhone, initialPassword: INITIAL_PASSWORD, roles: [...roles] }),
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
      'clue.patrol_no': `XC-240-${polygonOffset}`,
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
      cookie: await cookieOf('P-240-IN'),
      'idempotency-key': `review-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  return (await response.json()) as { id: string };
}

async function toHandlerAssigned(clueId: string): Promise<void> {
  const org = await fetch(`${baseUrl}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-240-IN') },
    body: JSON.stringify({ orgUnitId: stationAId, expectedStatus: 'in_pool', reason: '', designate: false }),
  });
  expect(org.status).toBe(200);
  const people = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-240-ST') },
    body: JSON.stringify({ mainId: handlerMainId, assistIds: [dualId], expectedStatus: 'org_assigned' }),
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
  const drafted = await postJson(`/api/clues/${registered.id}/filing-approval`, 'P-240-H1', {
    content: { conclusion: 'file', partyNames: ['张三'] },
  });
  expect(drafted.status).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, 'P-240-H1')).status).toBe(200);
  expect((await postJson(`/api/filing-approvals/${approvalId}/review`, 'P-240-RV', { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status).toBe(200);
  return String(approved.body.caseId);
}

async function addViolation(caseId: string, description: string): Promise<string> {
  const created = await postJson(`/api/cases/${caseId}/violations`, 'P-240-H1', {
    behaviorDescription: description,
    parties: ['张三'],
    startedOn: '2026-10-01',
    endedOn: '2026-10-20',
    recognition: 'one-off',
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  return String(created.body.id);
}

function penaltySuggestion(violationRecordId: string, overrides: Record<string, unknown> = {}) {
  return {
    violationRecordId,
    kind: 'penalty',
    penaltyCodes: ['fine'],
    fineAmount: 5000,
    discretionReason: '从轻',
    fineBases: ['土地管理法第77条'],
    basisText: '土地管理法第77条',
    comparisonReason: '',
    ...overrides,
  };
}

async function saveReport(
  caseId: string,
  suggestions: readonly Record<string, unknown>[],
  reviewerIdValue?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/cases/${caseId}/review-reports`, 'P-240-H1', {
    content: { suggestions, ...(reviewerIdValue ? { reviewerId: reviewerIdValue } : {}) },
  });
}

async function submitReport(approvalId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/review-reports/${approvalId}/submit`, 'P-240-H1');
}

async function reviewReport(approvalId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/review-reports/${approvalId}/review`, 'P-240-RV', { opinion: '同意' });
}

async function approveReport(
  approvalId: string,
  approver: string,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/review-reports/${approvalId}/approve`, approver, { opinion: '同意', ...extra });
}

/** 一条违法记录 → 报告 → 审批通过 → E04。返回案件与报告。 */
async function toE04(
  options: { reviewerId?: string; approver?: string; kind?: 'penalty' | 'no-penalty' | 'fact-not-established' } = {},
): Promise<{ caseId: string; violationId: string; reportId: string }> {
  const caseId = await fileCase();
  const violationId = await addViolation(caseId, '硬化地面');
  const suggestion =
    options.kind === 'penalty' || options.kind === undefined
      ? penaltySuggestion(violationId)
      : { violationRecordId: violationId, kind: options.kind };
  const drafted = await saveReport(caseId, [suggestion], options.reviewerId);
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const reportId = String(drafted.body.approvalId);
  expect((await submitReport(reportId)).status).toBe(200);
  expect((await reviewReport(reportId)).status).toBe(200);
  const approved = await approveReport(reportId, options.approver ?? 'P-APPROVE-HQ', {
    ...(options.reviewerId ? { reviewerId: options.reviewerId } : {}),
  });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return { caseId, violationId, reportId };
}

async function designate(
  caseId: string,
  code: string,
  personnelId: string,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/cases/${caseId}/reviewer-designations`, code, { personnelId, ...extra });
}

async function sign(
  caseId: string,
  code: string,
  kind: string,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/cases/${caseId}/review-opinions`, code, { kind, content: `意见：${kind}`, ...extra });
}

async function caseState(caseId: string): Promise<Record<string, unknown>> {
  return (await getJson(`/api/cases/${caseId}`, 'P-240-RV')).body;
}

async function trails(action: string, resourceId: string): Promise<Array<{ outcome: string; reason: string | null; detail: string | null }>> {
  return cloned.prisma.$queryRaw<Array<{ outcome: string; reason: string | null; detail: string | null }>>`
    SELECT outcome, reason, detail
    FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
    ORDER BY created_at ASC, id ASC
  `;
}

async function confirmationRows(resourceId: string): Promise<Array<{ detail: string | null }>> {
  return cloned.prisma.$queryRaw<Array<{ detail: string | null }>>`
    SELECT detail
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
  deptBId = await orgOf('ORG-DEPT-B');
  stationAId = await orgOf('ORG-STATION-A');
  await seedPerson('P-240-IN', '甲区内勤', deptAId, ['内勤'], '13900024001', false);
  await seedPerson('P-240-ST', '甲所内勤', stationAId, ['内勤'], '13900024002', false);
  handlerMainId = await seedPerson('P-240-H1', '主办甲', stationAId, ['经办'], '13900024003', true);
  dualId = await seedPerson('P-240-DUAL', '协办兼审核', stationAId, ['经办', '行政审核'], '13900024004', true);
  reviewerId = await seedPerson('P-240-RV', '所内审核', stationAId, ['行政审核'], '13900024005', false);
  reviewer2Id = await seedPerson('P-240-RV2', '所内审核二', stationAId, ['行政审核'], '13900024006', false);
  conflictedId = await seedPerson('P-240-IMP', '回避审核', stationAId, ['行政审核'], '13900024007', false);
  outOfScopeId = await seedPerson('P-240-OUT', '乙区审核', deptBId, ['行政审核'], '13900024008', false);
  await seedPerson('P-240-HEAD', '甲所负责人', stationAId, ['行政审批', '行政审核'], '13900024009', false);
}, 180_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  cookies.clear();
});

describe('#240 T08 调查报告呈批', () => {
  it('未指定审理人也能批准；此时签出审理意见 409「尚未指定审理人」', async () => {
    const { caseId } = await toE04();
    const state = await caseState(caseId);
    expect(state.currentStage).toBe('E04');

    const signed = await sign(caseId, 'P-240-RV', 'penalty');
    expect(signed.status).toBe(409);
    expect(signed.body.reason).toBe('reviewer-not-designated');
    expect(signed.body.message).toBe('尚未指定审理人');
    expect(await trails('case.review-recorded', caseId)).toEqual([
      expect.objectContaining({ outcome: 'failed', reason: 'reviewer-not-designated' }),
    ]);
  });

  it('批准时由承办机构负责人指定审理人；被指定人可签出', async () => {
    const { caseId } = await toE04({ reviewerId, approver: 'P-240-HEAD' });
    const view = await getJson(`/api/cases/${caseId}/review`, 'P-240-HEAD');
    expect(view.body.reviewer).toMatchObject({ personnelId: reviewerId });
    const signed = await sign(caseId, 'P-240-RV', 'penalty');
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect(signed.body.frozen).toBe(true);
  });

  it('中止中提调查报告 409 X02', async () => {
    const caseId = await fileCase();
    const suspension = await postJson(`/api/cases/${caseId}/procedures`, 'P-240-H1', { kind: 'suspend', extendTogether: false });
    expect(suspension.status).toBe(200);
    const procedureId = String(suspension.body.approvalId);
    expect((await postJson(`/api/procedures/${procedureId}/submit`, 'P-240-H1')).status).toBe(200);
    expect((await postJson(`/api/procedures/${procedureId}/review`, 'P-240-RV', { opinion: '同意' })).status).toBe(200);
    expect((await postJson(`/api/procedures/${procedureId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' })).status).toBe(200);

    const violationId = await addViolation(caseId, '硬化地面');
    const drafted = await saveReport(caseId, [penaltySuggestion(violationId)]);
    expect(drafted.status).toBe(200);
    const submitted = await submitReport(String(drafted.body.approvalId));
    expect(submitted.status).toBe(409);
    expect(submitted.body.reason).toBe('X02');
    expect(JSON.stringify(submitted.body)).toContain('中止期间不能推进到调查终结及以后');
    expect(await trails('case.review-report-submitted', caseId)).toEqual([
      expect.objectContaining({ outcome: 'failed', reason: 'X02' }),
    ]);
  });

  it('有有效违法记录未写处理建议 409；罚款竞合未写比对理由 409', async () => {
    const caseId = await fileCase();
    const first = await addViolation(caseId, '硬化地面');
    const second = await addViolation(caseId, '堆放材料');
    const drafted = await saveReport(caseId, [penaltySuggestion(first)]);
    expect(drafted.status).toBe(200);
    const reportId = String(drafted.body.approvalId);
    const missing = await submitReport(reportId);
    expect(missing.status).toBe(409);
    expect(missing.body.reason).toBe('missing-handling-suggestion');
    expect(missing.body.missingViolationIds).toHaveLength(1);
    expect(await cloned.prisma.caseApprovalChain.count({ where: { caseId } })).toBe(0);

    const competition = await saveReport(caseId, [
      penaltySuggestion(first, { fineBases: ['土地管理法第77条', '基本农田保护条例第33条'] }),
      { violationRecordId: second, kind: 'no-penalty' },
    ]);
    expect(competition.status).toBe(200);
    const rejected = await submitReport(String(competition.body.approvalId));
    expect(rejected.status).toBe(409);
    expect(rejected.body.reason).toBe('fine-competition-reason-missing');
  });
});

describe('#240 指定与更换审理人', () => {
  it('无行政审核、有回避声明、任职机构不覆盖：409 且写失败留痕', async () => {
    const { caseId } = await toE04();

    const noRole = await designate(caseId, 'P-240-HEAD', handlerMainId);
    expect(noRole.status).toBe(409);
    expect(noRole.body.reason).toBe('reviewer-not-admin-reviewer');

    const outOfScope = await designate(caseId, 'P-240-HEAD', outOfScopeId);
    expect(outOfScope.status).toBe(409);
    expect(outOfScope.body.reason).toBe('reviewer-org-not-covered');

    const declared = await postJson(`/api/cases/${caseId}/conflicts`, 'P-240-H1', {
      personId: conflictedId,
      source: 'other',
      reason: '有利害关系',
    });
    expect(declared.status).toBe(200);
    const conflicted = await designate(caseId, 'P-240-HEAD', conflictedId);
    expect(conflicted.status).toBe(409);
    expect(conflicted.body.reason).toBe('reviewer-conflict-active');

    expect((await trails('case.reviewer-designated', caseId)).filter((row) => row.outcome === 'failed')).toHaveLength(3);
    expect(await cloned.prisma.caseReviewerDesignation.count({ where: { caseId } })).toBe(0);
  });

  it('指定本案协办为审理人：警告 200 不落业务行；不填理由被拒；填理由并确认后成功且入审计', async () => {
    const { caseId } = await toE04();
    const first = await designate(caseId, 'P-240-HEAD', dualId);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      result: 'warnings',
      warnings: [expect.objectContaining({ code: 'REVIEW-SEPARATION', ruleKey: 'REVIEW-SEPARATION' })],
    });
    expect(await cloned.prisma.caseReviewerDesignation.count({ where: { caseId } })).toBe(0);

    const noReason = await designate(caseId, 'P-240-HEAD', dualId, { confirmedRuleKeys: ['REVIEW-SEPARATION'] });
    expect(noReason.status).toBe(400);
    expect(noReason.body.reason).toBe('missing-confirm-reason');

    const confirmed = await designate(caseId, 'P-240-HEAD', dualId, {
      confirmedRuleKeys: ['REVIEW-SEPARATION'],
      confirmReasons: { 'REVIEW-SEPARATION': '负责人指定协助审理' },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.result).toBe('reviewer-designated');
    expect(await cloned.prisma.caseReviewerDesignation.count({ where: { caseId } })).toBe(1);
    const confirmations = await confirmationRows(caseId);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]?.detail).toContain('负责人指定协助审理');
    expect(confirmations[0]?.detail).toContain('REVIEW-SEPARATION');
  });

  it('负责人指定本人：成功，本人可签出审理意见', async () => {
    const { caseId } = await toE04();
    const designated = await designate(caseId, 'P-240-HEAD', (await cloned.prisma.personnel.findFirstOrThrow({ where: { code: 'P-240-HEAD' } })).id);
    expect(designated.status).toBe(200);
    const signed = await sign(caseId, 'P-240-HEAD', 'penalty');
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
  });

  it('批准后补指定；签出前更换理由必填，旧指定可查；签出后更换 409', async () => {
    const { caseId } = await toE04();
    const first = await designate(caseId, 'P-240-HEAD', reviewerId);
    expect(first.status).toBe(200);
    const firstId = String(first.body.designationId);

    const missingReason = await designate(caseId, 'P-240-HEAD', reviewer2Id);
    expect(missingReason.status).toBe(400);
    expect(missingReason.body.reason).toBe('missing-reason');

    const replaced = await designate(caseId, 'P-240-HEAD', reviewer2Id, { reason: '原审理人回避' });
    expect(replaced.status).toBe(200);
    expect(replaced.body.replacedId).toBe(firstId);
    const view = await getJson(`/api/cases/${caseId}/review`, 'P-240-HEAD');
    expect(view.body.reviewer).toMatchObject({ personnelId: reviewer2Id, reason: '原审理人回避' });
    const designations = view.body.designations as Array<Record<string, unknown>>;
    expect(designations.find((row) => row.id === firstId)?.active).toBe(false);
    expect(designations.find((row) => row.id === replaced.body.designationId)?.active).toBe(true);
    expect(designations).toHaveLength(2);

    expect((await sign(caseId, 'P-240-RV2', 'penalty')).status).toBe(200);
    const late = await designate(caseId, 'P-240-HEAD', reviewerId, { reason: '再换' });
    expect(late.status).toBe(409);
    expect(late.body.reason).toBe('invalid-state');
  });
});

describe('#240 审理意见签出守卫', () => {
  it('非被指定人 409 X32；无行政审核 409 X23；被指定人成功', async () => {
    const { caseId } = await toE04();
    expect((await designate(caseId, 'P-240-HEAD', reviewerId)).status).toBe(200);

    const other = await sign(caseId, 'P-240-RV2', 'penalty');
    expect(other.status).toBe(409);
    expect(other.body.reason).toBe('X32');

    const noRole = await sign(caseId, 'P-240-H1', 'penalty');
    expect(noRole.status).toBe(409);
    expect(noRole.body.reason).toBe('X23');

    expect((await sign(caseId, 'P-240-RV', 'penalty')).status).toBe(200);
  });

  it('本案承办人员签出：警告 200 走两段式，不落业务行；确认后成功', async () => {
    const { caseId } = await toE04();
    const designated = await designate(caseId, 'P-240-HEAD', dualId, {
      confirmedRuleKeys: ['REVIEW-SEPARATION'],
      confirmReasons: { 'REVIEW-SEPARATION': '负责人指定协助审理' },
    });
    expect(designated.status).toBe(200);

    const warned = await sign(caseId, 'P-240-DUAL', 'penalty');
    expect(warned.status).toBe(200);
    expect(warned.body).toEqual({
      result: 'warnings',
      warnings: [expect.objectContaining({ code: 'X22', ruleKey: 'X22' })],
    });
    expect(await cloned.prisma.caseReviewOpinion.count({ where: { caseId } })).toBe(0);

    const confirmed = await sign(caseId, 'P-240-DUAL', 'penalty', { confirmedRuleKeys: ['X22'] });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.frozen).toBe(true);
    expect((await confirmationRows(caseId)).some((row) => row.detail?.includes('"X22"'))).toBe(true);
  });

  it('被指定审理人有回避声明：签出 409「声明期间签出被拒」', async () => {
    const { caseId } = await toE04();
    expect((await designate(caseId, 'P-240-HEAD', reviewerId)).status).toBe(200);
    expect((await postJson(`/api/cases/${caseId}/conflicts`, 'P-240-H1', {
      personId: reviewerId,
      source: 'other',
      reason: '有利害关系',
    })).status).toBe(200);
    const refused = await sign(caseId, 'P-240-RV', 'penalty');
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('声明期间签出被拒');
    expect(await trails('case.sign-refused', caseId)).toEqual([
      expect.objectContaining({ outcome: 'failed', reason: 'conflict-active' }),
    ]);
    expect(await cloned.prisma.caseReviewOpinion.count({ where: { caseId } })).toBe(0);
  });
});

describe('#240 T09 回流与锚点', () => {
  it('补充调查：回 E02、次序号加 1、退回 R2、旧实例失效、新锚点且 90 日到期日不变', async () => {
    const { caseId, reportId } = await toE04();
    expect((await designate(caseId, 'P-240-HEAD', reviewerId)).status).toBe(200);
    const before = await getJson(`/api/cases/${caseId}/deadlines`, 'P-240-HEAD');
    const beforeRows = (before.body.rows as Array<Record<string, unknown>>).filter((row) => row.ruleKey === 'case.handle');
    expect(beforeRows).toHaveLength(1);
    const dueOn = beforeRows[0]?.dueOn;

    const signed = await sign(caseId, 'P-240-RV', 'supplementary-investigation');
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect(signed.body).toMatchObject({ destinationCode: 'T09', currentStage: 'E02', stageEntrySeq: 2 });
    expect(signed.body.opinionId).toBeTruthy();
    expect(await cloned.prisma.caseReviewOpinion.count({ where: { caseId, opinionKind: 'supplementary-investigation' } })).toBe(1);

    const state = await caseState(caseId);
    expect(state.currentStage).toBe('E02');
    expect(state.stageEntrySeq).toBe(2);
    const returns = state.returns as Array<Record<string, unknown>>;
    expect(returns).toEqual([
      expect.objectContaining({ reasonCode: 'R2', reflow: true, entrySeqBefore: 1, entrySeqAfter: 2, receiverId: handlerMainId }),
    ]);
    const instances = state.instances as Array<Record<string, unknown>>;
    const oldE04 = instances.find((row) => row.stage === 'E04' && row.entrySeq === 1);
    expect(oldE04?.invalidated).toBe(true);
    const newE02 = instances.find((row) => row.stage === 'E02' && row.entrySeq === 2);
    expect(newE02).toMatchObject({ status: 'drafting', transitionCode: 'T09', invalidated: false });

    const rows = await cloned.prisma.caseDeadlineRow.findMany({ where: { caseId, ruleKey: 'case.handle' }, orderBy: { entrySeq: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.entrySeq, row.procedureNode, row.startedOn.toISOString().slice(0, 10), row.dueOn?.toISOString().slice(0, 10)])).toEqual([
      [1, 'E02', '2026-10-27', dueOn],
      [2, 'E02', '2026-10-27', dueOn],
    ]);

    // 回来后再提报告须重新审理：新 E04 没有在任指定，签出 409。
    const second = await saveReport(caseId, [penaltySuggestion((await cloned.prisma.caseViolationRecord.findFirstOrThrow({ where: { caseId } })).id)]);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    const secondId = String(second.body.approvalId);
    expect((await submitReport(secondId)).status).toBe(200);
    expect((await reviewReport(secondId)).status).toBe(200);
    const approved = await approveReport(secondId, 'P-APPROVE-HQ');
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const again = await caseState(caseId);
    expect(again.currentStage).toBe('E04');
    expect(again.stageEntrySeq).toBe(2);
    const noDesignation = await sign(caseId, 'P-240-RV', 'penalty');
    expect(noDesignation.status).toBe(409);
    expect(noDesignation.body.reason).toBe('reviewer-not-designated');

    const opinions = (await getJson(`/api/cases/${caseId}/review`, 'P-240-RV')).body.opinions as Array<Record<string, unknown>>;
    expect(opinions).toEqual([expect.objectContaining({ kind: 'supplementary-investigation', destinationCode: 'T09' })]);
    expect(reportId).toBeTruthy();
  });

  it('修改纠正：同样回 E02、次序号加 1，留痕意见类型单独记载', async () => {
    const { caseId } = await toE04();
    expect((await designate(caseId, 'P-240-HEAD', reviewerId)).status).toBe(200);
    expect((await getJson(`/api/cases/${caseId}/deadlines`, 'P-240-HEAD')).status).toBe(200);
    const signed = await sign(caseId, 'P-240-RV', 'correction');
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect(signed.body.destinationCode).toBe('T09');
    const opinion = await cloned.prisma.caseReviewOpinion.findFirstOrThrow({ where: { caseId } });
    expect(opinion.opinionKind).toBe('correction');
    expect(opinion.destinationCode).toBe('T09');
    const state = await caseState(caseId);
    expect(state.currentStage).toBe('E02');
    expect(state.stageEntrySeq).toBe(2);
    expect((state.returns as Array<Record<string, unknown>>)[0]).toMatchObject({ reasonCode: 'R2', entrySeqAfter: 2 });
    const rows = await cloned.prisma.caseDeadlineRow.findMany({ where: { caseId, ruleKey: 'case.handle' } });
    expect(rows.map((row) => row.dueOn?.toISOString().slice(0, 10))).toEqual([
      rows[0]?.dueOn?.toISOString().slice(0, 10),
      rows[0]?.dueOn?.toISOString().slice(0, 10),
    ]);
  });

  it('不存在 E04→E03 迁移：E04 尝试 T08 返回 409', async () => {
    const { caseId } = await toE04();
    const attempt = await postJson(`/api/cases/${caseId}/transitions`, 'P-240-HEAD', { transitionId: 'T08' });
    expect(attempt.status).toBe(409);
    expect(attempt.body.reason).toBe('invalid-state');
    expect((await caseState(caseId)).currentStage).toBe('E04');
  });
});

describe('#240 审理通过、冻结与时效出口', () => {
  it('拟处罚：冻结拟决定摘要，停留在 E04；再签出 409；之后再修改须回流', async () => {
    const { caseId } = await toE04();
    expect((await designate(caseId, 'P-240-HEAD', reviewerId)).status).toBe(200);
    const signed = await sign(caseId, 'P-240-RV', 'penalty');
    expect(signed.status).toBe(200);
    expect(signed.body).toMatchObject({ destinationCode: 'T10', currentStage: 'E04', frozen: true });
    const frozen = await cloned.prisma.caseFrozenDecision.findFirstOrThrow({ where: { caseId } });
    expect(frozen.summaryJson).toContain('"kind":"penalty"');
    expect(frozen.summaryJson).toContain('"fineAmount":5000');
    expect((await getJson(`/api/cases/${caseId}/review`, 'P-240-RV')).body.frozenDecision).toMatchObject({
      summary: expect.objectContaining({ kind: 'penalty', destinationCode: 'T10' }),
    });
    const again = await sign(caseId, 'P-240-RV', 'penalty');
    expect(again.status).toBe(409);
    expect(again.body.message).toBe('审理已通过，修改须回流');
    expect(await cloned.prisma.caseReviewOpinion.count({ where: { caseId } })).toBe(1);
  });

  it('事实不成立：T12 去向、O2，本票不执行 T12', async () => {
    const { caseId } = await toE04();
    expect((await designate(caseId, 'P-240-HEAD', reviewerId)).status).toBe(200);
    const signed = await sign(caseId, 'P-240-RV', 'fact-not-established');
    expect(signed.status).toBe(200);
    expect(signed.body).toMatchObject({ destinationCode: 'T12', outcomeCode: 'O2', outcomeLabel: '不予行政处罚', currentStage: 'E04' });
    const state = await caseState(caseId);
    expect(state.currentStage).toBe('E04');
    expect(state.status).toBe('in_progress');
  });

  it('已过追诉时效：出口取配置映射（configured-exit／O2），不撤案（X15）', async () => {
    const { caseId } = await toE04();
    expect((await designate(caseId, 'P-240-HEAD', reviewerId)).status).toBe(200);
    const signed = await sign(caseId, 'P-240-RV', 'limitation-expired');
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect(signed.body).toMatchObject({ destinationCode: 'configured-exit', outcomeCode: 'O2', outcomeLabel: '不予行政处罚', currentStage: 'E04' });
    const stored = await cloned.prisma.caseReviewOpinion.findFirstOrThrow({ where: { caseId } });
    expect(stored.destinationCode).toBe('configured-exit');
    expect(stored.outcomeCode).toBe('O2');
    const detail = JSON.parse((await trails('case.review-recorded', caseId))[0]?.detail ?? '{}') as Record<string, unknown>;
    expect(detail).toMatchObject({ outcomeCode: 'O2', transitionId: 'configured-exit', applyInThisTicket: false });

    // X15：审理开始后不能走撤案。
    const withdraw = await postJson(`/api/cases/${caseId}/procedures`, 'P-240-H1', { kind: 'withdraw', reason: 'limitation-expired' });
    expect(withdraw.status).toBe(409);
    expect(withdraw.body.reason).toBe('post-hearing-limitation');
    expect(JSON.stringify(withdraw.body)).toContain('审理开始后已过追诉时效不在本环节办结');
  });
});

describe('#240 T09a 审理异议呈批', () => {
  it('补充调查与修改纠正同一套参数：可拟制、提交并由负责人决定；异议不在退回列表', async () => {
    for (const kind of ['supplementary-investigation', 'correction'] as const) {
      const { caseId } = await toE04();
      expect((await designate(caseId, 'P-240-HEAD', reviewerId)).status).toBe(200);
      expect((await sign(caseId, 'P-240-RV', kind)).status).toBe(200);
      const beforeReturns = (await caseState(caseId)).returns as Array<Record<string, unknown>>;

      const drafted = await postJson(`/api/cases/${caseId}/review-objections`, 'P-240-H1', {
        note: '已补充证据，不同意补充调查',
        evidenceRefs: ['ev-1'],
      });
      expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
      const objectionId = String(drafted.body.objectionId);
      expect((await postJson(`/api/review-objections/${objectionId}/submit`, 'P-240-H1')).status).toBe(200);
      const decided = await postJson(`/api/review-objections/${objectionId}/decide`, 'P-APPROVE-HQ', {
        decision: 'support-handler',
        note: '采纳承办人员意见',
        decisionTransition: 'T11',
      });
      expect(decided.status, JSON.stringify(decided.body)).toBe(200);
      expect(decided.body).toMatchObject({ decision: 'support-handler', decisionTransition: 'T11' });

      const view = await getJson(`/api/cases/${caseId}/review`, 'P-240-RV');
      expect((view.body.opinions as Array<Record<string, unknown>>)[0]).toMatchObject({ kind, destinationCode: 'T09' });
      expect((view.body.objections as Array<Record<string, unknown>>)[0]).toMatchObject({
        status: 'decided',
        decision: 'support-handler',
        decisionTransition: 'T11',
      });
      const after = await caseState(caseId);
      expect(after.returns).toEqual(beforeReturns);
      const frozen = await cloned.prisma.caseFrozenDecision.findFirst({ where: { caseId } });
      expect(frozen?.summaryJson).toContain('leader-decision');
    }
  });

  it('负责人支持审理意见：T09 已生效，不再追加退回记录', async () => {
    const { caseId } = await toE04();
    expect((await designate(caseId, 'P-240-HEAD', reviewerId)).status).toBe(200);
    expect((await sign(caseId, 'P-240-RV', 'correction')).status).toBe(200);
    const before = (await caseState(caseId)).returns as Array<Record<string, unknown>>;
    const drafted = await postJson(`/api/cases/${caseId}/review-objections`, 'P-240-H1', { note: '有异议' });
    const objectionId = String(drafted.body.objectionId);
    expect((await postJson(`/api/review-objections/${objectionId}/submit`, 'P-240-H1')).status).toBe(200);
    const decided = await postJson(`/api/review-objections/${objectionId}/decide`, 'P-APPROVE-HQ', {
      decision: 'support-review',
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect(decided.body).toMatchObject({ decision: 'support-review', t09AlreadyApplied: true });
    const after = await caseState(caseId);
    expect(after.currentStage).toBe('E02');
    expect(after.returns).toEqual(before);
  });

  it('非补充调查或修改纠正的意见不能提异议 409', async () => {
    const { caseId } = await toE04();
    expect((await designate(caseId, 'P-240-HEAD', reviewerId)).status).toBe(200);
    expect((await sign(caseId, 'P-240-RV', 'penalty')).status).toBe(200);
    const rejected = await postJson(`/api/cases/${caseId}/review-objections`, 'P-240-H1', { note: '有异议' });
    expect(rejected.status).toBe(409);
    expect(rejected.body.result).toBe('objection-not-allowed');
  });
});