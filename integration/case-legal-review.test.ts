// #269 法制审核与集体讨论：必审判定、告知前法审（T10a／T10b）、X26、X27、X08、X09、
// G5 接收人改派、两级签字、同一人警告、集体讨论与 #246 期限。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-29T06:00:00.000Z');
let nowMs = T0;
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Legal-review-269!';
const INITIAL_PASSWORD = 'Legal-269!!';
const DEADLINE_RULE_VERSION = '2026-10-27';

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
let handlerAssistId = '';
let reviewerId = '';
let legalOneId = '';
let legalTwoId = '';
let legalOtherDeptId = '';
let approverId = '';
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
      'clue.patrol_no': `XC-269-${polygonOffset}`,
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
      cookie: await cookieOf('P-269-IN'),
      'idempotency-key': `legal-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  return (await response.json()) as { id: string };
}

async function toHandlerAssigned(clueId: string): Promise<void> {
  const org = await postJson(`/api/clues/${clueId}/assign-org`, 'P-269-IN', {
    orgUnitId: stationAId,
    expectedStatus: 'in_pool',
    reason: '',
    designate: false,
  });
  expect(org.status).toBe(200);
  const people = await postJson(`/api/clues/${clueId}/assign-people`, 'P-269-ST', {
    mainId: handlerMainId,
    assistIds: [handlerAssistId],
    expectedStatus: 'org_assigned',
  });
  expect(people.status).toBe(200);
}

function suggestion(violationRecordId: string, penaltyCodes: readonly string[]): Record<string, unknown> {
  return {
    violationRecordId,
    kind: 'penalty',
    penaltyCodes: [...penaltyCodes],
    fineAmount: 5000,
    discretionReason: '从轻',
    fineBases: ['土地管理法第77条'],
    basisText: '土地管理法第77条',
    comparisonReason: '',
  };
}

/** 到 E04 并签出审理意见（冻结拟决定摘要）。reviewerCode 可换成同一人。 */
async function toE04(options: { penaltyCodes?: readonly string[]; reviewerPersonId?: string; reviewerCode?: string } = {}): Promise<string> {
  offset += 1;
  const registered = await register(offset);
  await toHandlerAssigned(registered.id);
  const drafted = await postJson(`/api/clues/${registered.id}/filing-approval`, 'P-269-H1', {
    content: { conclusion: 'file', partyNames: ['张三'] },
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, 'P-269-H1')).status).toBe(200);
  expect((await postJson(`/api/filing-approvals/${approvalId}/review`, 'P-269-RV', { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status).toBe(200);
  const caseId = String(approved.body.caseId);

  const violation = await postJson(`/api/cases/${caseId}/violations`, 'P-269-H1', {
    behaviorDescription: '硬化地面',
    parties: ['张三'],
    startedOn: '2026-10-01',
    endedOn: '2026-10-20',
    recognition: 'one-off',
  });
  expect(violation.status).toBe(200);
  const report = await postJson(`/api/cases/${caseId}/review-reports`, 'P-269-H1', {
    content: { suggestions: [suggestion(String(violation.body.id), options.penaltyCodes ?? ['fine'])] },
  });
  expect(report.status, JSON.stringify(report.body)).toBe(200);
  const reportId = String(report.body.approvalId);
  expect((await postJson(`/api/review-reports/${reportId}/submit`, 'P-269-H1')).status).toBe(200);
  expect((await postJson(`/api/review-reports/${reportId}/review`, 'P-269-RV', { opinion: '同意' })).status).toBe(200);
  expect((await postJson(`/api/review-reports/${reportId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' })).status).toBe(200);
  const designated = await postJson(`/api/cases/${caseId}/reviewer-designations`, 'P-269-HHEAD', {
    personnelId: options.reviewerPersonId ?? reviewerId,
  });
  expect(designated.status, JSON.stringify(designated.body)).toBe(200);
  const signed = await postJson(`/api/cases/${caseId}/review-opinions`, options.reviewerCode ?? 'P-269-RV', {
    kind: 'penalty',
    content: '审理意见',
  });
  expect(signed.status, JSON.stringify(signed.body)).toBe(200);
  return caseId;
}

