// #235 案件状态机：T01／T02 走引擎，未启用边与 X12／X13／X17／X18 不改业务行。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CASE_STORE, nextEntrySeq, type CaseStore } from '../backend/case/src/index.ts';
import { newUlid } from '../backend/identity/src/index.ts';
import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-27T05:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Case-state-235!';
const INITIAL_PASSWORD = 'State-235!!';

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
      'clue.patrol_no': `XC-235-${polygonOffset}`,
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
      cookie: await cookieOf('P-235-IN'),
      'idempotency-key': `state-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  return (await response.json()) as { id: string; code: string };
}

async function toHandlerAssigned(clueId: string): Promise<void> {
  const org = await fetch(`${baseUrl}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-235-IN') },
    body: JSON.stringify({ orgUnitId: stationAId, expectedStatus: 'in_pool', reason: '', designate: false }),
  });
  expect(org.status).toBe(200);
  const people = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-235-ST') },
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

async function countInstances(caseId: string): Promise<number> {
  const rows = await cloned.prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM case_stage_instance WHERE case_id = ${caseId}
  `;
  return rows[0]?.n ?? 0;
}

async function countHistory(caseId: string): Promise<number> {
  const rows = await cloned.prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM case_transition WHERE case_id = ${caseId}
  `;
  return rows[0]?.n ?? 0;
}

interface TrailRow {
  readonly outcome: string | null;
  readonly reason: string | null;
}

async function transitionTrail(resourceId: string): Promise<TrailRow[]> {
  return cloned.prisma.$queryRaw<TrailRow[]>`
    SELECT outcome, reason
    FROM audit_trail
    WHERE action = 'case.transitioned' AND resource_id = ${resourceId}
    ORDER BY created_at ASC, id ASC
  `;
}

async function preparedClue(): Promise<string> {
  offset += 1;
  const registered = await register(offset);
  await toHandlerAssigned(registered.id);
  return registered.id;
}

async function fileCase(partyNames: readonly string[]): Promise<{ clueId: string; caseId: string; body: Record<string, unknown> }> {
  const clueId = await preparedClue();
  const drafted = await postJson(`/api/clues/${clueId}/filing-approval`, 'P-235-H1', {
    content: { conclusion: 'file', partyNames: [...partyNames] },
  });
  expect(drafted.status).toBe(200);
  const approvalId = String(drafted.body.approvalId);
  expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, 'P-235-H1')).status).toBe(200);
  const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
  expect(approved.status).toBe(200);
  return { clueId, caseId: String(approved.body.caseId), body: approved.body };
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
  await seedPerson('P-235-IN', '甲区内勤', deptAId, ['内勤'], '13900023501');
  await seedPerson('P-235-ST', '甲所内勤', stationAId, ['内勤'], '13900023502');
  handlerMainId = await seedPerson('P-235-H1', '主办甲', stationAId, ['经办'], '13900023503');
  handlerAssistId = await seedPerson('P-235-H2', '协办乙', stationAId, ['经办'], '13900023504');
  await seedPerson('P-235-SU', '监督甲', stationAId, ['监督'], '13900023505');
}, 120_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  cookies.clear();
});

