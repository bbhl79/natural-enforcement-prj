// #217 撤回不派：权限（录入人本人／录入机构内勤／所撞既有线索承办机构内勤；监督不能）、
// 四项常用原因（逐字、多选至少一项）与补充说明（必填）校验、状态回待分派池、
// 撤回行与留痕。凡 4xx/403 用例同时断言「失败留痕存在、业务行不变」。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-25T03:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Clue-withdraw-217!';
const INITIAL_PASSWORD = 'Withdraw-217!!';

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

/** 记录投递的假队列端口：不执行，核查停在「进行中」（核查没跑成不拦业务）。 */
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

/** 分派决定。 */
async function decide(
  clueId: string,
  input: { decision: string; acknowledged?: boolean; expectedStatus?: string },
  code = 'P-INTAKE-A',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({
      decision: input.decision,
      acknowledged: input.acknowledged ?? false,
      expectedStatus: input.expectedStatus ?? 'pending_decision',
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** 派机构。 */
async function assignOrg(
  clueId: string,
  input: { orgUnitId: string; expectedStatus?: string; reason?: string; designate?: boolean },
  code = 'P-INTAKE-A',
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

/** 撤回不派。 */
async function withdraw(
  clueId: string,
  input: {
    readonly reasonCodes?: readonly string[];
    readonly note?: string;
    readonly expectedStatus?: string;
  },
  code = 'P-INTAKE-A',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/withdraw`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({
      reasonCodes: input.reasonCodes ?? ['误判重复'],
      note: input.note ?? '经核为不同地块，应派。',
      expectedStatus: input.expectedStatus ?? 'held',
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

/** 登记两条相撞线索并把第二条决定为「不派」，返回 held 线索 id。 */
async function heldClue(offset: number): Promise<string> {
  await register({ polygon: geojsonPolygon(square(offset)) });
  const second = await register({ polygon: geojsonPolygon(square(offset)) });
  expect(second.body.status).toBe('pending_decision');
  const held = await decide(second.body.id ?? '', { decision: 'hold' });
  expect(held.status).toBe(200);
  return second.body.id ?? '';
}

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

  const orgOf = async (code: string) => {
    const org = await cloned.prisma.orgUnit.findUnique({ where: { code } });
    if (!org) throw new Error(`缺少种子机构 ${code}`);
    return org.id;
  };
  deptAId = await orgOf('ORG-DEPT-A');
  deptBId = await orgOf('ORG-DEPT-B');
  stationAId = await orgOf('ORG-STATION-A');
  await seedPerson('P-INTAKE-A', '甲区内勤', deptAId, ['内勤'], '13900003001');
  await seedPerson('P-INTAKE-B', '乙区内勤', deptBId, ['内勤'], '13900003002');
  await seedPerson('P-INTAKE-ST', '甲所内勤', stationAId, ['内勤'], '13900003003');
  await seedPerson('P-HANDLER-ST1', '甲所经办甲', stationAId, ['经办'], '13900003004');
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

describe('#217 撤回不派', () => {
  it('录入人本人撤回：成功回待分派池，撤回行与留痕齐备（原因逐字、可多选）', async () => {
    const clueId = await heldClue(60);
    const outcome = await withdraw(clueId, {
      reasonCodes: ['同一地点不同违法', '新增情况'],
      note: '经现场复核为不同违法地块，应派。',
    });
    expect(outcome.status).toBe(200);
    expect(outcome.body.result).toBe('withdrawn');
    expect(outcome.body.status).toBe('in_pool');

    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('in_pool');
    const row = await cloned.prisma.clueWithdrawal.findFirst({ where: { clueId } });
    expect(row?.reasonCodes).toEqual(['同一地点不同违法', '新增情况']);
    expect(row?.note).toBe('经现场复核为不同违法地块，应派。');
    const trail = (await trailOf('clue.withdrawn', clueId)).filter(
      (row) => row.outcome === 'succeeded',
    );
    expect(trail).toHaveLength(1);
    expect(trail[0]?.detail).toContain('同一地点不同违法');
    expect(trail[0]?.detail).toContain('新增情况');
  });

  it('录入机构内勤（非录入人）撤回：成功', async () => {
    // 本机构经办录入并决定「不派」；同机构内勤（非录入人）撤回。
    await register({ polygon: geojsonPolygon(square(61)) });
    const entered = await register({ polygon: geojsonPolygon(square(61)), code: 'P-CLERK-A' });
    expect(entered.body.status).toBe('pending_decision');
    const held = await decide(entered.body.id ?? '', { decision: 'hold' }, 'P-CLERK-A');
    expect(held.status).toBe(200);
    const outcome = await withdraw(entered.body.id ?? '', { reasonCodes: ['误判重复'] }, 'P-INTAKE-A');
    expect(outcome.status).toBe(200);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: entered.body.id } });
    expect(clue?.status).toBe('in_pool');
  });

  it('所撞既有线索承办机构内勤撤回：成功', async () => {
    // 旧线索派给甲所；新线索撞上后「不派」；甲所内勤（承办机构内勤）撤回新线索。
    const oldClue = await register({ polygon: geojsonPolygon(square(62)) });
    const assigned = await assignOrg(oldClue.body.id ?? '', { orgUnitId: stationAId });
    expect(assigned.status).toBe(200);
    const second = await register({ polygon: geojsonPolygon(square(62)) });
    expect(second.body.status).toBe('pending_decision');
    const held = await decide(second.body.id ?? '', { decision: 'hold' });
    expect(held.status).toBe(200);

    const outcome = await withdraw(second.body.id ?? '', { reasonCodes: ['原线索核查不属实需重派'] }, 'P-INTAKE-ST');
    expect(outcome.status).toBe(200);
    expect(outcome.body.status).toBe('in_pool');
  });

  it('撤回后可再走派机构（回池路径可用）', async () => {
    const clueId = await heldClue(63);
    const withdrawn = await withdraw(clueId, { reasonCodes: ['误判重复'] });
    expect(withdrawn.status).toBe(200);
    const assigned = await assignOrg(clueId, { orgUnitId: stationAId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.status).toBe('org_assigned');
  });

  it('监督撤回：403 permission-denied＋authz.denied，状态不变', async () => {
    const clueId = await heldClue(64);
    const outcome = await withdraw(clueId, { reasonCodes: ['误判重复'] }, 'P-SUPER-B');
    expect(outcome.status).toBe(403);
    expect(outcome.body.reason).toBe('permission-denied');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('held');
    const denied = await trailOf('authz.denied', clueId);
    expect(denied.length).toBeGreaterThan(0);
    expect(denied[0]?.reason).toBe('permission-denied');
    expect(await trailOf('clue.withdrawn', clueId)).toHaveLength(0);
  });

  it('有操作码但对象级无权（乙区内勤）：403＋authz.denied，状态不变', async () => {
    const clueId = await heldClue(65);
    const outcome = await withdraw(clueId, { reasonCodes: ['误判重复'] }, 'P-INTAKE-B');
    expect(outcome.status).toBe(403);
    expect(outcome.body.reason).toBe('permission-denied');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('held');
    const denied = (await trailOf('authz.denied', clueId)).filter(
      (row) => row.reason === 'permission-denied',
    );
    expect(denied).toHaveLength(1);
  });

  it('缺原因：400 non-compliant＋失败留痕，状态不变', async () => {
    const clueId = await heldClue(66);
    const outcome = await withdraw(clueId, { reasonCodes: [], note: '说明在。' });
    expect(outcome.status).toBe(400);
    expect(outcome.body.result).toBe('non-compliant');
    expect(outcome.body.rules).toEqual(['missing-withdraw-reason']);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('held');
    const failed = (await trailOf('clue.withdrawn', clueId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('missing-withdraw-reason');
    expect(await cloned.prisma.clueWithdrawal.findFirst({ where: { clueId } })).toBeNull();
  });

  it('缺说明：400 non-compliant＋失败留痕，状态不变', async () => {
    const clueId = await heldClue(67);
    const outcome = await withdraw(clueId, { reasonCodes: ['误判重复'], note: '  ' });
    expect(outcome.status).toBe(400);
    expect(outcome.body.rules).toEqual(['missing-withdraw-note']);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('held');
    const failed = (await trailOf('clue.withdrawn', clueId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('missing-withdraw-note');
  });

  it('原因不在四项之内：400 invalid-withdraw-reason＋失败留痕', async () => {
    const clueId = await heldClue(68);
    const outcome = await withdraw(clueId, { reasonCodes: ['新增情况', '随便写'] });
    expect(outcome.status).toBe(400);
    expect(outcome.body.rules).toEqual(['invalid-withdraw-reason']);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('held');
    const failed = (await trailOf('clue.withdrawn', clueId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed[0]?.reason).toBe('invalid-withdraw-reason');
  });

  it('非「不派」线索撤回：409 invalid-state＋失败留痕', async () => {
    const alone = await register({ polygon: geojsonPolygon(square(69)) });
    expect(alone.body.status).toBe('in_pool');
    const outcome = await withdraw(alone.body.id ?? '', {
      reasonCodes: ['误判重复'],
      expectedStatus: 'in_pool',
    });
    expect(outcome.status).toBe(409);
    expect(outcome.body.result).toBe('invalid-state');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: alone.body.id } });
    expect(clue?.status).toBe('in_pool');
    const failed = (await trailOf('clue.withdrawn', alone.body.id ?? '')).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('invalid-state');
  });

  it('expectedStatus 冲突：409 concurrent-change＋失败留痕，业务行不变', async () => {
    const clueId = await heldClue(70);
    const outcome = await withdraw(clueId, {
      reasonCodes: ['误判重复'],
      expectedStatus: 'in_pool',
    });
    expect(outcome.status).toBe(409);
    expect(outcome.body.result).toBe('concurrent-change');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('held');
    const failed = (await trailOf('clue.withdrawn', clueId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('concurrent-change');
  });
});
