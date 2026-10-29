// #272 告知／陈述申辩／听证：T10／T11 进入 E05、T13 送达、X07、较大数额、T14／T14a／T15／T16／T16a／T17、X26、X28。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { DEADLINE_RULE_VERSION } from '../backend/deadline/src/index.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-27T06:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Notice-hearing-272!';
const INITIAL_PASSWORD = 'Notice-272!!';

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
let reviewer2Id = '';
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
      'clue.received_at': '2026-10-27',
      'clue.narrative': '巡查发现一处硬化地面',
      'clue.finder': '巡查员',
      'clue.patrol_no': `XC-272-${polygonOffset}`,
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
      cookie: await cookieOf('P-272-IN'),
      'idempotency-key': `notice-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  return (await response.json()) as { id: string };
}

async function toHandlerAssigned(clueId: string): Promise<void> {
  const org = await fetch(`${baseUrl}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-272-IN') },
    body: JSON.stringify({ orgUnitId: stationAId, expectedStatus: 'in_pool', reason: '', designate: false }),
  });
  expect(org.status).toBe(200);
  const people = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-272-ST') },
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
  const drafted = await postJson(`/api/clues/${registered.id}/filing-approval`, 'P-272-H1', {
    content: { conclusion: 'file', partyNames: ['张三'] },
  });
  expect(drafted.status).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, 'P-272-H1')).status).toBe(200);
  expect((await postJson(`/api/filing-approvals/${approvalId}/review`, 'P-272-RV', { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status).toBe(200);
  return String(approved.body.caseId);
}

async function addViolation(caseId: string): Promise<string> {
  const created = await postJson(`/api/cases/${caseId}/violations`, 'P-272-H1', {
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

/** 到 E04 并签出拟处罚或拟不予处罚，冻结摘要。返回案件。 */
async function toE04(kind: 'penalty' | 'no-penalty' = 'penalty', fineAmount = 5000): Promise<string> {
  const caseId = await fileCase();
  const violationId = await addViolation(caseId);
  const drafted = await postJson(`/api/cases/${caseId}/review-reports`, 'P-272-H1', {
    content: { suggestions: [suggestion(violationId, kind, fineAmount)] },
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const reportId = String(drafted.body.approvalId);
  expect((await postJson(`/api/review-reports/${reportId}/submit`, 'P-272-H1')).status).toBe(200);
  expect((await postJson(`/api/review-reports/${reportId}/review`, 'P-272-RV', { opinion: '同意' })).status).toBe(200);
  expect((await postJson(`/api/review-reports/${reportId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' })).status).toBe(200);
  const designated = await postJson(`/api/cases/${caseId}/reviewer-designations`, 'P-272-HEAD', {
    personnelId: reviewerId,
  });
  expect(designated.status, JSON.stringify(designated.body)).toBe(200);
  const signed = await postJson(`/api/cases/${caseId}/review-opinions`, 'P-272-RV', {
    kind,
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

/** 发起告知（E04→E05），返回 noticeId。 */
async function draftNotice(
  caseId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ noticeId: string; body: Record<string, unknown> }> {
  const drafted = await postJson(`/api/cases/${caseId}/notices`, 'P-272-H1', {
    content: noticeContent(overrides),
  });
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  return { noticeId: String(drafted.body.noticeId), body: drafted.body };
}

async function submitNotice(noticeId: string): Promise<void> {
  expect((await postJson(`/api/notices/${noticeId}/submit`, 'P-272-H1')).status).toBe(200);
}

async function reviewNotice(noticeId: string): Promise<void> {
  expect((await postJson(`/api/notices/${noticeId}/review`, 'P-272-RV', { opinion: '同意' })).status).toBe(200);
}

/** 完整批准（不涉及 X26 两段式），返回响应。 */
async function approveNotice(
  noticeId: string,
  extra: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/notices/${noticeId}/approve`, 'P-APPROVE-HQ', { opinion: '同意', ...extra });
}

/** 到 E05 并完成告知批准。返回案件与告知。 */
async function approvedNotice(
  kind: 'penalty' | 'no-penalty' = 'penalty',
  fineAmount = 5000,
  overrides: Record<string, unknown> = {},
): Promise<{ caseId: string; noticeId: string }> {
  const caseId = await toE04(kind, fineAmount);
  const { noticeId } = await draftNotice(caseId, { kind, ...overrides });
  await submitNotice(noticeId);
  await reviewNotice(noticeId);
  const approved = await approveNotice(noticeId);
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return { caseId, noticeId };
}

/** 送达告知并返回响应。 */
async function serveNotice(caseId: string, noticeId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return postJson(`/api/notices/${noticeId}/serve`, 'P-272-H1');
}

async function markersOf(caseId: string): Promise<string[]> {
  const read = await getJson(`/api/cases/${caseId}/markers`, 'P-272-RV');
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
  await seedPerson('P-272-IN', '甲区内勤', deptAId, ['内勤'], '13900027201', false);
  await seedPerson('P-272-ST', '甲所内勤', stationAId, ['内勤'], '13900027202', false);
  handlerMainId = await seedPerson('P-272-H1', '主办甲', stationAId, ['经办'], '13900027203', true);
  handlerAssistId = await seedPerson('P-272-H2', '协办甲', stationAId, ['经办'], '13900027204', true);
  reviewerId = await seedPerson('P-272-RV', '所内审核', stationAId, ['行政审核'], '13900027205', false);
  reviewer2Id = await seedPerson('P-272-RV2', '所内审核二', stationAId, ['行政审核'], '13900027206', false);
  await seedPerson('P-272-HEAD', '甲所负责人', stationAId, ['行政审批', '行政审核'], '13900027207', false);
}, 180_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  cookies.clear();
  nowMs = T0;
});

describe('#272 X07：自动命中 ∪ 人工勾选', () => {
  it('公民罚款 5000 自动命中；未带听证告知批准 409 X07，业务行不动', async () => {
    const caseId = await toE04('penalty', 5000);
    const drafted = await draftNotice(caseId, { hearingNoticeAttached: false });
    expect(drafted.body.hints).toEqual([expect.objectContaining({ ruleKey: 'NOTICE-LARGE-AMOUNT' })]);
    await submitNotice(drafted.noticeId);
    await reviewNotice(drafted.noticeId);
    const refused = await approveNotice(drafted.noticeId);
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('X07');
    expect(refused.body.message).toBe('应听证情形未发听证告知');
    const row = await cloned.prisma.caseNotice.findFirstOrThrow({ where: { caseId } });
    expect(row.status).toBe('pending_approval');
    expect(await trails('case.notice-approved', caseId)).toEqual([
      expect.objectContaining({ outcome: 'failed', reason: 'X07' }),
    ]);
  });

  it('人工勾选应听证：系统未达阈值也能命中；未带听证告知 409', async () => {
    const caseId = await toE04('penalty', 100);
    const drafted = await draftNotice(caseId, { hearingNoticeAttached: false, manualHearingItems: ['other-heavy'] });
    expect(drafted.body.hints).toEqual([]);
    await submitNotice(drafted.noticeId);
    await reviewNotice(drafted.noticeId);
    const refused = await approveNotice(drafted.noticeId);
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('X07');
  });

  it('人工不能撤销系统命中：勾「不适用听证」→ 409', async () => {
    const caseId = await toE04('penalty', 5000);
    const drafted = await draftNotice(caseId, {
      hearingNoticeAttached: false,
      manualHearingItems: [],
      notApplicableHearing: true,
    });
    await submitNotice(drafted.noticeId);
    await reviewNotice(drafted.noticeId);
    const refused = await approveNotice(drafted.noticeId);
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('X07');
    expect(refused.body.message).toBe('应听证情形不得勾选不适用听证');
  });

  it('未命中时勾「不适用听证」允许；带听证告知批准成功', async () => {
    const { caseId, noticeId } = await approvedNotice('penalty', 100, {
      hearingNoticeAttached: false,
      notApplicableHearing: true,
    });
    expect(noticeId).toBeTruthy();
    expect(await cloned.prisma.caseNotice.findFirstOrThrow({ where: { caseId } })).toMatchObject({
      status: 'approved',
      kind: 'penalty',
    });
  });
});

describe('#272 T13 送达与期限', () => {
  it('送达后进入告知等待：写标记与两条期限行，期限按 #246 的工作日口径', async () => {
    const { caseId, noticeId } = await approvedNotice('penalty', 5000, { hearingNoticeAttached: true });
    const served = await serveNotice(caseId, noticeId);
    expect(served.status, JSON.stringify(served.body)).toBe(200);
    expect(served.body.servedOn).toBe('2026-10-27');
    const deadlines = served.body.deadlines as Array<Record<string, unknown>>;
    expect(deadlines.map((row) => row.ruleKey)).toEqual(['notice.statement', 'hearing.apply']);
    for (const row of deadlines) {
      expect(row.dueOn).toBe('2026-11-03');
      expect(row.needsManualConfirmation).toBe(false);
    }
    const rows = await cloned.prisma.caseDeadlineRow.findMany({
      where: { caseId, ruleKey: { in: ['notice.statement', 'hearing.apply'] } },
      orderBy: { ruleKey: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.ruleVersion)).toEqual([DEADLINE_RULE_VERSION, DEADLINE_RULE_VERSION]);
    expect(rows[0]?.startingDocument).toBe(noticeId);
    expect(await markersOf(caseId)).toEqual(expect.arrayContaining(['notice-served', 'notice-waiting']));
    const caseRow = await cloned.prisma.caseRecord.findFirstOrThrow({ where: { id: caseId } });
    expect([caseRow.currentStage, caseRow.stageEntrySeq]).toEqual(['E05', 1]);
    expect(await trails('case.notice-served', caseId)).toEqual([
      expect.objectContaining({ outcome: 'succeeded' }),
    ]);
  });

  it('拟不予处罚由办案人选择发告知：kind 一致时进入 E05 并送达', async () => {
    const { caseId, noticeId } = await approvedNotice('no-penalty', 5000, {
      kind: 'no-penalty',
      hearingNoticeAttached: false,
    });
    const served = await serveNotice(caseId, noticeId);
    expect(served.status, JSON.stringify(served.body)).toBe(200);
    const rows = await cloned.prisma.caseDeadlineRow.findMany({
      where: { caseId, ruleKey: 'notice.statement' },
    });
    expect(rows).toHaveLength(1);
    expect(await cloned.prisma.caseDeadlineRow.count({ where: { caseId, ruleKey: 'hearing.apply' } })).toBe(0);
  });
});

describe('#272 T14／T14a', () => {
  it('书面放弃可提前结束告知等待；有效期内再要求听证回到 E06（T14a）', async () => {
    const { caseId, noticeId } = await approvedNotice('penalty', 5000, { hearingNoticeAttached: true });
    expect((await serveNotice(caseId, noticeId)).status).toBe(200);

    const completed = await postJson(`/api/cases/${caseId}/notice-completions`, 'P-272-H1', {
      basis: 'waiver',
      note: '当事人书面明确放弃陈述申辩与听证',
    });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(completed.body).toMatchObject({ currentStage: 'E09', basis: 'waiver' });
    expect(await cloned.prisma.casePartySubmission.count({ where: { caseId, kind: 'notice-waiver' } })).toBe(1);
    // 放弃后仍保留告知等待标记，允许 T14a。
    expect(await markersOf(caseId)).toEqual(expect.arrayContaining(['notice-waiting']));

    const requested = await postJson(`/api/cases/${caseId}/hearing-requests`, 'P-272-H1', { note: '再次要求听证' });
    expect(requested.status, JSON.stringify(requested.body)).toBe(200);
    expect(requested.body).toMatchObject({ currentStage: 'E06', t14aRestored: true });
    const hearing = await cloned.prisma.caseHearing.findFirstOrThrow({ where: { caseId } });
    expect(hearing.status).toBe('applied');
    expect(await markersOf(caseId)).not.toContain('notice-waiting');
  });

  it('期满未申请视为放弃：届满前不能结算，届满后可登记', async () => {
    const { caseId, noticeId } = await approvedNotice('penalty', 5000, { hearingNoticeAttached: true });
    expect((await serveNotice(caseId, noticeId)).status).toBe(200);
    const early = await postJson(`/api/cases/${caseId}/notice-completions`, 'P-272-H1', {
      basis: 'deemed-waived',
    });
    expect(early.status).toBe(409);

    const restore = nowMs;
    nowMs = Date.parse('2026-11-04T02:00:00.000Z');
    try {
      cookies.clear();
      const late = await postJson(`/api/cases/${caseId}/notice-completions`, 'P-272-H1', {
        basis: 'deemed-waived',
      });
      expect(late.status, JSON.stringify(late.body)).toBe(200);
      expect(await markersOf(caseId)).toEqual(expect.arrayContaining(['deemed-waived']));
    } finally {
      nowMs = restore;
    }
  });
});

describe('#272 进入听证程序标记与 X28', () => {
  it('受理前撤回不算经过听证；标记＝否', async () => {
    const { caseId, noticeId } = await approvedNotice('penalty', 5000, { hearingNoticeAttached: true });
    expect((await serveNotice(caseId, noticeId)).status).toBe(200);
    const requested = await postJson(`/api/cases/${caseId}/hearing-requests`, 'P-272-H1');
    expect(requested.status).toBe(200);
    const hearingId = String(requested.body.hearingId);
    const ended = await postJson(`/api/hearings/${hearingId}/end`, 'P-272-RV', {
      endKind: 'withdrawn-before-acceptance',
      note: '受理前书面撤回',
    });
    expect(ended.status, JSON.stringify(ended.body)).toBe(200);
    expect(ended.body).toMatchObject({ countsAsHeld: false, currentStage: 'E09' });
    expect(await markersOf(caseId)).not.toContain('hearing-entered');
  });

  it('受理后撤回算经过听证：标记＝是，不清除；自动复开 409 X28', async () => {
    const { caseId, noticeId } = await approvedNotice('penalty', 5000, { hearingNoticeAttached: true });
    expect((await serveNotice(caseId, noticeId)).status).toBe(200);
    const requested = await postJson(`/api/cases/${caseId}/hearing-requests`, 'P-272-H1');
    const hearingId = String(requested.body.hearingId);
    expect((await postJson(`/api/hearings/${hearingId}/accept`, 'P-272-RV')).status).toBe(200);
    expect(await markersOf(caseId)).toEqual(expect.arrayContaining(['hearing-entered']));

    const ended = await postJson(`/api/hearings/${hearingId}/end`, 'P-272-RV', {
      endKind: 'terminated',
      note: '中途退出致终止',
    });
    expect(ended.status, JSON.stringify(ended.body)).toBe(200);
    expect(ended.body).toMatchObject({ countsAsHeld: true, hearingEntered: true });
    expect(await markersOf(caseId)).toEqual(expect.arrayContaining(['hearing-entered', 'hearing-terminated']));
    const row = await cloned.prisma.caseHearing.findFirstOrThrow({ where: { id: hearingId } });
    expect(row).toMatchObject({ status: 'ended', endKind: 'terminated' });

    const reopen = await postJson(`/api/cases/${caseId}/hearing-reopens`, 'P-272-RV');
    expect(reopen.status).toBe(409);
    expect(reopen.body.reason).toBe('X28');
    expect(await trails('case.hearing-reopen-refused', caseId)).toEqual([
      expect.objectContaining({ outcome: 'failed', reason: 'X28' }),
    ]);
  });

  it('已终止听证按 T15 重新申请：清除终止标记，进入听证程序标记保持', async () => {
    const { caseId, noticeId } = await approvedNotice('penalty', 5000, { hearingNoticeAttached: true });
    expect((await serveNotice(caseId, noticeId)).status).toBe(200);
    const first = await postJson(`/api/cases/${caseId}/hearing-requests`, 'P-272-H1');
    const firstId = String(first.body.hearingId);
    expect((await postJson(`/api/hearings/${firstId}/accept`, 'P-272-RV')).status).toBe(200);
    expect((await postJson(`/api/hearings/${firstId}/end`, 'P-272-RV', { endKind: 'concluded' })).status).toBe(200);

    const second = await postJson(`/api/cases/${caseId}/hearing-requests`, 'P-272-H1');
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.currentStage).toBe('E06');
    const hearings = await cloned.prisma.caseHearing.findMany({ where: { caseId }, orderBy: { entrySeq: 'asc' } });
    expect(hearings.map((row) => [row.entrySeq, row.status])).toEqual([[1, 'ended'], [2, 'applied']]);
    expect(await markersOf(caseId)).toEqual(expect.arrayContaining(['hearing-entered']));
    expect(await markersOf(caseId)).not.toContain('hearing-terminated');
  });
});

describe('#272 主持人资格', () => {
  it('曾任主办、协办（含已换下的）不得主持；非承办人可主持', async () => {
    const { caseId, noticeId } = await approvedNotice('penalty', 5000, { hearingNoticeAttached: true });
    expect((await serveNotice(caseId, noticeId)).status).toBe(200);
    const requested = await postJson(`/api/cases/${caseId}/hearing-requests`, 'P-272-H1');
    const hearingId = String(requested.body.hearingId);

    const main = await postJson(`/api/hearings/${hearingId}/host`, 'P-272-RV', { personnelId: handlerMainId });
    expect(main.status).toBe(409);
    expect(main.body.reason).toBe('hearing-host-is-handler');

    const assist = await postJson(`/api/hearings/${hearingId}/host`, 'P-272-RV', { personnelId: handlerAssistId });
    expect(assist.status).toBe(409);

    const other = await postJson(`/api/hearings/${hearingId}/host`, 'P-272-RV', { personnelId: reviewer2Id });
    expect(other.status, JSON.stringify(other.body)).toBe(200);
    const row = await cloned.prisma.caseHearing.findFirstOrThrow({ where: { id: hearingId } });
    expect(row.hostPersonnelId).toBe(reviewer2Id);
  });
});

describe('#272 X26 告知批准路径', () => {
  it('命中必审但未经告知前法审：警告 200 两段式，确认后批准；非 409', async () => {
    const caseId = await toE04('penalty', 5000);
    const { noticeId } = await draftNotice(caseId, {
      hearingNoticeAttached: true,
      mandatoryReview: true,
    });
    await submitNotice(noticeId);
    await reviewNotice(noticeId);

    const warned = await approveNotice(noticeId);
    expect(warned.status).toBe(200);
    expect(warned.body).toEqual({
      result: 'warnings',
      warnings: [expect.objectContaining({ code: 'X26', ruleKey: 'X26', level: 'warn' })],
    });
    expect(await cloned.prisma.caseNotice.findFirstOrThrow({ where: { caseId } })).toMatchObject({
      status: 'pending_approval',
    });

    const confirmed = await approveNotice(noticeId, { confirmedRuleKeys: ['X26'] });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.result).toBe('notice-approved');
    expect(await cloned.prisma.caseNotice.findFirstOrThrow({ where: { caseId } })).toMatchObject({
      status: 'approved',
    });
    const confirmations = await cloned.prisma.$queryRaw<Array<{ detail: string | null }>>`
      SELECT detail FROM audit_trail WHERE action = 'case.rule-confirmed' AND resource_id = ${caseId}
    `;
    expect(confirmations.some((row) => row.detail?.includes('X26'))).toBe(true);
  });

  it('带告知前法审通过引用时不警告', async () => {
    const caseId = await toE04('penalty', 5000);
    const { noticeId } = await draftNotice(caseId, {
      hearingNoticeAttached: true,
      mandatoryReview: true,
      preReviewApproval: 'LEGAL-PASS-272',
    });
    await submitNotice(noticeId);
    await reviewNotice(noticeId);
    const approved = await approveNotice(noticeId);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.result).toBe('notice-approved');
  });
});

describe('#272 T17 新事实回调查', () => {
  it('告知等待中提出新事实：回 E02、次序号加 1、退回 R2，期限锚点续写', async () => {
    const { caseId, noticeId } = await approvedNotice('penalty', 5000, { hearingNoticeAttached: true });
    // 首次读期限时惰性写入 case.handle 锚点（#246）。
    expect((await getJson(`/api/cases/${caseId}/deadlines`, 'P-272-H1')).status).toBe(200);
    expect((await serveNotice(caseId, noticeId)).status).toBe(200);
    const before = await cloned.prisma.caseDeadlineRow.findMany({ where: { caseId, ruleKey: 'case.handle' } });
    expect(before).toHaveLength(1);
    const dueOn = before[0]?.dueOn?.toISOString();

    const returned = await postJson(`/api/cases/${caseId}/new-fact-returns`, 'P-272-H1', {
      note: '陈述申辩提出须核实的新事实',
    });
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    expect(returned.body).toMatchObject({ currentStage: 'E02', stageEntrySeq: 2 });
    const caseRow = await cloned.prisma.caseRecord.findFirstOrThrow({ where: { id: caseId } });
    expect([caseRow.currentStage, caseRow.stageEntrySeq]).toEqual(['E02', 2]);
    const returns = await cloned.prisma.caseReturn.findMany({ where: { caseId } });
    expect(returns).toEqual([
      expect.objectContaining({ reasonCode: 'R2', reflow: true, entrySeqBefore: 1, entrySeqAfter: 2 }),
    ]);
    const rows = await cloned.prisma.caseDeadlineRow.findMany({
      where: { caseId, ruleKey: 'case.handle' },
      orderBy: { entrySeq: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.entrySeq, row.dueOn?.toISOString()])).toEqual([
      [1, dueOn],
      [2, dueOn],
    ]);
    expect(await markersOf(caseId)).not.toContain('notice-waiting');
  });

  it('听证中提出新事实：终止听证，经过听证标记保持「是」', async () => {
    const { caseId, noticeId } = await approvedNotice('penalty', 5000, { hearingNoticeAttached: true });
    expect((await serveNotice(caseId, noticeId)).status).toBe(200);
    const requested = await postJson(`/api/cases/${caseId}/hearing-requests`, 'P-272-H1');
    const hearingId = String(requested.body.hearingId);
    expect((await postJson(`/api/hearings/${hearingId}/accept`, 'P-272-RV')).status).toBe(200);
    expect(await markersOf(caseId)).toEqual(expect.arrayContaining(['hearing-entered']));

    const returned = await postJson(`/api/cases/${caseId}/new-fact-returns`, 'P-272-H1', {
      note: '听证中提出新证据',
    });
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    expect(returned.body).toMatchObject({ currentStage: 'E02', stageEntrySeq: 2 });
    expect(await markersOf(caseId)).toEqual(expect.arrayContaining(['hearing-entered']));
    const hearing = await cloned.prisma.caseHearing.findFirstOrThrow({ where: { id: hearingId } });
    expect(hearing).toMatchObject({ status: 'ended', endKind: 'terminated' });
  });
});

async function trails(
  action: string,
  resourceId: string,
): Promise<Array<{ outcome: string; reason: string | null; detail: string | null }>> {
  return cloned.prisma.$queryRaw<Array<{ outcome: string; reason: string | null; detail: string | null }>>`
    SELECT outcome, reason, detail FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
    ORDER BY created_at ASC, id ASC
  `;
}