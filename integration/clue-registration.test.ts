// #211 线索登记接口。
// 断言打在克隆库上：登记成功、缺件阻断、类型层确认后保存、附件与几何校验、
// 幂等（同 key 同报文回首次结果、异报文 409）、疑似重复逐面命中、以及监督无写权限。
// 存储用记录写的假端口：校验不通过时断言「一个字节都没写」。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-17T03:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Clue-register-211!';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(16).fill(0)]);

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

let cloned: ClonedDatabase;
let storage = new RecordingStorage();
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
const cookies = new Map<string, string>();

function sessionCookie(response: Response): string {
  const found = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='));
  const pair = found?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

/** 首次登录后强制改密，留住会话供后续请求用。 */
async function cookieOf(code: string): Promise<string> {
  const known = cookies.get(code);
  if (known) return known;
  const people = await cloned.prisma.personnel.findMany({ where: { code, deactivatedAt: null } });
  const person = people[0];
  if (!person) throw new Error(`缺少种子人员 ${code}`);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: person.mobilePhone, password: SEED_PASSWORD, rememberMe: false }),
  });
  expect(login.status).toBe(200);
  const cookie = sessionCookie(login);
  const changed = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ currentPassword: SEED_PASSWORD, newPassword: NEW_PASSWORD }),
  });
  expect(changed.status).toBe(200);
  cookies.set(code, cookie);
  return cookie;
}

/** 登记接口的响应体。 */
interface RegisterResponseBody {
  readonly result: string;
  readonly id?: string;
  readonly code?: string;
  readonly status?: string;
  readonly gaps?: { readonly key: string; readonly label: string }[];
  readonly hits?: unknown[];
  readonly rules?: string[];
  readonly filled?: { readonly key: string; readonly label: string }[];
}

interface RegisterOptions {
  readonly code?: string;
  readonly idempotencyKey?: string;
  readonly sourceCode?: string;
  readonly domain?: string;
  readonly types?: string;
  readonly values?: Record<string, string>;
  readonly polygon?: string | null;
  readonly attachments?: { readonly name: string; readonly bytes: Uint8Array }[];
  readonly confirm?: boolean;
  readonly subjectUnknown?: boolean;
  readonly anonymityConfirmed?: boolean;
}

