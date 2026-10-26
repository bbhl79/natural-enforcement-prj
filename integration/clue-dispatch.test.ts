// #214 分派决定与两步分派、重新分派与并发控制。
// 断言打在克隆库上：决定（默认不派／已知晓／举报必派）、两步分派（派机构→派主办协办）、
// 重新分派（理由必填、指定管辖锁；#228 换机构一律 409 designation-required）、
// expectedStatus 并发冲突，以及监督写操作 403。
// 凡 4xx/403 用例同时断言「失败留痕存在、业务行不变」。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-25T03:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Clue-dispatch-214!';
const INITIAL_PASSWORD = 'Dispatch-214!!';

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

/** 点状 GeoJSON Feature（规划／测绘类线索为点状）。 */
function geojsonPoint(lng: number, lat: number): string {
  return JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} });
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

/** 记录投递的假队列端口：不执行，核查停在「进行中」（核查没跑成不拦分派的对照口径）。 */
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

const COMPLAINT_VALUES = {
  'clue.received_at': '2026-10-25',
  'clue.narrative': '群众反映一处硬化地面',
  'clue.reporter_anonymous': 'false',
  'clue.verifiable_basis': '附有现场照片',
};

async function register(options: {
  readonly idempotencyKey?: string;
  readonly sourceCode?: string;
  readonly values?: Record<string, string>;
  readonly polygon?: string;
  readonly code?: string;
  readonly domain?: string;
  readonly types?: string;
}): Promise<{ status: number; body: RegisterResponseBody }> {
  const form = new FormData();
  form.set('sourceCode', options.sourceCode ?? '16');
  form.set('domain', options.domain ?? 'land');
  form.set('values', JSON.stringify(options.values ?? BASE_VALUES));
  if (options.types) form.set('types', options.types);
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

/** 分派决定。 */
async function decide(
  clueId: string,
  input: {
    decision: string;
    acknowledged?: boolean;
    expectedStatus?: string;
    conflictResolution?: string;
    conflictBasis?: string;
  },
  code = 'P-INTAKE-A',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({
      decision: input.decision,
      acknowledged: input.acknowledged ?? false,
      expectedStatus: input.expectedStatus ?? 'pending_decision',
      ...(input.conflictResolution !== undefined ? { conflictResolution: input.conflictResolution } : {}),
      ...(input.conflictBasis !== undefined ? { conflictBasis: input.conflictBasis } : {}),
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
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
  input: { mainId?: string; assistIds?: string[]; expectedStatus?: string },
  code: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({
      mainId: input.mainId ?? '',
      assistIds: input.assistIds ?? [],
      expectedStatus: input.expectedStatus ?? 'org_assigned',
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

interface TrailRow {
  readonly action: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly detail: string | null;
  readonly resource_id: string | null;
}

/** 留痕行：留痕只许经设施包追加，读取走原生 SQL（委托名不出现在用例里）。 */
async function trailOf(action: string, resourceId?: string): Promise<TrailRow[]> {
  if (resourceId === undefined) {
    return cloned.prisma.$queryRaw<TrailRow[]>`
      SELECT action, outcome, reason, detail, resource_id
      FROM audit_trail
      WHERE action = ${action}
      ORDER BY created_at DESC, id DESC
      LIMIT 10
    `;
  }
  return cloned.prisma.$queryRaw<TrailRow[]>`
    SELECT action, outcome, reason, detail, resource_id
    FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
    ORDER BY created_at DESC, id DESC
  `;
}

let deptAId = '';
let deptBId = '';
let stationAId = '';
let handlerSt1 = '';
let handlerSt2 = '';
let clerkBId = '';

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

  // 夹具：甲区内勤（待分派池所属机构）、乙区内勤与经办、甲区内勤与经办（所级）。
  const orgOf = async (code: string) => {
    const org = await cloned.prisma.orgUnit.findUnique({ where: { code } });
    if (!org) throw new Error(`缺少种子机构 ${code}`);
    return org.id;
  };
  deptAId = await orgOf('ORG-DEPT-A');
  deptBId = await orgOf('ORG-DEPT-B');
  stationAId = await orgOf('ORG-STATION-A');
  await seedPerson('P-INTAKE-A', '甲区内勤', deptAId, ['内勤'], '13900002001');
  await seedPerson('P-INTAKE-B', '乙区内勤', deptBId, ['内勤'], '13900002002');
  await seedPerson('P-INTAKE-ST', '甲所内勤', stationAId, ['内勤'], '13900002003');
  await seedPerson('P-HANDLER-ST1', '甲所主办甲', stationAId, ['经办'], '13900002004');
  await seedPerson('P-HANDLER-ST2', '甲所主办乙', stationAId, ['经办'], '13900002005');
  const handler1 = await cloned.prisma.personnel.findUnique({ where: { code: 'P-HANDLER-ST1' } });
  const handler2 = await cloned.prisma.personnel.findUnique({ where: { code: 'P-HANDLER-ST2' } });
  const clerkB = await cloned.prisma.personnel.findUnique({ where: { code: 'P-CLERK-B' } });
  handlerSt1 = handler1?.id ?? '';
  handlerSt2 = handler2?.id ?? '';
  clerkBId = clerkB?.id ?? '';
  // 新登记人员的会话（首登强制改密）。
  for (const code of ['P-INTAKE-A', 'P-INTAKE-B', 'P-INTAKE-ST', 'P-HANDLER-ST1', 'P-HANDLER-ST2']) {
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

describe('#214 分派决定', () => {
  it('默认不派：决定「不派」进 held，留痕 clue.held 含前后状态', async () => {
    const first = await register({ polygon: geojsonPolygon(square(40)) });
    expect(first.status).toBe(201);
    const second = await register({ polygon: geojsonPolygon(square(40)) });
    expect(second.status).toBe(201);
    expect(second.body.status).toBe('pending_decision');

    const outcome = await decide(second.body.id ?? '', { decision: 'hold' });
    expect(outcome.status).toBe(200);
    expect(outcome.body.result).toBe('decided');
    expect(outcome.body.status).toBe('held');

    const clue = await cloned.prisma.clue.findUnique({ where: { id: second.body.id } });
    expect(clue?.status).toBe('held');
    const trail = await trailOf('clue.held', second.body.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]?.outcome).toBe('succeeded');
    expect(trail[0]?.detail).toContain('pending_decision');
    expect(trail[0]?.detail).toContain('held');
  });

  it('已知晓派出：未点已知晓 400 ack-required＋失败留痕，点已知晓 200 进待分派池', async () => {
    const first = await register({ polygon: geojsonPolygon(square(41)) });
    const second = await register({ polygon: geojsonPolygon(square(41)) });
    expect(second.body.status).toBe('pending_decision');

    const unacked = await decide(second.body.id ?? '', { decision: 'dispatch' });
    expect(unacked.status).toBe(400);
    expect(unacked.body.result).toBe('non-compliant');
    expect(unacked.body.rules).toEqual(['ack-required']);
    const clueAfter = await cloned.prisma.clue.findUnique({ where: { id: second.body.id } });
    expect(clueAfter?.status).toBe('pending_decision');
    const failed = (await trailOf('clue.dispatched', second.body.id)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('ack-required');

    const acked = await decide(second.body.id ?? '', { decision: 'dispatch', acknowledged: true });
    expect(acked.status).toBe(200);
    expect(acked.body.status).toBe('in_pool');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: second.body.id } });
    expect(clue?.status).toBe('in_pool');
    const trail = (await trailOf('clue.dispatched', second.body.id)).filter(
      (row) => row.outcome === 'succeeded',
    );
    expect(trail).toHaveLength(1);
    expect(trail[0]?.detail).toContain('"acknowledged":true');
    expect(first.body.hits).toEqual([]);
  });

  it('举报必派：群众举报选「不派」400 complaint-must-dispatch＋失败留痕；重合信息仍在视图里', async () => {
    const first = await register({ polygon: geojsonPolygon(square(42)) });
    expect(first.body.status).toBe('in_pool');
    const complaint = await register({
      sourceCode: '301',
      values: COMPLAINT_VALUES,
      polygon: geojsonPolygon(square(42)),
    });
    expect(complaint.status).toBe(201);
    expect(complaint.body.status).toBe('pending_decision');
    expect((complaint.body.hits ?? []).length).toBeGreaterThan(0);

    const held = await decide(complaint.body.id ?? '', { decision: 'hold' });
    expect(held.status).toBe(400);
    expect(held.body.rules).toEqual(['complaint-must-dispatch']);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: complaint.body.id } });
    expect(clue?.status).toBe('pending_decision');
    const failed = (await trailOf('clue.held', complaint.body.id)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('complaint-must-dispatch');

    const view = await fetch(`${baseUrl}/api/clues/${complaint.body.id}/dispatch`, {
      headers: { cookie: await cookieOf('P-CLERK-A') },
    });
    expect(view.status).toBe(200);
    const viewBody = (await view.json()) as {
      complaint: boolean;
      hitGroups: { otherClueCode: string; open: boolean; pairs: { selfRatio: number; otherRatio: number }[] }[];
      suggestion: { suggestions: unknown[]; unavailableReason: string | null };
    };
    expect(viewBody.complaint).toBe(true);
    expect(viewBody.hitGroups.length).toBeGreaterThan(0);
    expect(viewBody.hitGroups[0]?.otherClueCode).toBe(first.body.code);
    expect(viewBody.hitGroups[0]?.open).toBe(true);
    // 街道边界服务地址未配置（ADR 0021）：空建议不拦决定。
    expect(viewBody.suggestion.suggestions).toEqual([]);
    expect(viewBody.suggestion.unavailableReason).toBe('service-not-configured');

    const dispatched = await decide(complaint.body.id ?? '', { decision: 'dispatch' });
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.status).toBe('in_pool');
  });

  it('全部对方已结案：不用已知晓可直接派出，但仍由人完成决定', async () => {
    const first = await register({ polygon: geojsonPolygon(square(43)) });
    const second = await register({ polygon: geojsonPolygon(square(43)) });
    expect(second.body.status).toBe('pending_decision');
    // 对方结案（结案口径由撤回不派/处置票承载，这里直接置终态以构造决定场景）。
    await cloned.prisma.clue.update({
      where: { id: first.body.id },
      data: { status: 'closed' },
    });

    const dispatched = await decide(second.body.id ?? '', { decision: 'dispatch' });
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.status).toBe('in_pool');
    const trail = (await trailOf('clue.dispatched', second.body.id)).filter(
      (row) => row.outcome === 'succeeded',
    );
    expect(trail).toHaveLength(1);
    expect(trail[0]?.detail).toContain('"acknowledged":false');
  });

  it('决定只能由录入人完成：非录入人的内勤代决 403＋authz.denied，业务行不变', async () => {
    const first = await register({ polygon: geojsonPolygon(square(44)) });
    const second = await register({ polygon: geojsonPolygon(square(44)) });
    // 市局内勤有分派决定操作码，但不是该线索的录入人：对象级拒绝。
    const outcome = await decide(second.body.id ?? '', { decision: 'hold' }, 'P-INTAKE-HQ');
    expect(outcome.status).toBe(403);
    expect(outcome.body.reason).toBe('permission-denied');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: second.body.id } });
    expect(clue?.status).toBe('pending_decision');
    const denied = await trailOf('authz.denied', second.body.id);
    expect(denied.length).toBeGreaterThan(0);
    expect(denied[0]?.reason).toBe('permission-denied');
    expect(first.body.status).toBe('in_pool');
  });

  it('expectedStatus 冲突：409 concurrent-change＋失败留痕，业务行不变', async () => {
    await register({ polygon: geojsonPolygon(square(45)) });
    const second = await register({ polygon: geojsonPolygon(square(45)) });
    const outcome = await decide(second.body.id ?? '', {
      decision: 'hold',
      expectedStatus: 'in_pool',
    });
    expect(outcome.status).toBe(409);
    expect(outcome.body.result).toBe('concurrent-change');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: second.body.id } });
    expect(clue?.status).toBe('pending_decision');
    const failed = (await trailOf('clue.held', second.body.id)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('concurrent-change');
  });

  it('决定后不再是待分派决定：重复决定 409 concurrent-change＋失败留痕', async () => {
    await register({ polygon: geojsonPolygon(square(46)) });
    const second = await register({ polygon: geojsonPolygon(square(46)) });
    const held = await decide(second.body.id ?? '', { decision: 'hold' });
    expect(held.status).toBe(200);
    const again = await decide(second.body.id ?? '', { decision: 'hold' });
    expect(again.status).toBe(409);
    expect(again.body.result).toBe('concurrent-change');
    const failed = (await trailOf('clue.held', second.body.id)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]?.reason).toBe('concurrent-change');
  });
});

