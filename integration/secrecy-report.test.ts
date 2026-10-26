// #225 保密报告工单（依赖 #224 隔离）。
// 断言：只能对已隔离对象生成工单，工单与对象双向可查；状态 待报→已报→已回执，只进不退；
// 默认 24h 时限提醒（假时钟拨动，不真实等待），只提醒不代发、超时无自动动作；
// 录入指令摘要＋回执附件才达已回执；全程原对象字节保留、隔离行不变、无删除／销毁接口。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-26T06:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Secrecy-report-225!';
const HOUR = 60 * 60 * 1000;
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
  'clue.patrol_no': 'XC-2026-225',
};

let cloned: ClonedDatabase;
let storage = new RecordingStorage();
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
let nowMs = T0;
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
      'idempotency-key': `r225-${squareOffset}-${Math.random().toString(36).slice(2)}`,
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

type Json = Record<string, unknown>;

async function call(
  method: string,
  path: string,
  code: string,
  body?: Json | FormData,
): Promise<{ status: number; body: Json }> {
  const headers: Record<string, string> = { cookie: await cookieOf(code) };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const raw = await response.text();
  return { status: response.status, body: raw === '' ? {} : (JSON.parse(raw) as Json) };
}

const materialPath = (id: string) => `/api/storage/materials/${encodeURIComponent(id)}`;
const ticketPath = (id: string) => `/api/storage/secrecy-reports/${encodeURIComponent(id)}`;

async function quarantined(): Promise<Awaited<ReturnType<typeof registerWithAttachment>>> {
  const target = await registerWithAttachment();
  const marked = await call('POST', `${materialPath(target.materialId)}/quarantine`, 'P-ADMIN-HQ', {
    summary: '发现疑似涉密文件误传',
  });
  expect(marked.status).toBe(200);
  return target;
}