describe('#235 案件状态机', () => {
  it('T01 批准写入 E01 完成、E02 拟制中、次序号 1 和迁移历史；读接口能看到', async () => {
    const { clueId, caseId, body } = await fileCase(['张三']);
    expect(body).toMatchObject({
      result: 'filing-approved',
      conclusion: 'file',
      clueStatus: 'filed',
      caseId,
    });
    const view = await getJson(`/api/cases/${caseId}`, 'P-APPROVE-HQ');
    expect(view.status).toBe(200);
    expect(view.body.status).toBe('in_progress');
    expect(view.body.statusName).toBe('办理中');
    expect(view.body.currentStage).toBe('E02');
    expect(view.body.stageName).toBe('调查');
    expect(view.body.stageEntrySeq).toBe(1);
    const instances = view.body.instances as Array<{ stage: string; entrySeq: number; status: string }>;
    expect(instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: 'E01', entrySeq: 1, status: 'completed' }),
        expect.objectContaining({ stage: 'E02', entrySeq: 1, status: 'drafting' }),
      ]),
    );
    expect(instances).toHaveLength(2);
    const history = view.body.history as Array<{ transitionCode: string }>;
    expect(history.map((row) => row.transitionCode)).toEqual(['T01']);
    const trail = await transitionTrail(clueId);
    expect(trail.some((row) => row.outcome == null || row.outcome === 'succeeded')).toBe(true);
  });

  it('T02 批准不建案件，迁移历史只有线索', async () => {
    const clueId = await preparedClue();
    const drafted = await postJson(`/api/clues/${clueId}/filing-approval`, 'P-235-H1', {
      content: {
        conclusion: 'no-case',
        noCaseReason: { kind: 'non-filing-grounds', grounds: ['art16-2-no-violation-fact'] },
      },
    });
    expect(drafted.status).toBe(200);
    const approvalId = String(drafted.body.approvalId);
    expect((await postJson(`/api/filing-approvals/${approvalId}/submit`, 'P-235-H1')).status).toBe(200);
    const approved = await postJson(`/api/filing-approvals/${approvalId}/approve`, 'P-APPROVE-HQ', { opinion: '同意' });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ conclusion: 'no-case', clueStatus: 'closed' });
    expect(approved.body.caseId).toBeUndefined();
    expect(await cloned.prisma.caseRecord.findFirst({ where: { filingApprovalId: approvalId } })).toBeNull();
    const rows = await cloned.prisma.$queryRaw<Array<{ case_id: string | null; transition_code: string }>>`
      SELECT case_id, transition_code FROM case_transition WHERE clue_id = ${clueId}
    `;
    expect(rows).toEqual([{ case_id: null, transition_code: 'T02' }]);
  });

  it('未启用的边 409 transition-disabled，不写实例和历史，留一条失败痕', async () => {
    const { caseId } = await fileCase(['李四']);
    const instances = await countInstances(caseId);
    const history = await countHistory(caseId);
    const denied = await postJson(`/api/cases/${caseId}/transitions`, 'P-APPROVE-HQ', { transitionId: 'T10' });
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('transition-disabled');
    expect(await countInstances(caseId)).toBe(instances);
    expect(await countHistory(caseId)).toBe(history);
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.status).toBe('in_progress');
    expect(row.currentStage).toBe('E02');
    const trail = await transitionTrail(caseId);
    expect(trail).toEqual([expect.objectContaining({ outcome: 'failed', reason: 'transition-disabled' })]);
  });

  it('起点不符 409 invalid-state，不写业务行', async () => {
    const { caseId } = await fileCase(['王五']);
    const instances = await countInstances(caseId);
    const history = await countHistory(caseId);
    const denied = await postJson(`/api/cases/${caseId}/transitions`, 'P-APPROVE-HQ', { transitionId: 'T01' });
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('invalid-state');
    expect(await countInstances(caseId)).toBe(instances);
    expect(await countHistory(caseId)).toBe(history);
    const trail = await transitionTrail(caseId);
    expect(trail).toEqual([expect.objectContaining({ outcome: 'failed', reason: 'invalid-state' })]);
  });

  it('终态业务写 409 X12；白名单上的 T27 仍是未启用；阅读放行', async () => {
    const { caseId } = await fileCase(['赵六']);
    await cloned.prisma.caseRecord.update({ where: { id: caseId }, data: { status: 'closed' } });
    const t27 = await postJson(`/api/cases/${caseId}/transitions`, 'P-APPROVE-HQ', { transitionId: 'T27' });
    expect(t27.status).toBe(409);
    expect(t27.body.reason).toBe('transition-disabled');
    const rowAfterT27 = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(rowAfterT27.status).toBe('closed');

    for (const status of ['withdrawn', 'closed', 'finalized'] as const) {
      await cloned.prisma.caseRecord.update({ where: { id: caseId }, data: { status } });
      const denied = await postJson(`/api/cases/${caseId}/transitions`, 'P-APPROVE-HQ', { transitionId: 'T03' });
      expect(denied.status).toBe(409);
      expect(denied.body.reason).toBe('X12');
      expect(denied.body.basis).toBe('immutability §2 第 4 点；#235 评论 6431387386');
      expect(typeof denied.body.outlet).toBe('string');
      expect(String(denied.body.outlet).length).toBeGreaterThan(0);
      const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
      expect(row.status).toBe(status);
    }

    const read = await getJson(`/api/cases/${caseId}`, 'P-235-SU');
    expect(read.status).toBe(200);
    expect(read.body.status).toBe('finalized');
    expect(read.body.currentStage).toBe('E02');
  });

  it('只有监督角色的人迁移 409 X17，主状态不变；经办缺批准权仍是 403', async () => {
    const { caseId } = await fileCase(['钱七']);
    const denied = await postJson(`/api/cases/${caseId}/transitions`, 'P-235-SU', { transitionId: 'T03' });
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('X17');
    expect(denied.body.basis).toBe('GLOSSARY「监督」');
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.status).toBe('in_progress');
    expect(row.currentStage).toBe('E02');
    expect(row.stageEntrySeq).toBe(1);
    const handler = await postJson(`/api/cases/${caseId}/transitions`, 'P-235-H1', { transitionId: 'T03' });
    expect(handler.status).toBe(403);
    expect(handler.body.reason).toBe('permission-denied');
    const after = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(after.status).toBe('in_progress');
  });

  it('第二条进行中的审批链 409 X18，案件指针不变；种类不合格 400', async () => {
    const { caseId } = await fileCase(['孙八']);
    const first = await postJson(`/api/cases/${caseId}/approval-chains`, 'P-235-H1', { kind: 'document' });
    expect(first.status).toBe(200);
    expect(first.body.result).toBe('approval-chain-opened');
    const second = await postJson(`/api/cases/${caseId}/approval-chains`, 'P-235-H1', { kind: 'hearing' });
    expect(second.status).toBe(409);
    expect(second.body.reason).toBe('X18');
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.status).toBe('in_progress');
    expect(row.currentStage).toBe('E02');
    expect(row.stageEntrySeq).toBe(1);
    const trail = await transitionTrail(caseId);
    expect(trail.filter((item) => item.reason === 'X18')).toEqual([
      expect.objectContaining({ outcome: 'failed', reason: 'X18' }),
    ]);
    const bad = await postJson(`/api/cases/${caseId}/approval-chains`, 'P-235-H1', { kind: 'Bad Kind' });
    expect(bad.status).toBe(400);
    expect(bad.body.reason).toBe('invalid-approval-chain-kind');
  });

  it('立案后改承办机构 409 X13，机构列不变；库层触发器也拒绝', async () => {
    const { caseId } = await fileCase(['周九']);
    const denied = await postJson(`/api/cases/${caseId}/transitions`, 'P-APPROVE-HQ', {
      transitionId: 'T03',
      handlingOrgId: deptAId,
    });
    expect(denied.status).toBe(409);
    expect(denied.body.reason).toBe('X13');
    expect(denied.body.basis).toBe('#40 Q29');
    const row = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(row.handlingOrgId).toBe(stationAId);
    await expect(
      cloned.prisma.$executeRaw`UPDATE case_record SET handling_org_id = ${deptAId} WHERE id = ${caseId}`,
    ).rejects.toThrow();
    const after = await cloned.prisma.caseRecord.findUniqueOrThrow({ where: { id: caseId } });
    expect(after.handlingOrgId).toBe(stationAId);
  });

  it('再次进入写新次序号，旧实例仍可查；HTTP 未启用边不写；触发器拒绝改删', async () => {
    const { caseId } = await fileCase(['吴十']);
    const before = await countInstances(caseId);
    const t10 = await postJson(`/api/cases/${caseId}/transitions`, 'P-APPROVE-HQ', { transitionId: 'T10' });
    expect(t10.status).toBe(409);
    expect(t10.body.reason).toBe('transition-disabled');
    expect(await countInstances(caseId)).toBe(before);

    const store = app.get<CaseStore>(CASE_STORE);
    const view = await store.readCaseView(caseId);
    if (!view) throw new Error('缺少案件');
    const seq = nextEntrySeq(view.instances, 'E02');
    expect(seq).toBe(2);
    const inserted = await store.appendStageInstance({
      id: newUlid(),
      caseId,
      stage: 'E02',
      entrySeq: seq,
      status: 'drafting',
      enteredAt: new Date(T0),
      enteredBy: handlerMainId,
      transitionCode: 'T09',
    });
    expect(inserted).toBe(true);
    await cloned.prisma.caseRecord.update({ where: { id: caseId }, data: { stageEntrySeq: seq } });

    const read = await getJson(`/api/cases/${caseId}`, 'P-235-H1');
    expect(read.status).toBe(200);
    expect(read.body.stageEntrySeq).toBe(2);
    const e02 = (read.body.instances as Array<{ stage: string; entrySeq: number; status: string }>).filter(
      (row) => row.stage === 'E02',
    );
    expect(e02.map((row) => row.entrySeq).sort()).toEqual([1, 2]);
    expect(e02.find((row) => row.entrySeq === 1)?.status).toBe('drafting');

    const instanceId = String(
      (read.body.instances as Array<{ id: string; entrySeq: number; stage: string }>).find(
        (row) => row.stage === 'E02' && row.entrySeq === 1,
      )?.id,
    );
    await expect(
      cloned.prisma.$executeRaw`UPDATE case_stage_instance SET status = 'completed' WHERE id = ${instanceId}`,
    ).rejects.toThrow();
    await expect(
      cloned.prisma.$executeRaw`DELETE FROM case_stage_instance WHERE id = ${instanceId}`,
    ).rejects.toThrow();
    const historyId = String((read.body.history as Array<{ id: string }>)[0]?.id);
    await expect(
      cloned.prisma.$executeRaw`UPDATE case_transition SET to_json = '{}' WHERE id = ${historyId}`,
    ).rejects.toThrow();
    await expect(
      cloned.prisma.$executeRaw`DELETE FROM case_transition WHERE id = ${historyId}`,
    ).rejects.toThrow();
    expect(await countInstances(caseId)).toBe(before + 1);
    expect(await countHistory(caseId)).toBe(1);
  });
});
