// #246 期限：90 日、T34、补登、四维锚点、工作日历、跨年人工确认、换表修订。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CASE_STORE, nextEntrySeq, type CaseStore, type StageInstanceRow } from '../backend/case/src/index.ts';
import { newUlid } from '../backend/identity/src/index.ts';
import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-03-02T04:00:00.000Z');
const OPENED = '2026-03-02T04:00:00.000Z';
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Case-due-246!';
const INITIAL_PASSWORD = 'Due-246-x!!';
const SOURCE_URL = 'https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm';
const MANUAL_TRACE = '工作日口径跨入未装入的年份，需人工确认，不按日历日计算。';
const OVERDUE_PROMPT = '办案期限已届满。只提示，不阻断。';
const PAUSE_PROMPT = '中止期间停表，恢复后继续计算。';

function square(offset: number): (readonly number[])[] {
  const west = 116 + offset;
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

interface DeadlineRowBody {
  ruleKey: string;
  entrySeq: number;
  procedureNode: string;
  startingDocument: string | null;
  dueOn: string | null;
  revisionNo: number;
  consumption: string;
  ruleVersion: string;
  dayCount: number;
  dayBasis: string;
  partyFacing: boolean;
  extensionAllowance: number | null;
  needsManualConfirmation: boolean;
  confirmationTrace: string | null;
  clamped: boolean;
  rowStatus: string;
}

interface PeriodEventBody {
  kind: string;
  source: string;
  status: string;
  extensionDays: number | null;
  backfill: boolean;
  approvalId: string | null;
}

interface DeadlineBody {
  sourceUrl: string;
  blocked: boolean;
  prompts: string[];
  handling: { startedOn: string; dueOn: string | null; paused: boolean } | null;
  rows: DeadlineRowBody[];
  periodEvents: PeriodEventBody[];
}

let cloned: ClonedDatabase;
let application: Awaited<ReturnType<typeof createApplication>>;
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
      'clue.received_at': '2026-03-02',
      'clue.narrative': '巡查发现一处硬化地面',
      'clue.finder': '巡查员',
      'clue.patrol_no': `XC-246-${polygonOffset}`,
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
      cookie: await cookieOf('P-246-IN'),
      'idempotency-key': `due-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  return (await response.json()) as { id: string };
}

async function toHandlerAssigned(clueId: string): Promise<void> {
  const org = await fetch(`${baseUrl}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-246-IN') },
    body: JSON.stringify({ orgUnitId: stationAId, expectedStatus: 'in_pool', reason: '', designate: false }),
  });
  expect(org.status).toBe(200);
  const people = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-246-ST') },
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

async function getJson(path: string, code: string): Promise<{ status: number; body: DeadlineBody }> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { cookie: await cookieOf(code) } });
  return { status: response.status, body: (await response.json()) as DeadlineBody };
}