function noticeContent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'penalty',
    partyType: 'citizen',
    hearingNoticeAttached: true,
    manualHearingItems: [],
    notApplicableHearing: false,
    mandatoryReview: false,
    preReviewApproval: null,
    confiscationValue: null,
    note: '告知书正文',
    ...overrides,
  };
}

async function draftNotice(
  caseId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/cases/${caseId}/notices`, 'P-269-H1', { content: noticeContent(overrides) });
}

async function approvedNotice(caseId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const drafted = await draftNotice(caseId, overrides);
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const noticeId = String(drafted.body.noticeId);
  expect((await postJson(`/api/notices/${noticeId}/submit`, 'P-269-H1')).status).toBe(200);
  expect((await postJson(`/api/notices/${noticeId}/review`, 'P-269-RV', { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/notices/${noticeId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return noticeId;
}

async function serveAndComplete(caseId: string, noticeId: string): Promise<void> {
  expect((await postJson(`/api/notices/${noticeId}/serve`, 'P-269-H1')).status).toBe(200);
  const completed = await postJson(`/api/cases/${caseId}/notice-completions`, 'P-269-H1', {
    basis: 'waiver',
    note: '当事人书面明确放弃陈述申辩与听证',
  });
  expect(completed.status, JSON.stringify(completed.body)).toBe(200);
}

async function startReview(
  caseId: string,
  receiverIdValue: string,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/cases/${caseId}/legal-review`, 'P-269-H1', {
    receiverId: receiverIdValue,
    manualItems: [],
    ...extra,
  });
}

async function signOpinion(
  legalReviewId: string,
  conclusion: 'pass' | 'fail',
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/legal-reviews/${legalReviewId}/opinions`, 'P-269-L1', {
    conclusion,
    content: `法审意见：${conclusion}`,
    ...extra,
  });
}

async function signHead(
  legalReviewId: string,
  code = 'P-269-HEAD',
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/legal-reviews/${legalReviewId}/sign`, code, { opinion: '同意' });
}

async function decisionGate(caseId: string, code = 'P-APPROVE-HQ'): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/cases/${caseId}/legal-review-decision-gate`, code);
}

async function caseView(caseId: string): Promise<Record<string, unknown>> {
  return (await getJson(`/api/cases/${caseId}`, 'P-269-RV')).body;
}

async function trails(action: string, resourceId: string): Promise<Array<{ outcome: string; reason: string | null; detail: string | null; previous_value: string | null }>> {
  return cloned.prisma.$queryRaw`
    SELECT outcome, reason, detail, previous_value
    FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
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
  deptBId = await orgOf('ORG-DEPT-B');
  stationAId = await orgOf('ORG-STATION-A');
  await seedPerson('P-269-IN', '甲区内勤', deptAId, ['内勤'], '13900026901', false);
  await seedPerson('P-269-ST', '甲所内勤', stationAId, ['内勤'], '13900026902', false);
  handlerMainId = await seedPerson('P-269-H1', '主办甲', stationAId, ['经办'], '13900026903', true);
  handlerAssistId = await seedPerson('P-269-H2', '协办甲', stationAId, ['经办'], '13900026904', true);
  reviewerId = await seedPerson('P-269-RV', '甲区审理人', deptAId, ['行政审核', '法制审核'], '13900026905', false);
  legalOneId = await seedPerson('P-269-L1', '甲区法审一', deptAId, ['法制审核'], '13900026906', false);
  legalTwoId = await seedPerson('P-269-L2', '甲区法审二', deptAId, ['法制审核'], '13900026907', false);
  legalOtherDeptId = await seedPerson('P-269-LB', '乙区法审', deptBId, ['法制审核'], '13900026908', false);
  await seedPerson('P-269-HEAD', '甲区法审负责人', deptAId, ['行政审核'], '13900026909', false, [
    'legal-review-lead',
  ]);
  await seedPerson('P-269-HEAD2', '甲区行政审核', deptAId, ['行政审核'], '13900026910', false);
  await seedPerson('P-269-HHEAD', '甲所负责人', stationAId, ['行政审批', '行政审核'], '13900026911', false);
  approverId = (await cloned.prisma.personnel.findFirstOrThrow({ where: { code: 'P-APPROVE-HQ' } })).id;
}, 180_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  cookies.clear();
});

