// #212 疑似重复用例的共享夹具（真实 PostGIS，克隆库上断言）。
// 三个用例文件（逐面计算／重绘／比对视图与实名查阅）共用这套登记、留痕与几何工具。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, expect } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

export const T0 = Date.parse('2026-10-17T03:00:00.000Z');
export const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Clue-dup-212!';

/** 矩形环（经纬度，EPSG:4326）。各用例取不同经度区间，避免无关碰撞。 */
export function rect(west: number, south: number, east: number, north: number): (readonly number[])[] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

export function polygon(ring: readonly (readonly number[])[]): string {
  return JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} });
}

/** 多点（一个文件两个面）。 */
export function multipolygon(rings: readonly (readonly (readonly number[])[])[]): string {
  return JSON.stringify({
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) },
    properties: {},
  });
}

export function point(longitude: number, latitude: number): string {
  return JSON.stringify({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: {},
  });
}

/** 记录写的假存储端口。 */
export class RecordingStorage {
  readonly writes: { fileKey: string; byteSize: number }[] = [];

  async putVersion(fileKey: string, content: Uint8Array): Promise<{ fileKey: string; versionId: string }> {
    this.writes.push({ fileKey, byteSize: content.byteLength });
    return { fileKey, versionId: `version-${this.writes.length}` };
  }

  async readVersion(): Promise<Uint8Array> {
    return new Uint8Array(0);
  }
}

/** 套件共享状态：每个用例文件各克隆一次库。用前先调 setupClueSuite。 */
export interface ClueSuiteState {
  cloned: ClonedDatabase;
  storage: RecordingStorage;
  baseUrl: string;
}

export const suite: ClueSuiteState = {
  cloned: null as unknown as ClonedDatabase,
  storage: null as unknown as RecordingStorage,
  baseUrl: '',
};

const cookies = new Map<string, string>();

function sessionCookie(response: Response): string {
  const found = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='));
  const pair = found?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

/** 首次登录后强制改密，留住会话供后续请求用。 */
export async function cookieOf(code: string): Promise<string> {
  const known = cookies.get(code);
  if (known) return known;
  const people = await suite.cloned.prisma.personnel.findMany({ where: { code, deactivatedAt: null } });
  const person = people[0];
  if (!person) throw new Error(`缺少种子人员 ${code}`);
  const login = await fetch(`${suite.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mobilePhone: person.mobilePhone, password: SEED_PASSWORD, rememberMe: false }),
  });
  expect(login.status).toBe(200);
  const cookie = sessionCookie(login);
  const changed = await fetch(`${suite.baseUrl}/api/auth/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ currentPassword: SEED_PASSWORD, newPassword: NEW_PASSWORD }),
  });
  expect(changed.status).toBe(200);
  cookies.set(code, cookie);
  return cookie;
}

export interface RegisterResponseBody {
  readonly result: string;
  readonly id?: string;
  readonly code?: string;
  readonly status?: string;
  readonly gaps?: { readonly key: string; readonly label: string }[];
  readonly hits?: {
    readonly otherClueId: string;
    readonly otherClueCode: string;
    readonly partId: string;
    readonly otherPartId: string;
    readonly selfRatio: number;
    readonly otherRatio: number;
    readonly intersectionArea: number;
  }[];
  readonly rules?: string[];
}

export interface RegisterOptions {
  readonly code?: string;
  readonly sourceCode?: string;
  readonly domain?: string;
  readonly values?: Record<string, string>;
  readonly spatial?: string;
}

export const PATROL_VALUES: Record<string, string> = {
  'clue.received_at': '2026-10-25',
  'clue.narrative': '巡查发现一处硬化地面',
  'clue.finder': '巡查员甲',
  'clue.patrol_no': 'XC-2026-001',
};

export const COMPLAINT_VALUES: Record<string, string> = {
  'clue.received_at': '2026-10-25',
  'clue.narrative': '群众反映一处违规占地',
  'clue.reporter_anonymous': '否',
  'clue.reporter_name': '张三',
  'clue.reporter_contact': '13812345678',
  'clue.verifiable_basis': '附有现场照片与定位',
};