function receiptForm(summary: string, withFile: boolean): FormData {
  const form = new FormData();
  form.set('instructionSummary', summary);
  if (withFile) {
    form.set('attachment', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/pdf' }), '保密部门回执.pdf');
  }
  return form;
}

async function quarantineRows(fileKey: string, versionId: string): Promise<{ status: string }[]> {
  return cloned.prisma.$queryRaw<{ status: string }[]>`
    SELECT status FROM storage_object_quarantine WHERE file_key = ${fileKey} AND version_id = ${versionId}
  `;
}

describe('保密报告工单（#225）', () => {
  beforeAll(async () => {
    cloned = await openClonedDatabase();
    storage = new RecordingStorage();
    const app = await createApplication(
      cloned.connectionString,
      { now: () => new Date(nowMs) },
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
    nowMs = T0;
    cookies.clear();
  });

  it('未隔离对象不能建单；已隔离对象建单为待报，工单与对象双向关联，重复建单 409', async () => {
    const plain = await registerWithAttachment();
    const refused = await call('POST', `${materialPath(plain.materialId)}/secrecy-report`, 'P-ADMIN-HQ');
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('not-quarantined');

    const target = await quarantined();
    const created = await call('POST', `${materialPath(target.materialId)}/secrecy-report`, 'P-ADMIN-HQ');
    expect(created.status).toBe(200);
    const ticket = created.body.ticket as Json;
    expect(ticket.status).toBe('pending_report');
    expect(ticket.statusLabel).toBe('待报');
    expect(ticket.reportDueAt).toBe(new Date(T0 + 24 * HOUR).toISOString());
    expect(ticket.object).toMatchObject({
      materialId: target.materialId,
      clueId: target.clueId,
      fileKey: target.fileKey,
      versionId: target.versionId,
      quarantined: true,
    });

    // 对象 → 工单。
    const byObject = await call('GET', `${materialPath(target.materialId)}/secrecy-report`, 'P-ADMIN-HQ');
    expect(byObject.status).toBe(200);
    expect((byObject.body.ticket as Json).id).toBe(ticket.id);
    // 工单 → 对象。
    const byTicket = await call('GET', ticketPath(String(ticket.id)), 'P-ADMIN-HQ');
    expect(byTicket.status).toBe(200);
    expect(((byTicket.body.ticket as Json).object as Json).materialId).toBe(target.materialId);

    const again = await call('POST', `${materialPath(target.materialId)}/secrecy-report`, 'P-ADMIN-HQ');
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('already-exists');

    const trail = await cloned.prisma.$queryRaw<{ outcome: string; reason: string | null }[]>`
      SELECT outcome, reason FROM audit_trail
      WHERE action = 'storage.secrecy-report-created'
        AND resource_id = ${`${target.fileKey}@${target.versionId}`}
      ORDER BY created_at
    `;
    expect(trail.map((row) => row.outcome)).toEqual(['succeeded', 'failed']);
    expect(trail[1]?.reason).toBe('already-exists');
  });

  it('非系统管理员 403；部门系统管理员跨根收窄 403（与 #224 同口径）', async () => {
    const target = await quarantined();
    const clerk = await call('POST', `${materialPath(target.materialId)}/secrecy-report`, 'P-CLERK-A');
    expect(clerk.status).toBe(403);
    const deptAdmin = await call('POST', `${materialPath(target.materialId)}/secrecy-report`, 'P-SUP-A');
    expect(deptAdmin.status).toBe(403);
    expect(deptAdmin.body.reason).toBe('scope-denied');
    const rows = await cloned.prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(*) AS cnt
      FROM secrecy_report_ticket t
      JOIN storage_object_quarantine q ON q.id = t.quarantine_id
      WHERE q.file_key = ${target.fileKey} AND q.version_id = ${target.versionId}
    `;
    expect(Number(rows[0]?.cnt ?? 0)).toBe(0);
  });

  it('24h 时限提醒：假时钟拨动；超时只标超时，不迁移状态、不销毁、不对外写任何东西', async () => {
    const target = await quarantined();
    const created = await call('POST', `${materialPath(target.materialId)}/secrecy-report`, 'P-ADMIN-HQ');
    const ticketId = String((created.body.ticket as Json).id);

    const fresh = await call('GET', '/api/storage/secrecy-reports/reminders', 'P-ADMIN-HQ');
    expect(fresh.status).toBe(200);
    expect(fresh.body.deadlineHours).toBe(24);
    const item = (fresh.body.items as Json[]).find((row) => row.id === ticketId);
    expect(item?.reminder).toEqual({
      dueAt: new Date(T0 + 24 * HOUR).toISOString(),
      remainingMinutes: 24 * 60,
      overdue: false,
    });

    // 非系统管理员没有提醒入口。
    const other = await call('GET', '/api/storage/secrecy-reports/reminders', 'P-CLERK-A');
    expect(other.status).toBe(403);

    const writesBefore = storage.writes.length;
    nowMs = T0 + 25 * HOUR;
    cookies.clear();
    const late = await call('GET', '/api/storage/secrecy-reports/reminders', 'P-ADMIN-HQ');
    expect(late.status).toBe(200);
    const lateItem = (late.body.items as Json[]).find((row) => row.id === ticketId);
    expect(lateItem?.status).toBe('pending_report');
    expect((lateItem?.reminder as Json).overdue).toBe(true);
    expect((lateItem?.reminder as Json).remainingMinutes).toBe(-60);

    // 超时无自动动作：工单仍待报，隔离行仍在，对象字节仍在，存储无新写入。
    const ticketRow = await cloned.prisma.$queryRaw<{ status: string }[]>`
      SELECT status FROM secrecy_report_ticket WHERE id = ${ticketId}
    `;
    expect(ticketRow[0]?.status).toBe('pending_report');
    expect(await quarantineRows(target.fileKey, target.versionId)).toEqual([{ status: 'quarantined' }]);
    expect(storage.objects.has(`${target.fileKey}@${target.versionId}`)).toBe(true);
    expect(storage.writes.length).toBe(writesBefore);
  });

  it('待报→已报→已回执：跳步与缺项拒绝；录入摘要＋附件后已回执；原对象与隔离不变', async () => {
    const target = await quarantined();
    const created = await call('POST', `${materialPath(target.materialId)}/secrecy-report`, 'P-ADMIN-HQ');
    const ticketId = String((created.body.ticket as Json).id);
    const originalBytes = storage.objects.get(`${target.fileKey}@${target.versionId}`);

    const skip = await call('POST', `${ticketPath(ticketId)}/receipt`, 'P-ADMIN-HQ', receiptForm('指令', true));
    expect(skip.status).toBe(409);
    expect(skip.body.reason).toBe('invalid-state');

    const noNote = await call('POST', `${ticketPath(ticketId)}/reported`, 'P-ADMIN-HQ', { reportNote: '  ' });
    expect(noNote.status).toBe(400);
    expect(noNote.body.reason).toBe('missing-report-note');

    const reported = await call('POST', `${ticketPath(ticketId)}/reported`, 'P-ADMIN-HQ', {
      reportNote: '已按规程电话报告市保密局并呈报上级，文号 保报〔2026〕1 号',
    });
    expect(reported.status).toBe(200);
    expect((reported.body.ticket as Json).status).toBe('reported');
    expect((reported.body.ticket as Json).reminder).toBeNull();
    const reminders = await call('GET', '/api/storage/secrecy-reports/reminders', 'P-ADMIN-HQ');
    expect((reminders.body.items as Json[]).some((row) => row.id === ticketId)).toBe(false);

    const twice = await call('POST', `${ticketPath(ticketId)}/reported`, 'P-ADMIN-HQ', { reportNote: '再报' });
    expect(twice.status).toBe(409);

    // 已报但未录入回执：挂起等待，不触发销毁。
    expect(await quarantineRows(target.fileKey, target.versionId)).toEqual([{ status: 'quarantined' }]);

    const noSummary = await call('POST', `${ticketPath(ticketId)}/receipt`, 'P-ADMIN-HQ', receiptForm(' ', true));
    expect(noSummary.status).toBe(400);
    expect(noSummary.body.reason).toBe('missing-instruction-summary');
    const noFile = await call('POST', `${ticketPath(ticketId)}/receipt`, 'P-ADMIN-HQ', receiptForm('指令', false));
    expect(noFile.status).toBe(400);
    expect(noFile.body.reason).toBe('missing-receipt-attachment');

    const done = await call(
      'POST',
      `${ticketPath(ticketId)}/receipt`,
      'P-ADMIN-HQ',
      receiptForm('保密部门指令：原件封存待二期处置，暂不销毁', true),
    );
    expect(done.status).toBe(200);
    const ticket = done.body.ticket as Json;
    expect(ticket.status).toBe('receipted');
    expect(ticket.statusLabel).toBe('已回执');
    expect(ticket.instructionSummary).toBe('保密部门指令：原件封存待二期处置，暂不销毁');
    expect((ticket.receipt as Json).fileName).toBe('保密部门回执.pdf');

    const after = await call('POST', `${ticketPath(ticketId)}/receipt`, 'P-ADMIN-HQ', receiptForm('再录', true));
    expect(after.status).toBe(409);

    // 已回执后：原对象字节仍在、隔离行不变、业务读仍拒绝。
    expect(storage.objects.get(`${target.fileKey}@${target.versionId}`)).toEqual(originalBytes);
    expect(await quarantineRows(target.fileKey, target.versionId)).toEqual([{ status: 'quarantined' }]);
    const read = await call('GET', `${materialPath(target.materialId)}/content`, 'P-CLERK-A');
    expect(read.status).toBe(403);
    expect(read.body.reason).toBe('object-quarantined');

    const trail = await cloned.prisma.$queryRaw<{ action: string; outcome: string }[]>`
      SELECT action, outcome FROM audit_trail
      WHERE action IN ('storage.secrecy-report-reported', 'storage.secrecy-report-receipted')
        AND outcome = 'succeeded'
        AND resource_id = ${`${target.fileKey}@${target.versionId}`}
      ORDER BY created_at
    `;
    expect(trail.map((row) => row.action)).toEqual([
      'storage.secrecy-report-reported',
      'storage.secrecy-report-receipted',
    ]);
  });

  it('无删除／销毁接口：DELETE 一律 404，存储端口无删除成员', async () => {
    const target = await quarantined();
    const created = await call('POST', `${materialPath(target.materialId)}/secrecy-report`, 'P-ADMIN-HQ');
    const ticketId = String((created.body.ticket as Json).id);
    for (const path of [
      ticketPath(ticketId),
      `${materialPath(target.materialId)}/secrecy-report`,
      `${materialPath(target.materialId)}/content`,
    ]) {
      const response = await call('DELETE', path, 'P-ADMIN-HQ');
      expect(response.status, path).toBe(404);
    }
    for (const path of [`${ticketPath(ticketId)}/destroy`, `${materialPath(target.materialId)}/destroy`]) {
      const response = await call('POST', path, 'P-ADMIN-HQ', {});
      expect(response.status, path).toBe(404);
    }
    for (const name of ['delete', 'deleteObject', 'DeleteObject', 'deleteVersion', 'destroy']) {
      expect(name in storage).toBe(false);
    }
    expect(storage.objects.has(`${target.fileKey}@${target.versionId}`)).toBe(true);
  });
});
