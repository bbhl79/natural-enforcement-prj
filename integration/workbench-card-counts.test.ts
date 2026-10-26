// #207 工作台卡片计数。
// 断言打在克隆库上：按身份分类的卡片数字（一线／领导／监督）、
// entered_org／当前承办在机构子树内计入、范围外不计入；空任职 403。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-26T03:30:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Workbench-cards-207!';
const INITIAL_PASSWORD = 'Card-counts-207!!';

function square(offset: number): (readonly number[])[] {
  const west = 113 + offset * 0.2;
  return [
    [west, 23],
    [west + 0.05, 23],
    [west + 0.05, 23.05],
    [west, 23.05],
    [west, 23],
  ];
}

function geojsonPolygon(ring: readonly (readonly number[])[]): string {
  return JSON.stringify({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {},
  });
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function newUlid(): string {
  let time = BigInt(Date.now());
  let id = '';
  for (let i = 0; i < 10; i += 1) {
    id = CROCKFORD[Number(time % 32n)] + id;
    time /= 32n;
  }
  for (const byte of crypto.getRandomValues(new Uint8Array(16))) id += CROCKFORD[byte % 32];
  return id;
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

let deptAId = '';
let deptBId = '';
let stationAId = '';

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
      mobilePhone,
      initialPassword: INITIAL_PASSWORD,
      roles: [...roles],
    }),
  });
  expect(response.status).toBe(200);
}

const PATROL_VALUES = {
  'clue.received_at': '2026-10-25',
  'clue.narrative': '巡查发现一处硬化地面',
  'clue.finder': '巡查员甲',
  'clue.patrol_no': 'XC-2026-001',
};

interface RegisterBody {
  readonly result: string;
  readonly id?: string;
  readonly code?: string;
  readonly status?: string;
}