async function fileCase(openedAt: string = OPENED): Promise<string> {
  offset += 1;
  const registered = await register(offset);
  await toHandlerAssigned(registered.id);
  const drafted = await postJson(`/api/clues/${registered.id}/filing-approval`, 'P-246-H1', {
    content: { conclusion: 'file', partyNames: ['张三'] },
  });
  expect(drafted.status).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, 'P-246-H1')).status).toBe(200);
  expect((await postJson(`/api/filing-approvals/${approvalId}/review`, 'P-246-RV', { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  const caseId = String(approved.body.caseId);
  await cloned.prisma.caseRecord.update({ where: { id: caseId }, data: { openedAt: new Date(openedAt) } });
  return caseId;
}

async function approveDeadline(path: string, body: unknown): Promise<Record<string, unknown>> {
  const drafted = await postJson(path, 'P-246-H1', body);
  expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/deadline-approvals/${approvalId}/submit`, 'P-246-H1')).status).toBe(200);
  expect((await postJson(`/api/deadline-approvals/${approvalId}/review`, 'P-246-RV', { opinion: '同意' })).status).toBe(200);
  const approved = await postJson(`/api/deadline-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return approved.body;
}

async function details(action: string, resourceId: string): Promise<Array<{ detail: string | null; outcome: string }>> {
  return cloned.prisma.$queryRaw<Array<{ detail: string | null; outcome: string }>>`
    SELECT detail, outcome
    FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
    ORDER BY created_at ASC, id ASC
  `;
}

function handles(body: DeadlineBody): DeadlineRowBody[] {
  return body.rows.filter((row) => row.ruleKey === 'case.handle');
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  application = await createApplication(cloned.connectionString, { now: () => new Date(T0) }, undefined, {
    storagePort: new RecordingStorage() as never,
    queuePort: new RecordingQueue() as never,
    filingAdminReview: 'one-level',
  });
  await application.listen(0, '127.0.0.1');
  const address = application.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => application.close();
  const orgOf = async (code: string) => {
    const org = await cloned.prisma.orgUnit.findUnique({ where: { code } });
    if (!org) throw new Error(`缺少种子机构 ${code}`);
    return org.id;
  };
  deptAId = await orgOf('ORG-DEPT-A');
  stationAId = await orgOf('ORG-STATION-A');
  await seedPerson('P-246-IN', '甲区内勤', deptAId, ['内勤'], '13900024601');
  await seedPerson('P-246-ST', '甲所内勤', stationAId, ['内勤'], '13900024602');
  handlerMainId = await seedPerson('P-246-H1', '主办甲', stationAId, ['经办'], '13900024603');
  handlerAssistId = await seedPerson('P-246-H2', '协办乙', stationAId, ['经办'], '13900024605');
  await seedPerson('P-246-RV', '所内审核', stationAId, ['行政审核'], '13900024604');
}, 180_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  cookies.clear();
});

describe('#246 期限', () => {
  it('新案默认 90 个日历日，起算日不计入，届满顺延，在途不计入，回流不重起，只提示不阻断', async () => {
    const caseId = await fileCase();
    const listed = await getJson(`/api/cases/${caseId}/deadlines`, 'P-246-H1');
    expect(listed.status).toBe(200);
    expect(listed.body.blocked).toBe(false);
    expect(listed.body.sourceUrl).toBe(SOURCE_URL);
    expect(listed.body.handling?.startedOn).toBe('2026-03-02');
    expect(listed.body.handling?.dueOn).toBe('2026-06-01');
    expect(listed.body.prompts).not.toContain(OVERDUE_PROMPT);

    const store = application.get<CaseStore>(CASE_STORE);
    const view = await store.readCaseView(caseId);
    if (!view) throw new Error('案件不存在');
    const seq = nextEntrySeq(
      view.instances.map((row: StageInstanceRow) => ({ stage: row.stage, entrySeq: row.entrySeq, status: row.status })),
      'E02',
    );
    expect(seq).toBeGreaterThan(1);
    expect(
      await store.appendStageInstance({
        id: newUlid(),
        caseId,
        stage: 'E02',
        entrySeq: seq,
        status: 'drafting',
        enteredAt: new Date('2026-03-20T04:00:00.000Z'),
        enteredBy: handlerMainId,
        transitionCode: 'T09',
      }),
    ).toBe(true);
    const anchor = await postJson(`/api/cases/${caseId}/deadline-anchors`, 'P-246-H1', {
      ruleKey: 'case.handle',
      entrySeq: seq,
      procedureNode: 'E02',
      startedOn: '2026-06-01',
      startingDocument: '第二次调查',
    });
    expect(anchor.status, JSON.stringify(anchor.body)).toBe(200);
    expect(anchor.body.startedOn).toBe('2026-03-02');
    expect(anchor.body.startingDocument).toBe('第二次调查');
    expect(anchor.body.dueOn).toBe('2026-06-01');
    const again = await postJson(`/api/cases/${caseId}/deadline-anchors`, 'P-246-H1', {
      ruleKey: 'case.handle',
      entrySeq: seq,
      procedureNode: 'E02',
      startedOn: '2026-03-02',
      startingDocument: '另一份文书',
    });
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('anchor-exists');

    const afterReflow = await getJson(`/api/cases/${caseId}/deadlines`, 'P-246-H1');
    const handleRows = handles(afterReflow.body);
    expect(handleRows.map((row) => row.entrySeq).sort()).toEqual([1, seq].sort());
    expect(new Set(handleRows.map((row) => row.dueOn))).toEqual(new Set(['2026-06-01']));
    expect(handleRows.find((row) => row.entrySeq === 1)?.startingDocument).toBeNull();

    const transit = await postJson(`/api/cases/${caseId}/period-events/system`, 'P-246-H1', {
      eventKind: 'in-transit',
      basisLabel: '在途',
      startedOn: '2026-03-10',
      endedOn: '2026-03-11',
    });
    expect(transit.status, JSON.stringify(transit.body)).toBe(200);
    const shifted = await getJson(`/api/cases/${caseId}/deadlines`, 'P-246-H1');
    expect(shifted.status).toBe(200);
    expect(shifted.body.blocked).toBe(false);
    expect(new Set(handles(shifted.body).map((row) => row.dueOn))).toEqual(new Set(['2026-06-02']));
  });

  it('消费停表和续表，未配对停表则停表且不阻断', async () => {
    const ranged = await fileCase();
    await getJson(`/api/cases/${ranged}/deadlines`, 'P-246-H1');
    await cloned.prisma.caseDeadlineEvent.create({
      data: {
        id: newUlid(),
        caseId: ranged,
        eventKind: 'stop',
        basisLabel: '中止',
        basisNote: '依据待确认',
        stage: 'E02',
        entrySeq: 1,
        transitionCode: 'T03',
        actorId: handlerMainId,
        createdAt: new Date('2026-03-10T04:00:00.000Z'),
      },
    });
    await cloned.prisma.caseDeadlineEvent.create({
      data: {
        id: newUlid(),
        caseId: ranged,
        eventKind: 'continue',
        basisLabel: '恢复',
        basisNote: '依据待确认',
        stage: 'E02',
        entrySeq: 1,
        transitionCode: 'T04',
        actorId: handlerMainId,
        createdAt: new Date('2026-03-20T04:00:00.000Z'),
      },
    });
    const rangedView = await getJson(`/api/cases/${ranged}/deadlines`, 'P-246-H1');
    expect(rangedView.body.handling?.dueOn).toBe('2026-06-10');
    expect(rangedView.body.handling?.paused).toBe(false);

    const paused = await fileCase();
    await getJson(`/api/cases/${paused}/deadlines`, 'P-246-H1');
    await cloned.prisma.caseDeadlineEvent.create({
      data: {
        id: newUlid(),
        caseId: paused,
        eventKind: 'stop',
        basisLabel: '中止',
        basisNote: '依据待确认',
        stage: 'E02',
        entrySeq: 1,
        transitionCode: 'T03',
        actorId: handlerMainId,
        createdAt: new Date('2026-03-10T04:00:00.000Z'),
      },
    });
    const pausedView = await getJson(`/api/cases/${paused}/deadlines`, 'P-246-H1');
    expect(pausedView.status).toBe(200);
    expect(pausedView.body.blocked).toBe(false);
    expect(pausedView.body.handling?.dueOn).toBeNull();
    expect(pausedView.body.handling?.paused).toBe(true);
    expect(pausedView.body.prompts).toContain(PAUSE_PROMPT);
  });

  it('超期只提示，延长呈批仍可提交', async () => {
    const caseId = await fileCase('2025-11-30T04:00:00.000Z');
    const listed = await getJson(`/api/cases/${caseId}/deadlines`, 'P-246-H1');
    expect(listed.status).toBe(200);
    expect(listed.body.blocked).toBe(false);
    expect(listed.body.handling?.dueOn).toBe('2026-02-28');
    expect(listed.body.prompts).toContain(OVERDUE_PROMPT);
    const drafted = await postJson(`/api/cases/${caseId}/deadline-extensions`, 'P-246-H1', { days: 1, reason: '补记' });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(200);
  });

  it('T34 批准顺延，超过 30 日不写特别复杂则 409，写了则放行并留痕', async () => {
    const capped = await fileCase();
    await getJson(`/api/cases/${capped}/deadlines`, 'P-246-H1');
    const over = await postJson(`/api/cases/${capped}/deadline-extensions`, 'P-246-H1', { days: 31, reason: '需要更多时间' });
    expect(over.status).toBe(409);
    expect(over.body.reason).toBe('over-cap');
    await approveDeadline(`/api/cases/${capped}/deadline-extensions`, { days: 30, reason: '案情需要' });
    const afterCap = await getJson(`/api/cases/${capped}/deadlines`, 'P-246-H1');
    expect(afterCap.body.handling?.dueOn).toBe('2026-06-30');
    expect(afterCap.body.periodEvents.filter((row) => row.kind === 'extension')).toHaveLength(1);

    const complex = await fileCase();
    await getJson(`/api/cases/${complex}/deadlines`, 'P-246-H1');
    await approveDeadline(`/api/cases/${complex}/deadline-extensions`, {
      days: 31,
      reason: '案情特别复杂，需要继续调查',
    });
    const afterComplex = await getJson(`/api/cases/${complex}/deadlines`, 'P-246-H1');
    expect(afterComplex.body.handling?.dueOn).toBe('2026-07-01');
    const trails = await details('deadline.approved', complex);
    expect(trails.some((row) => row.outcome === 'succeeded' && row.detail?.includes('案情特别复杂'))).toBe(true);
  });

  it('补登理由必填，非法区间 409，未批准不生效，批准后只追加', async () => {
    const caseId = await fileCase();
    const missing = await postJson(`/api/cases/${caseId}/period-events`, 'P-246-H1', {
      eventKind: 'appraisal',
      reason: '  ',
      basisLabel: '鉴定',
      startedOn: '2026-03-10',
      endedOn: '2026-03-12',
      backfill: true,
    });
    expect(missing.status).toBe(400);
    expect(missing.body.reason).toBe('missing-reason');
    const invalid = await postJson(`/api/cases/${caseId}/period-events`, 'P-246-H1', {
      eventKind: 'appraisal',
      reason: '补记鉴定',
      basisLabel: '鉴定',
      startedOn: '2026-03-12',
      endedOn: '2026-03-10',
      backfill: true,
    });
    expect(invalid.status).toBe(409);
    expect(invalid.body.reason).toBe('invalid-interval');
    const drafted = await postJson(`/api/cases/${caseId}/period-events`, 'P-246-H1', {
      eventKind: 'appraisal',
      reason: '补记鉴定',
      basisLabel: '鉴定委托',
      startedOn: '2026-03-10',
      endedOn: '2026-03-12',
      backfill: true,
    });
    expect(drafted.status).toBe(200);
    const pending = await getJson(`/api/cases/${caseId}/deadlines`, 'P-246-H1');
    expect(pending.body.periodEvents).toHaveLength(0);
    const before = await cloned.prisma.casePeriodEvent.count({ where: { caseId } });
    await approveDeadline(`/api/cases/${caseId}/period-events`, {
      eventKind: 'appraisal',
      reason: '补记鉴定',
      basisLabel: '鉴定委托',
      startedOn: '2026-03-10',
      endedOn: '2026-03-12',
      backfill: true,
    });
    const after = await getJson(`/api/cases/${caseId}/deadlines`, 'P-246-H1');
    expect(after.body.periodEvents).toHaveLength(before + 1);
    expect(after.body.periodEvents[0]).toMatchObject({ kind: 'appraisal', source: 'manual', status: 'effective', backfill: true });
    const rows = await cloned.prisma.casePeriodEvent.findMany({ where: { caseId } });
    expect(rows).toHaveLength(1);
  });

  it('系统事件不经呈批直接生效', async () => {
    const caseId = await fileCase();
    const recorded = await postJson(`/api/cases/${caseId}/period-events/system`, 'P-246-H1', {
      eventKind: 'hearing',
      basisLabel: '听证',
      startedOn: '2026-03-04',
      endedOn: '2026-03-06',
    });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200);
    expect(recorded.body.source).toBe('system');
    expect(await cloned.prisma.caseDeadlineApproval.count({ where: { caseId } })).toBe(0);
    const listed = await getJson(`/api/cases/${caseId}/deadlines`, 'P-246-H1');
    expect(listed.body.periodEvents).toEqual([
      expect.objectContaining({ kind: 'hearing', source: 'system', status: 'effective', approvalId: null }),
    ]);
  });

  it('规则键带继续消耗或重新起算，工作日含调休，配置带来源', async () => {
    const caseId = await fileCase();
    const legal = await postJson(`/api/cases/${caseId}/deadline-anchors`, 'P-246-H1', {
      ruleKey: 'legal-review.round',
      entrySeq: 1,
      procedureNode: 'E06',
      startedOn: '2026-01-05',
      startingDocument: '送审稿',
    });
    expect(legal.status, JSON.stringify(legal.body)).toBe(200);
    expect(legal.body).toMatchObject({
      consumption: 'restart',
      consumptionName: '重新起算',
      ruleVersion: '2026-10-27',
      dayCount: 5,
      dayBasis: 'working',
      partyFacing: false,
      extensionAllowance: 10,
      dueOn: '2026-01-12',
    });
    const hearing = await postJson(`/api/cases/${caseId}/deadline-anchors`, 'P-246-H1', {
      ruleKey: 'hearing.apply',
      entrySeq: 1,
      procedureNode: 'E05',
      startedOn: '2026-01-03',
      startingDocument: '告知书',
    });
    expect(hearing.status, JSON.stringify(hearing.body)).toBe(200);
    expect(hearing.body).toMatchObject({
      consumption: 'restart',
      ruleVersion: '2026-10-27',
      dayCount: 5,
      dayBasis: 'working',
      partyFacing: true,
      dueOn: '2026-01-08',
    });
    const second = await postJson(`/api/cases/${caseId}/deadline-anchors`, 'P-246-H1', {
      ruleKey: 'hearing.apply',
      entrySeq: 2,
      procedureNode: 'E05',
      startedOn: '2026-03-02',
      startingDocument: '重新告知',
    });
    expect(second.status).toBe(200);
    expect(second.body.dueOn).toBe('2026-03-09');
    const listed = await getJson(`/api/cases/${caseId}/deadlines`, 'P-246-H1');
    expect(listed.body.sourceUrl).toBe(SOURCE_URL);
    expect(listed.body.rows.filter((row) => row.ruleKey === 'hearing.apply').map((row) => row.entrySeq).sort()).toEqual([1, 2]);
  });

  it('跨入未装年份提示人工确认并留痕；换表追加修订，当事人期限不提前，已届满和视为放弃的行不动', async () => {
    const caseId = await fileCase();
    const crossing = await postJson(`/api/cases/${caseId}/deadline-anchors`, 'P-246-H1', {
      ruleKey: 'legal-review.round',
      entrySeq: 2,
      procedureNode: 'E06',
      startedOn: '2026-12-31',
      startingDocument: '年末送审',
    });
    expect(crossing.status, JSON.stringify(crossing.body)).toBe(200);
    expect(crossing.body.dueOn).toBeNull();
    expect(crossing.body.needsManualConfirmation).toBe(true);
    expect(crossing.body.trace).toBe(MANUAL_TRACE);
    const traces = await details('deadline.recorded', caseId);
    expect(traces.some((row) => row.outcome === 'succeeded' && row.detail?.includes(MANUAL_TRACE))).toBe(true);

    const hearing = await postJson(`/api/cases/${caseId}/deadline-anchors`, 'P-246-H1', {
      ruleKey: 'hearing.apply',
      entrySeq: 1,
      procedureNode: 'E05',
      startedOn: '2026-09-18',
      startingDocument: '告知书',
    });
    expect(hearing.body.dueOn).toBe('2026-09-24');
    const legal = await postJson(`/api/cases/${caseId}/deadline-anchors`, 'P-246-H1', {
      ruleKey: 'legal-review.round',
      entrySeq: 1,
      procedureNode: 'E06',
      startedOn: '2026-09-18',
      startingDocument: '送审稿',
    });
    expect(legal.body.dueOn).toBe('2026-09-24');
    const expired = await postJson(`/api/cases/${caseId}/deadline-anchors`, 'P-246-H1', {
      ruleKey: 'hearing.apply',
      entrySeq: 3,
      procedureNode: 'E05',
      startedOn: '2026-01-05',
      startingDocument: '早已告知',
    });
    expect(expired.body.dueOn).toBe('2026-01-12');
    const waived = await postJson(`/api/cases/${caseId}/deadline-anchors`, 'P-246-H1', {
      ruleKey: 'transfer.notice',
      entrySeq: 1,
      procedureNode: 'E07',
      startedOn: '2026-09-18',
      startingDocument: '移送告知',
    });
    expect(waived.status).toBe(200);
    const source = await cloned.prisma.caseDeadlineRow.findFirstOrThrow({
      where: { caseId, ruleKey: 'transfer.notice', revisionNo: 0 },
    });
    await cloned.prisma.caseDeadlineRow.create({
      data: {
        id: newUlid(),
        caseId: source.caseId,
        ruleKey: source.ruleKey,
        entrySeq: source.entrySeq,
        procedureNode: source.procedureNode,
        startingDocument: source.startingDocument,
        consumption: source.consumption,
        ruleVersion: source.ruleVersion,
        dayCount: source.dayCount,
        dayBasis: source.dayBasis,
        partyFacing: source.partyFacing,
        extensionAllowance: source.extensionAllowance,
        startedOn: source.startedOn,
        dueOn: source.dueOn,
        needsManualConfirmation: false,
        confirmationTrace: null,
        rowStatus: 'deemed-waived',
        revisionNo: 1,
        calendarVersion: source.calendarVersion,
        clamped: false,
      },
    });

    const patched = await postJson('/api/deadline/calendar-installs', 'P-APPROVE-HQ', {
      version: 'test-2026-09-19',
      year: 2026,
      holidays: [],
      makeupWorkdays: ['2026-09-19'],
      sourceUrl: 'https://example.test/2026',
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const revised = await getJson(`/api/cases/${caseId}/deadlines`, 'P-246-H1');
    const hearingRows = revised.body.rows.filter((row) => row.ruleKey === 'hearing.apply' && row.entrySeq === 1);
    expect(hearingRows.map((row) => row.revisionNo).sort()).toEqual([0, 1]);
    expect(hearingRows.find((row) => row.revisionNo === 0)?.dueOn).toBe('2026-09-24');
    expect(hearingRows.find((row) => row.revisionNo === 1)).toMatchObject({ dueOn: '2026-09-24', clamped: true });
    const legalRows = revised.body.rows.filter((row) => row.ruleKey === 'legal-review.round' && row.entrySeq === 1);
    expect(legalRows.find((row) => row.revisionNo === 1)?.dueOn).toBe('2026-09-23');
    expect(legalRows.find((row) => row.revisionNo === 1)?.clamped).toBe(false);
    expect(revised.body.rows.filter((row) => row.ruleKey === 'hearing.apply' && row.entrySeq === 3)).toHaveLength(1);
    const waivedRows = revised.body.rows.filter((row) => row.ruleKey === 'transfer.notice');
    expect(waivedRows.map((row) => row.revisionNo).sort()).toEqual([0, 1]);
    expect(waivedRows.find((row) => row.revisionNo === 1)?.rowStatus).toBe('deemed-waived');

    const installed = await postJson('/api/deadline/calendar-installs', 'P-APPROVE-HQ', {
      version: 'test-2027',
      year: 2027,
      holidays: ['2027-01-01'],
      makeupWorkdays: [],
      sourceUrl: 'https://example.test/2027',
    });
    expect(installed.status, JSON.stringify(installed.body)).toBe(200);
    const afterYear = await getJson(`/api/cases/${caseId}/deadlines`, 'P-246-H1');
    const crossed = afterYear.body.rows.filter((row) => row.ruleKey === 'legal-review.round' && row.entrySeq === 2);
    expect(crossed.some((row) => row.dueOn === null && row.needsManualConfirmation)).toBe(true);
    expect(crossed.find((row) => row.revisionNo === crossed.reduce((max, row) => Math.max(max, row.revisionNo), 0))?.dueOn).toBe(
      '2027-01-08',
    );
  });
});