describe('#214 两步分派', () => {
  it('派机构：待分派池所属机构的内勤派给数据范围内的机构，状态进已派机构并留痕', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(50)) });
    expect(registered.body.status).toBe('in_pool');
    // 内勤看得到核查编排：核查投递了但没人执行（没跑成/进行中都不拦分派）。
    expect(storage.writes.length).toBeGreaterThan(0);

    const outcome = await assignOrg(
      registered.body.id ?? '',
      { orgUnitId: stationAId },
      'P-INTAKE-A',
    );
    expect(outcome.status).toBe(200);
    expect(outcome.body.result).toBe('org-assigned');
    expect(outcome.body.status).toBe('org_assigned');

    const clue = await cloned.prisma.clue.findUnique({ where: { id: registered.body.id } });
    expect(clue?.status).toBe('org_assigned');
    const assignments = await cloned.prisma.clueAssignment.findMany({
      where: { clueId: registered.body.id },
    });
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.kind).toBe('initial');
    expect(assignments[0]?.orgUnitId).toBe(stationAId);
    const trail = await trailOf('clue.org-assigned', registered.body.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]?.outcome).toBe('succeeded');
    expect(trail[0]?.detail).toContain('"kind":"initial"');
  });

  it('派机构的对象级校验：非本池内勤 403＋authz.denied，无操作码的监督 403，业务行都不变', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(51)) });
    const before = await cloned.prisma.clueAssignment.count({
      where: { clueId: registered.body.id },
    });

    // 上级机构的内勤（市局内勤）不是待分派池所属机构的内勤。
    const hqClerk = await assignOrg(registered.body.id ?? '', { orgUnitId: stationAId }, 'P-INTAKE-HQ');
    expect(hqClerk.status).toBe(403);
    expect(hqClerk.body.reason).toBe('permission-denied');
    // 监督没有任何写操作码。
    const supervisor = await assignOrg(registered.body.id ?? '', { orgUnitId: stationAId }, 'P-SUPER-B');
    expect(supervisor.status).toBe(403);
    expect(supervisor.body.reason).toBe('permission-denied');

    const clue = await cloned.prisma.clue.findUnique({ where: { id: registered.body.id } });
    expect(clue?.status).toBe('in_pool');
    expect(
      await cloned.prisma.clueAssignment.count({ where: { clueId: registered.body.id } }),
    ).toBe(before);
    const denied = await trailOf('authz.denied', registered.body.id);
    expect(denied.length).toBeGreaterThan(0);
  });

  it('派机构指向数据范围外：同级机构 403 scope-denied，业务行不变', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(52)) });
    // 甲区内勤不能把线索派给乙区（兄弟机构，不在本人数据范围）。
    const outcome = await assignOrg(registered.body.id ?? '', { orgUnitId: deptBId }, 'P-INTAKE-A');
    expect(outcome.status).toBe(403);
    expect(outcome.body.reason).toBe('scope-denied');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: registered.body.id } });
    expect(clue?.status).toBe('in_pool');
  });

  it('派主办／协办：承办机构内勤指定主办与协办，状态进已派承办人并留痕', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(53)) });
    await assignOrg(registered.body.id ?? '', { orgUnitId: stationAId }, 'P-INTAKE-A');

    const outcome = await assignPeople(
      registered.body.id ?? '',
      { mainId: handlerSt1, assistIds: [handlerSt2] },
      'P-INTAKE-ST',
    );
    expect(outcome.status).toBe(200);
    expect(outcome.body.result).toBe('people-assigned');
    expect(outcome.body.status).toBe('handler_assigned');

    const clue = await cloned.prisma.clue.findUnique({ where: { id: registered.body.id } });
    expect(clue?.status).toBe('handler_assigned');
    const handlers = await cloned.prisma.clueHandler.findMany({
      where: { clueId: registered.body.id, endedAt: null },
    });
    expect(handlers).toHaveLength(2);
    expect(handlers.find((row) => row.role === 'main')?.personnelId).toBe(handlerSt1);
    expect(handlers.find((row) => row.role === 'assist')?.personnelId).toBe(handlerSt2);
    const trail = await trailOf('clue.handler-assigned', registered.body.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]?.outcome).toBe('succeeded');
    expect(trail[0]?.detail).toContain(handlerSt1);
  });

  it('派主办／协办的对象级校验：非承办机构内勤 403，主办缺失 400，人选不属于承办机构 400', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(54)) });
    await assignOrg(registered.body.id ?? '', { orgUnitId: stationAId }, 'P-INTAKE-A');

    // 甲区内勤（上级机构）不是承办机构内勤：换人只能由承办机构内勤执行。
    const otherClerk = await assignPeople(registered.body.id ?? '', { mainId: handlerSt1 }, 'P-INTAKE-A');
    expect(otherClerk.status).toBe(403);
    expect(otherClerk.body.reason).toBe('permission-denied');

    const missingMain = await assignPeople(registered.body.id ?? '', { mainId: '' }, 'P-INTAKE-ST');
    expect(missingMain.status).toBe(400);
    expect(missingMain.body.rules).toEqual(['handler-main-required']);
    const failedMain = (await trailOf('clue.handler-assigned', registered.body.id)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failedMain).toHaveLength(1);
    expect(failedMain[0]?.reason).toBe('missing-required-items');

    // 乙区经办不属于承办机构（甲所）。
    const outsider = await assignPeople(registered.body.id ?? '', { mainId: clerkBId }, 'P-INTAKE-ST');
    expect(outsider.status).toBe(400);
    expect(outsider.body.rules).toEqual(['assignee-not-qualified']);
    const failedOutside = (await trailOf('clue.handler-assigned', registered.body.id)).filter(
      (row) => row.outcome === 'failed' && row.reason === 'assignee-not-qualified',
    );
    expect(failedOutside).toHaveLength(1);

    const clue = await cloned.prisma.clue.findUnique({ where: { id: registered.body.id } });
    expect(clue?.status).toBe('org_assigned');
  });

  it('监督尝试两步分派写操作：一律 403＋authz.denied，业务行不变', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(55)) });
    const org = await assignOrg(registered.body.id ?? '', { orgUnitId: stationAId }, 'P-SUPER-B');
    expect(org.status).toBe(403);
    const people = await assignPeople(registered.body.id ?? '', { mainId: handlerSt1 }, 'P-SUPER-B');
    expect(people.status).toBe(403);
    const decideForbidden = await decide(registered.body.id ?? '', { decision: 'hold' }, 'P-SUPER-B');
    expect(decideForbidden.status).toBe(403);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: registered.body.id } });
    expect(clue?.status).toBe('in_pool');
    const denied = await trailOf('authz.denied', registered.body.id);
    expect(denied.length).toBeGreaterThanOrEqual(3);
  });
});

