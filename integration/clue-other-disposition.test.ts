// #229 线索处置「其他」与「系统外移送」附加记录。
// 其他：handler_assigned、理由必填、进 closed、kind=other 提醒、各自留痕。
// 系统外移送：须挂 other；不改状态；可事后补挂；缺字段复用 assessTransfer。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-26T09:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Clue-other-229!';
const INITIAL_PASSWORD = 'Other-229!!';

/** 以整数经度偏移区分方斑，避免用例之间互相撞成疑似重复。 */
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
let storage = new RecordingStorage();
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
const cookies = new Map<string, string>();
const passwords = new Map<string, string>();
let stationAId = '';
let deptAId = '';
let deptBId = '';
let handlerSt1Id = '';

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
      roles,
      mobilePhone,
      initialPassword: INITIAL_PASSWORD,
    }),
  });
  if (response.status !== 200) {
    throw new Error(`seedPerson ${code} failed: ${response.status} ${await response.text()}`);
  }
}

const BASE_VALUES = {
  'clue.received_at': '2026-10-26',
  'clue.narrative': '其他处置测试线索',
  'clue.finder': '巡查员',
  'clue.patrol_no': 'XC-2026-229',
};

async function register(options: {
  readonly polygon?: string;
  readonly code?: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  form.set('sourceCode', '16');
  form.set('domain', 'land');
  form.set('values', JSON.stringify(BASE_VALUES));
  form.set(
    'spatial-source',
    new Blob([options.polygon ?? geojsonPolygon(square(0))], { type: 'application/geo+json' }),
    'area.geojson',
  );
  const response = await fetch(`${baseUrl}/api/clues`, {
    method: 'POST',
    headers: {
      cookie: await cookieOf(options.code ?? 'P-229-IA'),
      'idempotency-key': `key-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function assignOrg(clueId: string, input: { orgUnitId: string }): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-229-IA') },
    body: JSON.stringify({ orgUnitId: input.orgUnitId, reason: '', designate: false, expectedStatus: 'in_pool' }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function assignPeople(clueId: string, input: { mainId: string }): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-229-ST') },
    body: JSON.stringify({ mainId: input.mainId, assistIds: [], expectedStatus: 'org_assigned' }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function decide(clueId: string, input: { decision: string }): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf('P-229-IA') },
    body: JSON.stringify({ decision: input.decision, acknowledged: true, expectedStatus: 'pending_decision' }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function recordOther(
  clueId: string,
  input: { note?: string; expectedStatus?: string } = {},
  code = 'P-229-H1',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/disposition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({
      disposition: 'other',
      note: input.note ?? '本机关批地事项，系统外行政处理。',
      expectedStatus: input.expectedStatus ?? 'handler_assigned',
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function attachExternal(
  clueId: string,
  input: { transferOrg?: string; documentNo?: string; reason?: string; letterDate?: string } = {},
  code = 'P-229-H1',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  form.append('transferOrg', input.transferOrg ?? '市纪委监委');
  form.append('documentNo', input.documentNo ?? '纪移〔2026〕1号');
  form.append('reason', input.reason ?? '涉嫌违纪另行处理');
  form.append('letterDate', input.letterDate ?? '');
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/external-transfers`, {
    method: 'POST',
    headers: { cookie: await cookieOf(code) },
    body: form,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function listExternal(clueId: string, code = 'P-229-H1'): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/external-transfers`, {
    headers: { cookie: await cookieOf(code) },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function trailOf(action: string, resourceId: string) {
  return cloned.prisma.$queryRaw<
    Array<{ action: string; outcome: string; reason: string | null; detail: string | null; resource_id: string }>
  >`
    SELECT action, outcome, reason, detail, resource_id
    FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
    ORDER BY created_at DESC, id DESC
  `;
}

async function heldPair(offset: number): Promise<{ oldClueId: string; heldClueId: string }> {
  const old = await register({ polygon: geojsonPolygon(square(offset)) });
  expect(old.body.status).toBe('in_pool');
  const assigned = await assignOrg(String(old.body.id), { orgUnitId: stationAId });
  expect(assigned.status).toBe(200);
  const people = await assignPeople(String(old.body.id), { mainId: handlerSt1Id });
  expect(people.status).toBe(200);
  const second = await register({ polygon: geojsonPolygon(square(offset)) });
  expect(second.body.status).toBe('pending_decision');
  const held = await decide(String(second.body.id), { decision: 'hold' });
  expect(held.status).toBe(200);
  return { oldClueId: String(old.body.id), heldClueId: String(second.body.id) };
}

async function assignedAlone(offset: number): Promise<string> {
  const old = await register({ polygon: geojsonPolygon(square(offset)) });
  expect(old.body.status).toBe('in_pool');
  const assigned = await assignOrg(String(old.body.id), { orgUnitId: stationAId });
  expect(assigned.status).toBe(200);
  const people = await assignPeople(String(old.body.id), { mainId: handlerSt1Id });
  expect(people.status).toBe(200);
  return String(old.body.id);
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
  await seedPerson('P-229-IA', '甲区内勤', deptAId, ['内勤'], '13900022901');
  await seedPerson('P-229-IB', '乙区内勤', deptBId, ['内勤'], '13900022902');
  await seedPerson('P-229-ST', '甲所内勤', stationAId, ['内勤'], '13900022903');
  await seedPerson('P-229-H1', '甲所经办甲', stationAId, ['经办'], '13900022904');
  await seedPerson('P-229-SU', '乙区监督', deptBId, ['监督'], '13900022905');
  for (const code of ['P-229-IA', 'P-229-IB', 'P-229-ST', 'P-229-H1', 'P-229-SU']) {
    await cookieOf(code, INITIAL_PASSWORD);
  }
  const handler = await cloned.prisma.personnel.findUnique({ where: { code: 'P-229-H1' } });
  if (!handler) throw new Error('缺少 P-HANDLER-ST1');
  handlerSt1Id = handler.id;
}, 60_000);

afterAll(async () => {
  await closeApp();
  await cloned?.close();
});

beforeEach(() => {
  storage.writes.length = 0;
});

describe('#229 其他处置', () => {
  it('主办登记 other：进 closed、处置行、留痕、held 提醒 kind=other', async () => {
    const pair = await heldPair(201);
    const outcome = await recordOther(pair.oldClueId);
    expect(outcome.status).toBe(200);
    expect(outcome.body.result).toBe('disposition-recorded');
    expect(outcome.body.status).toBe('closed');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: pair.oldClueId } });
    expect(clue?.status).toBe('closed');
    const disposition = await cloned.prisma.clueDisposition.findFirst({ where: { clueId: pair.oldClueId } });
    expect(disposition?.disposition).toBe('other');
    expect(disposition?.note).toContain('系统外行政处理');
    const trail = (await trailOf('clue.disposition-recorded', pair.oldClueId)).filter((row) => row.outcome !== 'failed');
    expect(trail).toHaveLength(1);
    expect(trail[0]?.detail).toContain('"disposition":"other"');
    const reminders = await cloned.prisma.clueClosureReminder.findMany({ where: { otherClueId: pair.oldClueId } });
    expect(reminders.length).toBeGreaterThanOrEqual(1);
    expect(reminders.every((row) => row.kind === 'other')).toBe(true);
  });

  it('缺理由：400＋失败留痕，业务行不变', async () => {
    const clueId = await assignedAlone(202);
    const outcome = await recordOther(clueId, { note: '  ' });
    expect(outcome.status).toBe(400);
    expect(outcome.body.rules).toEqual(['missing-disposition-fields']);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('handler_assigned');
    const failed = (await trailOf('clue.disposition-recorded', clueId)).filter((row) => row.outcome === 'failed');
    expect(failed[0]?.reason).toBe('missing-disposition-fields');
  });

  it('非允许状态：409 invalid-state＋失败留痕', async () => {
    // 已派机构未派承办人：承办机构内勤有对象级权限，但状态不允许登记。
    const registered = await register({ polygon: geojsonPolygon(square(203)) });
    const clueId = String(registered.body.id);
    const assigned = await assignOrg(clueId, { orgUnitId: stationAId });
    expect(assigned.status).toBe(200);
    const outcome = await recordOther(clueId, { expectedStatus: 'org_assigned' }, 'P-229-ST');
    expect(outcome.status).toBe(409);
    expect(outcome.body.result).toBe('invalid-state');
    const failed = (await trailOf('clue.disposition-recorded', clueId)).filter((row) => row.outcome === 'failed');
    expect(failed[0]?.reason).toBe('invalid-state');
  });

  it('无权人：403＋authz.denied，业务行不变', async () => {
    const clueId = await assignedAlone(204);
    const outcome = await recordOther(clueId, {}, 'P-229-IB');
    expect(outcome.status).toBe(403);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('handler_assigned');
  });

  it('监督：403，业务行不变', async () => {
    const clueId = await assignedAlone(205);
    const outcome = await recordOther(clueId, {}, 'P-229-SU');
    expect(outcome.status).toBe(403);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('handler_assigned');
  });
});

describe('#229 系统外移送附加记录', () => {
  it('对 other 线索补挂：状态不变、记录新增、留痕一条', async () => {
    const clueId = await assignedAlone(206);
    expect((await recordOther(clueId)).status).toBe(200);
    const attached = await attachExternal(clueId);
    expect(attached.status).toBe(200);
    expect(attached.body.result).toBe('external-transfer-attached');
    expect(attached.body.status).toBe('closed');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('closed');
    const rows = await cloned.prisma.clueExternalTransfer.findMany({ where: { clueId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.transferredOrg).toBe('市纪委监委');
    const trail = (await trailOf('clue.external-transfer-attached', clueId)).filter((row) => row.outcome !== 'failed');
    expect(trail).toHaveLength(1);
    const listed = await listExternal(clueId);
    expect(listed.status).toBe(200);
    expect((listed.body.transfers as unknown[]).length).toBe(1);
  });

  it('登记 other 后同会话再挂移送：两条成功留痕，状态仍 closed 非 transferred_out', async () => {
    const clueId = await assignedAlone(207);
    expect((await recordOther(clueId)).status).toBe(200);
    expect((await attachExternal(clueId)).status).toBe(200);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('closed');
    expect(clue?.status).not.toBe('transferred_out');
    expect((await trailOf('clue.disposition-recorded', clueId)).filter((r) => r.outcome !== 'failed')).toHaveLength(1);
    expect((await trailOf('clue.external-transfer-attached', clueId)).filter((r) => r.outcome !== 'failed')).toHaveLength(1);
  });

  it('非 other 挂移送：409＋失败留痕', async () => {
    const clueId = await assignedAlone(208);
    const attached = await attachExternal(clueId);
    expect(attached.status).toBe(409);
    expect(attached.body.result).toBe('invalid-state');
    const failed = (await trailOf('clue.external-transfer-attached', clueId)).filter((row) => row.outcome === 'failed');
    expect(failed[0]?.reason).toBe('invalid-state');
    expect(await cloned.prisma.clueExternalTransfer.count({ where: { clueId } })).toBe(0);
  });

  it('缺移送机关：400 missing-disposition-fields', async () => {
    const clueId = await assignedAlone(209);
    expect((await recordOther(clueId)).status).toBe(200);
    const attached = await attachExternal(clueId, { transferOrg: '  ' });
    expect(attached.status).toBe(400);
    expect(attached.body.rules).toEqual(['missing-disposition-fields']);
  });

  it('接口无管辖／涉刑／党纪政务类型字段', async () => {
    const clueId = await assignedAlone(210);
    expect((await recordOther(clueId)).status).toBe(200);
    expect((await attachExternal(clueId)).status).toBe(200);
    const listed = await listExternal(clueId);
    const transfers = listed.body.transfers as Array<Record<string, unknown>>;
    expect(transfers[0]).not.toHaveProperty('category');
    expect(transfers[0]).not.toHaveProperty('type');
    expect(transfers[0]).not.toHaveProperty('transferType');
  });
});
