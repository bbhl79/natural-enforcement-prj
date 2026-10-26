// #218 线索中心列表。
// 断言打在克隆库上：六维筛选＋关键词＋登记日＋分页（默认 20／最大 100／
// registered_at DESC,id DESC）、关键词不搜反映人、行不含反映人、
// entered_org／当前承办 assignment 在机构子树可见、空范围 403 scope-denied。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-26T03:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Clue-center-218!';
const INITIAL_PASSWORD = 'Center-list-218!!';

/** 以经度偏移量区分的方斑：不同用例各用一块，免得互相撞成疑似重复。 */
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

/** 记录投递的假队列端口：核查不跑，避免拖慢列表用例。 */
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

const COMPLAINT_VALUES = {
  'clue.received_at': '2026-10-25',
  'clue.narrative': '群众反映一处违规占地',
  'clue.reporter_anonymous': '否',
  'clue.reporter_name': '张三',
  'clue.reporter_contact': '13812345678',
  'clue.verifiable_basis': '附有现场照片与定位',
};

interface RegisterResponseBody {
  readonly result: string;
  readonly id?: string;
  readonly code?: string;
  readonly status?: string;
  readonly gaps?: { readonly key: string }[];
  readonly hits?: unknown[];
  readonly rules?: string[];
}

async function register(options: {
  readonly code?: string;
  readonly sourceCode?: string;
  readonly domain?: string;
  readonly values?: Record<string, string>;
  readonly polygon?: string;
  readonly narrative?: string;
}): Promise<{ status: number; body: RegisterResponseBody }> {
  const values = {
    ...(options.values ?? PATROL_VALUES),
    ...(options.narrative ? { 'clue.narrative': options.narrative } : {}),
  };
  const form = new FormData();
  form.set('sourceCode', options.sourceCode ?? '16');
  form.set('domain', options.domain ?? 'land');
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
  return { status: response.status, body: (await response.json()) as RegisterResponseBody };
}

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

interface ListRow {
  readonly id: string;
  readonly code: string;
  readonly domain: string;
  readonly sourceCode: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly verificationStatus: string;
  readonly verificationStatusLabel: string;
  readonly narrative: string;
  readonly registeredAt: string;
  readonly hasGaps: boolean;
  readonly tags: readonly string[];
  readonly [key: string]: unknown;
}

interface ListBody {
  readonly result: string;
  readonly rows: readonly ListRow[];
  readonly total: number;
  readonly page: number;
  readonly size: number;
  readonly reason?: string;
}

