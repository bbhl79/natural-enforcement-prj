// #214 辖区建议（服务端现算、不自动派）。
// 面状逐面与街道镇边界相交后按街道、机构汇总：全部候选、占比、街道明细（按占比降序）；
// 点状按包含点位的街道建议；跨区给「分割重传或择一」提示；
// 街道边界服务或辖区对应未就绪（含服务不可用）时返回空建议，不拦手工分派。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-25T03:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Clue-suggest-214!';

/** 以经度偏移量区分的方斑。 */
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

function geojsonMultiPolygon(rings: readonly (readonly (readonly number[])[])[]): string {
  return JSON.stringify({
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) },
    properties: {},
  });
}

/** 街道镇边界查询替身：每个用例脚本化返回（结构与 case 模块端口一致）。 */
interface StreetRequestStub {
  readonly clueId: string;
  readonly kind: 'face' | 'point';
  readonly parts: readonly { readonly partId: string; readonly partIndex: number; readonly geojson: string }[];
}

type StreetOutcomeStub =
  | {
      readonly ok: true;
      readonly features: readonly {
        readonly streetCode: string;
        readonly partId: string;
        readonly partIndex: number;
        readonly overlapArea: number;
        readonly intersection: string;
      }[];
    }
  | { readonly ok: false; readonly reason: string };

class StubStreetBoundary {
  script: (request: StreetRequestStub) => StreetOutcomeStub = () => ({ ok: true, features: [] });

  async query(request: StreetRequestStub): Promise<StreetOutcomeStub> {
    return this.script(request);
  }
}

/** 记录写的假存储端口。 */
class RecordingStorage {
  async putVersion(fileKey: string): Promise<{ fileKey: string; versionId: string }> {
    return { fileKey, versionId: 'version-1' };
  }

  async readVersion(): Promise<Uint8Array> {
    return new Uint8Array(0);
  }
}

let cloned: ClonedDatabase;
const street = new StubStreetBoundary();
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

const BASE_VALUES = {
  'clue.received_at': '2026-10-25',
  'clue.narrative': '巡查发现一处硬化地面',
  'clue.finder': '巡查员甲',
  'clue.patrol_no': 'XC-2026-001',
};