async function register(options: {
  readonly code?: string;
  readonly polygon?: string;
  readonly narrative?: string;
}): Promise<{ status: number; body: RegisterBody }> {
  const values = {
    ...PATROL_VALUES,
    ...(options.narrative ? { 'clue.narrative': options.narrative } : {}),
  };
  const form = new FormData();
  form.set('sourceCode', '16');
  form.set('domain', 'land');
  form.set('values', JSON.stringify(values));
  form.set(
    'spatial-source',
    new Blob([options.polygon ?? geojsonPolygon(square(0))], { type: 'application/geo+json' }),
    'area.geojson',
  );
  const response = await fetch(`${baseUrl}/api/clues`, {
    method: 'POST',
    headers: {
      cookie: await cookieOf(options.code ?? 'P-INTAKE-A'),
      'idempotency-key': `key-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  return { status: response.status, body: (await response.json()) as RegisterBody };
}

async function decide(
  clueId: string,
  decision: string,
  code = 'P-INTAKE-A',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({
      decision,
      acknowledged: false,
      expectedStatus: 'pending_decision',
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function assignOrg(
  clueId: string,
  orgUnitId: string,
  code: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({
      orgUnitId,
      expectedStatus: 'in_pool',
      reason: '',
      designate: false,
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

interface CardCountsBody {
  readonly frontline: {
    readonly pendingDecision: number;
    readonly orgAssigned: number;
    readonly handlerAssigned: number;
    readonly held: number;
    readonly reminders: number;
    readonly designationPending: number;
  };
  readonly leader: {
    readonly lawReview: number;
    readonly approval: number;
    readonly reminders: number;
    readonly designationPending: number;
  };
  readonly supervision: {
    readonly total: number;
    readonly pendingDispatch: number;
    readonly held: number;
    readonly closed: number;
  };
  readonly reason?: string;
}

async function cardCounts(code: string): Promise<{ status: number; body: CardCountsBody }> {
  const response = await fetch(`${baseUrl}/api/workbench/card-counts`, {
    method: 'GET',
    headers: { cookie: await cookieOf(code) },
  });
  return { status: response.status, body: (await response.json()) as CardCountsBody };
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

  await seedPerson('P-INTAKE-A', '甲区内勤', deptAId, ['内勤'], '13900020701');
  await seedPerson('P-INTAKE-B', '乙区内勤', deptBId, ['内勤'], '13900020702');
  await seedPerson('P-INTAKE-ST', '甲所内勤', stationAId, ['内勤'], '13900020703');
  await seedPerson('P-207-NONE', '无任职测员', deptAId, ['内勤'], '13900020704');
  const none = await cloned.prisma.personnel.findFirst({ where: { code: 'P-207-NONE' } });
  if (!none) throw new Error('缺少 P-207-NONE');
  await cloned.prisma.personnelAssignment.updateMany({
    where: { personnelId: none.id, endedAt: null },
    data: { endedAt: new Date(T0) },
  });

  for (const code of ['P-INTAKE-A', 'P-INTAKE-B', 'P-INTAKE-ST', 'P-207-NONE']) {
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

describe('#207 工作台卡片计数', () => {
  it('身份卡数＋数据范围：一线／领导／监督按子树计入，范围外不计', async () => {
    // 甲区：待分派池 1 + 撞车旧 in_pool 1 + 撞车新 held 1 + 派甲所 org_assigned 1
    const pool = await register({ polygon: geojsonPolygon(square(200)), narrative: '卡数池线索' });
    expect(pool.status).toBe(201);

    const older = await register({ polygon: geojsonPolygon(square(201)), narrative: '卡数撞车旧' });
    expect(older.status).toBe(201);
    const newer = await register({ polygon: geojsonPolygon(square(201)), narrative: '卡数撞车新' });
    expect(newer.status).toBe(201);
    expect(newer.body.status).toBe('pending_decision');
    expect((await decide(newer.body.id ?? '', 'hold')).status).toBe(200);

    const toStation = await register({ polygon: geojsonPolygon(square(202)), narrative: '卡数待派机构' });
    expect(toStation.status).toBe(201);
    expect((await assignOrg(toStation.body.id ?? '', stationAId, 'P-INTAKE-A')).status).toBe(200);

    await cloned.prisma.clueClosureReminder.create({
      data: {
        id: newUlid(),
        clueId: newer.body.id ?? '',
        kind: 'no-case',
        otherClueId: older.body.id ?? '',
        createdAt: new Date(T0),
        resolvedAt: null,
      },
    });

    await cloned.prisma.$executeRaw`
      INSERT INTO clue_designation_request
        (id, clue_id, requesting_org_id, proposed_org_id, reviewer_org_id, reason, status, created_at)
      VALUES
        (${newUlid()}, ${pool.body.id ?? ''}, ${stationAId}, ${deptAId}, ${deptAId},
         '卡数报请', 'pending', ${new Date(T0)})
    `;

    // 乙区一条：只进乙区计数。
    const inB = await register({
      code: 'P-INTAKE-B',
      polygon: geojsonPolygon(square(210)),
      narrative: '卡数乙区线索',
    });
    expect(inB.status).toBe(201);

    const a = await cardCounts('P-INTAKE-A');
    expect(a.status).toBe(200);
    expect(a.body.frontline).toEqual({
      pendingDecision: 2,
      orgAssigned: 1,
      handlerAssigned: 0,
      held: 1,
      reminders: 1,
      designationPending: 1,
    });
    expect(a.body.leader).toEqual({
      lawReview: 0,
      approval: 0,
      reminders: 1,
      designationPending: 1,
    });
    expect(a.body.supervision).toEqual({
      total: 4,
      pendingDispatch: 2,
      held: 1,
      closed: 0,
    });

    const b = await cardCounts('P-INTAKE-B');
    expect(b.status).toBe(200);
    expect(b.body.frontline.pendingDecision).toBe(1);
    expect(b.body.frontline.held).toBe(0);
    expect(b.body.frontline.reminders).toBe(0);
    expect(b.body.frontline.designationPending).toBe(0);
    expect(b.body.supervision.total).toBe(1);

    // 甲所子树只含承办在本所的那条（assignment），不含甲区 entered_org 的池／不派。
    const st = await cardCounts('P-INTAKE-ST');
    expect(st.status).toBe(200);
    expect(st.body.frontline).toEqual({
      pendingDecision: 0,
      orgAssigned: 1,
      handlerAssigned: 0,
      held: 0,
      reminders: 0,
      designationPending: 0,
    });
    expect(st.body.supervision.total).toBe(1);
  });

  it('空任职：403 scope-denied', async () => {
    const outcome = await cardCounts('P-207-NONE');
    expect(outcome.status).toBe(403);
    expect(outcome.body.reason).toBe('scope-denied');
  });
});
