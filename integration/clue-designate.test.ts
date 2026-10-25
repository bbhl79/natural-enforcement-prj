// #215 报请指定管辖与指定锁。
// 断言打在克隆库上：报请发起（理由必填、拟归属可选）、受理人规则（最近共同上级内勤，
// 未选拟归属机构时为直接上级内勤）、受理人待办、报请期间下级分派／派承办人 409
// designation-pending、受理人 designate=true 指定并关闭报请、驳回（理由必填）与留痕，
// 指定后下级重新分派 409 designated-lock，以及状态约束与对象级 403。
// 凡 4xx/403 用例同时断言「失败留痕存在、业务行不变」。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-25T05:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Clue-designate-215!';
const INITIAL_PASSWORD = 'Designate-215!!';

/** 以经度偏移量区分的方斑：不同用例各用一块，免得互相撞成疑似重复。 */
function square(offset: number): (readonly number[])[] {
  const west = 113 + offset;
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

/** 记录写的假存储端口。 */
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

/** 记录投递的假队列端口：不执行，核查停在「进行中」（不拦分派）。 */
class RecordingQueue {
  readonly jobs: { jobName: string; payload: unknown }[] = [];

  async enqueue(jobName: string, payload: unknown): Promise<{ id: string }> {
    this.jobs.push({ jobName, payload });
    return { id: `job-${this.jobs.length}` };
  }

  async waitForCompletion(): Promise<unknown> {
    return null;
  }

  async close(): Promise<void> {}
}

let cloned: ClonedDatabase;
let storage = new RecordingStorage();
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
const cookies = new Map<string, string>();
const passwords = new Map<string, string>();

function sessionCookie(response: Response): string {
  const found = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='));
  const pair = found?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

/** 首次登录后强制改密，留住会话供后续请求用；改密后同一工号全程复用该会话。 */
async function cookieOf(code: string, password?: string): Promise<string> {
  const known = cookies.get(code);
  if (known) return known;
  const current = password ?? passwords.get(code) ?? SEED_PASSWORD;
  const people = await cloned.prisma.personnel.findMany({ where: { code, deactivatedAt: null } });
  const person = people[0];
  if (!person?.mobilePhone) throw new Error(`缺少种子人员 ${code}`);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: person.mobilePhone, password: current, rememberMe: false }),
  });
  expect(login.status).toBe(200);
  const cookie = sessionCookie(login);
  const changed = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ currentPassword: current, newPassword: NEW_PASSWORD }),
  });
  expect(changed.status).toBe(200);
  passwords.set(code, NEW_PASSWORD);
  cookies.set(code, cookie);
  return cookie;
}

/** 以系统管理员身份登记一名人员（内勤或经办）。 */
async function seedPerson(
  code: string,
  name: string,
  orgUnitId: string,
  roles: readonly string[],
  mobilePhone: string,
): Promise<void> {
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
  expect(response.status).toBe(200);
}

interface RegisterResponseBody {
  readonly result: string;
  readonly id?: string;
  readonly code?: string;
  readonly status?: string;
  readonly hits?: unknown[];
  readonly rules?: string[];
}

const BASE_VALUES = {
  'clue.received_at': '2026-10-25',
  'clue.narrative': '巡查发现一处硬化地面',
  'clue.finder': '巡查员甲',
  'clue.patrol_no': 'XC-2026-001',
};