async function register(options: {
  readonly domain?: string;
  readonly polygon?: string;
}): Promise<{ status: number; body: { id?: string; code?: string; status?: string } }> {
  const form = new FormData();
  form.set('sourceCode', '16');
  form.set('domain', options.domain ?? 'land');
  form.set('values', JSON.stringify(BASE_VALUES));
  form.set(
    'spatial-source',
    new Blob([options.polygon ?? geojsonPolygon(square(0))], { type: 'application/geo+json' }),
    'area.geojson',
  );
  const response = await fetch(`${baseUrl}/api/clues`, {
    method: 'POST',
    headers: {
      cookie: await cookieOf('P-CLERK-A'),
      'idempotency-key': `key-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  return { status: response.status, body: (await response.json()) as { id?: string; code?: string; status?: string } };
}

interface SuggestionView {
  readonly result: string;
  readonly kind: string;
  readonly suggestions: readonly {
    readonly orgUnitId: string;
    readonly orgName: string;
    readonly area: number;
    readonly ratio: number;
    readonly streets: readonly {
      readonly streetCode: string;
      readonly streetName: string;
      readonly area: number;
      readonly faces: readonly { readonly partIndex: number; readonly area: number }[];
    }[];
  }[];
  readonly crossDistrict: boolean;
  readonly hint: string | null;
  readonly unavailableReason: string | null;
}

async function suggestionOf(clueId: string): Promise<{ status: number; body: SuggestionView }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/dispatch`, {
    headers: { cookie: await cookieOf('P-CLERK-A') },
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { suggestion: SuggestionView };
  return { status: response.status, body: body.suggestion };
}

let deptAId = '';
let deptBId = '';
let stationAId = '';

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(T0) },
    undefined,
    { storagePort: new RecordingStorage(), streetBoundaryPort: street },
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
  // 夹具：甲区内勤（待分派池所属机构），供「空建议不拦手工分派」用例派机构。
  const admin = await cookieOf('P-ADMIN-HQ');
  const created = await fetch(`${baseUrl}/api/admin/personnel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: admin },
    body: JSON.stringify({
      code: 'P-INTAKE-A',
      name: '甲区内勤',
      orgUnitId: deptAId,
      mobilePhone: '13900003001',
      initialPassword: 'Suggest-214!!',
      roles: ['内勤'],
    }),
  });
  expect(created.status).toBe(200);
  await cookieOf('P-INTAKE-A', 'Suggest-214!!');
  // 辖区对应（街道编码 → 机构）。服务地址未就绪期间，验收保持受阻（ADR 0021）。
  await cloned.prisma.geoDictJurisdiction.createMany({
    data: [
      { id: 'juris-0000000000000001', code: 'S-TH', version: 1, name: '天河街道', orgCode: 'ORG-STATION-A', orgName: '甲区执法所', source: '测试夹具', status: 'active' },
      { id: 'juris-0000000000000002', code: 'S-JA', version: 1, name: '甲区街道', orgCode: 'ORG-DEPT-A', orgName: '第一执法支队', source: '测试夹具', status: 'active' },
      { id: 'juris-0000000000000003', code: 'S-YB', version: 1, name: '乙区街道', orgCode: 'ORG-DEPT-B', orgName: '第二执法支队', source: '测试夹具', status: 'active' },
    ],
  });
}, 60_000);

afterAll(async () => {
  await closeApp();
  await cloned?.close();
});

beforeEach(() => {
  street.script = () => ({ ok: true, features: [] });
});

describe('#214 辖区建议', () => {
  it('面状逐面汇总：全部候选、占比、街道明细按占比降序；同区不提示跨区', async () => {
    const registered = await register({
      polygon: geojsonMultiPolygon([square(70), square(71)]),
    });
    expect(registered.status).toBe(201);
    street.script = (request) => {
      expect(request.kind).toBe('face');
      expect(request.parts).toHaveLength(2);
      return {
        ok: true,
        features: [
          { streetCode: 'S-TH', partId: request.parts[0].partId, partIndex: 0, overlapArea: 6000, intersection: '{}' },
          { streetCode: 'S-JA', partId: request.parts[0].partId, partIndex: 0, overlapArea: 4000, intersection: '{}' },
          { streetCode: 'S-TH', partId: request.parts[1].partId, partIndex: 1, overlapArea: 2000, intersection: '{}' },
        ],
      };
    };
    const { body } = await suggestionOf(registered.body.id ?? '');
    expect(body.kind).toBe('face');
    expect(body.unavailableReason).toBeNull();
    // 全部候选、按占比降序：甲所（天河街道 8000）在前，甲区（甲区街道 4000）在后。
    expect(body.suggestions).toHaveLength(2);
    expect(body.suggestions[0]?.orgUnitId).toBe(stationAId);
    expect(body.suggestions[1]?.orgUnitId).toBe(deptAId);
    expect(body.suggestions[0]?.ratio ?? 0).toBeGreaterThan(body.suggestions[1]?.ratio ?? 1);
    expect(body.suggestions[0]?.area).toBe(8000);
    // 街道明细：逐面归组。
    const streets = body.suggestions[0]?.streets ?? [];
    expect(streets).toHaveLength(1);
    expect(streets[0]?.streetCode).toBe('S-TH');
    expect(streets[0]?.streetName).toBe('天河街道');
    expect(streets[0]?.area).toBe(8000);
    expect(streets[0]?.faces).toEqual([
      { partIndex: 0, area: 6000 },
      { partIndex: 1, area: 2000 },
    ]);
    // 同属甲区：不提示跨区。
    expect(body.crossDistrict).toBe(false);
    expect(body.hint).toBeNull();
  });

  it('跨区候选：给「分割重传或择一」提示', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(72)) });
    street.script = (request) => ({
      ok: true,
      features: [
        { streetCode: 'S-TH', partId: request.parts[0].partId, partIndex: 0, overlapArea: 5000, intersection: '{}' },
        { streetCode: 'S-YB', partId: request.parts[0].partId, partIndex: 0, overlapArea: 3000, intersection: '{}' },
      ],
    });
    const { body } = await suggestionOf(registered.body.id ?? '');
    expect(body.suggestions.map((item) => item.orgUnitId).sort()).toEqual([deptBId, stationAId].sort());
    expect(body.crossDistrict).toBe(true);
    expect(body.hint).toContain('分割重传');
  });

  it('点状线索：按包含点位的街道建议，占比 1', async () => {
    const registered = await register({
      domain: 'survey',
      polygon: JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [113.5, 23.05] }, properties: {} }),
    });
    expect(registered.status).toBe(201);
    expect(registered.body.status).toBe('in_pool');
    street.script = (request) => {
      expect(request.kind).toBe('point');
      return {
        ok: true,
        features: [
          { streetCode: 'S-TH', partId: request.parts[0].partId, partIndex: 0, overlapArea: 0, intersection: '{}' },
        ],
      };
    };
    const { body } = await suggestionOf(registered.body.id ?? '');
    expect(body.kind).toBe('point');
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0]?.orgUnitId).toBe(stationAId);
    expect(body.suggestions[0]?.ratio).toBe(1);
  });

  it('街道边界服务不可用：空建议并给出原因，不拦手工分派', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(73)) });
    street.script = () => ({ ok: false, reason: 'service-unavailable' });
    const { body } = await suggestionOf(registered.body.id ?? '');
    expect(body.suggestions).toEqual([]);
    expect(body.unavailableReason).toBe('service-unavailable');

    // 空建议不拦手工分派：待分派池所属机构的内勤照常派机构。
    const intake = await cloned.prisma.personnel.findUnique({ where: { code: 'P-INTAKE-A' } });
    const response = await fetch(`${baseUrl}/api/clues/${registered.body.id ?? ''}/assign-org`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: await cookieOf('P-INTAKE-A') },
      body: JSON.stringify({
        orgUnitId: stationAId,
        expectedStatus: 'in_pool',
        reason: '',
        designate: false,
      }),
    });
    expect(response.status).toBe(200);
    expect(intake?.id).toBeTruthy();
  });

  it('辖区对应未覆盖返回的街道：空建议并给出原因，不拦手工分派', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(75)) });
    street.script = (request) => ({
      ok: true,
      features: [
        { streetCode: 'S-UNKNOWN', partId: request.parts[0].partId, partIndex: 0, overlapArea: 5000, intersection: '{}' },
      ],
    });
    const { body } = await suggestionOf(registered.body.id ?? '');
    expect(body.suggestions).toEqual([]);
    expect(body.unavailableReason).toBe('jurisdiction-not-ready');
  });
});
