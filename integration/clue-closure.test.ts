// #217／#226 结案提醒处理、其他 HTTP 路径旁路，以及 #226 不予立案：
// HTTP disposition=no-case 一律拒绝；落点服务 recordNoCaseFromFilingApproval 直调验收；
// 立案提醒 kind=case 恒生成（已删 filedReminderEnabled）。
// 凡 4xx/403 用例同时断言「失败留痕存在、业务行不变」。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  generateClosureReminders,
  recordNoCaseFromFilingApproval,
} from '../backend/case/src/index.ts';
import { newUlid } from '../backend/identity/src/index.ts';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { ClueClosureService } from '../backend/server/src/clue-closure.service.ts';
import { UNIT_OF_WORK, type UnitOfWork } from '../backend/server/src/unit-of-work.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-25T05:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Clue-closure-217!';
const INITIAL_PASSWORD = 'Closure-217!!';

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
let uow: UnitOfWork;
let closureService: ClueClosureService;
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
}

const BASE_VALUES = {
  'clue.received_at': '2026-10-25',
  'clue.narrative': '巡查发现一处硬化地面',
  'clue.finder': '巡查员乙',
  'clue.patrol_no': 'XC-2026-002',
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

/** 派主办／协办。 */
async function assignPeople(
  clueId: string,
  input: { mainId: string; assistIds?: readonly string[]; expectedStatus?: string },
  code = 'P-INTAKE-ST',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({
      mainId: input.mainId,
      assistIds: input.assistIds ?? [],
      expectedStatus: input.expectedStatus ?? 'org_assigned',
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** 不予立案登记。 */
async function recordNoCase(
  clueId: string,
  input: { disposition?: string; note?: string; expectedStatus?: string } = {},
  code = 'P-HANDLER-ST1',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/disposition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({
      disposition: input.disposition ?? 'no-case',
      note: input.note ?? '核查后查无违法事实，不予立案。',
      expectedStatus: input.expectedStatus ?? 'handler_assigned',
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}


/** #226 落点：不符合立案条件（第 16 条至少一项）。 */
function groundsReason(codes: readonly string[] = ['art16-2-no-violation-fact']) {
  return { kind: 'non-filing-grounds' as const, grounds: [...codes], note: '核查后不符合立案条件' };
}

/** #226 落点：轻微三要素。 */
function minorReason() {
  return {
    kind: 'minor-corrected-no-harm' as const,
    minor: { confirmed: true as const, note: '违法行为轻微' },
    timelyCorrection: { confirmed: true as const, note: '已及时纠正' },
    noHarm: { confirmed: true as const, note: '没有造成危害后果' },
  };
}

/** 直调落点服务（同事务写处置＋提醒＋留痕由 Nest 包装）。 */
async function recordNoCaseFromFiling(
  clueId: string,
  input: {
    reason?: unknown;
    filingApprovalRef?: string;
    expectedStatus?: string;
    note?: string;
    recordedBy?: string;
  } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const outcome = await closureService.recordNoCaseFromFiling({
    clueId,
    expectedStatus: input.expectedStatus ?? 'handler_assigned',
    filingApprovalRef: input.filingApprovalRef ?? newUlid(),
    reason: input.reason ?? groundsReason(),
    recordedBy: input.recordedBy ?? handlerSt1Id,
    note: input.note ?? '呈批批准不予立案',
    actorCode: 'P-HANDLER-ST1',
  });
  return { status: outcome.status, body: outcome.body as Record<string, unknown> };
}

/** 结案提醒列表。 */
async function listReminders(code = 'P-INTAKE-A'): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/reminders`, {
    method: 'GET',
    headers: { cookie: await cookieOf(code) },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** 不派视图。 */
async function listHeld(code = 'P-INTAKE-A'): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/held`, {
    method: 'GET',
    headers: { cookie: await cookieOf(code) },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** 提醒处理。 */
async function resolveReminder(
  reminderId: string,
  input: {
    resolution?: string;
    reasonCodes?: readonly string[];
    note?: string;
    expectedStatus?: string;
  },
  code = 'P-INTAKE-A',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/reminders/${reminderId}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({
      resolution: input.resolution ?? 'withdraw',
      reasonCodes: input.reasonCodes ?? ['误判重复'],
      note: input.note ?? '经核为不同违法，应派。',
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
      LIMIT 20
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
let handlerSt1Id = '';

/**
 * 铺一组「旧线索已派承办人 ＋ 新线索撞上后不派」的场景。
 * 返回旧线索与暂存（新）线索的编号。
 */
async function heldPair(offset: number): Promise<{ oldClueId: string; heldClueId: string }> {
  const old = await register({ polygon: geojsonPolygon(square(offset)) });
  expect(old.body.status).toBe('in_pool');
  const assigned = await assignOrg(old.body.id ?? '', { orgUnitId: stationAId });
  expect(assigned.status).toBe(200);
  const people = await assignPeople(old.body.id ?? '', { mainId: handlerSt1Id });
  expect(people.status).toBe(200);
  const second = await register({ polygon: geojsonPolygon(square(offset)) });
  expect(second.body.status).toBe('pending_decision');
  const held = await decide(second.body.id ?? '', { decision: 'hold' });
  expect(held.status).toBe(200);
  return { oldClueId: old.body.id ?? '', heldClueId: second.body.id ?? '' };
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
  uow = app.get<UnitOfWork>(UNIT_OF_WORK);
  closureService = app.get(ClueClosureService);

  const orgOf = async (code: string) => {
    const org = await cloned.prisma.orgUnit.findUnique({ where: { code } });
    if (!org) throw new Error(`缺少种子机构 ${code}`);
    return org.id;
  };
  deptAId = await orgOf('ORG-DEPT-A');
  deptBId = await orgOf('ORG-DEPT-B');
  stationAId = await orgOf('ORG-STATION-A');
  await seedPerson('P-INTAKE-A', '甲区内勤', deptAId, ['内勤'], '13900004001');
  await seedPerson('P-INTAKE-B', '乙区内勤', deptBId, ['内勤'], '13900004002');
  await seedPerson('P-INTAKE-ST', '甲所内勤', stationAId, ['内勤'], '13900004003');
  await seedPerson('P-HANDLER-ST1', '甲所经办甲', stationAId, ['经办'], '13900004004');
  await seedPerson('P-HANDLER-ST2', '甲所经办乙', stationAId, ['经办'], '13900004005');
  for (const code of ['P-INTAKE-A', 'P-INTAKE-B', 'P-INTAKE-ST', 'P-HANDLER-ST1', 'P-HANDLER-ST2']) {
    await cookieOf(code, INITIAL_PASSWORD);
  }
  const handler = await cloned.prisma.personnel.findUnique({ where: { code: 'P-HANDLER-ST1' } });
  if (!handler) throw new Error('缺少种子人员 P-HANDLER-ST1');
  handlerSt1Id = handler.id;
}, 60_000);

afterAll(async () => {
  await closeApp();
  await cloned?.close();
});

beforeEach(() => {
  storage.writes.length = 0;
});

describe('#226 HTTP 拒绝直接登记不予立案', () => {
  it('主办本人 disposition=no-case：400 filing-approval-required，业务行不变＋失败留痕', async () => {
    const pair = await heldPair(80);
    const outcome = await recordNoCase(pair.oldClueId);
    expect(outcome.status).toBe(400);
    expect(outcome.body.rules).toEqual(['filing-approval-required']);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: pair.oldClueId } });
    expect(clue?.status).toBe('handler_assigned');
    expect(await cloned.prisma.clueDisposition.findFirst({ where: { clueId: pair.oldClueId } })).toBeNull();
    expect(await cloned.prisma.clueClosureReminder.findMany({ where: { clueId: pair.heldClueId } })).toHaveLength(0);
    const failed = (await trailOf('clue.disposition-recorded', pair.oldClueId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('filing-approval-required');
  });

  it('协办本人：同样拒绝', async () => {
    const old = await register({ polygon: geojsonPolygon(square(81)) });
    await assignOrg(old.body.id ?? '', { orgUnitId: stationAId });
    const handler2 = await cloned.prisma.personnel.findUnique({ where: { code: 'P-HANDLER-ST2' } });
    await assignPeople(old.body.id ?? '', {
      mainId: handlerSt1Id,
      assistIds: handler2 ? [handler2.id] : [],
    });
    const outcome = await recordNoCase(old.body.id ?? '', {}, 'P-HANDLER-ST2');
    expect(outcome.status).toBe(400);
    expect(outcome.body.rules).toEqual(['filing-approval-required']);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: old.body.id } });
    expect(clue?.status).toBe('handler_assigned');
  });

  it('承办机构内勤：同样拒绝', async () => {
    const old = await register({ polygon: geojsonPolygon(square(82)) });
    await assignOrg(old.body.id ?? '', { orgUnitId: stationAId });
    await assignPeople(old.body.id ?? '', { mainId: handlerSt1Id });
    const outcome = await recordNoCase(old.body.id ?? '', {}, 'P-INTAKE-ST');
    expect(outcome.status).toBe(400);
    expect(outcome.body.rules).toEqual(['filing-approval-required']);
  });
});

describe('#226 落点服务 recordNoCaseFromFiling', () => {
  it('(a) handler_assigned → closed，处置＋呈批引用＋理由快照＋留痕＋kind=no-case 提醒', async () => {
    const pair = await heldPair(83);
    const filingRef = newUlid();
    const outcome = await recordNoCaseFromFiling(pair.oldClueId, {
      filingApprovalRef: filingRef,
      reason: groundsReason(['art16-2-no-violation-fact', 'art16-5-beyond-limitation']),
    });
    expect(outcome.status).toBe(200);
    expect(outcome.body.result).toBe('disposition-recorded');
    expect(outcome.body.status).toBe('closed');
    expect(outcome.body.reminderCount).toBe(1);

    const clue = await cloned.prisma.clue.findUnique({ where: { id: pair.oldClueId } });
    expect(clue?.status).toBe('closed');
    const disposition = await cloned.prisma.clueDisposition.findFirst({ where: { clueId: pair.oldClueId } });
    expect(disposition?.disposition).toBe('no-case');
    expect(disposition?.filingApprovalRef).toBe(filingRef);
    expect(disposition?.noCaseReasonJson).toContain('non-filing-grounds');
    expect(disposition?.noCaseReasonJson).toContain('art16-2-no-violation-fact');

    const trail = (await trailOf('clue.disposition-recorded', pair.oldClueId)).filter(
      (row) => row.outcome === 'succeeded',
    );
    expect(trail).toHaveLength(1);
    expect(trail[0]?.detail).toContain('no-case');
    expect(trail[0]?.detail).toContain(filingRef);

    const reminders = await cloned.prisma.clueClosureReminder.findMany({
      where: { clueId: pair.heldClueId },
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.kind).toBe('no-case');
    expect(reminders[0]?.otherClueId).toBe(pair.oldClueId);
  });

  it('(b) 三要素齐全成功', async () => {
    const pair = await heldPair(84);
    const outcome = await recordNoCaseFromFiling(pair.oldClueId, { reason: minorReason() });
    expect(outcome.status).toBe(200);
    const disposition = await cloned.prisma.clueDisposition.findFirst({ where: { clueId: pair.oldClueId } });
    expect(disposition?.noCaseReasonJson).toContain('minor-corrected-no-harm');
  });

  it('非 handler_assigned → 409 invalid-state＋失败留痕', async () => {
    const alone = await register({ polygon: geojsonPolygon(square(85)) });
    await assignOrg(alone.body.id ?? '', { orgUnitId: stationAId });
    const outcome = await recordNoCaseFromFiling(alone.body.id ?? '', {
      expectedStatus: 'org_assigned',
    });
    expect(outcome.status).toBe(409);
    expect(outcome.body.result).toBe('invalid-state');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: alone.body.id } });
    expect(clue?.status).toBe('org_assigned');
    expect(await cloned.prisma.clueDisposition.findFirst({ where: { clueId: alone.body.id } })).toBeNull();
    const failed = (await trailOf('clue.disposition-recorded', alone.body.id ?? '')).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('invalid-state');
  });

  it('核查失败不阻止落点', async () => {
    const old = await register({ polygon: geojsonPolygon(square(86)) });
    await assignOrg(old.body.id ?? '', { orgUnitId: stationAId });
    await assignPeople(old.body.id ?? '', { mainId: handlerSt1Id });
    await cloned.prisma.clue.update({
      where: { id: old.body.id ?? '' },
      data: { verificationStatus: 'failed' },
    });
    const outcome = await recordNoCaseFromFiling(old.body.id ?? '');
    expect(outcome.status).toBe(200);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: old.body.id } });
    expect(clue?.status).toBe('closed');
  });

  it('(a)(b) 皆空拒绝', async () => {
    const old = await register({ polygon: geojsonPolygon(square(87)) });
    await assignOrg(old.body.id ?? '', { orgUnitId: stationAId });
    await assignPeople(old.body.id ?? '', { mainId: handlerSt1Id });
    const outcome = await recordNoCaseFromFiling(old.body.id ?? '', { reason: {} });
    expect(outcome.status).toBe(400);
    expect(outcome.body.rules).toEqual(['invalid-no-case-reason']);
    expect(await cloned.prisma.clueDisposition.findFirst({ where: { clueId: old.body.id } })).toBeNull();
  });

  it('混选拒绝', async () => {
    const old = await register({ polygon: geojsonPolygon(square(88)) });
    await assignOrg(old.body.id ?? '', { orgUnitId: stationAId });
    await assignPeople(old.body.id ?? '', { mainId: handlerSt1Id });
    const outcome = await recordNoCaseFromFiling(old.body.id ?? '', {
      reason: {
        kind: 'non-filing-grounds',
        grounds: ['art16-1-no-clear-actor'],
        minor: { confirmed: true, note: 'x' },
      },
    });
    expect(outcome.status).toBe(400);
    expect(outcome.body.rules).toEqual(['invalid-no-case-reason']);
  });

  it('仅部分三要素拒绝', async () => {
    const old = await register({ polygon: geojsonPolygon(square(89)) });
    await assignOrg(old.body.id ?? '', { orgUnitId: stationAId });
    await assignPeople(old.body.id ?? '', { mainId: handlerSt1Id });
    const outcome = await recordNoCaseFromFiling(old.body.id ?? '', {
      reason: {
        kind: 'minor-corrected-no-harm',
        minor: { confirmed: true, note: '轻微' },
        timelyCorrection: { confirmed: true, note: '已改正' },
      },
    });
    expect(outcome.status).toBe(400);
    expect(outcome.body.rules).toEqual(['invalid-no-case-reason']);
  });

  it('同事务：人为回滚则处置与提醒全无', async () => {
    const pair = await heldPair(70);
    await expect(
      uow.run(async (tx) => {
        const outcome = await recordNoCaseFromFilingApproval(tx.clues, {
          clueId: pair.oldClueId,
          expectedStatus: 'handler_assigned',
          filingApprovalRef: newUlid(),
          reason: groundsReason(),
          recordedBy: handlerSt1Id,
          recordedAt: new Date(),
          newId: () => newUlid(),
        });
        expect(outcome.ok).toBe(true);
        throw new Error('模拟案件段同事务回滚');
      }),
    ).rejects.toThrow('模拟案件段同事务回滚');
    expect(await cloned.prisma.clueDisposition.findFirst({ where: { clueId: pair.oldClueId } })).toBeNull();
    expect(await cloned.prisma.clueClosureReminder.findMany({ where: { clueId: pair.heldClueId } })).toHaveLength(0);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: pair.oldClueId } });
    expect(clue?.status).toBe('handler_assigned');
  });
});