async function listClues(
  query: Record<string, string> = {},
  code = 'P-INTAKE-A',
): Promise<{ status: number; body: ListBody }> {
  const params = new URLSearchParams(query);
  const response = await fetch(`${baseUrl}/api/clues?${params.toString()}`, {
    method: 'GET',
    headers: { cookie: await cookieOf(code) },
  });
  return { status: response.status, body: (await response.json()) as ListBody };
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

  await seedPerson('P-INTAKE-A', '甲区内勤', deptAId, ['内勤'], '13900021801');
  await seedPerson('P-INTAKE-B', '乙区内勤', deptBId, ['内勤'], '13900021802');
  await seedPerson('P-INTAKE-ST', '甲所内勤', stationAId, ['内勤'], '13900021803');
  await seedPerson('P-218-NONE', '无任职测员', deptAId, ['内勤'], '13900021804');
  // 空数据范围：结束当前任职。
  const none = await cloned.prisma.personnel.findFirst({ where: { code: 'P-218-NONE' } });
  if (!none) throw new Error('缺少 P-218-NONE');
  await cloned.prisma.personnelAssignment.updateMany({
    where: { personnelId: none.id, endedAt: null },
    data: { endedAt: new Date(T0) },
  });

  for (const code of ['P-INTAKE-A', 'P-INTAKE-B', 'P-INTAKE-ST', 'P-218-NONE']) {
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

describe('#218 线索中心列表', () => {
  it('默认分页 size=20，size 上限 100，按 registered_at DESC,id DESC', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const registered = await register({
        polygon: geojsonPolygon(square(100 + i)),
        narrative: `分页序线索-${i}`,
      });
      expect(registered.status).toBe(201);
      ids.push(registered.body.id ?? '');
    }

    const defaults = await listClues({});
    expect(defaults.status).toBe(200);
    expect(defaults.body.result).toBe('listed');
    expect(defaults.body.page).toBe(1);
    expect(defaults.body.size).toBe(20);

    const capped = await listClues({ size: '200' });
    expect(capped.status).toBe(200);
    expect(capped.body.size).toBe(100);

    const page = await listClues({ q: '分页序线索', size: '2', page: '1' });
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(3);
    expect(page.body.rows).toHaveLength(2);
    // 同 registered_at（钉死时钟）时按 id DESC：后登记的在前。
    expect(page.body.rows[0]?.id).toBe(ids[2]);
    expect(page.body.rows[1]?.id).toBe(ids[1]);

    const page2 = await listClues({ q: '分页序线索', size: '2', page: '2' });
    expect(page2.body.rows).toHaveLength(1);
    expect(page2.body.rows[0]?.id).toBe(ids[0]);
  });

  it('六维筛选＋关键词＋登记日：domain／source／org／status／check／gap／q／from／to', async () => {
    const land = await register({
      polygon: geojsonPolygon(square(110)),
      domain: 'land',
      sourceCode: '16',
      narrative: '六维筛选专用叙述甲',
    });
    expect(land.status).toBe(201);
    const landId = land.body.id ?? '';

    const surveyPoint = JSON.stringify({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [113.25, 23.25] },
      properties: {},
    });
    const survey = await register({
      polygon: surveyPoint,
      domain: 'survey',
      sourceCode: '16',
      narrative: '六维筛选专用叙述乙-测绘',
    });
    expect(survey.status).toBe(201);

    const complaint = await register({
      polygon: geojsonPolygon(square(112)),
      domain: 'land',
      sourceCode: '301',
      values: {
        ...COMPLAINT_VALUES,
        'clue.narrative': '六维筛选专用叙述丙-举报',
        'clue.reporter_name': '六维反映人独有名',
      },
    });
    expect(complaint.status).toBe(201);

    // 当事人名供关键词命中（不经反映人字段）。
    await cloned.prisma.clueItemValue.create({
      data: { id: newUlid(), clueId: landId, key: 'clue.party_name', value: '六维当事人独有名' },
    });
    // 标签供关键词命中。
    const libraryId = newUlid();
    await cloned.prisma.clueTagLibrary.create({
      data: { id: libraryId, name: '六维标签独有名' },
    });
    await cloned.prisma.clueTag.create({
      data: { id: newUlid(), clueId: landId, libraryId, name: '六维标签独有名' },
    });
    // 缺件／核查状态直接置事实（筛选行为验收）。
    await cloned.prisma.clueItemGap.create({
      data: {
        id: newUlid(),
        clueId: landId,
        key: 'clue.extra_gap_218',
        layer: 'public',
        label: '六维缺件',
        required: true,
        timing: '录入时',
        consequence: '警告',
        filledAt: null,
      },
    });
    await cloned.prisma.clue.update({
      where: { id: landId },
      data: { verificationStatus: 'failed', status: 'held' },
    });

    const byDomain = await listClues({ q: '六维筛选专用', domain: 'survey' });
    expect(byDomain.body.rows.map((row) => row.id)).toEqual([survey.body.id]);

    const bySource = await listClues({ q: '六维筛选专用', source: '301' });
    expect(bySource.body.rows.map((row) => row.id)).toEqual([complaint.body.id]);

    const byOrg = await listClues({ q: '六维筛选专用', org: deptAId });
    expect(byOrg.body.total).toBeGreaterThanOrEqual(3);
    expect(byOrg.body.rows.every((row) => ['六维筛选专用叙述甲', '六维筛选专用叙述乙-测绘', '六维筛选专用叙述丙-举报'].includes(row.narrative))).toBe(
      true,
    );

    const byStatus = await listClues({ q: '六维筛选专用', status: 'held' });
    expect(byStatus.body.rows.map((row) => row.id)).toEqual([landId]);

    const byCheck = await listClues({ q: '六维筛选专用', check: 'failed' });
    expect(byCheck.body.rows.map((row) => row.id)).toEqual([landId]);

    const byGap = await listClues({ q: '六维筛选专用', gap: 'has_gap' });
    expect(byGap.body.rows.some((row) => row.id === landId && row.hasGaps === true)).toBe(true);
    expect(byGap.body.rows.every((row) => row.hasGaps === true)).toBe(true);

    const byKeywordCode = await listClues({ q: land.body.code ?? '___no___' });
    expect(byKeywordCode.body.rows.some((row) => row.id === landId)).toBe(true);

    const byParty = await listClues({ q: '六维当事人独有名' });
    expect(byParty.body.rows.map((row) => row.id)).toEqual([landId]);

    const byTag = await listClues({ q: '六维标签独有名' });
    expect(byTag.body.rows.map((row) => row.id)).toEqual([landId]);

    // 登记日窗口：钉死时钟当日有，次日窗口空。
    const onDay = await listClues({ q: '六维筛选专用叙述甲', from: '2026-10-26', to: '2026-10-26' });
    expect(onDay.body.rows.some((row) => row.id === landId)).toBe(true);
    const offDay = await listClues({ q: '六维筛选专用叙述甲', from: '2026-10-27', to: '2026-10-27' });
    expect(offDay.body.rows).toHaveLength(0);
  });

  it('关键词不搜反映人；列表行不含反映人字段', async () => {
    const uniqueReporter = '反映人关键词独有勿命中甲';
    const registered = await register({
      polygon: geojsonPolygon(square(120)),
      sourceCode: '301',
      values: {
        ...COMPLAINT_VALUES,
        'clue.narrative': '关键词反映人用例叙述',
        'clue.reporter_name': uniqueReporter,
        'clue.reporter_contact': '13900021899',
      },
    });
    expect(registered.status).toBe(201);

    const byReporter = await listClues({ q: uniqueReporter });
    expect(byReporter.status).toBe(200);
    expect(byReporter.body.rows).toHaveLength(0);

    const byNarrative = await listClues({ q: '关键词反映人用例叙述' });
    expect(byNarrative.body.rows).toHaveLength(1);
    const row = byNarrative.body.rows[0];
    expect(row?.id).toBe(registered.body.id);
    const keys = Object.keys(row ?? {});
    expect(keys.some((key) => /reporter|反映人/i.test(key))).toBe(false);
    expect(row).not.toHaveProperty('reporterName');
    expect(row).not.toHaveProperty('reporterContact');
    expect(row).not.toHaveProperty('reporter_name');
    expect(row).not.toHaveProperty('reporter_contact');
  });

  it('entered_org／当前承办 assignment 在机构子树可见；范围外不可见', async () => {
    const registered = await register({
      code: 'P-INTAKE-A',
      polygon: geojsonPolygon(square(130)),
      narrative: '子树可见专用叙述',
    });
    expect(registered.status).toBe(201);
    const clueId = registered.body.id ?? '';

    // 甲区可见（entered_org）；乙区不可见。
    const inA = await listClues({ q: '子树可见专用叙述' }, 'P-INTAKE-A');
    expect(inA.status).toBe(200);
    expect(inA.body.rows.map((row) => row.id)).toEqual([clueId]);
    const inB = await listClues({ q: '子树可见专用叙述' }, 'P-INTAKE-B');
    expect(inB.body.rows).toHaveLength(0);

    // 派到甲所后：甲所经 assignment 可见；甲区仍经 entered_org 可见。
    const assigned = await assignOrg(clueId, { orgUnitId: stationAId }, 'P-INTAKE-A');
    expect(assigned.status).toBe(200);

    const atStation = await listClues({ q: '子树可见专用叙述' }, 'P-INTAKE-ST');
    expect(atStation.body.rows.map((row) => row.id)).toEqual([clueId]);
    const stillA = await listClues({ q: '子树可见专用叙述' }, 'P-INTAKE-A');
    expect(stillA.body.rows.map((row) => row.id)).toEqual([clueId]);
    const stillB = await listClues({ q: '子树可见专用叙述' }, 'P-INTAKE-B');
    expect(stillB.body.rows).toHaveLength(0);

    // org 筛选：按承办机构可命中。
    const byAssignOrg = await listClues({ q: '子树可见专用叙述', org: stationAId }, 'P-INTAKE-A');
    expect(byAssignOrg.body.rows.map((row) => row.id)).toEqual([clueId]);
  });

  it('空数据范围：403 scope-denied', async () => {
    const outcome = await listClues({}, 'P-218-NONE');
    expect(outcome.status).toBe(403);
    expect(outcome.body).toEqual({ reason: 'scope-denied' });
  });
});