describe('#214 重新分派与并发控制', () => {
  it('重新分派：上级内勤在原承办机构内重新分派须填理由，留痕并关止原承办人', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(60)) });
    await assignOrg(registered.body.id ?? '', { orgUnitId: stationAId }, 'P-INTAKE-A');
    await assignPeople(
      registered.body.id ?? '',
      { mainId: handlerSt1, assistIds: [handlerSt2] },
      'P-INTAKE-ST',
    );

    // 理由必填。
    const missing = await assignOrg(
      registered.body.id ?? '',
      { orgUnitId: deptAId, expectedStatus: 'handler_assigned' },
      'P-INTAKE-A',
    );
    expect(missing.status).toBe(400);
    expect(missing.body.rules).toEqual(['missing-reassign-reason']);
    const failed = (await trailOf('clue.org-assigned', registered.body.id)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('missing-reassign-reason');

    // 上级内勤（甲区）在原承办机构（甲所）内重新分派。
    const outcome = await assignOrg(
      registered.body.id ?? '',
      { orgUnitId: stationAId, expectedStatus: 'handler_assigned', reason: '所里人手不足' },
      'P-INTAKE-A',
    );
    expect(outcome.status).toBe(200);
    expect(outcome.body.status).toBe('org_assigned');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: registered.body.id } });
    expect(clue?.status).toBe('org_assigned');
    const assignments = await cloned.prisma.clueAssignment.findMany({
      where: { clueId: registered.body.id },
      orderBy: { assignedAt: 'asc' },
    });
    expect(assignments).toHaveLength(2);
    expect(assignments[0]?.endedAt).not.toBeNull();
    expect(assignments[1]?.kind).toBe('reassign');
    expect(assignments[1]?.orgUnitId).toBe(stationAId);
    expect(assignments[1]?.reason).toBe('所里人手不足');
    // 原承办人行已关止。
    const handlers = await cloned.prisma.clueHandler.findMany({
      where: { clueId: registered.body.id, endedAt: null },
    });
    expect(handlers).toHaveLength(0);
    const trail = (await trailOf('clue.org-assigned', registered.body.id)).filter(
      (row) => row.outcome === 'succeeded',
    );
    expect(trail).toHaveLength(2);
    expect(trail[0]?.detail).toContain('"kind":"reassign"');
  });

  it('原承办机构内勤 designate=false 改到下属所：409 designation-required，承办机构不变、分派行不新增、失败留痕一行（#228）', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(61)) });
    const clueId = registered.body.id ?? '';
    await assignOrg(clueId, { orgUnitId: deptAId }, 'P-INTAKE-A');
    const before = await cloned.prisma.clueAssignment.count({ where: { clueId } });
    const outcome = await assignOrg(
      clueId,
      { orgUnitId: stationAId, expectedStatus: 'org_assigned', reason: '交由甲所承办' },
      'P-INTAKE-A',
    );
    expect(outcome.status).toBe(409);
    expect(outcome.body).toEqual({
      result: 'invalid-state',
      reason: 'designation-required',
      nextAction: 'clue.designate.request',
    });
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('org_assigned');
    const current = await cloned.prisma.clueAssignment.findFirst({ where: { clueId, endedAt: null } });
    expect(current?.orgUnitId).toBe(deptAId);
    expect(await cloned.prisma.clueAssignment.count({ where: { clueId } })).toBe(before);
    const failed = (await trailOf('clue.org-assigned', clueId)).filter((row) => row.outcome === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('designation-required');
    // 甲区内勤不能把线索重派到数据范围外的乙区。
    const outside = await assignOrg(
      registered.body.id ?? '',
      { orgUnitId: deptBId, expectedStatus: 'org_assigned', reason: '越权尝试' },
      'P-INTAKE-A',
    );
    expect(outside.status).toBe(403);
    expect(outside.body.reason).toBe('scope-denied');
  });

  it('上级内勤 designate=false 把线索从甲区改到同级的乙区：409 designation-required；designate=true 主动指定照旧（#228）', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(65)) });
    const clueId = registered.body.id ?? '';
    await assignOrg(clueId, { orgUnitId: deptAId }, 'P-INTAKE-A');
    const before = await cloned.prisma.clueAssignment.count({ where: { clueId } });
    const moved = await assignOrg(
      clueId,
      { orgUnitId: deptBId, expectedStatus: 'org_assigned', reason: '改由乙区承办' },
      'P-INTAKE-HQ',
    );
    expect(moved.status).toBe(409);
    expect(moved.body.reason).toBe('designation-required');
    expect(moved.body.nextAction).toBe('clue.designate.request');
    const current = await cloned.prisma.clueAssignment.findFirst({ where: { clueId, endedAt: null } });
    expect(current?.orgUnitId).toBe(deptAId);
    expect(await cloned.prisma.clueAssignment.count({ where: { clueId } })).toBe(before);
    const failed = (await trailOf('clue.org-assigned', clueId)).filter((row) => row.outcome === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('designation-required');

    // 上级不经报请以 designate=true 主动指定：保留现行为（#228 评论确认）。
    const designated = await assignOrg(
      clueId,
      { orgUnitId: deptBId, expectedStatus: 'org_assigned', reason: '市局指定乙区', designate: true },
      'P-INTAKE-HQ',
    );
    expect(designated.status).toBe(200);
    const after = await cloned.prisma.clueAssignment.findFirst({ where: { clueId, endedAt: null } });
    expect(after?.orgUnitId).toBe(deptBId);
    expect(after?.kind).toBe('designate');
  });

  it('指定管辖：上级内勤 designate=true 指定下级；指定之后下级重新分派 409 designated-lock', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(62)) });
    // 市局内勤指定甲所承办（甲所是市局的下级）。
    const designated = await assignOrg(
      registered.body.id ?? '',
      { orgUnitId: stationAId, designate: true },
      'P-INTAKE-HQ',
    );
    expect(designated.status).toBe(200);
    const assignments = await cloned.prisma.clueAssignment.findMany({
      where: { clueId: registered.body.id },
    });
    expect(assignments[0]?.kind).toBe('designate');
    expect(assignments[0]?.designate).toBe(true);
    expect(assignments[0]?.assignedByOrgId).not.toBeNull();

    // 下级（甲区内勤是甲所的上级？不是——甲区内勤属甲区，是甲所的上级机构内勤。
    // 指定者是市局：甲区内勤不是指定者或其上级，锁生效）。
    const locked = await assignOrg(
      registered.body.id ?? '',
      { orgUnitId: deptAId, expectedStatus: 'org_assigned', reason: '想换机构' },
      'P-INTAKE-A',
    );
    expect(locked.status).toBe(409);
    expect(locked.body.result).toBe('invalid-state');
    expect(locked.body.reason).toBe('designated-lock');
    const failed = (await trailOf('clue.org-assigned', registered.body.id)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('designated-lock');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: registered.body.id } });
    expect(clue?.status).toBe('org_assigned');

    // 指定者本人（市局内勤）可以再调整。
    const byDesignator = await assignOrg(
      registered.body.id ?? '',
      { orgUnitId: deptBId, expectedStatus: 'org_assigned', reason: '改派乙区', designate: true },
      'P-INTAKE-HQ',
    );
    expect(byDesignator.status).toBe(200);
  });

  it('红探针：assign-org 成功的 reassign 留痕一律 previousOrgId = orgUnitId（#228）', async () => {
    const rows = await cloned.prisma.$queryRaw<TrailRow[]>`
      SELECT action, outcome, reason, detail, resource_id
      FROM audit_trail
      WHERE action = 'clue.org-assigned' AND outcome = 'succeeded'
    `;
    const reassigns = rows
      .map((row) => JSON.parse(row.detail ?? '{}') as { kind?: string; previousOrgId?: string | null; orgUnitId?: string })
      .filter((detail) => detail.kind === 'reassign');
    expect(reassigns.length).toBeGreaterThan(0);
    for (const detail of reassigns) {
      expect(detail.previousOrgId).toBe(detail.orgUnitId);
    }
  });

  it('并发控制：派机构 expectedStatus 不符 409 concurrent-change＋失败留痕，业务行不变', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(63)) });
    const outcome = await assignOrg(
      registered.body.id ?? '',
      { orgUnitId: stationAId, expectedStatus: 'org_assigned' },
      'P-INTAKE-A',
    );
    expect(outcome.status).toBe(409);
    expect(outcome.body.result).toBe('concurrent-change');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: registered.body.id } });
    expect(clue?.status).toBe('in_pool');
    const failed = (await trailOf('clue.org-assigned', registered.body.id)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('concurrent-change');
    expect(
      await cloned.prisma.clueAssignment.count({ where: { clueId: registered.body.id } }),
    ).toBe(0);
  });

  it('派主办／协办并发冲突：409 concurrent-change＋失败留痕，承办人行不变', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(64)) });
    await assignOrg(registered.body.id ?? '', { orgUnitId: stationAId }, 'P-INTAKE-A');
    const outcome = await assignPeople(
      registered.body.id ?? '',
      { mainId: handlerSt1, expectedStatus: 'handler_assigned' },
      'P-INTAKE-ST',
    );
    expect(outcome.status).toBe(409);
    expect(outcome.body.result).toBe('concurrent-change');
    const failed = (await trailOf('clue.handler-assigned', registered.body.id)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('concurrent-change');
    const handlers = await cloned.prisma.clueHandler.findMany({
      where: { clueId: registered.body.id },
    });
    expect(handlers).toHaveLength(0);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: registered.body.id } });
    expect(clue?.status).toBe('org_assigned');
  });
});

