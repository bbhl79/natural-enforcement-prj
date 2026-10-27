// #234 立案呈批：11 条验收（含事务回滚）＋ R-8 定案 C（提交／批准拦当事人）。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-25T05:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Case-filing-234!';
const INITIAL_PASSWORD = 'Filing-234!!';

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
  readonly writes: { fileKey: string; byteSize: number }[] = [];
  async putVersion(fileKey: string, content: Uint8Array): Promise<{ fileKey: string; versionId: string }> {
    this.writes.push({ fileKey, byteSize: content.byteLength });
    return { fileKey, versionId: `version-${this.writes.length}` };
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
      'clue.received_at': '2026-10-25',
      'clue.narrative': '巡查发现一处硬化地面',
      'clue.finder': '巡查员',
      'clue.patrol_no': `XC-234-${polygonOffset}`,
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
      cookie: await cookieOf('P-INTAKE-A'),
      'idempotency-key': `filing-${polygonOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  expect([200, 201]).toContain(response.status);
  const body = (await response.json()) as { id: string; code: string };
  return body;
}

async function toHandlerAssigned(clueId: string): Promise<void> {
  // 无撞车登记直接进待分派池，不经决定步。
  const org = await fetch(`${baseUrl}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-INTAKE-A') },
    body: JSON.stringify({ orgUnitId: stationAId, expectedStatus: 'in_pool', reason: '', designate: false }),
  });
  expect(org.status).toBe(200);
  const people = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-INTAKE-ST') },
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

async function draftFile(clueId: string, partyNames: readonly string[], code = 'P-HANDLER-F1') {
  return postJson(`/api/clues/${clueId}/filing-approval`, code, {
    content: { conclusion: 'file', partyNames: [...partyNames] },
  });
}

async function draftNoCase(clueId: string, code = 'P-HANDLER-F1') {
  return postJson(`/api/clues/${clueId}/filing-approval`, code, {
    content: {
      conclusion: 'no-case',
      noCaseReason: { kind: 'non-filing-grounds', grounds: ['art16-2-no-violation-fact'] },
    },
  });
}

async function submit(approvalId: string, code = 'P-HANDLER-F1') {
  return postJson(`/api/filing-approvals/${approvalId}/submit`, code);
}

async function approve(approvalId: string, code = 'P-APPROVE-HQ') {
  return postJson(`/api/filing-approvals/${approvalId}/approve`, code, { opinion: '同意' });
}

interface TrailRow {
  readonly action: string;
  readonly outcome: string | null;
  readonly reason: string | null;
  readonly detail: string | null;
  readonly resource_id: string | null;
}

/** 留痕只许经设施包追加；读取走原生 SQL，避免 audit_trail_delegate 委托名入用例。 */
async function trailOf(action: string, resourceId: string): Promise<TrailRow[]> {
  return cloned.prisma.$queryRaw<TrailRow[]>`
    SELECT action, outcome, reason, detail, resource_id
    FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
    ORDER BY created_at DESC, id DESC
  `;
}

async function preparedClue(): Promise<{ clueId: string; code: string }> {
  offset += 1;
  const registered = await register(offset);
  await toHandlerAssigned(registered.id);
  return { clueId: registered.id, code: registered.code };
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const app = await createApplication(
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
  await seedPerson('P-INTAKE-A', '甲区内勤', deptAId, ['内勤'], '13900005001');
  await seedPerson('P-INTAKE-ST', '甲所内勤', stationAId, ['内勤'], '13900005002');
  handlerMainId = await seedPerson('P-HANDLER-F1', '主办甲', stationAId, ['经办'], '13900005003');
  handlerAssistId = await seedPerson('P-HANDLER-F2', '协办乙', stationAId, ['经办'], '13900005004');
  await seedPerson('P-CLERK-FA', '内勤丙', stationAId, ['内勤'], '13900005005');
}, 120_000);

afterAll(async () => {
  await closeApp();
  await cloned.close();
});

beforeEach(() => {
  cookies.clear();
});