/** 登记线索（登记人默认甲区内勤：线索进甲区待分派池）。 */
async function register(options: {
  readonly idempotencyKey?: string;
  readonly values?: Record<string, string>;
  readonly polygon?: string;
  readonly code?: string;
}): Promise<{ status: number; body: RegisterResponseBody }> {
  const form = new FormData();
  form.set('sourceCode', '16');
  form.set('domain', 'land');
  form.set('values', JSON.stringify(options.values ?? BASE_VALUES));
  form.set(
    'spatial-source',
    new Blob([options.polygon ?? geojsonPolygon(square(0))], { type: 'application/geo+json' }),
    'area.geojson',
  );
  const response = await fetch(`${baseUrl}/api/clues`, {
    method: 'POST',
    headers: {
      cookie: await cookieOf(options.code ?? 'P-INTAKE-A'),
      'idempotency-key': options.idempotencyKey ?? `key-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  return { status: response.status, body: (await response.json()) as RegisterResponseBody };
}

/** 报请指定管辖。 */
async function designateRequest(
  clueId: string,
  input: { reason?: string; proposedOrgId?: string },
  code: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/designate-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({ reason: input.reason ?? '', proposedOrgId: input.proposedOrgId ?? '' }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** 驳回报请。 */
async function designateReject(
  clueId: string,
  input: { reason?: string },
  code: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/designate-reject`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({ reason: input.reason ?? '' }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

interface TodoBody {
  readonly result?: string;
  readonly items?: { requestId: string; clueCode: string; reviewerOrgId: string }[];
}

/** 受理人待办。 */
async function designationTodos(code: string): Promise<{ status: number; body: TodoBody }> {
  const response = await fetch(`${baseUrl}/api/clues/designation-requests`, {
    headers: { cookie: await cookieOf(code) },
  });
  return { status: response.status, body: (await response.json()) as TodoBody };
}

/** 派机构。 */
async function assignOrg(
  clueId: string,
  input: { orgUnitId: string; expectedStatus?: string; reason?: string; designate?: boolean },
  code: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({
      orgUnitId: input.orgUnitId,
      expectedStatus: input.expectedStatus ?? 'in_pool',
      reason: input.reason ?? '',
      designate: input.designate ?? false,
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** 派主办／协办。 */
async function assignPeople(
  clueId: string,
  input: { mainId?: string; expectedStatus?: string },
  code: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({
      mainId: input.mainId ?? '',
      assistIds: [],
      expectedStatus: input.expectedStatus ?? 'org_assigned',
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** 分派视图。 */
async function dispatchView(clueId: string, code: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/dispatch`, {
    headers: { cookie: await cookieOf(code) },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

interface TrailRow {
  readonly action: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly detail: string | null;
  readonly resource_id: string | null;
}

/** 留痕行：留痕只许经设施包追加，读取走原生 SQL（委托名不出现在用例里）。 */
async function trailOf(action: string, resourceId: string): Promise<TrailRow[]> {
  return cloned.prisma.$queryRaw<TrailRow[]>`
    SELECT action, outcome, reason, detail, resource_id
    FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
    ORDER BY created_at DESC, id DESC
  `;
}

let hqId = '';
let deptAId = '';
let deptBId = '';
let stationAId = '';
let handlerSt1 = '';
let hqClerkId = '';

beforeAll(async () => {
  cloned = await openClonedDatabase();
  storage = new RecordingStorage();
  const app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(T0) },
    undefined,
    { storagePort: storage, queuePort: new RecordingQueue() },
  );
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();

  // 夹具：甲区内勤（待分派池所属机构）、甲所内勤与经办（承办机构）。
  const orgOf = async (code: string) => {
    const org = await cloned.prisma.orgUnit.findUnique({ where: { code } });
    if (!org) throw new Error(`缺少种子机构 ${code}`);
    return org.id;
  };
  hqId = await orgOf('ORG-HQ');
  deptAId = await orgOf('ORG-DEPT-A');
  deptBId = await orgOf('ORG-DEPT-B');
  stationAId = await orgOf('ORG-STATION-A');
  await seedPerson('P-INTAKE-A', '甲区内勤', deptAId, ['内勤'], '13900003001');
  await seedPerson('P-INTAKE-B', '乙区内勤', deptBId, ['内勤'], '13900003002');
  await seedPerson('P-INTAKE-ST', '甲所内勤', stationAId, ['内勤'], '13900003003');
  await seedPerson('P-HANDLER-ST1', '甲所主办甲', stationAId, ['经办'], '13900003004');
  const handler1 = await cloned.prisma.personnel.findUnique({ where: { code: 'P-HANDLER-ST1' } });
  const hqClerk = await cloned.prisma.personnel.findUnique({ where: { code: 'P-INTAKE-HQ' } });
  handlerSt1 = handler1?.id ?? '';
  hqClerkId = hqClerk?.id ?? '';
  for (const code of ['P-INTAKE-A', 'P-INTAKE-B', 'P-INTAKE-ST', 'P-HANDLER-ST1']) {
    await cookieOf(code, INITIAL_PASSWORD);
  }
}, 60_000);

afterAll(async () => {
  await closeApp();
  await cloned?.close();
});

beforeEach(() => {
  storage.writes.length = 0;
});

describe('#215 报请发起与受理人规则', () => {
  it('待分派池报请（未选拟归属机构）：受理人为直接上级内勤，进待办并留痕', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(70)) });
    expect(registered.body.status).toBe('in_pool');

    const outcome = await designateRequest(
      registered.body.id ?? '',
      { reason: '该地不属甲区管辖' },
      'P-INTAKE-A',
    );
    expect(outcome.status).toBe(200);
    expect(outcome.body.result).toBe('designate-requested');
    expect(outcome.body.reviewerOrgId).toBe(hqId);

    // 报请行：主状态不变，受理机构＝市局。
    const clue = await cloned.prisma.clue.findUnique({ where: { id: registered.body.id } });
    expect(clue?.status).toBe('in_pool');
    const rows = await cloned.prisma.clueDesignationRequest.findMany({
      where: { clueId: registered.body.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.requestingOrgId).toBe(deptAId);
    expect(rows[0]?.proposedOrgId).toBeNull();
    expect(rows[0]?.reviewerOrgId).toBe(hqId);

    // 留痕：报请机构、拟归属机构、受理上级。
    const trail = await trailOf('clue.designate-requested', registered.body.id ?? '');
    expect(trail).toHaveLength(1);
    expect(trail[0]?.outcome).toBe('succeeded');
    expect(trail[0]?.detail).toContain(`"requestingOrgId":"${deptAId}"`);
    expect(trail[0]?.detail).toContain('"proposedOrgId":null');
    expect(trail[0]?.detail).toContain(`"reviewerOrgId":"${hqId}"`);

    // 受理人（市局内勤）的待办里有这条；非受理人（甲区内勤）的待办里没有。
    const hqTodos = await designationTodos('P-INTAKE-HQ');
    expect(hqTodos.status).toBe(200);
    expect(
      (hqTodos.body.items ?? []).some((item) => item.clueCode === registered.body.code),
    ).toBe(true);
    const deptTodos = await designationTodos('P-INTAKE-A');
    expect(
      (deptTodos.body.items ?? []).some((item) => item.clueCode === registered.body.code),
    ).toBe(false);

    // 分派视图：进行中的报请与办理 affordance。
    const view = (await dispatchView(registered.body.id ?? '', 'P-INTAKE-HQ')) as {
      designation: { requestId: string; reviewerOrgId: string } | null;
      mayReviewDesignation: boolean;
      mayRequestDesignation: boolean;
      designationLocked: boolean;
    };
    expect(view.designation?.reviewerOrgId).toBe(hqId);
    expect(view.mayReviewDesignation).toBe(true);
    expect(view.mayRequestDesignation).toBe(false);
    const requesterView = (await dispatchView(registered.body.id ?? '', 'P-INTAKE-A')) as {
      mayRequestDesignation: boolean;
      mayReviewDesignation: boolean;
      designationLocked: boolean;
    };
    expect(requesterView.mayRequestDesignation).toBe(false);
    expect(requesterView.mayReviewDesignation).toBe(false);
    expect(requesterView.designationLocked).toBe(true);
  });

  it('选拟归属机构：受理人为报请方与拟归属机构的最近共同上级内勤', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(71)) });
    // 拟归属乙区：甲区与乙区的最近共同上级是市局。
    const outcome = await designateRequest(
      registered.body.id ?? '',
      { reason: '应归乙区管辖', proposedOrgId: deptBId },
      'P-INTAKE-A',
    );
    expect(outcome.status).toBe(200);
    expect(outcome.body.reviewerOrgId).toBe(hqId);
    const row = await cloned.prisma.clueDesignationRequest.findFirst({
      where: { clueId: registered.body.id },
    });
    expect(row?.proposedOrgId).toBe(deptBId);
    expect(row?.reviewerOrgId).toBe(hqId);
  });

  it('已派机构与已派承办人：由承办机构内勤报请，受理人为承办机构的直接上级内勤', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(72)) });
    await assignOrg(registered.body.id ?? '', { orgUnitId: stationAId }, 'P-INTAKE-A');

    // 已派机构：甲所内勤报请，受理人＝甲所的直接上级（甲区）内勤。
    const asOrg = await designateRequest(
      registered.body.id ?? '',
      { reason: '不属甲所管辖' },
      'P-INTAKE-ST',
    );
    expect(asOrg.status).toBe(200);
    expect(asOrg.body.reviewerOrgId).toBe(deptAId);
    const pendingRow = await cloned.prisma.clueDesignationRequest.findFirst({
      where: { clueId: registered.body.id },
    });
    expect(pendingRow?.status).toBe('pending');

    // 受理人（甲区内勤）驳回后，已派承办人状态仍可报请。
    const rejected = await designateReject(registered.body.id ?? '', { reason: '仍由甲所先核' }, 'P-INTAKE-A');
    expect(rejected.status).toBe(200);
    const people = await assignPeople(registered.body.id ?? '', { mainId: handlerSt1 }, 'P-INTAKE-ST');
    expect(people.status).toBe(200);

    // 已派承办人：承办机构内勤再报请，受理人仍是甲区。
    const asPeople = await designateRequest(
      registered.body.id ?? '',
      { reason: '承办中发现应归甲区直办' },
      'P-INTAKE-ST',
    );
    expect(asPeople.status).toBe(200);
    expect(asPeople.body.reviewerOrgId).toBe(deptAId);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: registered.body.id } });
    expect(clue?.status).toBe('handler_assigned');
  });

  it('理由必填：400 non-compliant＋失败留痕，无报请行', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(73)) });
    const outcome = await designateRequest(registered.body.id ?? '', { reason: '  ' }, 'P-INTAKE-A');
    expect(outcome.status).toBe(400);
    expect(outcome.body.result).toBe('non-compliant');
    expect(outcome.body.rules).toEqual(['missing-designate-reason']);
    expect(
      await cloned.prisma.clueDesignationRequest.count({ where: { clueId: registered.body.id } }),
    ).toBe(0);
    const failed = (await trailOf('clue.designate-requested', registered.body.id ?? '')).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('missing-designate-reason');
  });

  it('状态约束：待分派决定的线索报请 409 invalid-state＋失败留痕', async () => {
    await register({ polygon: geojsonPolygon(square(74)) });
    const second = await register({ polygon: geojsonPolygon(square(74)) });
    expect(second.body.status).toBe('pending_decision');

    const outcome = await designateRequest(second.body.id ?? '', { reason: '试试报请' }, 'P-INTAKE-A');
    expect(outcome.status).toBe(409);
    expect(outcome.body.result).toBe('invalid-state');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: second.body.id } });
    expect(clue?.status).toBe('pending_decision');
    const failed = (await trailOf('clue.designate-requested', second.body.id ?? '')).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('invalid-state');
  });

  it('对象级：非本级机构内勤与监督报请一律 403＋authz.denied，无报请行', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(75)) });

    // 市局内勤不是甲区（池所属机构）的内勤。
    const hqClerk = await designateRequest(registered.body.id ?? '', { reason: '代报' }, 'P-INTAKE-HQ');
    expect(hqClerk.status).toBe(403);
    expect(hqClerk.body.reason).toBe('permission-denied');
    // 监督没有任何写操作码。
    const supervisor = await designateRequest(registered.body.id ?? '', { reason: '代报' }, 'P-SUPER-B');
    expect(supervisor.status).toBe(403);
    expect(supervisor.body.reason).toBe('permission-denied');

    expect(
      await cloned.prisma.clueDesignationRequest.count({ where: { clueId: registered.body.id } }),
    ).toBe(0);
    const denied = await trailOf('authz.denied', registered.body.id ?? '');
    expect(denied.length).toBeGreaterThanOrEqual(2);
  });

  it('待处理期间重复报请：409 designation-pending＋失败留痕，报请行不变', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(76)) });
    const first = await designateRequest(registered.body.id ?? '', { reason: '首次报请' }, 'P-INTAKE-A');
    expect(first.status).toBe(200);

    const again = await designateRequest(registered.body.id ?? '', { reason: '再次报请' }, 'P-INTAKE-A');
    expect(again.status).toBe(409);
    expect(again.body.result).toBe('invalid-state');
    expect(again.body.reason).toBe('designation-pending');
    const rows = await cloned.prisma.clueDesignationRequest.findMany({
      where: { clueId: registered.body.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe('首次报请');
    const failed = (await trailOf('clue.designate-requested', registered.body.id ?? '')).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('designation-pending');
  });
});

describe('#215 报请期间的锁与受理人处理', () => {
  it('报请期间下级分派：409 designation-pending＋失败留痕，业务行不变', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(80)) });
    const requested = await designateRequest(registered.body.id ?? '', { reason: '不属本级管辖' }, 'P-INTAKE-A');
    expect(requested.status).toBe(200);

    // 报请方（下级）此时不能分派。
    const locked = await assignOrg(
      registered.body.id ?? '',
      { orgUnitId: stationAId, reason: '想先派出去' },
      'P-INTAKE-A',
    );
    expect(locked.status).toBe(409);
    expect(locked.body.result).toBe('invalid-state');
    expect(locked.body.reason).toBe('designation-pending');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: registered.body.id } });
    expect(clue?.status).toBe('in_pool');
    expect(
      await cloned.prisma.clueAssignment.count({ where: { clueId: registered.body.id } }),
    ).toBe(0);
    const failed = (await trailOf('clue.org-assigned', registered.body.id ?? '')).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('designation-pending');

    // 受理人（上级）不受此锁：designate=true 指定承办机构，报请同时关闭。
    const designated = await assignOrg(
      registered.body.id ?? '',
      { orgUnitId: deptBId, reason: '指定乙区承办', designate: true },
      'P-INTAKE-HQ',
    );
    expect(designated.status).toBe(200);
    const rows = await cloned.prisma.clueDesignationRequest.findMany({
      where: { clueId: registered.body.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('approved');
    expect(rows[0]?.decidedBy).toBe(hqClerkId);
    expect(rows[0]?.decisionReason).toBeNull();
    const orgTrail = (await trailOf('clue.org-assigned', registered.body.id ?? '')).filter(
      (row) => row.outcome === 'succeeded',
    );
    expect(orgTrail).toHaveLength(1);
    expect(orgTrail[0]?.detail).toContain('"kind":"designate"');
  });

  it('报请期间下级派主办／协办：409 designation-pending＋失败留痕，承办人行不变', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(81)) });
    await assignOrg(registered.body.id ?? '', { orgUnitId: stationAId }, 'P-INTAKE-A');
    const requested = await designateRequest(registered.body.id ?? '', { reason: '不属甲所管辖' }, 'P-INTAKE-ST');
    expect(requested.status).toBe(200);

    const locked = await assignPeople(registered.body.id ?? '', { mainId: handlerSt1 }, 'P-INTAKE-ST');
    expect(locked.status).toBe(409);
    expect(locked.body.result).toBe('invalid-state');
    expect(locked.body.reason).toBe('designation-pending');
    const handlers = await cloned.prisma.clueHandler.findMany({
      where: { clueId: registered.body.id },
    });
    expect(handlers).toHaveLength(0);
    const failed = (await trailOf('clue.handler-assigned', registered.body.id ?? '')).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('designation-pending');
  });

  it('受理人驳回：理由必填并留痕；非受理人驳回 403；驳回后恢复正常办理', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(82)) });
    const requested = await designateRequest(registered.body.id ?? '', { reason: '不属本级管辖' }, 'P-INTAKE-A');
    expect(requested.status).toBe(200);

    // 理由必填。
    const missing = await designateReject(registered.body.id ?? '', { reason: '' }, 'P-INTAKE-HQ');
    expect(missing.status).toBe(400);
    expect(missing.body.rules).toEqual(['missing-reject-reason']);
    let rows = await cloned.prisma.clueDesignationRequest.findMany({
      where: { clueId: registered.body.id },
    });
    expect(rows[0]?.status).toBe('pending');
    const failed = (await trailOf('clue.designate-rejected', registered.body.id ?? '')).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('missing-reject-reason');

    // 非受理人（报请方本人）不能驳回。
    const notReviewer = await designateReject(registered.body.id ?? '', { reason: '自我驳回' }, 'P-INTAKE-A');
    expect(notReviewer.status).toBe(403);
    // 报请方的数据范围不含受理机构（上级）：范围外拒绝。
    expect(notReviewer.body.reason).toBe('scope-denied');
    expect((await trailOf('authz.denied', registered.body.id ?? '')).length).toBeGreaterThan(0);
    rows = await cloned.prisma.clueDesignationRequest.findMany({
      where: { clueId: registered.body.id },
    });
    expect(rows[0]?.status).toBe('pending');

    // 受理人驳回成功：报请行关止、理由落业务行、留痕。
    const rejected = await designateReject(
      registered.body.id ?? '',
      { reason: '经核仍属甲区管辖' },
      'P-INTAKE-HQ',
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.result).toBe('designate-rejected');
    rows = await cloned.prisma.clueDesignationRequest.findMany({
      where: { clueId: registered.body.id },
    });
    expect(rows[0]?.status).toBe('rejected');
    expect(rows[0]?.decisionReason).toBe('经核仍属甲区管辖');
    expect(rows[0]?.decidedBy).toBe(hqClerkId);
    // 成功留痕一条；同用例前面已因「驳回理由必填」留下一条失败留痕，故按 outcome 筛。
    const trail = (await trailOf('clue.designate-rejected', registered.body.id ?? '')).filter(
      (row) => row.outcome === 'succeeded',
    );
    expect(trail).toHaveLength(1);
    expect(trail[0]?.detail).toContain(`"reviewerOrgId":"${hqId}"`);

    // 驳回后恢复正常办理：报请方可分派，且可再次报请。
    const assigned = await assignOrg(registered.body.id ?? '', { orgUnitId: stationAId }, 'P-INTAKE-A');
    expect(assigned.status).toBe(200);
    // 分派到甲所后线索的承办机构是甲所，按规格由承办机构内勤发起报请（受理人为甲区）。
    const again = await designateRequest(registered.body.id ?? '', { reason: '再报一次' }, 'P-INTAKE-ST');
    expect(again.status).toBe(200);
    expect(again.body.reviewerOrgId).toBe(deptAId);
  });

  it('没有待处理报请时驳回：409 invalid-state＋失败留痕', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(83)) });
    const outcome = await designateReject(registered.body.id ?? '', { reason: '没有报请' }, 'P-INTAKE-HQ');
    expect(outcome.status).toBe(409);
    expect(outcome.body.result).toBe('invalid-state');
    const failed = (await trailOf('clue.designate-rejected', registered.body.id ?? '')).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('invalid-state');
  });

  it('指定管辖后下级重新分派 409 designated-lock；指定者本人可再调整', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(84)) });
    // 甲区内勤报请（拟归乙区），市局受理人指定乙区承办。
    const requested = await designateRequest(
      registered.body.id ?? '',
      { reason: '应归乙区管辖', proposedOrgId: deptBId },
      'P-INTAKE-A',
    );
    expect(requested.status).toBe(200);
    const designated = await assignOrg(
      registered.body.id ?? '',
      { orgUnitId: deptBId, reason: '指定乙区承办', designate: true },
      'P-INTAKE-HQ',
    );
    expect(designated.status).toBe(200);

    // 指定者是市局：甲区（下级）重新分派被 designated-lock 拦下。
    const locked = await assignOrg(
      registered.body.id ?? '',
      { orgUnitId: stationAId, expectedStatus: 'org_assigned', reason: '想换机构' },
      'P-INTAKE-A',
    );
    expect(locked.status).toBe(409);
    expect(locked.body.result).toBe('invalid-state');
    expect(locked.body.reason).toBe('designated-lock');
    const failed = (await trailOf('clue.org-assigned', registered.body.id ?? '')).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('designated-lock');

    // 指定者本人可以再调整。
    const byDesignator = await assignOrg(
      registered.body.id ?? '',
      { orgUnitId: stationAId, expectedStatus: 'org_assigned', reason: '改由甲所承办', designate: true },
      'P-INTAKE-HQ',
    );
    expect(byDesignator.status).toBe(200);
    const assignments = await cloned.prisma.clueAssignment.findMany({
      where: { clueId: registered.body.id },
    });
    expect(assignments.filter((row) => row.kind === 'designate')).toHaveLength(2);
  });
});