/**
 * P7 夹具：规划类点状线索注册后直接进 in_pool，走不到分派决定步。
 * 这里在注册之后把线索行直接置为 pending_decision，只测决定步的校验，不改注册分流。
 */
async function seedClueAtPendingDecision(types: string, point: { lng: number; lat: number }): Promise<string> {
  const registered = await register({
    domain: 'planning',
    types,
    polygon: geojsonPoint(point.lng, point.lat),
    // 类型层「录入时」必填项：只有违法建设类要填在建／已建成，其他类型填了反而是无效项。
    values:
      types === 'planning_build_without_permit'
        ? { ...BASE_VALUES, 'type.planning_build_without_permit.build_stage': '已建成' }
        : BASE_VALUES,
  });
  expect(registered.status, JSON.stringify(registered.body)).toBe(201);
  const clueId = registered.body.id ?? '';
  await cloned.prisma.clue.update({ where: { id: clueId }, data: { status: 'pending_decision' } });
  return clueId;
}

describe('P7 个案判断规划类分派校验', () => {
  it('个案判断项派时缺 conflictResolution → 400 missing-conflict-resolution，业务行不变', async () => {
    const clueId = await seedClueAtPendingDecision('planning_build_without_permit', { lng: 113, lat: 23 });
    const outcome = await decide(clueId, { decision: 'dispatch' });
    expect(outcome.status).toBe(400);
    expect(outcome.body.rules).toEqual(['missing-conflict-resolution']);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('pending_decision');
  });

  it('个案判断项派时缺 conflictBasis → 400 missing-conflict-basis，业务行不变', async () => {
    const clueId = await seedClueAtPendingDecision('planning_build_without_permit', { lng: 113.1, lat: 23.1 });
    const outcome = await decide(clueId, { decision: 'dispatch', conflictResolution: 'handle-in-system' });
    expect(outcome.status).toBe(400);
    expect(outcome.body.rules).toEqual(['missing-conflict-basis']);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('pending_decision');
  });

  it('个案判断项提供完整冲突解决参数 → 200，进入待分派池', async () => {
    const clueId = await seedClueAtPendingDecision('planning_build_without_permit', { lng: 113.2, lat: 23.2 });
    const outcome = await decide(clueId, {
      decision: 'dispatch',
      conflictResolution: 'handle-in-system',
      conflictBasis: '依据《城乡规划法》第 64 条',
    });
    expect(outcome.status).toBe(200);
    // 「派」只把线索放进待分派池，派机构是下一步。
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('in_pool');
  });

  it('体系内规划类派时不需冲突解决参数', async () => {
    const clueId = await seedClueAtPendingDecision('planning_completion_data_unreported', { lng: 113.3, lat: 23.3 });
    const outcome = await decide(clueId, { decision: 'dispatch' });
    expect(outcome.status).toBe(200);
  });
});
