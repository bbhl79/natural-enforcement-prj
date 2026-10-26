// #224 涉密误传标记与 quarantined 隔离。
// 断言：根机构系统管理员可标记＋留痕；非管理员／部门管理员拒绝；
// quarantined 后业务读 403 object-quarantined；假存储仍保留对象字节；
// StoragePort 类型层无 DeleteObject／物理删除成员。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-26T06:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Clue-quarantine-224!';
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(16).fill(7)]);

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

/** 记录写的假存储：保留字节，供读路径与「桶内仍在」断言。 */
class RecordingStorage {
  readonly objects = new Map<string, Uint8Array>();
  readonly writes: { fileKey: string; versionId: string; byteSize: number }[] = [];

  async putVersion(fileKey: string, content: Uint8Array): Promise<{ fileKey: string; versionId: string }> {
    const versionId = `version-${this.writes.length + 1}`;
    this.writes.push({ fileKey, versionId, byteSize: content.byteLength });
    this.objects.set(`${fileKey}@${versionId}`, new Uint8Array(content));
    return { fileKey, versionId };
  }

  async readVersion(ref: { fileKey: string; versionId: string }): Promise<Uint8Array> {
    const found = this.objects.get(`${ref.fileKey}@${ref.versionId}`);
    if (!found) throw new Error(`missing object ${ref.fileKey}@${ref.versionId}`);
    return new Uint8Array(found);
  }
}

const BASE_VALUES = {
  'clue.received_at': '2026-10-25',
  'clue.narrative': '巡查发现疑似涉密材料误传',
  'clue.finder': '巡查员甲',
  'clue.patrol_no': 'XC-2026-224',
};

let cloned: ClonedDatabase;
let storage = new RecordingStorage();
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
const cookies = new Map<string, string>();
const passwords = new Map<string, string>();
let squareOffset = 0;