describe('#269 自动必审与告知前法审', () => {
  it('清单第 5 项罚种自动命中：告知前法审 T10a／T10b、期限走 #246、X26 通过且覆盖放行', async () => {
    const caseId = await toE04({ penaltyCodes: ['revoke-mining-permit'] });

    const blocked = await draftNotice(caseId);
    expect(blocked.status).toBe(409);
    expect(blocked.body.reason).toBe('legal-review-required');
    expect((await caseView(caseId)).currentStage).toBe('E04');

    const view = await getJson(`/api/cases/${caseId}/legal-review`, 'P-269-H1');
    expect(view.status).toBe(200);
    expect(view.body.mandatoryReview).toMatchObject({
      required: true,
      autoReasons: expect.arrayContaining(['penalty-item-5']),
      listId: 'cfg.rule.legal-review-list.v1',
      listVersion: '2026-10-29',
    });
    const candidateIds = (view.body.candidates as Array<{ personnelId: string; eligible: boolean }>)
      .map((row) => row.personnelId);
    expect(candidateIds).toEqual(expect.arrayContaining([legalOneId, legalTwoId]));
    expect(candidateIds).not.toContain(legalOtherDeptId);

    const wrongOrg = await startReview(caseId, legalOtherDeptId);
    expect(wrongOrg.status).toBe(409);
    expect(wrongOrg.body.reason).toBe('receiver-org-not-attributed');

    const notReviewer = await startReview(caseId, handlerMainId);
    expect(notReviewer.status).toBe(409);
    expect(notReviewer.body.reason).toBe('receiver-not-legal-reviewer');

    const started = await startReview(caseId, legalOneId);
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const legalReviewId = String(started.body.legalReviewId);
    expect(started.body).toMatchObject({
      roundNo: 1,
      phase: 'pre-notice',
      currentStage: 'E07',
      deadline: expect.objectContaining({
        ruleKey: 'legal-review.round',
        needsManualConfirmation: false,
      }),
    });
    expect((started.body.hints as Array<{ code: string }>).some((item) => item.code === 'LEGAL-QUALIFICATION')).toBe(true);

    const row = await cloned.prisma.caseLegalReview.findFirstOrThrow({ where: { caseId } });
    expect(JSON.parse(row.determinationJson)).toMatchObject({
      required: true,
      autoReasons: ['penalty-item-5'],
      manualItems: [],
      listId: 'cfg.rule.legal-review-list.v1',
      listVersion: '2026-10-29',
    });
    const deadline = await cloned.prisma.caseDeadlineRow.findFirstOrThrow({
      where: { caseId, ruleKey: 'legal-review.round' },
    });
    expect(deadline).toMatchObject({
      entrySeq: 1,
      procedureNode: 'E07',
      dayCount: 5,
      dayBasis: 'working',
      extensionAllowance: 10,
      ruleVersion: DEADLINE_RULE_VERSION,
      needsManualConfirmation: false,
    });
    expect(deadline.dueOn).not.toBeNull();
    expect((await caseView(caseId)).currentStage).toBe('E07');

    const earlyHead = await signHead(legalReviewId);
    expect(earlyHead.status).toBe(409);
    expect(earlyHead.body.reason).toBe('no-pending-opinion');

    const signed = await signOpinion(legalReviewId, 'pass');
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    const opinionId = String(signed.body.opinionId);

    const notHead = await signHead(legalReviewId, 'P-269-HEAD2');
    expect(notHead.status).toBe(409);
    expect(notHead.body.reason).toBe('head-post-marker-missing');

    const concluded = await signHead(legalReviewId);
    expect(concluded.status, JSON.stringify(concluded.body)).toBe(200);
    expect(concluded.body).toMatchObject({ conclusion: 'pass', currentStage: 'E05' });

    const transitions = await cloned.prisma.caseTransition.findMany({ where: { caseId }, orderBy: { createdAt: 'asc' } });
    expect(transitions.map((item) => item.transitionCode)).toEqual(expect.arrayContaining(['T10a', 'T10b']));

    const drafted = await draftNotice(caseId, { preReviewApproval: opinionId });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
    const noticeId = String(drafted.body.noticeId);
    expect((await postJson(`/api/notices/${noticeId}/submit`, 'P-269-H1')).status).toBe(200);
    expect((await postJson(`/api/notices/${noticeId}/review`, 'P-269-RV', { opinion: '同意' })).status).toBe(200);
    const approved = await postJson(`/api/notices/${noticeId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.result).toBe('notice-approved');

    const startedTrails = (await trails('case.legal-review-started', caseId)).filter(
      (row) => row.outcome === 'succeeded',
    );
    expect(startedTrails).toHaveLength(1);
    expect(startedTrails[0]?.detail).toContain('legal-review.round');
  }, 60_000);

  it('人工勾选必审：判定记录清单与版本；不通过且接受后重新送审，不是退回', async () => {
    const caseId = await toE04();
    const started = await startReview(caseId, legalOneId, { manualItems: ['complex-multiple-relations'] });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.determination).toMatchObject({
      required: true,
      autoReasons: [],
      manualItems: ['complex-multiple-relations'],
    });
    const legalReviewId = String(started.body.legalReviewId);

    const failed = await signOpinion(legalReviewId, 'fail', { failRoute: 'accept-revise' });
    expect(failed.status, JSON.stringify(failed.body)).toBe(200);
    const concluded = await signHead(legalReviewId);
    expect(concluded.status).toBe(200);
    expect(concluded.body.conclusion).toBe('fail');
    expect((await caseView(caseId)).currentStage).toBe('E07');
    expect(await cloned.prisma.caseReturn.count({ where: { caseId } })).toBe(0);

    const second = await signOpinion(legalReviewId, 'pass');
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect((await signHead(legalReviewId)).status).toBe(200);
    expect((await caseView(caseId)).currentStage).toBe('E05');
  }, 60_000);

  it('不必审情形：罚款 5000 元无听证，告知照常；决定闸口放行；主动送审受理', async () => {
    const caseId = await toE04();
    const view = await getJson(`/api/cases/${caseId}/legal-review`, 'P-269-H1');
    expect(view.body.mandatoryReview).toMatchObject({ required: false, excluded: false });
    const noticeId = await approvedNotice(caseId);
    await serveAndComplete(caseId, noticeId);
    expect((await caseView(caseId)).currentStage).toBe('E09');
    const gate = await decisionGate(caseId);
    expect(gate.status, JSON.stringify(gate.body)).toBe(200);
    expect(gate.body).toMatchObject({ result: 'decision-gate-passed', mandatoryReview: false });

    const voluntaryCase = await toE04();
    const voluntary = await startReview(voluntaryCase, legalOneId);
    expect(voluntary.status, JSON.stringify(voluntary.body)).toBe(200);
    expect(voluntary.body.determination).toMatchObject({ required: false, autoReasons: [], manualItems: [] });
  }, 60_000);
});

describe('#269 G5 接收人改派与候选收窄', () => {
  it('接收人由负责人改派：理由必填、非负责人拒绝、原接收人不能再签', async () => {
    const caseId = await toE04();
    const started = await startReview(caseId, legalOneId, { manualItems: ['major-public-interest'] });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const legalReviewId = String(started.body.legalReviewId);

    const noReason = await postJson(`/api/legal-reviews/${legalReviewId}/reassign`, 'P-269-HEAD', {
      receiverId: legalTwoId,
    });
    expect(noReason.status).toBe(400);
    expect(noReason.body.reason).toBe('missing-reason');

    const notHead = await postJson(`/api/legal-reviews/${legalReviewId}/reassign`, 'P-269-HEAD2', {
      receiverId: legalTwoId,
      reason: '更换法审人员',
    });
    expect(notHead.status).toBe(409);
    expect(notHead.body.reason).toBe('head-post-marker-missing');

    const wrongOrg = await postJson(`/api/legal-reviews/${legalReviewId}/reassign`, 'P-269-HEAD', {
      receiverId: legalOtherDeptId,
      reason: '更换法审人员',
    });
    expect(wrongOrg.status).toBe(409);
    expect(wrongOrg.body.reason).toBe('receiver-org-not-attributed');

    const changed = await postJson(`/api/legal-reviews/${legalReviewId}/reassign`, 'P-269-HEAD', {
      receiverId: legalTwoId,
      reason: '原接收人临时出差',
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body).toMatchObject({ previousReceiverId: legalOneId, receiverId: legalTwoId });
    const changeTrails = (await trails('case.legal-review-receiver-changed', caseId)).filter(
      (row) => row.outcome === 'succeeded',
    );
    expect(changeTrails).toHaveLength(1);
    expect(changeTrails[0]).toMatchObject({ previous_value: legalOneId });
    expect(changeTrails[0]?.detail).toContain('原接收人临时出差');

    const oldSigner = await signOpinion(legalReviewId, 'pass');
    expect(oldSigner.status).toBe(409);
    expect(oldSigner.body.reason).toBe('reviewer-not-receiver');

    const newSigner = await postJson(`/api/legal-reviews/${legalReviewId}/opinions`, 'P-269-L2', {
      conclusion: 'pass',
      content: '法审意见：pass',
    });
    expect(newSigner.status, JSON.stringify(newSigner.body)).toBe(200);
  }, 60_000);

  it('候选收窄：有声明或生效回避的接收人不可选、不能发起', async () => {
    const caseId = await toE04();
    const declared = await postJson(`/api/cases/${caseId}/conflicts`, 'P-269-H1', {
      personId: legalOneId,
      source: 'other',
      reason: '与本案当事人有亲属关系',
    });
    expect(declared.status).toBe(200);

    const view = await getJson(`/api/cases/${caseId}/legal-review`, 'P-269-H1');
    const excluded = (view.body.excludedCandidates as Array<{ personnelId: string; reason: string }>).find(
      (row) => row.personnelId === legalOneId,
    );
    expect(excluded).toMatchObject({ reason: 'receiver-conflict-active' });

    const started = await startReview(caseId, legalOneId, { manualItems: ['major-public-interest'] });
    expect(started.status).toBe(409);
    expect(started.body.reason).toBe('receiver-conflict-active');
  }, 60_000);
});

describe('#269 听证后再审与决定闸口', () => {
  it('Q32 受理后书面撤回仍算经过听证：未再审进领导审批 409 X27；再审通过后放行', async () => {
    const caseId = await toE04();
    const noticeId = await approvedNotice(caseId);
    expect((await postJson(`/api/notices/${noticeId}/serve`, 'P-269-H1')).status).toBe(200);
    const requested = await postJson(`/api/cases/${caseId}/hearing-requests`, 'P-269-H1');
    expect(requested.status, JSON.stringify(requested.body)).toBe(200);
    const hearingId = String(requested.body.hearingId);
    expect((await postJson(`/api/hearings/${hearingId}/accept`, 'P-269-RV')).status).toBe(200);
    const ended = await postJson(`/api/hearings/${hearingId}/end`, 'P-269-RV', {
      endKind: 'withdrawn',
      note: '受理后书面撤回',
    });
    expect(ended.status, JSON.stringify(ended.body)).toBe(200);
    expect((await caseView(caseId)).currentStage).toBe('E09');

    const blocked = await decisionGate(caseId);
    expect(blocked.status).toBe(409);
    expect(blocked.body.reason).toBe('X27');
    expect((await trails('case.decision-gate-checked', caseId))[0]).toMatchObject({ outcome: 'failed', reason: 'X27' });

    nowMs += 1000;
    const started = await startReview(caseId, legalOneId, { manualItems: ['major-public-interest'] });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body).toMatchObject({ phase: 'pre-decision', currentStage: 'E09' });
    const legalReviewId = String(started.body.legalReviewId);
    expect((await signOpinion(legalReviewId, 'pass')).status).toBe(200);
    const concluded = await signHead(legalReviewId);
    expect(concluded.status).toBe(200);
    expect(concluded.body.currentStage).toBe('E09');

    const passed = await decisionGate(caseId);
    expect(passed.status, JSON.stringify(passed.body)).toBe(200);
    const markers = await getJson(`/api/cases/${caseId}/markers`, 'P-269-H1');
    expect(markers.body.active).toEqual(expect.arrayContaining(['hearing-entered']));
  }, 60_000);

  it('必审未审进领导审批 409 X08：告知勾选人工必审但未法审', async () => {
    const caseId = await toE04();
    const drafted = await draftNotice(caseId, { mandatoryReview: true });
    expect(drafted.status).toBe(200);
    const noticeId = String(drafted.body.noticeId);
    expect((await postJson(`/api/notices/${noticeId}/submit`, 'P-269-H1')).status).toBe(200);
    expect((await postJson(`/api/notices/${noticeId}/review`, 'P-269-RV', { opinion: '同意' })).status).toBe(200);
    const warned = await postJson(`/api/notices/${noticeId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
    expect(warned.status).toBe(200);
    expect(warned.body.warnings).toEqual([expect.objectContaining({ code: 'X26' })]);
    const approved = await postJson(`/api/notices/${noticeId}/approve`, 'P-APPROVE-HQ', {
      opinion: '同意',
      confirmedRuleKeys: ['X26'],
    });
    expect(approved.status).toBe(200);
    await serveAndComplete(caseId, noticeId);
    expect((await caseView(caseId)).currentStage).toBe('E09');

    const blocked = await decisionGate(caseId);
    expect(blocked.status).toBe(409);
    expect(blocked.body.reason).toBe('X08');
  }, 60_000);

  it('须集体讨论未讨论 409 X09：勾选触发后须先录入讨论记录', async () => {
    const caseId = await toE04();
    const noticeId = await approvedNotice(caseId);
    await serveAndComplete(caseId, noticeId);
    expect((await decisionGate(caseId)).status).toBe(200);

    const marked = await postJson(`/api/cases/${caseId}/discussion-marks`, 'P-269-H1', {
      criteriaCodes: ['complex-or-major'],
      reason: '情节复杂，涉及多个违法行为',
    });
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    const blocked = await decisionGate(caseId);
    expect(blocked.status).toBe(409);
    expect(blocked.body.reason).toBe('X09');

    const recorded = await postJson(`/api/cases/${caseId}/discussion-records`, 'P-269-H1', {
      purposes: ['penalty-decision'],
      criteriaCodes: ['complex-or-major'],
      note: '经集体讨论，一致同意按拟处罚意见办理',
    });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200);
    const passed = await decisionGate(caseId);
    expect(passed.status, JSON.stringify(passed.body)).toBe(200);
    expect(passed.body).toMatchObject({ discussionRequired: true });
  }, 60_000);

  it('决定签出人处于回避声明：409 X33', async () => {
    const caseId = await toE04();
    const noticeId = await approvedNotice(caseId);
    await serveAndComplete(caseId, noticeId);
    const declared = await postJson(`/api/cases/${caseId}/conflicts`, 'P-269-H1', {
      personId: approverId,
      source: 'other',
      reason: '审批人与当事人有利害关系',
    });
    expect(declared.status).toBe(200);
    const blocked = await decisionGate(caseId);
    expect(blocked.status).toBe(409);
    expect(blocked.body.reason).toBe('conflict-active');
  }, 60_000);
});

describe('#269 三去向与同一人警告', () => {
  it('不通过且不接受：集体讨论统一意见后回法审补出通过并引用讨论记录', async () => {
    const caseId = await toE04();
    const started = await startReview(caseId, legalOneId, { manualItems: ['complex-multiple-relations'] });
    expect(started.status).toBe(200);
    const legalReviewId = String(started.body.legalReviewId);

    expect((await signOpinion(legalReviewId, 'fail', { failRoute: 'collective-discussion' })).status).toBe(200);
    const failed = await signHead(legalReviewId);
    expect(failed.status).toBe(200);
    expect(failed.body.conclusion).toBe('fail');
    expect((await caseView(caseId)).currentStage).toBe('E07');

    const noReference = await signOpinion(legalReviewId, 'pass');
    expect(noReference.status).toBe(409);
    expect(noReference.body.reason).toBe('discussion-reference-required');

    nowMs += 1000;
    const recorded = await postJson(`/api/cases/${caseId}/discussion-records`, 'P-269-H1', {
      purposes: ['unify-legal-opinion'],
      criteriaCodes: ['complex-or-major'],
      note: '集体讨论统一意见：按法审意见修改后通过',
    });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200);
    const discussionRecordId = String(recorded.body.discussionRecordId);

    const passed = await signOpinion(legalReviewId, 'pass', { discussionRecordId });
    expect(passed.status, JSON.stringify(passed.body)).toBe(200);
    expect((await signHead(legalReviewId)).status).toBe(200);
    expect((await caseView(caseId)).currentStage).toBe('E05');

    const opinions = await cloned.prisma.caseLegalReviewOpinion.findMany({
      where: { legalReviewId },
      orderBy: { signedAt: 'asc' },
    });
    expect(opinions.map((row) => row.conclusion)).toEqual(['fail', 'pass']);
    expect(opinions[1]?.discussionRecordId).toBe(discussionRecordId);
  }, 60_000);

  it('审理人＝法审人：警告 200，确认后成功并留痕', async () => {
    const caseId = await toE04({ reviewerPersonId: reviewerId, reviewerCode: 'P-269-RV' });
    const started = await startReview(caseId, reviewerId, { manualItems: ['major-public-interest'] });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const legalReviewId = String(started.body.legalReviewId);

    const warned = await postJson(`/api/legal-reviews/${legalReviewId}/opinions`, 'P-269-RV', {
      conclusion: 'pass',
      content: '法审意见：pass',
    });
    expect(warned.status).toBe(200);
    expect(warned.body).toEqual({
      result: 'warnings',
      warnings: [expect.objectContaining({ code: 'LEGAL-SAME-PERSON', level: 'warn' })],
    });
    expect((await cloned.prisma.caseLegalReview.findFirstOrThrow({ where: { caseId } })).status).toBe('drafting');

    const confirmed = await postJson(`/api/legal-reviews/${legalReviewId}/opinions`, 'P-269-RV', {
      conclusion: 'pass',
      content: '法审意见：pass',
      confirmedRuleKeys: ['LEGAL-SAME-PERSON'],
      confirmReasons: { 'LEGAL-SAME-PERSON': '本区只有一名法审人员' },
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const confirmations = await cloned.prisma.$queryRaw<Array<{ detail: string | null }>>`
      SELECT detail FROM audit_trail
      WHERE action = 'case.rule-confirmed' AND resource_id = ${caseId}
    `;
    expect(confirmations.some((row) => row.detail?.includes('LEGAL-SAME-PERSON'))).toBe(true);
    expect((await signHead(legalReviewId)).status).toBe(200);
  }, 60_000);
});