describe('#217 结案提醒生成', () => {
  it('仅当前 held 的线索生成提醒：非 held 的撞车线索不生成', async () => {
    const pair = await heldPair(90);
    // 第三条线索也撞上，但状态不是 held（待分派决定）。
    const third = await register({ polygon: geojsonPolygon(square(90)) });
    expect(third.body.status).toBe('pending_decision');
    const outcome = await recordNoCaseFromFiling(pair.oldClueId);
    expect(outcome.status).toBe(200);
    expect(outcome.body.reminderCount).toBe(1);
    const forThird = await cloned.prisma.clueClosureReminder.findMany({
      where: { clueId: third.body.id ?? '' },
    });
    expect(forThird).toHaveLength(0);
  });

  it('立案提醒恒生成（#226）：kind=case 逐对生成，与状态写入同事务', async () => {
    const pair = await heldPair(91);
    await cloned.prisma.clue.update({
      where: { id: pair.oldClueId },
      data: { status: 'filed' },
    });
    await expect(
      uow.run(async (tx) => {
        await generateClosureReminders(tx.clues, {
          closedClueId: pair.oldClueId,
          kind: 'case',
          createdAt: new Date(),
          newId: () => newUlid(),
        });
        throw new Error('模拟案件段同事务回滚');
      }),
    ).rejects.toThrow('模拟案件段同事务回滚');
    expect(
      await cloned.prisma.clueClosureReminder.findMany({ where: { clueId: pair.heldClueId } }),
    ).toHaveLength(0);

    await uow.run(async (tx) => {
      await generateClosureReminders(tx.clues, {
        closedClueId: pair.oldClueId,
        kind: 'case',
        createdAt: new Date(),
        newId: () => newUlid(),
      });
    });
    const reminders = await cloned.prisma.clueClosureReminder.findMany({
      where: { clueId: pair.heldClueId },
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.kind).toBe('case');
    expect(reminders[0]?.otherClueId).toBe(pair.oldClueId);
  });
});

describe('#217 界面口径', () => {
  it('四项常用原因由服务端给出，界面不另存一份', async () => {
    const response = await fetch(`${baseUrl}/api/clues/closure-options`, {
      method: 'GET',
      headers: { cookie: await cookieOf('P-INTAKE-A') },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly withdrawReasons: readonly string[] };
    expect(body.withdrawReasons).toEqual([
      '同一地点不同违法',
      '新增情况',
      '原线索核查不属实需重派',
      '误判重复',
    ]);
  });
});

describe('#217 结案提醒处理', () => {
  it('撤回不派再办：回待分派池、撤回行与提醒处理留痕齐备', async () => {
    const pair = await heldPair(92);
    await recordNoCaseFromFiling(pair.oldClueId);
    const reminders = await cloned.prisma.clueClosureReminder.findMany({
      where: { clueId: pair.heldClueId },
    });
    const reminderId = reminders[0]?.id ?? '';
    const outcome = await resolveReminder(reminderId, { resolution: 'withdraw' });
    expect(outcome.status).toBe(200);
    expect(outcome.body.resolution).toBe('withdraw');
    expect(outcome.body.status).toBe('in_pool');

    const clue = await cloned.prisma.clue.findUnique({ where: { id: pair.heldClueId } });
    expect(clue?.status).toBe('in_pool');
    const withdrawal = await cloned.prisma.clueWithdrawal.findFirst({ where: { clueId: pair.heldClueId } });
    expect(withdrawal?.reasonCodes).toEqual(['误判重复']);
    const resolved = await cloned.prisma.clueClosureReminder.findFirst({ where: { id: reminderId } });
    expect(resolved?.resolvedAt).not.toBeNull();
    expect(resolved?.resolution).toBe('withdraw');

    const trail = (await trailOf('clue.reminder-resolved', pair.heldClueId)).filter(
      (row) => row.outcome === 'succeeded',
    );
    expect(trail).toHaveLength(1);
    expect(trail[0]?.detail).toContain(reminderId);
    const withdrawn = (await trailOf('clue.withdrawn', pair.heldClueId)).filter(
      (row) => row.outcome === 'succeeded',
    );
    expect(withdrawn).toHaveLength(1);
  });

  it('写明原因随旧线索办结：进 closed、处置行与提醒处理留痕齐备', async () => {
    const pair = await heldPair(93);
    await recordNoCaseFromFiling(pair.oldClueId);
    const reminders = await cloned.prisma.clueClosureReminder.findMany({
      where: { clueId: pair.heldClueId },
    });
    const reminderId = reminders[0]?.id ?? '';
    const outcome = await resolveReminder(reminderId, {
      resolution: 'close-with-old',
      note: '与旧线索同一事项，随旧线索办结。',
    });
    expect(outcome.status).toBe(200);
    expect(outcome.body.status).toBe('closed');

    const clue = await cloned.prisma.clue.findUnique({ where: { id: pair.heldClueId } });
    expect(clue?.status).toBe('closed');
    const disposition = await cloned.prisma.clueDisposition.findFirst({ where: { clueId: pair.heldClueId } });
    expect(disposition?.disposition).toBe('with-old');
    expect(disposition?.note).toBe('与旧线索同一事项，随旧线索办结。');
    const trail = (await trailOf('clue.reminder-resolved', pair.heldClueId)).filter(
      (row) => row.outcome === 'succeeded',
    );
    expect(trail).toHaveLength(1);
    expect(trail[0]?.detail).toContain('close-with-old');
  });

  it('选撤回不派再办但缺原因：400＋失败留痕，线索仍在「不派」', async () => {
    const pair = await heldPair(94);
    await recordNoCaseFromFiling(pair.oldClueId);
    const reminders = await cloned.prisma.clueClosureReminder.findMany({
      where: { clueId: pair.heldClueId },
    });
    const reminderId = reminders[0]?.id ?? '';
    const outcome = await resolveReminder(reminderId, { resolution: 'withdraw', reasonCodes: [] });
    expect(outcome.status).toBe(400);
    expect(outcome.body.rules).toEqual(['missing-withdraw-reason']);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: pair.heldClueId } });
    expect(clue?.status).toBe('held');
    const failed = (await trailOf('clue.reminder-resolved', pair.heldClueId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('missing-withdraw-reason');
  });

  it('选随旧线索办结但缺说明：400＋失败留痕', async () => {
    const pair = await heldPair(95);
    await recordNoCaseFromFiling(pair.oldClueId);
    const reminders = await cloned.prisma.clueClosureReminder.findMany({
      where: { clueId: pair.heldClueId },
    });
    const outcome = await resolveReminder(reminders[0]?.id ?? '', {
      resolution: 'close-with-old',
      note: ' ',
    });
    expect(outcome.status).toBe(400);
    expect(outcome.body.rules).toEqual(['missing-disposition-fields']);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: pair.heldClueId } });
    expect(clue?.status).toBe('held');
  });

  it('无权人处理提醒：403＋authz.denied，线索仍在「不派」', async () => {
    const pair = await heldPair(96);
    await recordNoCaseFromFiling(pair.oldClueId);
    const reminders = await cloned.prisma.clueClosureReminder.findMany({
      where: { clueId: pair.heldClueId },
    });
    const outcome = await resolveReminder(reminders[0]?.id ?? '', {}, 'P-INTAKE-B');
    expect(outcome.status).toBe(403);
    expect(outcome.body.reason).toBe('permission-denied');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: pair.heldClueId } });
    expect(clue?.status).toBe('held');
    const denied = await trailOf('authz.denied', pair.heldClueId);
    expect(denied.length).toBeGreaterThan(0);
  });

  it('监督处理提醒：403，业务行不变', async () => {
    const pair = await heldPair(97);
    await recordNoCaseFromFiling(pair.oldClueId);
    const reminders = await cloned.prisma.clueClosureReminder.findMany({
      where: { clueId: pair.heldClueId },
    });
    const outcome = await resolveReminder(reminders[0]?.id ?? '', {}, 'P-SUPER-B');
    expect(outcome.status).toBe(403);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: pair.heldClueId } });
    expect(clue?.status).toBe('held');
  });

  it('提醒列表与不派视图：只在数据范围内返回，且给出可办理标记', async () => {
    const pair = await heldPair(98);
    await recordNoCaseFromFiling(pair.oldClueId);
    const reminders = await listReminders();
    expect(reminders.status).toBe(200);
    const rows = (reminders.body.reminders ?? []) as Array<{
      readonly reminderId: string;
      readonly clueId: string;
      readonly mayResolve: boolean;
    }>;
    expect(rows.some((row) => row.clueId === pair.heldClueId)).toBe(true);
    expect(rows.find((row) => row.clueId === pair.heldClueId)?.mayResolve).toBe(true);

    const held = await listHeld();
    expect(held.status).toBe(200);
    const clues = (held.body.clues ?? []) as Array<{
      readonly clueId: string;
      readonly code: string;
      readonly mayWithdraw: boolean;
      readonly hitCodes: readonly string[];
    }>;
    const row = clues.find((item) => item.clueId === pair.heldClueId);
    expect(row?.mayWithdraw).toBe(true);
    expect(row?.hitCodes.length).toBeGreaterThan(0);
  });
});