async function register(options: RegisterOptions = {}): Promise<{ status: number; body: RegisterResponseBody }> {
  const code = options.code ?? 'P-CLERK-A';
  const form = new FormData();
  form.set('sourceCode', options.sourceCode ?? '16');
  form.set('domain', options.domain ?? 'land');
  if (options.types !== undefined) form.set('types', options.types);
  form.set('values', JSON.stringify(options.values ?? {}));
  if (options.confirm !== undefined) form.set('confirm', String(options.confirm));
  if (options.subjectUnknown !== undefined) form.set('subjectUnknown', String(options.subjectUnknown));
  if (options.anonymityConfirmed !== undefined) {
    form.set('anonymityConfirmed', String(options.anonymityConfirmed));
  }
  if (options.polygon !== null) {
    form.set(
      'spatial-source',
      new Blob([options.polygon ?? geojsonPolygon(square(0))], { type: 'application/geo+json' }),
      'area.geojson',
    );
  }
  for (const attachment of options.attachments ?? []) {
    const bytes = new Uint8Array(attachment.bytes);
    form.set('attachment', new Blob([bytes], { type: 'application/octet-stream' }), attachment.name);
  }
  const response = await fetch(`${baseUrl}/api/clues`, {
    method: 'POST',
    headers: {
      cookie: await cookieOf(code),
      'idempotency-key': options.idempotencyKey ?? `key-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  return { status: response.status, body: (await response.json()) as RegisterResponseBody };
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
      LIMIT 5
    `;
  }
  return cloned.prisma.$queryRaw<TrailRow[]>`
    SELECT action, outcome, reason, detail, resource_id
    FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
  `;
}

/** 补齐缺件。 */
async function fillGaps(
  clueId: string,
  values: Record<string, string>,
  code = 'P-CLERK-A',
): Promise<{ status: number; body: RegisterResponseBody }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/gaps/fill`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({ values }),
  });
  return { status: response.status, body: (await response.json()) as RegisterResponseBody };
}

const BASE_VALUES = {
  'clue.received_at': '2026-10-25',
  'clue.narrative': '巡查发现一处硬化地面',
  'clue.finder': '巡查员甲',
  'clue.patrol_no': 'XC-2026-001',
};

beforeAll(async () => {
  cloned = await openClonedDatabase();
  storage = new RecordingStorage();
  const app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(T0) },
    undefined,
    { storagePort: storage },
  );
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();
}, 60_000);

afterAll(async () => {
  await closeApp();
  await cloned?.close();
});

beforeEach(() => {
  storage.writes.length = 0;
});

describe('#211 线索登记', () => {
  it('登记成功：201，编号、状态、缺件与正式命中都回，库里有线索行与成功留痕', async () => {
    const before = await cloned.prisma.clue.count();
    const result = await register({ values: BASE_VALUES, polygon: geojsonPolygon(square(0)) });
    expect(result.status).toBe(201);
    expect(result.body.result).toBe('registered');
    expect(result.body.code).toMatch(/^CL\d{10}$/);
    expect(result.body.status).toBe('in_pool');
    expect(result.body.gaps).toEqual([]);
    expect(result.body.hits).toEqual([]);

    const clue = await cloned.prisma.clue.findUnique({ where: { id: result.body.id } });
    expect(clue?.code).toBe(result.body.code);
    expect(clue?.domain).toBe('land');
    expect(clue?.sourceCode).toBe('16');
    expect(await cloned.prisma.clue.count()).toBe(before + 1);

    const objects = await cloned.prisma.clueSpatialObject.count({ where: { clueId: result.body.id } });
    expect(objects).toBe(1);
    const partCount = await cloned.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM clue_spatial_part p
      JOIN clue_spatial_object o ON o.id = p.spatial_object_id
      WHERE o.clue_id = ${result.body.id}
    `;
    expect(Number(partCount[0]?.count ?? 0)).toBe(1);

    const materials = await cloned.prisma.clueMaterial.findMany({ where: { clueId: result.body.id } });
    expect(materials).toHaveLength(1);
    expect(materials[0]?.kind).toBe('spatial-source');

    const trail = await trailOf('clue.registered', result.body.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]?.outcome).toBe('succeeded');
    expect(trail[0]?.detail).toContain(result.body.code);
    expect(storage.writes).toHaveLength(1);
  });

  it('公共层或来源层阻断项缺失：400 + 失败留痕，业务行不变，存储零写入', async () => {
    const before = await cloned.prisma.clue.count();
    const values = { ...BASE_VALUES };
    // #257：clue.finder 等来源层键降为警告，改用仍为阻断的公共层键。
    delete (values as Record<string, string>)['clue.narrative'];
    const result = await register({ values });
    expect(result.status).toBe(400);
    expect(result.body.result).toBe('non-compliant');
    expect(result.body.rules ?? []).toContain('clue.narrative');
    expect(await cloned.prisma.clue.count()).toBe(before);
    expect(storage.writes).toHaveLength(0);
    const failed = (await trailOf('clue.registered')).filter((row) => row.outcome === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]?.reason).toBe('missing-required-items');
  });

  it('类型层缺件：未确认即 400，确认后 200 且缺件清单落库为常驻事实', async () => {
    const types = 'land_approve_without_authority';
    const unconfirmed = await register({
      types,
      values: BASE_VALUES,
      polygon: geojsonPolygon(square(1)),
    });
    expect(unconfirmed.status).toBe(400);
    expect((unconfirmed.body.rules ?? []).some((rule) => rule.startsWith('type.'))).toBe(true);

    const confirmed = await register({
      types,
      values: BASE_VALUES,
      polygon: geojsonPolygon(square(1)),
      confirm: true,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.gaps?.length ?? 0).toBeGreaterThan(0);
    expect(confirmed.body.gaps?.[0]?.key ?? '').toMatch(/^type\./);
    const gaps = await cloned.prisma.clueItemGap.findMany({ where: { clueId: confirmed.body.id } });
    expect(gaps.length).toBe(confirmed.body.gaps?.length ?? 0);
    expect(gaps[0]?.filledAt).toBeNull();
  });

  it('合规附件随登记写入存储并落材料行', async () => {
    const result = await register({
      values: BASE_VALUES,
      polygon: geojsonPolygon(square(30)),
      attachments: [{ name: '现场照片.png', bytes: PNG_BYTES }],
    });
    expect(result.status).toBe(201);
    const materials = await cloned.prisma.clueMaterial.findMany({
      where: { clueId: result.body.id ?? '', kind: 'attachment' },
    });
    expect(materials).toHaveLength(1);
    expect(storage.writes).toHaveLength(2);
  });

  it('附件类型不合规：400 + 存储零写入', async () => {
    const result = await register({
      values: BASE_VALUES,
      polygon: geojsonPolygon(square(2)),
      attachments: [{ name: '打包.zip', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) }],
    });
    expect(result.status).toBe(400);
    expect(result.body.rules ?? []).toContain('attachment-type-not-allowed');
    expect(storage.writes).toHaveLength(0);
  });

  it('几何形态与法域不符：400 + 存储零写入', async () => {
    const result = await register({
      values: BASE_VALUES,
      polygon: JSON.stringify({ type: 'Point', coordinates: [113, 23] }),
    });
    expect(result.status).toBe(400);
    expect(result.body.rules ?? []).toContain('spatial-geometry-type-rejected');
    expect(storage.writes).toHaveLength(0);
  });

  it('幂等：同 key 同报文回首次结果，同 key 异报文 409', async () => {
    const key = 'idempotent-key-1';
    const first = await register({ idempotencyKey: key, values: BASE_VALUES, polygon: geojsonPolygon(square(3)) });
    expect(first.status).toBe(201);
    const replay = await register({ idempotencyKey: key, values: BASE_VALUES, polygon: geojsonPolygon(square(3)) });
    expect(replay.status).toBe(200);
    expect(replay.body.code).toBe(first.body.code);
    expect(replay.body.id).toBe(first.body.id);
    const conflict = await register({
      idempotencyKey: key,
      values: { ...BASE_VALUES, 'clue.narrative': '另一次反映' },
      polygon: geojsonPolygon(square(3)),
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.result).toBe('already-exists');
  });

  it('疑似重复：面状逐面命中，后登的进待分派决定，对方也挂上标记', async () => {
    const first = await register({ values: BASE_VALUES, polygon: geojsonPolygon(square(10)) });
    expect(first.status).toBe(201);
    expect(first.body.hits ?? []).toEqual([]);
    const second = await register({ values: BASE_VALUES, polygon: geojsonPolygon(square(10)) });
    expect(second.status).toBe(201);
    expect(second.body.status).toBe('pending_decision');
    const hits = second.body.hits ?? [];
    expect(hits).toHaveLength(1);
    expect((hits[0] as { otherClueCode: string }).otherClueCode).toBe(first.body.code);
    expect((hits[0] as { selfRatio: number }).selfRatio).toBeGreaterThanOrEqual(0.6);
    const reverse = await cloned.prisma.clueSpatialHit.findMany({ where: { clueId: first.body.id } });
    expect(reverse).toHaveLength(1);
    expect(reverse[0]?.otherClueId).toBe(second.body.id);
  });

  it('监督无写权限：403，存储零写入', async () => {
    const result = await register({ code: 'P-SUPER-B', values: BASE_VALUES, polygon: geojsonPolygon(square(11)) });
    expect(result.status).toBe(403);
    expect(storage.writes).toHaveLength(0);
  });

  it('幂等键缺失：400 + 失败留痕', async () => {
    const form = new FormData();
    form.set('sourceCode', '16');
    form.set('domain', 'land');
    form.set('values', JSON.stringify(BASE_VALUES));
    const response = await fetch(`${baseUrl}/api/clues`, {
      method: 'POST',
      headers: { cookie: await cookieOf('P-CLERK-A') },
      body: form,
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as RegisterResponseBody;
    expect(body.rules ?? []).toContain('idempotency-key-required');
  });
});

describe('#211 缺件补齐', () => {
  it('补齐单项：200，缺件清单随之外，留痕 clue.items-supplemented', async () => {
    const registered = await register({
      types: 'land_approve_without_authority',
      values: BASE_VALUES,
      polygon: geojsonPolygon(square(20)),
      confirm: true,
    });
    expect(registered.status).toBe(200);
    const gaps = registered.body.gaps ?? [];
    expect(gaps.length).toBeGreaterThan(1);
    const first = gaps[0];

    const filled = await fillGaps(registered.body.id ?? '', { [first.key]: '某机关' });
    expect(filled.status).toBe(200);
    expect(filled.body.result).toBe('supplemented');
    expect((filled.body.filled ?? []).map((item) => item.key)).toEqual([first.key]);
    expect((filled.body.gaps ?? []).map((item) => item.key)).not.toContain(first.key);

    const rows = await cloned.prisma.clueItemGap.findMany({ where: { clueId: registered.body.id } });
    const row = rows.find((item) => item.key === first.key);
    expect(row?.filledAt).not.toBeNull();
    const values = await cloned.prisma.clueItemValue.findMany({
      where: { clueId: registered.body.id, key: first.key },
    });
    expect(values[0]?.value).toBe('某机关');

    const trail = await trailOf('clue.items-supplemented', registered.body.id);
    expect(trail).toHaveLength(1);
    expect(trail[0]?.outcome).toBe('succeeded');
    expect(trail[0]?.detail).toContain(first.key);
  });

  it('一键补齐：多项同一次提交，补齐后清单为空', async () => {
    const registered = await register({
      types: 'land_approve_without_authority',
      values: BASE_VALUES,
      polygon: geojsonPolygon(square(21)),
      confirm: true,
    });
    const gaps = registered.body.gaps ?? [];
    const submitted = Object.fromEntries(gaps.map((gap) => [gap.key, '补齐内容']));
    const filled = await fillGaps(registered.body.id ?? '', submitted);
    expect(filled.status).toBe(200);
    expect(filled.body.gaps ?? []).toEqual([]);
    const open = await cloned.prisma.clueItemGap.count({
      where: { clueId: registered.body.id, filledAt: null },
    });
    expect(open).toBe(0);
  });

  it('同一次提交任一项不合格：全部不保存', async () => {
    const registered = await register({
      types: 'land_approve_without_authority',
      values: BASE_VALUES,
      polygon: geojsonPolygon(square(22)),
      confirm: true,
    });
    const gaps = registered.body.gaps ?? [];
    const result = await fillGaps(registered.body.id ?? '', {
      [gaps[0].key]: '这一项合格',
      'type.land_approve_without_authority.not_a_gap': '这一项不是缺件',
    });
    expect(result.status).toBe(400);
    expect(result.body.result).toBe('non-compliant');
    const open = await cloned.prisma.clueItemGap.count({
      where: { clueId: registered.body.id, filledAt: null },
    });
    expect(open).toBe(gaps.length);
    const values = await cloned.prisma.clueItemValue.findMany({
      where: { clueId: registered.body.id, key: gaps[0].key },
    });
    expect(values).toHaveLength(0);
  });

  it('监督只读：补齐被拒 403', async () => {
    const registered = await register({
      types: 'land_approve_without_authority',
      values: BASE_VALUES,
      polygon: geojsonPolygon(square(23)),
      confirm: true,
    });
    const gaps = registered.body.gaps ?? [];
    const result = await fillGaps(registered.body.id ?? '', { [gaps[0].key]: '监督不能补' }, 'P-SUPER-B');
    expect(result.status).toBe(403);
  });
});