/** 登记一条线索。 */
export async function register(
  options: RegisterOptions = {},
): Promise<{ status: number; body: RegisterResponseBody }> {
  const form = new FormData();
  form.set('sourceCode', options.sourceCode ?? '16');
  form.set('domain', options.domain ?? 'land');
  form.set('values', JSON.stringify(options.values ?? PATROL_VALUES));
  form.set('spatial-source', new Blob([options.spatial ?? polygon(rect(113, 23, 113.1, 23.1))], {
    type: 'application/geo+json',
  }), 'area.geojson');
  const response = await fetch(`${suite.baseUrl}/api/clues`, {
    method: 'POST',
    headers: {
      cookie: await cookieOf(options.code ?? 'P-CLERK-A'),
      'idempotency-key': `key-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  return { status: response.status, body: (await response.json()) as RegisterResponseBody };
}

/** 直接改线索主状态（filed 本期不可达、org_assigned 等由另票接线，用例自己置行）。 */
export async function setStatus(clueId: string, status: string): Promise<void> {
  await suite.cloned.prisma.clue.update({ where: { id: clueId }, data: { status } });
}

/** 一条线索的当前命中行（本线索视角）。 */
export async function hitRows(clueId: string): Promise<
  { clue_id: string; other_clue_id: string; self_ratio: number; other_ratio: number; intersection_area: number }[]
> {
  return suite.cloned.prisma.$queryRaw<
    { clue_id: string; other_clue_id: string; self_ratio: number; other_ratio: number; intersection_area: number }[]
  >`
    SELECT clue_id, other_clue_id, self_ratio, other_ratio, intersection_area
    FROM clue_spatial_hit
    WHERE clue_id = ${clueId}
    ORDER BY spatial_part_id, other_part_id
  `;
}

/** 线索当前部件 GeoJSON（按序号排）。 */
export async function partGeojsons(clueId: string): Promise<string[]> {
  const rows = await suite.cloned.prisma.$queryRaw<{ geojson: string }[]>`
    SELECT ST_AsGeoJSON(p.geom) AS geojson
    FROM clue_spatial_part p
    JOIN clue_spatial_object o ON o.id = p.spatial_object_id
    WHERE o.clue_id = ${clueId}
    ORDER BY p.part_index
  `;
  return rows.map((row) => row.geojson);
}

export interface TrailRow {
  readonly action: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly detail: string | null;
  readonly resource_id: string | null;
}

/** 留痕行：留痕只许经设施包追加，读取走原生 SQL（委托名不出现在用例里）。 */
export async function trailOf(action: string, resourceId?: string): Promise<TrailRow[]> {
  if (resourceId === undefined) {
    return suite.cloned.prisma.$queryRaw<TrailRow[]>`
      SELECT action, outcome, reason, detail, resource_id
      FROM audit_trail
      WHERE action = ${action}
      ORDER BY created_at DESC, id DESC
      LIMIT 5
    `;
  }
  return suite.cloned.prisma.$queryRaw<TrailRow[]>`
    SELECT action, outcome, reason, detail, resource_id
    FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
  `;
}

export async function deniedTrail(resourceId: string): Promise<TrailRow[]> {
  return suite.cloned.prisma.$queryRaw<TrailRow[]>`
    SELECT action, outcome, reason, detail, resource_id
    FROM audit_trail
    WHERE action = 'authz.denied' AND resource_id = ${resourceId}
  `;
}

/** 每个用例文件的套件装配：克隆库、起应用、会话留驻、收尾关闭。 */
export function setupClueSuite(): void {
  const storage = new RecordingStorage();
  let closeApp: () => Promise<void> = async () => {};
  let cloned: ClonedDatabase | null = null;
  let baseUrl = '';
  beforeAll(async () => {
    cloned = await openClonedDatabase();
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
    Object.assign(suite, { cloned, storage, baseUrl });
  }, 60_000);
  afterAll(async () => {
    await closeApp();
    await cloned?.close();
  });
}