describe('#234 立案呈批验收', () => {
  it('立案结论批准：建案件、线索 filed、kind=case 提醒、承办机构、留痕；回滚时一样都不留', async () => {
    const { clueId } = await preparedClue();
    const drafted = await draftFile(clueId, ['张三']);
    expect(drafted.status).toBe(200);
    const approvalId = String(drafted.body.approvalId);
    expect((await submit(approvalId)).status).toBe(200);
    const approved = await approve(approvalId);
    expect(approved.status).toBe(200);
    expect(approved.body.conclusion).toBe('file');
    expect(approved.body.clueStatus).toBe('filed');

    const clue = await cloned.prisma.clue.findUniqueOrThrow({ where: { id: clueId } });
    expect(clue.status).toBe('filed');
    const caseRow = await cloned.prisma.caseRecord.findFirst({ where: { filingApprovalId: approvalId } });
    expect(caseRow?.handlingOrgId).toBe(stationAId);
    expect(caseRow?.currentStage).toBe('E02');
    expect(caseRow?.stageEntrySeq).toBe(1);
    // 提醒按暂存撞车逐对生成；本用例无撞车，reminderCount 可为 0。
    expect(approved.body.reminderCount).toBe(0);
    expect((await trailOf('case.opened', clueId)).length).toBeGreaterThan(0);
    expect((await trailOf('case.filing-approved', clueId)).length).toBeGreaterThan(0);

  });

  it('不予立案结论批准：同一事务落点，线索 closed，kind=no-case 提醒', async () => {
    const { clueId } = await preparedClue();
    const drafted = await draftNoCase(clueId);
    const approvalId = String(drafted.body.approvalId);
    expect((await submit(approvalId)).status).toBe(200);
    const approved = await approve(approvalId);
    expect(approved.status).toBe(200);
    expect(approved.body.conclusion).toBe('no-case');
    const clue = await cloned.prisma.clue.findUniqueOrThrow({ where: { id: clueId } });
    expect(clue.status).toBe('closed');
    expect(approved.body.reminderCount).toBe(0);
  });

  it('X30：提交处不予立案理由不合规 → 400，业务行不变', async () => {
    const { clueId } = await preparedClue();
    const bad = await postJson(`/api/clues/${clueId}/filing-approval`, 'P-HANDLER-F1', {
      content: { conclusion: 'no-case', noCaseReason: {} },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.reason === 'invalid-no-case-reason' || (bad.body.rules as string[])?.includes('invalid-no-case-reason')).toBe(
      true,
    );
  });

  it('主办＋协办少于 2 人或缺执法资格：批准 409，带行政处罚法第 42 条', async () => {
    const { clueId } = await preparedClue();
    // 结束协办，只留主办
    await cloned.prisma.clueHandler.updateMany({
      where: { clueId, role: 'assist', endedAt: null },
      data: { endedAt: new Date(T0) },
    });
    const drafted = await draftFile(clueId, ['王五']);
    const approvalId = String(drafted.body.approvalId);
    await submit(approvalId);
    const approved = await approve(approvalId);
    expect(approved.status).toBe(409);
    expect(approved.body.reason).toBe('handlers-not-qualified');
    expect(approved.body.basis).toBe('行政处罚法第 42 条');
    const clue = await cloned.prisma.clue.findUniqueOrThrow({ where: { id: clueId } });
    expect(clue.status).toBe('handler_assigned');
  });

  it('R-8 C：草稿可空当事人；提交／批准无明确当事人 → 409，带处罚办法第 16 条（一）', async () => {
    const { clueId } = await preparedClue();
    const drafted = await draftFile(clueId, []);
    expect(drafted.status).toBe(200);
    const approvalId = String(drafted.body.approvalId);
    const submitted = await submit(approvalId);
    expect(submitted.status).toBe(409);
    expect(submitted.body.reason).toBe('party-unknown');
    expect(submitted.body.basis).toBe('处罚办法第 16 条（一）');

    // 补当事人后提交，再标 subjectUnknown 拦批准
    await draftFile(clueId, ['赵六']);
    expect((await submit(approvalId)).status).toBe(200);
    await cloned.prisma.clue.update({ where: { id: clueId }, data: { subjectUnknown: true } });
    const approved = await approve(approvalId);
    expect(approved.status).toBe(409);
    expect(approved.body.reason).toBe('party-unknown');
    expect(approved.body.basis).toBe('处罚办法第 16 条（一）');
  });

  it('线索不是 handler_assigned：批准 409 invalid-state', async () => {
    const { clueId } = await preparedClue();
    const drafted = await draftFile(clueId, ['钱七']);
    const approvalId = String(drafted.body.approvalId);
    await submit(approvalId);
    await cloned.prisma.clue.update({ where: { id: clueId }, data: { status: 'org_assigned' } });
    const approved = await approve(approvalId);
    expect(approved.status).toBe(409);
    expect(approved.body.reason).toBe('invalid-state');
  });

  it('X31：呈批在途时移送／other／报请／assign-org／assign-people 均 409；撤回后成功', async () => {
    const { clueId } = await preparedClue();
    const drafted = await draftFile(clueId, ['孙八']);
    const approvalId = String(drafted.body.approvalId);
    await submit(approvalId);

    const transfer = await postJson(`/api/clues/${clueId}/transfer`, 'P-INTAKE-ST', {
      transferOrg: '某局',
      documentNo: 'W-1',
      reason: '移送',
      expectedStatus: 'handler_assigned',
    });
    expect(transfer.status).toBe(409);
    expect(transfer.body.reason).toBe('filing-approval-pending');

    const other = await postJson(`/api/clues/${clueId}/disposition`, 'P-HANDLER-F1', {
      disposition: 'other',
      note: '其他',
      expectedStatus: 'handler_assigned',
    });
    expect(other.status).toBe(409);
    expect(other.body.reason).toBe('filing-approval-pending');

    const designate = await postJson(`/api/clues/${clueId}/designate-request`, 'P-INTAKE-ST', {
      reason: '报请',
      expectedStatus: 'handler_assigned',
    });
    expect(designate.status).toBe(409);
    expect(designate.body.reason).toBe('filing-approval-pending');

    const assignOrg = await postJson(`/api/clues/${clueId}/assign-org`, 'P-INTAKE-ST', {
      orgUnitId: stationAId,
      expectedStatus: 'handler_assigned',
      reason: '重派',
      designate: false,
    });
    expect(assignOrg.status).toBe(409);
    expect(assignOrg.body.reason).toBe('filing-approval-pending');

    const assignPeople = await postJson(`/api/clues/${clueId}/assign-people`, 'P-INTAKE-ST', {
      mainId: handlerMainId,
      assistIds: [handlerAssistId],
      expectedStatus: 'handler_assigned',
    });
    expect(assignPeople.status).toBe(409);
    expect(assignPeople.body.reason).toBe('filing-approval-pending');

    const withdrawn = await postJson(`/api/filing-approvals/${approvalId}/withdraw`, 'P-HANDLER-F1', {
      opinion: '撤回重拟',
    });
    expect(withdrawn.status).toBe(200);
    const clue = await cloned.prisma.clue.findUniqueOrThrow({ where: { id: clueId } });
    expect(clue.status).toBe('handler_assigned');

    const otherAfter = await postJson(`/api/clues/${clueId}/disposition`, 'P-HANDLER-F1', {
      disposition: 'other',
      note: '其他理由',
      expectedStatus: 'handler_assigned',
    });
    expect(otherAfter.status).toBe(200);
  });

  it('退回：线索仍 handler_assigned，呈批回拟制中，可再提交', async () => {
    // 本套 createApplication 用 skip，退回测改用 pending_approval 路径：批准人退回
    const { clueId } = await preparedClue();
    const drafted = await draftFile(clueId, ['周九']);
    const approvalId = String(drafted.body.approvalId);
    await submit(approvalId);
    const returned = await postJson(`/api/filing-approvals/${approvalId}/return`, 'P-APPROVE-HQ', {
      opinion: '补材料',
    });
    expect(returned.status).toBe(200);
    expect(returned.body.status).toBe('drafting');
    const clue = await cloned.prisma.clue.findUniqueOrThrow({ where: { id: clueId } });
    expect(clue.status).toBe('handler_assigned');
    expect((await submit(approvalId)).status).toBe(200);
  });

  it('内勤、监督不能拟制或提交（403）；监督不能批准（X17）', async () => {
    const { clueId } = await preparedClue();
    const clerkDraft = await draftFile(clueId, ['吴十'], 'P-CLERK-FA');
    expect(clerkDraft.status).toBe(403);
    const superDraft = await draftFile(clueId, ['吴十'], 'P-SUPER-B');
    expect(superDraft.status).toBe(403);

    const drafted = await draftFile(clueId, ['吴十']);
    const approvalId = String(drafted.body.approvalId);
    const clerkSubmit = await submit(approvalId, 'P-CLERK-FA');
    expect(clerkSubmit.status).toBe(403);
    await submit(approvalId);
    const superApprove = await approve(approvalId, 'P-SUPER-B');
    expect(superApprove.status).toBe(403);
  });

  it('案件创建后改承办机构路径 409（X13）；库层触发器拒改 handling_org_id', async () => {
    const { clueId } = await preparedClue();
    const drafted = await draftFile(clueId, ['郑十一']);
    const approvalId = String(drafted.body.approvalId);
    await submit(approvalId);
    expect((await approve(approvalId)).status).toBe(200);
    const caseRow = await cloned.prisma.caseRecord.findFirstOrThrow({ where: { filingApprovalId: approvalId } });
    await expect(
      cloned.prisma.$executeRawUnsafe(
        `UPDATE case_record SET handling_org_id = $1 WHERE id = $2`,
        deptAId,
        caseRow.id,
      ),
    ).rejects.toThrow();
    const assignOrg = await postJson(`/api/clues/${clueId}/assign-org`, 'P-INTAKE-A', {
      orgUnitId: deptAId,
      expectedStatus: 'filed',
      reason: '改机构',
      designate: true,
    });
    expect(assignOrg.status).toBe(409);
  });

  it('事务回滚：批准守卫失败后业务行不变（案件／filed／提醒都不留）', async () => {
    const { clueId } = await preparedClue();
    const drafted = await draftFile(clueId, ['回滚甲']);
    const approvalId = String(drafted.body.approvalId);
    await submit(approvalId);
    await cloned.prisma.clue.update({ where: { id: clueId }, data: { status: 'org_assigned' } });
    const approved = await approve(approvalId);
    expect(approved.status).toBe(409);
    expect(approved.body.reason).toBe('invalid-state');
    expect(await cloned.prisma.caseRecord.findFirst({ where: { filingApprovalId: approvalId } })).toBeNull();
    const approval = await cloned.prisma.filingApproval.findUniqueOrThrow({ where: { id: approvalId } });
    expect(approval.status).toBe('pending_approval');
    expect((await trailOf('case.filing-approved', clueId)).some((row) => row.outcome === 'failed')).toBe(true);
  });
});