function sessionCookie(response: Response): string {
  const found = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='));
  const pair = found?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

async function cookieOf(code: string): Promise<string> {
  const known = cookies.get(code);
  if (known) return known;
  const current = passwords.get(code) ?? SEED_PASSWORD;
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
  if (current === SEED_PASSWORD) {
    const changed = await fetch(`${baseUrl}/api/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ currentPassword: current, newPassword: NEW_PASSWORD }),
    });
    expect(changed.status).toBe(200);
    passwords.set(code, NEW_PASSWORD);
  }
  cookies.set(code, cookie);
  return cookie;
}

async function registerWithAttachment(): Promise<{ clueId: string; materialId: string; fileKey: string; versionId: string }> {
  squareOffset += 1;
  const form = new FormData();
  form.set('sourceCode', '16');
  form.set('domain', 'land');
  form.set('values', JSON.stringify(BASE_VALUES));
  form.set(
    'spatial-source',
    new Blob([geojsonPolygon(square(squareOffset))], { type: 'application/geo+json' }),
    'area.geojson',
  );
  form.set('attachment', new Blob([new Uint8Array(PNG_BYTES)], { type: 'application/octet-stream' }), '涉密误传.png');
  const response = await fetch(`${baseUrl}/api/clues`, {
    method: 'POST',
    headers: {
      cookie: await cookieOf('P-CLERK-A'),
      'idempotency-key': `q224-${squareOffset}-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  const body = (await response.json()) as { result?: string; id?: string };
  expect([200, 201]).toContain(response.status);
  expect(body.result).toBe('registered');
  const materials = await cloned.prisma.clueMaterial.findMany({
    where: { clueId: body.id ?? '', kind: 'attachment' },
  });
  expect(materials).toHaveLength(1);
  const material = materials[0]!;
  return {
    clueId: body.id!,
    materialId: material.id,
    fileKey: material.fileKey,
    versionId: material.versionId,
  };
}

async function mark(materialId: string, summary: string, code: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/storage/materials/${encodeURIComponent(materialId)}/quarantine`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({ summary }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function readContent(materialId: string, code: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}/api/storage/materials/${encodeURIComponent(materialId)}/content`, {
    headers: { cookie: await cookieOf(code) },
  });
  if (response.headers.get('content-type')?.includes('application/json')) {
    return { status: response.status, body: await response.json() };
  }
  return { status: response.status, body: new Uint8Array(await response.arrayBuffer()) };
}

describe('涉密误传标记与 quarantined 隔离（#224）', () => {
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
    cookies.clear();
  });

  it('应用侧假存储与 StoragePort 契约无 DeleteObject／物理删除通道', () => {
    // 类型层闸在 packages/storage/test/rustfs-storage.test.ts；此处锁运行时形态。
    const proto = Object.getOwnPropertyNames(RecordingStorage.prototype);
    expect(proto).toEqual(expect.arrayContaining(['putVersion', 'readVersion']));
    for (const name of ['delete', 'deleteObject', 'DeleteObject', 'deleteVersion', 'update', 'overwrite']) {
      expect(proto).not.toContain(name);
      expect(name in storage).toBe(false);
    }
  });

  it('根机构系统管理员标记成功：状态 quarantined＋留痕含对象 id／发现人／时间／简述', async () => {
    const target = await registerWithAttachment();
    const beforeBytes = storage.objects.get(`${target.fileKey}@${target.versionId}`);
    expect(beforeBytes?.byteLength).toBe(PNG_BYTES.byteLength);

    const outcome = await mark(target.materialId, '发现疑似涉密图纸误传至业务系统', 'P-ADMIN-HQ');
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({
      result: 'quarantined',
      materialId: target.materialId,
      fileKey: target.fileKey,
      versionId: target.versionId,
    });

    const rows = await cloned.prisma.$queryRaw<{ status: string; summary: string; discovered_by: string }[]>`
      SELECT status, summary, discovered_by
      FROM storage_object_quarantine
      WHERE file_key = ${target.fileKey} AND version_id = ${target.versionId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('quarantined');
    expect(rows[0]?.summary).toBe('发现疑似涉密图纸误传至业务系统');

    const admin = await cloned.prisma.personnel.findFirstOrThrow({ where: { code: 'P-ADMIN-HQ' } });
    expect(rows[0]?.discovered_by).toBe(admin.id);

    const trail = await cloned.prisma.$queryRaw<{ action: string; outcome: string; detail: string | null; actor_id: string | null }[]>`
      SELECT action, outcome, detail, actor_id
      FROM audit_trail
      WHERE action = 'storage.quarantined' AND resource_id = ${`${target.fileKey}@${target.versionId}`}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(trail).toHaveLength(1);
    expect(trail[0]?.outcome).toBe('succeeded');
    expect(trail[0]?.actor_id).toBe(admin.id);
    const detail = JSON.parse(trail[0]?.detail ?? '{}') as Record<string, unknown>;
    expect(detail.materialId).toBe(target.materialId);
    expect(detail.summary).toBe('发现疑似涉密图纸误传至业务系统');
    expect(detail.discoveredBy).toBe(admin.id);
    expect(typeof detail.discoveredAt).toBe('string');

    // 桶内对象仍在（假存储未删；应用侧无 DeleteObject 通道）。
    expect(storage.objects.get(`${target.fileKey}@${target.versionId}`)).toEqual(beforeBytes);
  });

  it('非系统管理员标记 403；部门系统管理员跨根收窄 403', async () => {
    const target = await registerWithAttachment();
    const clerk = await mark(target.materialId, '简述', 'P-CLERK-A');
    expect(clerk.status).toBe(403);

    const deptAdmin = await mark(target.materialId, '简述', 'P-SUP-A');
    expect(deptAdmin.status).toBe(403);
    expect(deptAdmin.body.reason).toBe('scope-denied');

    const rows = await cloned.prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(*) AS cnt FROM storage_object_quarantine
      WHERE file_key = ${target.fileKey} AND version_id = ${target.versionId}
    `;
    expect(Number(rows[0]?.cnt ?? 0)).toBe(0);
  });

  it('简述缺省 400；重复标记 409；隔离后业务读 403 object-quarantined', async () => {
    const target = await registerWithAttachment();
    const missing = await mark(target.materialId, '   ', 'P-ADMIN-HQ');
    expect(missing.status).toBe(400);
    expect(missing.body.reason).toBe('missing-summary');

    const ok = await mark(target.materialId, '误传扫描件', 'P-ADMIN-HQ');
    expect(ok.status).toBe(200);

    const again = await mark(target.materialId, '再次标记', 'P-ADMIN-HQ');
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('already-quarantined');

    const before = await readContent(target.materialId, 'P-CLERK-A');
    // 已隔离：读拒绝。隔离前本可 200；此处只断言隔离后拒绝。
    expect(before.status).toBe(403);
    expect((before.body as { reason?: string }).reason).toBe('object-quarantined');

    // 对象字节仍在。
    expect(storage.objects.has(`${target.fileKey}@${target.versionId}`)).toBe(true);
  });

  it('未隔离材料可业务读', async () => {
    const target = await registerWithAttachment();
    const content = await readContent(target.materialId, 'P-CLERK-A');
    expect(content.status).toBe(200);
    expect(content.body).toEqual(PNG_BYTES);
  });
});
