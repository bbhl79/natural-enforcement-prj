// #248 有效性确认与重新告知：A1–A6、B1b、B1a／B2、确认覆盖与复核、Q14 加重来源、
// 重新告知 T32（E05 次序号加 1、旧期限行保留、90 日不重置）、C1 旧视为放弃保留、C3 主持守卫复核。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newUlid } from '../backend/identity/src/index.ts';
import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-29T06:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Validity-248!!';
const INITIAL_PASSWORD = 'Validity248!';
const HANDLER = 'P-248-H1';
const REVIEWER = 'P-248-RV';
const APPROVER = 'P-248-AP';

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
let offset = 0;
let nowMs = T0;

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
      'clue.received_at': '2026-10-29',
      'clue.narrative': '巡查发现一处硬化地面',
      'clue.finder': '巡查员',
      'clue.patrol_no': `XC-248-${polygonOffset}`,
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
      cookie: await cookieOf('P-248-IN'),
      'idempotency-key': `validity-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  return (await response.json()) as { id: string };
}

async function toHandlerAssigned(clueId: string): Promise<void> {
  const org = await fetch(`${baseUrl}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-248-IN') },
    body: JSON.stringify({ orgUnitId: stationAId, expectedStatus: 'in_pool', reason: '', designate: false }),
  });
  expect(org.status).toBe(200);
  const people = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-248-ST') },
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
  const drafted = await postJson(`/api/clues/${registered.id}/filing-approval`, HANDLER, {
    content: { conclusion: 'file', partyNames: ['张三'] },
  });
  expect(drafted.status).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, HANDLER)).status).toBe(200);
  expect((await postJson(`/api/filing-approvals/${approvalId}/review`, REVIEWER, { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, APPROVER, { opinion: '同意' });
  expect(approved.status).toBe(200);
  return String(approved.body.caseId);
}

async function addViolation(caseId: string): Promise<string> {
  const created = await postJson(`/api/cases/${caseId}/violations`, HANDLER, {
    behaviorDescription: '硬化地面',
    parties: ['张三'],
    startedOn: '2026-10-01',
    endedOn: '2026-10-20',
    recognition: 'one-off',
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  return String(created.body.id);
}

function suggestion(violationRecordId: string, kind: 'penalty' | 'no-penalty', fineAmount = 5000): Record<string, unknown> {
  return kind === 'penalty'
    ? {
        violationRecordId,
        kind,
        penaltyCodes: ['fine'],
        fineAmount,
        discretionReason: '从轻',
        fineBases: ['土地管理法第77条'],
        basisText: '土地管理法第77条',
        comparisonReason: '',
      }
    : { violationRecordId, kind };
}

async function toE04(kind: 'penalty' | 'no-penalty' = 'penalty', fineAmount = 5000): Promise<{ caseId: string; violationId: string }> {
  const caseId = await fileCase();
  const violationId = await addViolation(caseId);
  const drafted = await postJson(`/api/cases/${caseId}/review-reports`, HANDLER, {
    content: { suggestions: [suggestion(violationId, kind, fineAmount)] },
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const reportId = String(drafted.body.approvalId);
  expect((await postJson(`/api/review-reports/${reportId}/submit`, HANDLER)).status).toBe(200);
  expect((await postJson(`/api/review-reports/${reportId}/review`, REVIEWER, { opinion: '同意' })).status).toBe(200);
  expect((await postJson(`/api/review-reports/${reportId}/approve`, APPROVER, { opinion: '同意' })).status).toBe(200);
  await designateReviewer(caseId);
  const signed = await postJson(`/api/cases/${caseId}/review-opinions`, REVIEWER, {
    kind,
    content: '审理意见',
  });
  expect(signed.status, JSON.stringify(signed.body)).toBe(200);
  return { caseId, violationId };
}

async function designateReviewer(caseId: string): Promise<void> {
  const designated = await postJson(`/api/cases/${caseId}/reviewer-designations`, APPROVER, {
    personnelId: reviewerId,
  });
  expect(designated.status, JSON.stringify(designated.body)).toBe(200);
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

async function draftAndServe(caseId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const drafted = await postJson(`/api/cases/${caseId}/notices`, HANDLER, { content: noticeContent(overrides) });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const noticeId = String(drafted.body.noticeId);
  await submitAndServe(noticeId);
  return noticeId;
}

async function submitAndServe(noticeId: string): Promise<void> {
  expect((await postJson(`/api/notices/${noticeId}/submit`, HANDLER)).status).toBe(200);
  expect((await postJson(`/api/notices/${noticeId}/review`, REVIEWER, { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/notices/${noticeId}/approve`, APPROVER, { opinion: '同意' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  const served = await postJson(`/api/notices/${noticeId}/serve`, HANDLER);
  expect(served.status, JSON.stringify(served.body)).toBe(200);
}

function summaryViolation(violationRecordId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    violationRecordId,
    kind: 'penalty',
    penaltyCodes: ['fine'],
    fineAmount: 5000,
    fineBases: ['土地管理法第77条'],
    basisText: '土地管理法第77条',
    discretionReason: '从轻',
    comparisonReason: '',
    ...overrides,
  };
}

function frozenSummary(violations: readonly Record<string, unknown>[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    opinionId: 'forced',
    kind: 'penalty',
    destinationCode: 'T10',
    outcomeCode: 'penalty',
    outcomeLabel: '拟处罚',
    violations,
    ...overrides,
  };
}

/** 直接冻结一份新的拟决定摘要，模拟新一轮审理后的决定书摘要。 */
async function forceFrozen(caseId: string, summary: Record<string, unknown>): Promise<void> {
  const designation = await cloned.prisma.caseReviewerDesignation.findFirstOrThrow({
    where: { caseId },
    orderBy: { designatedAt: 'desc' },
  });
  const opinionId = newUlid();
  const at = new Date(nowMs + 1000);
  await cloned.prisma.caseReviewOpinion.create({
    data: {
      id: opinionId,
      caseId,
      entrySeq: 1,
      opinionKind: 'penalty',
      content: '测试新拟决定',
      signedBy: reviewerId,
      designationId: designation.id,
      destinationCode: 'T10',
      createdAt: at,
    },
  });
  await cloned.prisma.caseFrozenDecision.create({
    data: {
      id: newUlid(),
      caseId,
      opinionId,
      summaryJson: JSON.stringify(summary),
      createdAt: at,
    },
  });
}

async function hitsOf(caseId: string): Promise<string[]> {
  const read = await getJson(`/api/cases/${caseId}/validity`, REVIEWER);
  expect(read.status, JSON.stringify(read.body)).toBe(200);
  return (read.body.systemHits as Array<{ code: string }>).map((row) => row.code);
}

async function gate(caseId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/cases/${caseId}/validity-gate`, APPROVER);
}

async function confirm(caseId: string, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/cases/${caseId}/validity-confirmations`, HANDLER, body);
}

async function reviewConfirmation(confirmationId: string, conclusion = 'pass'): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/validity-confirmations/${confirmationId}/review`, REVIEWER, { conclusion, opinion: '复核' });
}

async function markersOf(caseId: string): Promise<string[]> {
  const read = await getJson(`/api/cases/${caseId}/markers`, REVIEWER);
  expect(read.status).toBe(200);
  return read.body.active as string[];
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
  await seedPerson('P-248-IN', '甲区内勤', deptAId, ['内勤'], '13900024801', false);
  await seedPerson('P-248-ST', '甲所内勤', stationAId, ['内勤'], '13900024802', false);
  handlerMainId = await seedPerson(HANDLER, '主办甲', stationAId, ['经办'], '13900024803', true);
  handlerAssistId = await seedPerson('P-248-H2', '协办甲', stationAId, ['经办'], '13900024804', true);
  reviewerId = await seedPerson(REVIEWER, '所内审核', stationAId, ['行政审核'], '13900024805', false);
  await seedPerson(APPROVER, '甲所负责人', stationAId, ['行政审批', '行政审核'], '13900024806', false);
}, 180_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  cookies.clear();
  nowMs = T0;
});

const A_CASES = [
  { code: 'A1', fine: 5000, hearing: true, hits: ['A1'], summary: (id: string) => frozenSummary([summaryViolation(id)], { parties: ['张三', '李四'] }) },
  { code: 'A2', fine: 5000, hearing: true, hits: ['A2'], summary: (id: string) => frozenSummary([summaryViolation(id), summaryViolation(newUlid())]) },
  { code: 'A3', fine: 5000, hearing: true, hits: ['A3'], summary: (id: string) => frozenSummary([summaryViolation(id, { fineBases: ['土地管理法第78条'], basisText: '土地管理法第78条' })]) },
  { code: 'A4', fine: 5000, hearing: true, hits: ['A4'], summary: (id: string) => frozenSummary([summaryViolation(id, { penaltyCodes: ['fine', 'confiscation'] })]) },
  { code: 'A5', fine: 5000, hearing: true, hits: ['A5'], summary: (id: string) => frozenSummary([summaryViolation(id, { fineAmount: 8000 })]) },
  { code: 'A6', fine: 100, hearing: false, hits: ['A6'], summary: (id: string) => frozenSummary([summaryViolation(id, { penaltyCodes: ['revoke-permit'], fineAmount: null })]) },
  { code: 'B1b', fine: 5000, hearing: true, hits: ['B1b'], summary: (id: string) => frozenSummary([summaryViolation(id, { fineAmount: 3000, factChange: 'narrowed' })]) },
] as const;

describe('#248 A 类（含 B1b）：决定呈批 409，直到重新告知', () => {
  for (const scenario of A_CASES) {
    it(`${scenario.code} 命中后闸口 409`, async () => {
      const { caseId, violationId } = await toE04('penalty', scenario.fine);
      await draftAndServe(caseId, { hearingNoticeAttached: scenario.hearing });
      await forceFrozen(caseId, scenario.summary(violationId));
      const hits = await hitsOf(caseId);
      for (const code of scenario.hits) expect(hits, JSON.stringify(hits)).toContain(code);
      const refused = await gate(caseId);
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body.reason).toBe('validity-invalid');
      expect(String(refused.body.message)).toContain(scenario.hits[0]);
    });
  }
});

describe('#248 B 类：确认、覆盖与复核', () => {
  it('B1a 整条剔除：无确认 409；确认未复核 409；复核通过放行', async () => {
    const { caseId, violationId } = await toE04('penalty', 5000);
    const second = newUlid();
    await forceFrozen(caseId, frozenSummary([summaryViolation(violationId), summaryViolation(second)]));
    await draftAndServe(caseId);
    await forceFrozen(caseId, frozenSummary([summaryViolation(violationId)]));

    const refused = await gate(caseId);
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.reason).toBe('validity-b-confirmation-required');

    const confirmed = await confirm(caseId, { conclusion: 'valid', reason: '剔除第二宗后其余事实不变' });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const pending = await gate(caseId);
    expect(pending.status).toBe(409);
    expect(pending.body.reason).toBe('validity-review-required');

    const reviewed = await reviewConfirmation(String(confirmed.body.confirmationId));
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    const passed = await gate(caseId);
    expect(passed.status, JSON.stringify(passed.body)).toBe(200);
    expect(passed.body.result).toBe('validity-gate-passed');

    const read = await getJson(`/api/cases/${caseId}/validity`, REVIEWER);
    const differences = read.body.differences as Array<{ violationRecordId: string | null }>;
    expect(differences).toEqual([expect.objectContaining({ violationRecordId: second })]);
  });

  it('B2 金额下调：确认覆盖当前摘要才放行；摘要再变则确认过时', async () => {
    const { caseId, violationId } = await toE04('penalty', 5000);
    await draftAndServe(caseId);
    await forceFrozen(caseId, frozenSummary([summaryViolation(violationId, { fineAmount: 3000 })]));

    const confirmed = await confirm(caseId, { conclusion: 'valid', reason: '区间内下调' });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect((await reviewConfirmation(String(confirmed.body.confirmationId))).status).toBe(200);
    expect((await gate(caseId)).status).toBe(200);

    await forceFrozen(caseId, frozenSummary([summaryViolation(violationId, { fineAmount: 2500 })]));
    const stale = await gate(caseId);
    expect(stale.status).toBe(409);
    expect(stale.body.reason).toBe('validity-b-confirmation-stale');

    const reconfirmed = await confirm(caseId, { conclusion: 'valid', reason: '按最新金额再次确认' });
    expect(reconfirmed.status, JSON.stringify(reconfirmed.body)).toBe(200);
    expect((await reviewConfirmation(String(reconfirmed.body.confirmationId))).status).toBe(200);
    expect((await gate(caseId)).status).toBe(200);
  });

  it('系统判失效的 A 类不能被确认为有效', async () => {
    const { caseId, violationId } = await toE04('penalty', 5000);
    await draftAndServe(caseId);
    await forceFrozen(caseId, frozenSummary([summaryViolation(violationId, { fineAmount: 8000 })]));
    const refused = await confirm(caseId, { conclusion: 'valid', reason: '试图确认有效' });
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.reason).toBe('validity-system-invalid');
  });

  it('非审理或法审人员不能复核有效性确认', async () => {
    const { caseId, violationId } = await toE04('penalty', 5000);
    await draftAndServe(caseId);
    await forceFrozen(caseId, frozenSummary([summaryViolation(violationId, { fineAmount: 3000 })]));
    const confirmed = await confirm(caseId, { conclusion: 'valid', reason: '区间内下调' });
    expect(confirmed.status).toBe(200);
    const confirmation = await cloned.prisma.caseValidityConfirmation.findFirstOrThrow({
      where: { id: String(confirmed.body.confirmationId) },
    });
    const selfReview = await postJson(`/api/validity-confirmations/${confirmation.id}/review`, HANDLER, {
      conclusion: 'pass',
      opinion: '自己复核',
    });
    expect(selfReview.status).toBe(403);
    expect(await cloned.prisma.caseValidityReview.count({ where: { confirmationId: confirmation.id } })).toBe(0);
  });
});

describe('#248 理由已变化与重新告知', () => {
  it('勾选理由已变化：系统判失效；重新告知并送达后闸口放行', async () => {
    const { caseId, violationId } = await toE04('penalty', 5000);
    const oldNoticeId = await draftAndServe(caseId);
    const confirmed = await confirm(caseId, {
      conclusion: 'invalid',
      reason: '定性理由改写',
      reasonChanged: true,
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const refused = await gate(caseId);
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('validity-invalid');

    const reissued = await postJson(`/api/cases/${caseId}/notice-reissues`, HANDLER, {
      reason: 'reason-changed',
      note: '定性理由改写，重新告知',
    });
    expect(reissued.status, JSON.stringify(reissued.body)).toBe(200);
    const newNoticeId = String(reissued.body.noticeId);
    expect(newNoticeId).not.toBe(oldNoticeId);
    expect(reissued.body.entrySeq).toBe(2);
    await submitAndServe(newNoticeId);
    expect((await gate(caseId)).status).toBe(200);
    expect(await hitsOf(caseId)).toEqual([]);
    expect(violationId).toBeTruthy();
  });
});

describe('#248 Q18 重新告知：E05 次序号加 1、期限不重置、旧期限行保留', () => {
  it('C1 旧视为放弃保留绑定旧告知；T32 从 E09 回 E05；新期限行生成，90 日到期日不变', async () => {
    const { caseId } = await toE04('penalty', 5000);
    // 首次读期限时惰性写入 case.handle 锚点（#246）。
    expect((await getJson(`/api/cases/${caseId}/deadlines`, HANDLER)).status).toBe(200);
    const handleBefore = await cloned.prisma.caseDeadlineRow.findMany({ where: { caseId, ruleKey: 'case.handle' } });
    expect(handleBefore).toHaveLength(1);
    const handleDue = handleBefore[0]?.dueOn?.toISOString();
    const oldNoticeId = await draftAndServe(caseId);

    nowMs = Date.parse('2026-11-10T02:00:00.000Z');
    cookies.clear();
    expect((await getJson(`/api/cases/${caseId}/notice`, HANDLER)).status).toBe(200);
    const completed = await postJson(`/api/cases/${caseId}/notice-completions`, HANDLER, { basis: 'deemed-waived' });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(completed.body.currentStage).toBe('E09');

    const reissued = await postJson(`/api/cases/${caseId}/notice-reissues`, HANDLER, {
      reason: 'R7',
      note: '手动发起重新比对，依据变化',
    });
    expect(reissued.status, JSON.stringify(reissued.body)).toBe(200);
    expect(reissued.body).toMatchObject({ oldNoticeId, entrySeq: 2, currentStage: 'E05' });
    const caseRow = await cloned.prisma.caseRecord.findFirstOrThrow({ where: { id: caseId } });
    expect([caseRow.currentStage, caseRow.stageEntrySeq]).toEqual(['E05', 2]);
    const oldNotice = await cloned.prisma.caseNotice.findFirstOrThrow({ where: { id: oldNoticeId } });
    expect(oldNotice.status).toBe('revoked');
    expect(await cloned.prisma.caseNoticeStep.count({ where: { noticeId: oldNoticeId, step: 'revoke' } })).toBe(1);

    // 旧期限行保留，案件办案期限未重置。
    const noticeDeadlines = await cloned.prisma.caseDeadlineRow.findMany({
      where: { caseId, ruleKey: { in: ['notice.statement', 'hearing.apply'] } },
      orderBy: [{ entrySeq: 'asc' }, { ruleKey: 'asc' }],
    });
    expect(noticeDeadlines.map((row) => [row.entrySeq, row.ruleKey, row.startingDocument])).toEqual([
      [1, 'hearing.apply', oldNoticeId],
      [1, 'notice.statement', oldNoticeId],
    ]);
    const handleRows = await cloned.prisma.caseDeadlineRow.findMany({ where: { caseId, ruleKey: 'case.handle' } });
    expect(handleRows).toHaveLength(1);
    expect(handleRows[0]?.dueOn?.toISOString()).toBe(handleDue);

    // C1：旧「视为放弃」保留并绑定旧告知，重新告知只追加清除行。
    const waiverRows = await cloned.prisma.caseMarker.findMany({
      where: { caseId, marker: 'deemed-waived' },
      orderBy: { changedAt: 'asc' },
    });
    expect(waiverRows.some((row) => row.state === 'set' && row.note === oldNoticeId)).toBe(true);
    expect(waiverRows.at(-1)).toMatchObject({ state: 'cleared', note: String(reissued.body.noticeId) });
    expect(await markersOf(caseId)).not.toContain('deemed-waived');

    // 新告知送达：新陈述申辩期与听证申请期生成，旧行仍在。
    const newNoticeId = String(reissued.body.noticeId);
    await submitAndServe(newNoticeId);
    const afterServe = await cloned.prisma.caseDeadlineRow.findMany({
      where: { caseId, ruleKey: { in: ['notice.statement', 'hearing.apply'] } },
      orderBy: [{ entrySeq: 'asc' }, { ruleKey: 'asc' }],
    });
    expect(afterServe.map((row) => [row.entrySeq, row.ruleKey, row.startingDocument])).toEqual([
      [1, 'hearing.apply', oldNoticeId],
      [1, 'notice.statement', oldNoticeId],
      [2, 'hearing.apply', newNoticeId],
      [2, 'notice.statement', newNoticeId],
    ]);
    const handleAfter = await cloned.prisma.caseDeadlineRow.findMany({ where: { caseId, ruleKey: 'case.handle' } });
    expect(handleAfter).toHaveLength(1);
    expect(handleAfter[0]?.dueOn?.toISOString()).toBe(handleDue);
    expect(await markersOf(caseId)).toEqual(expect.arrayContaining(['notice-served', 'notice-waiting']));
  });
});

describe('#248 Q14：申辩后加重须写明加重来源', () => {
  it('回流新证据：未写来源 409；写明来源后放行', async () => {
    const { caseId, violationId } = await toE04('penalty', 5000);
    const oldNoticeId = await draftAndServe(caseId);
    expect((await postJson(`/api/cases/${caseId}/statements`, HANDLER, { note: '当事人书面申辩' })).status).toBe(200);
    // 回流须晚于陈述申辩，时间前进一分钟。
    nowMs = T0 + 60_000;
    cookies.clear();
    const returned = await postJson(`/api/cases/${caseId}/new-fact-returns`, HANDLER, { note: '申辩提出新证据' });
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    const returnId = String(returned.body.returnId);
    // 第二轮时间前进一小时，避免同一时刻的已批准报告在按更新时间排序时混淆。
    nowMs = T0 + 3_600_000;
    cookies.clear();

    // 回流后在 E02 重新写报告和处理建议，再进入 E04。
    const drafted = await postJson(`/api/cases/${caseId}/review-reports`, HANDLER, {
      content: { suggestions: [suggestion(violationId, 'penalty', 8000)] },
    });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
    const reportId = String(drafted.body.approvalId);
    expect((await postJson(`/api/review-reports/${reportId}/submit`, HANDLER)).status).toBe(200);
    expect((await postJson(`/api/review-reports/${reportId}/review`, REVIEWER, { opinion: '同意' })).status).toBe(200);
    expect((await postJson(`/api/review-reports/${reportId}/approve`, APPROVER, { opinion: '同意' })).status).toBe(200);
    await designateReviewer(caseId);
    const signed = await postJson(`/api/cases/${caseId}/review-opinions`, REVIEWER, { kind: 'penalty', content: '按新证据加重' });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    const newNoticeId = await draftAndServe(caseId);

    const read = await getJson(`/api/cases/${caseId}/validity`, REVIEWER);
    expect(read.body.q14).toEqual([
      expect.objectContaining({ noticeId: oldNoticeId, hitCodes: ['A5'], satisfied: false }),
    ]);
    const refused = await gate(caseId);
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body.reason).toBe('Q14');

    const invalidConfirm = await confirm(caseId, { noticeId: oldNoticeId, conclusion: 'valid', reason: '试图确认有效' });
    expect(invalidConfirm.status).toBe(409);
    expect(invalidConfirm.body.reason).toBe('validity-system-invalid');

    const confirmed = await confirm(caseId, {
      noticeId: oldNoticeId,
      conclusion: 'invalid',
      reason: '申辩后按回流新证据加重',
      aggravationSource: 'reflow-new-evidence',
      aggravationReference: returnId,
      aggravationReason: '回流取得的新证据支持上调',
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const passed = await gate(caseId);
    expect(passed.status, JSON.stringify(passed.body)).toBe(200);
    expect(newNoticeId).toBeTruthy();
  });

  it('R4 定性纠正：直接冻结新摘要并重新告知后，写明 R4 来源放行', async () => {
    const { caseId, violationId } = await toE04('penalty', 5000);
    const oldNoticeId = await draftAndServe(caseId);
    expect((await postJson(`/api/cases/${caseId}/statements`, HANDLER, { note: '当事人书面申辩' })).status).toBe(200);
    await forceFrozen(caseId, frozenSummary([summaryViolation(violationId, { fineAmount: 8000 })]));
    const reissued = await postJson(`/api/cases/${caseId}/notice-reissues`, HANDLER, {
      reason: 'A5',
      note: '按新决定重新告知',
    });
    expect(reissued.status, JSON.stringify(reissued.body)).toBe(200);
    await submitAndServe(String(reissued.body.noticeId));
    const refused = await gate(caseId);
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('Q14');

    const returnId = await insertReturn(caseId, 'R4', true);
    const confirmed = await confirm(caseId, {
      noticeId: oldNoticeId,
      conclusion: 'invalid',
      reason: 'R4 定性纠正后加重',
      aggravationSource: 'r4-qualification-correction',
      aggravationReference: returnId,
      aggravationReason: '定性或法律适用纠正',
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const passed = await gate(caseId);
    expect(passed.status, JSON.stringify(passed.body)).toBe(200);
  });
});

describe('#248 C3 主持守卫复核', () => {
  it('曾任主办、协办的人员不得主持听证', async () => {
    const { caseId } = await toE04('penalty', 5000);
    await draftAndServe(caseId);
    const requested = await postJson(`/api/cases/${caseId}/hearing-requests`, HANDLER);
    expect(requested.status).toBe(200);
    const hearingId = String(requested.body.hearingId);
    const refused = await postJson(`/api/hearings/${hearingId}/host`, REVIEWER, { personnelId: handlerMainId });
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('hearing-host-is-handler');
  });
});

async function insertReturn(caseId: string, reasonCode: string, reflow: boolean): Promise<string> {
  const opinionId = newUlid();
  const at = new Date(nowMs + 1000);
  await cloned.prisma.caseApprovalOpinion.create({
    data: {
      id: opinionId,
      caseId,
      reasonCode,
      note: '测试退回',
      targetKey: 'stage:E04',
      actorId: handlerMainId,
      createdAt: at,
    },
  });
  const returnId = newUlid();
  await cloned.prisma.caseReturn.create({
    data: {
      id: returnId,
      caseId,
      opinionId,
      reasonCode,
      inheritedCode: null,
      targetKey: 'stage:E04',
      receiverId: handlerMainId,
      reflow,
      n5: false,
      entrySeqBefore: 1,
      entrySeqAfter: 2,
      exitCode: null,
      rehearingRequired: false,
      revokeNotice: false,
      actorId: handlerMainId,
      createdAt: at,
    },
  });
  return returnId;
}