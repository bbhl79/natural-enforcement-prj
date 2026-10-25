// #216 移送与停用机构池重新指定。
// 断言打在克隆库上：移送登记（必填校验、发函日期缺省与补录、附件选填 0..n、
// 存储零写入、transferred_out 终态、退出比对、报请期间的锁）、池重新指定
// （系统管理员、理由必填、目标须未停用、只接已停用池机构的未派出线索、不加锁）。
// 凡 4xx/403 用例同时断言「失败留痕存在、业务行不变」。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-25T03:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Clue-disposition-216!';
const INITIAL_PASSWORD = 'Disposition-216!!';

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

/** PNG 魔数开头的最小附件（真实内容校验过扩展名还核魔数）。 */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** 记录写的假存储端口：断言「附件校验失败存储零写入」。 */
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

/**
 * 某一步动作写入存储的件数。
 * 登记本身会写一件空间源文件，故基线要在动作前取，断言只看该动作带来的增量。
 * 用法：const before = storage.writes.length; …动作…; expect(writesSince(before)).toHaveLength(0);
 */
function writesSince(baseline: number): readonly { readonly fileKey: string; readonly byteSize: number }[] {
  return storage.writes.slice(baseline);
}

/** 记录投递的假队列端口：不执行，核查停在「进行中」（核查没跑成不拦移送）。 */
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

interface TransferInput {
  readonly transferOrg?: string;
  readonly documentNo?: string;
  readonly letterDate?: string;
  readonly reason?: string;
  readonly expectedStatus?: string;
  readonly attachments?: readonly { readonly name: string; readonly content: Uint8Array }[];
}

/** 移送登记（multipart：表单字段 + 选填附件）。 */
async function transfer(
  clueId: string,
  input: TransferInput = {},
  code = 'P-INTAKE-A',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  form.set('transferOrg', input.transferOrg ?? '市公安局');
  form.set('documentNo', input.documentNo ?? '穗公移〔2026〕12 号');
  form.set('letterDate', input.letterDate ?? '');
  form.set('reason', input.reason ?? '涉嫌污染环境罪，移送公安处理');
  form.set('expectedStatus', input.expectedStatus ?? 'in_pool');
  for (const file of input.attachments ?? []) {
    form.append('attachment', new Blob([file.content.slice()], { type: 'image/png' }), file.name);
  }
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/transfer`, {
    method: 'POST',
    headers: { cookie: await cookieOf(code) },
    body: form,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** 派机构。同级机构不在操作者数据范围内，跨区指派须由上级内勤带 designate=true 执行。 */
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

/** 停用机构池重新指定。 */
async function poolReassign(
  clueId: string,
  input: { orgUnitId: string; reason?: string; expectedStatus?: string },
  code = 'P-ADMIN-HQ',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/pool-reassign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await cookieOf(code) },
    body: JSON.stringify({
      orgUnitId: input.orgUnitId,
      reason: input.reason ?? '机构停用，池线索改派',
      expectedStatus: input.expectedStatus ?? 'in_pool',
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
  readonly opcode: string | null;
}

/** 留痕行：留痕只许经设施包追加，读取走原生 SQL（委托名不出现在用例里）。 */
async function trailOf(action: string, resourceId?: string): Promise<TrailRow[]> {
  if (resourceId === undefined) {
    return cloned.prisma.$queryRaw<TrailRow[]>`
      SELECT action, outcome, reason, detail, resource_id, opcode
      FROM audit_trail
      WHERE action = ${action}
      ORDER BY created_at DESC, id DESC
      LIMIT 20
    `;
  }
  return cloned.prisma.$queryRaw<TrailRow[]>`
    SELECT action, outcome, reason, detail, resource_id, opcode
    FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
    ORDER BY created_at DESC, id DESC
  `;
}

let deptAId = '';
let deptBId = '';
let unitSeq = 0;

/** 建一个所级机构（可选直接置停用），返回机构 id。 */
async function addStation(parentId: string, deactivated = false): Promise<string> {
  unitSeq += 1;
  const id = newUlid();
  const name = `移送测试所${unitSeq}`;
  await cloned.prisma.orgUnit.create({
    data: {
      id,
      code: `ORG-216-${unitSeq}`,
      name,
      level: 'station',
      parentId,
      deactivatedAt: deactivated ? new Date(T0) : null,
    },
  });
  await cloned.prisma.orgUnitNameVersion.create({ data: { id: newUlid(), orgUnitId: id, name, version: 1 } });
  return id;
}

/** 直接写一行未关闭的指定管辖报请（#215 未落地，按其表结构造事实）。 */
async function addPendingDesignation(clueId: string, requestingOrgId: string, proposedOrgId: string): Promise<void> {
  await cloned.prisma.$queryRaw`
    INSERT INTO clue_designation_request (id, clue_id, requesting_org_id, proposed_org_id, reason, status, created_at)
    VALUES (${newUlid()}, ${clueId}, ${requestingOrgId}, ${proposedOrgId}, '应属上级管辖', 'pending', ${new Date(T0)})
  `;
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

  // 夹具：甲区（待分派池）与乙区（承办侧）内勤、甲所内勤与经办。
  const orgOf = async (code: string) => {
    const org = await cloned.prisma.orgUnit.findUnique({ where: { code } });
    if (!org) throw new Error(`缺少种子机构 ${code}`);
    return org.id;
  };
  deptAId = await orgOf('ORG-DEPT-A');
  deptBId = await orgOf('ORG-DEPT-B');
  await seedPerson('P-INTAKE-A', '甲区内勤', deptAId, ['内勤'], '13900003001');
  await seedPerson('P-INTAKE-B', '乙区内勤', deptBId, ['内勤'], '13900003002');
  await seedPerson('P-HANDLER-216', '甲区经办甲', deptAId, ['经办'], '13900003003');
  for (const code of ['P-INTAKE-A', 'P-INTAKE-B', 'P-HANDLER-216']) {
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

describe('#216 移送登记', () => {
  it('待分派池移送成功：transferred_out 终态＋处置行＋留痕 clue.disposition-recorded，发函日期缺省北京当日', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(50)) });
    expect(registered.status).toBe(201);
    const clueId = registered.body.id ?? '';

    const outcome = await transfer(clueId);
    expect(outcome.status).toBe(200);
    expect(outcome.body.result).toBe('transferred-out');
    expect(outcome.body.status).toBe('transferred_out');
    // T0＝2026-10-25T03:00Z＝北京 11:00，缺省发函日期为 2026-10-25。
    expect(outcome.body.letterDate).toBe('2026-10-25');

    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('transferred_out');
    const disposition = await cloned.prisma.clueDisposition.findFirst({ where: { clueId } });
    expect(disposition?.disposition).toBe('transfer');
    expect(disposition?.transferredOrg).toBe('市公安局');
    expect(disposition?.documentNo).toBe('穗公移〔2026〕12 号');
    expect(disposition?.note).toBe('涉嫌污染环境罪，移送公安处理');
    expect(disposition?.letterDate?.toISOString()).toBe('2026-10-24T16:00:00.000Z');
    expect(disposition?.recordedBy).not.toBe('');

    const trail = (await trailOf('clue.disposition-recorded', clueId)).filter(
      (row) => row.outcome === 'succeeded',
    );
    expect(trail).toHaveLength(1);
    expect(trail[0]?.detail).toContain('transfer');
    expect(trail[0]?.detail).toContain('市公安局');
    expect(trail[0]?.detail).toContain('穗公移〔2026〕12 号');
  });

  it('必填缺失：400 missing-disposition-fields＋失败留痕＋业务行不变＋存储零写入', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(51)) });
    const clueId = registered.body.id ?? '';
    const before = storage.writes.length;

    const outcome = await transfer(clueId, { transferOrg: '  ' });
    expect(outcome.status).toBe(400);
    expect(outcome.body).toEqual({ result: 'non-compliant', rules: ['missing-disposition-fields'] });

    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('in_pool');
    expect(await cloned.prisma.clueDisposition.count({ where: { clueId } })).toBe(0);
    const failed = (await trailOf('clue.disposition-recorded', clueId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('missing-disposition-fields');
    expect(writesSince(before)).toHaveLength(0);
  });

  it('已派机构后由承办机构内勤移送；池所属机构内勤再移送 403', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(52)) });
    const clueId = registered.body.id ?? '';
    // 目标乙区与甲区平级，不在甲区内勤数据范围内；跨区指派由市局内勤带 designate=true 执行。
    const assigned = await assignOrg(
      clueId,
      { orgUnitId: deptBId, designate: true, reason: '指定乙区承办' },
      'P-INTAKE-HQ',
    );
    expect(assigned.status).toBe(200);

    const denied = await transfer(clueId, {}, 'P-INTAKE-A');
    expect(denied.status).toBe(403);
    // 承办机构已是乙区，不在甲区内勤的数据范围内：第一层授权即按范围外拒绝。
    expect(denied.body.reason).toBe('scope-denied');
    const clueAfterDeny = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clueAfterDeny?.status).toBe('org_assigned');
    expect(await cloned.prisma.clueDisposition.count({ where: { clueId } })).toBe(0);
    const deniedTrail = await cloned.prisma.$queryRaw<TrailRow[]>`
      SELECT action, outcome, reason FROM audit_trail
      WHERE action = 'authz.denied' AND resource_id = ${clueId} AND opcode = 'clue.disposition.record'
    `;
    expect(deniedTrail).toHaveLength(1);
    expect(deniedTrail[0]?.outcome).toBe('failed');

    const outcome = await transfer(clueId, { expectedStatus: 'org_assigned' }, 'P-INTAKE-B');
    expect(outcome.status).toBe(200);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('transferred_out');
    // 终态关止当前分派事实：当前有效行清零（退出 OpenItems 的当前有效行口径）。
    const openAssignments = await cloned.prisma.clueAssignment.count({
      where: { clueId, endedAt: null },
    });
    expect(openAssignments).toBe(0);
  });

  it('经办不能移送：403 permission-denied＋authz.denied＋业务行不变', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(53)) });
    const clueId = registered.body.id ?? '';

    const outcome = await transfer(clueId, {}, 'P-HANDLER-216');
    expect(outcome.status).toBe(403);
    expect(outcome.body.reason).toBe('permission-denied');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('in_pool');
    expect(await cloned.prisma.clueDisposition.count({ where: { clueId } })).toBe(0);
    const deniedTrail = await trailOf('clue.disposition-recorded', clueId);
    expect(deniedTrail).toHaveLength(0);
  });

  it('状态不允许：待分派决定与不派不能移送，409 invalid-state＋失败留痕', async () => {
    const first = await register({ polygon: geojsonPolygon(square(54)) });
    const second = await register({ polygon: geojsonPolygon(square(54)) });
    expect(second.body.status).toBe('pending_decision');
    const pendingId = second.body.id ?? '';
    const pendingOutcome = await transfer(pendingId, { expectedStatus: 'pending_decision' });
    expect(pendingOutcome.status).toBe(409);
    expect(pendingOutcome.body).toEqual({ result: 'invalid-state', reason: 'invalid-state' });
    const failedPending = (await trailOf('clue.disposition-recorded', pendingId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failedPending).toHaveLength(1);
    expect(failedPending[0]?.reason).toBe('invalid-state');

    const held = await decide(pendingId, { decision: 'hold' });
    expect(held.status).toBe(200);
    const heldOutcome = await transfer(pendingId, { expectedStatus: 'held' });
    expect(heldOutcome.status).toBe(409);
    expect(heldOutcome.body).toEqual({ result: 'invalid-state', reason: 'invalid-state' });
    expect(first.body.status).toBe('in_pool');
  });

  it('expectedStatus 不符：409 concurrent-change＋失败留痕＋业务行不变', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(55)) });
    const clueId = registered.body.id ?? '';
    const outcome = await transfer(clueId, { expectedStatus: 'org_assigned' });
    expect(outcome.status).toBe(409);
    expect(outcome.body).toEqual({ result: 'concurrent-change', reason: 'concurrent-change' });
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('in_pool');
    const failed = (await trailOf('clue.disposition-recorded', clueId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('concurrent-change');
  });

  it('报请期间的锁：存在未关闭的指定管辖报请，移送 409 designation-pending＋失败留痕', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(56)) });
    const clueId = registered.body.id ?? '';
    await addPendingDesignation(clueId, deptAId, deptBId);

    const outcome = await transfer(clueId);
    expect(outcome.status).toBe(409);
    expect(outcome.body).toEqual({ result: 'invalid-state', reason: 'designation-pending' });
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('in_pool');
    expect(await cloned.prisma.clueDisposition.count({ where: { clueId } })).toBe(0);
    const failed = (await trailOf('clue.disposition-recorded', clueId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('designation-pending');
  });

  it('transferred_out 退出比对：移送后再登记同位置线索命中为空', async () => {
    const first = await register({ polygon: geojsonPolygon(square(57)) });
    const moved = await transfer(first.body.id ?? '');
    expect(moved.status).toBe(200);

    const second = await register({ polygon: geojsonPolygon(square(57)) });
    expect(second.body.hits).toEqual([]);

    // 对照：同位置两条都未移送时，后登记的必命中先登记的。
    const third = await register({ polygon: geojsonPolygon(square(58)) });
    const fourth = await register({ polygon: geojsonPolygon(square(58)) });
    expect((fourth.body.hits ?? []).length).toBeGreaterThan(0);
    expect(third.body.status).toBe('in_pool');
  });
});

describe('#216 移送附件与发函日期', () => {
  it('附件选填：0 件成功；2 件成功且材料行与存储写入一一对应', async () => {
    const bare = await register({ polygon: geojsonPolygon(square(60)) });
    const bareBefore = storage.writes.length;
    const bareOutcome = await transfer(bare.body.id ?? '');
    expect(bareOutcome.status).toBe(200);
    expect(writesSince(bareBefore)).toHaveLength(0);

    const registered = await register({ polygon: geojsonPolygon(square(61)) });
    const clueId = registered.body.id ?? '';
    const before = storage.writes.length;
    const outcome = await transfer(clueId, {
      attachments: [
        { name: '移送函.png', content: PNG_BYTES },
        { name: '现场照片.png', content: PNG_BYTES },
      ],
    });
    expect(outcome.status).toBe(200);
    const written = writesSince(before);
    expect(written).toHaveLength(2);
    expect(written[0]?.fileKey).toContain(`clue/${clueId}/transfer/`);
    // 登记本身会留一条空间源材料行，故这里只看移送挂上的附件行。
    const materials = await cloned.prisma.clueMaterial.findMany({
      where: { clueId, kind: 'attachment' },
    });
    expect(materials).toHaveLength(2);
    expect(materials.map((row) => row.fileName).sort()).toEqual(['现场照片.png', '移送函.png']);
  });

  it('附件校验失败：400 non-compliant＋失败留痕 invalid-attachment＋存储零写入', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(62)) });
    const clueId = registered.body.id ?? '';
    const before = storage.writes.length;
    // 扩展名是 png，真实内容不是 PNG：魔数核对必失败。
    const fake = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const outcome = await transfer(clueId, {
      attachments: [{ name: '伪造.png', content: fake }],
    });
    expect(outcome.status).toBe(400);
    expect(outcome.body).toEqual({
      result: 'non-compliant',
      rules: ['attachment-content-mismatch'],
    });
    expect(writesSince(before)).toHaveLength(0);
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('in_pool');
    expect(await cloned.prisma.clueDisposition.count({ where: { clueId } })).toBe(0);
    // 登记本身会留一条空间源材料行，故这里只看移送有没有挂上附件行。
    expect(
      await cloned.prisma.clueMaterial.count({ where: { clueId, kind: 'attachment' } }),
    ).toBe(0);
    const failed = (await trailOf('clue.disposition-recorded', clueId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('invalid-attachment');
  });

  it('发函日期允许补录：处置行写入补录值', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(63)) });
    const clueId = registered.body.id ?? '';
    const outcome = await transfer(clueId, { letterDate: '2026-10-20' });
    expect(outcome.status).toBe(200);
    expect(outcome.body.letterDate).toBe('2026-10-20');
    const disposition = await cloned.prisma.clueDisposition.findFirst({ where: { clueId } });
    expect(disposition?.letterDate?.toISOString()).toBe('2026-10-19T16:00:00.000Z');
  });

  it('发函日期补录不合规：400 invalid-letter-date＋失败留痕＋存储零写入', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(64)) });
    const clueId = registered.body.id ?? '';
    const before = storage.writes.length;
    const outcome = await transfer(clueId, { letterDate: '2026-02-30' });
    expect(outcome.status).toBe(400);
    expect(outcome.body).toEqual({ result: 'non-compliant', rules: ['invalid-letter-date'] });
    expect(writesSince(before)).toHaveLength(0);
    const failed = (await trailOf('clue.disposition-recorded', clueId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('invalid-letter-date');
  });
});

describe('#216 停用机构池重新指定', () => {
  it('系统管理员重新指定成功：归属变更＋指定事实（不加锁）＋留痕 clue.pool-reassigned；接收机构可正常分派', async () => {
    // 夹具：甲区下级一所，内勤登记线索后该所停用。
    const stationId = await addStation(deptAId);
    await seedPerson('P-216-ST-X', '停用所内勤', stationId, ['内勤'], '13900003010');
    await cookieOf('P-216-ST-X', INITIAL_PASSWORD);
    const registered = await register({ polygon: geojsonPolygon(square(70)), code: 'P-216-ST-X' });
    expect(registered.status).toBe(201);
    const clueId = registered.body.id ?? '';
    await cloned.prisma.orgUnit.update({
      where: { id: stationId },
      data: { deactivatedAt: new Date(T0) },
    });

    const outcome = await poolReassign(clueId, { orgUnitId: deptBId });
    expect(outcome.status).toBe(200);
    expect(outcome.body.result).toBe('pool-reassigned');
    expect(outcome.body.status).toBe('in_pool');

    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.enteredOrgId).toBe(deptBId);
    expect(clue?.status).toBe('in_pool');
    const assignment = await cloned.prisma.clueAssignment.findFirst({
      where: { clueId, kind: 'pool-reassign' },
    });
    expect(assignment?.orgUnitId).toBe(deptBId);
    expect(assignment?.designate).toBe(false);
    expect(assignment?.reason).toBe('机构停用，池线索改派');
    expect(assignment?.endedAt).toBeNull();

    const trail = (await trailOf('clue.pool-reassigned', clueId)).filter(
      (row) => row.outcome === 'succeeded',
    );
    expect(trail).toHaveLength(1);
    expect(trail[0]?.detail).toContain(stationId);
    expect(trail[0]?.detail).toContain(deptBId);

    // 不构成指定管辖锁：接收机构（乙区内勤）可直接派机构。
    const dispatched = await assignOrg(clueId, { orgUnitId: deptBId }, 'P-INTAKE-B');
    expect(dispatched.status).toBe(200);
  });

  it('待分派决定与不派也可重新指定；已派出的线索 409 invalid-state', async () => {
    const stationId = await addStation(deptAId);
    await seedPerson('P-216-ST-Y', '停用所内勤乙', stationId, ['内勤'], '13900003011');
    await cookieOf('P-216-ST-Y', INITIAL_PASSWORD);
    const base = { code: 'P-216-ST-Y' };
    const first = await register({ polygon: geojsonPolygon(square(71)), ...base });
    const second = await register({ polygon: geojsonPolygon(square(71)), ...base });
    expect(second.body.status).toBe('pending_decision');
    // 决定步只对有命中的线索开放（待分派决定），故第三条也登记在同一位置以产生命中。
    const third = await register({ polygon: geojsonPolygon(square(71)), ...base });
    expect(third.body.status).toBe('pending_decision');
    const held = await decide(third.body.id ?? '', { decision: 'hold' }, 'P-216-ST-Y');
    expect(held.status).toBe(200);
    // 第四条：派出后停用，验证已派出的不能重新指定。
    const fourth = await register({ polygon: geojsonPolygon(square(73)), ...base });
    // 先派出（目标限本所数据范围），再停用：验证已派出的线索不能重新指定。
    await assignOrg(fourth.body.id ?? '', { orgUnitId: stationId }, 'P-216-ST-Y');
    await cloned.prisma.orgUnit.update({
      where: { id: stationId },
      data: { deactivatedAt: new Date(T0) },
    });

    const pendingId = second.body.id ?? '';
    const heldId = third.body.id ?? '';
    const assignedId = fourth.body.id ?? '';

    for (const clueId of [first.body.id ?? '', pendingId, heldId]) {
      const outcome = await poolReassign(clueId, {
        orgUnitId: deptBId,
        expectedStatus:
          clueId === pendingId ? 'pending_decision' : clueId === heldId ? 'held' : 'in_pool',
      });
      expect(outcome.status).toBe(200);
    }

    const assignedOutcome = await poolReassign(assignedId, {
      orgUnitId: deptAId,
      expectedStatus: 'org_assigned',
    });
    expect(assignedOutcome.status).toBe(409);
    expect(assignedOutcome.body).toEqual({ result: 'invalid-state', reason: 'invalid-state' });
    const failed = (await trailOf('clue.pool-reassigned', assignedId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('invalid-state');
  });

  it('非系统管理员 403：authz.denied 留痕＋业务行不变', async () => {
    const stationId = await addStation(deptAId);
    await seedPerson('P-216-ST-Z', '停用所内勤丙', stationId, ['内勤'], '13900003012');
    await cookieOf('P-216-ST-Z', INITIAL_PASSWORD);
    const registered = await register({ polygon: geojsonPolygon(square(74)), code: 'P-216-ST-Z' });
    const clueId = registered.body.id ?? '';
    await cloned.prisma.orgUnit.update({
      where: { id: stationId },
      data: { deactivatedAt: new Date(T0) },
    });

    const outcome = await poolReassign(clueId, { orgUnitId: deptBId }, 'P-INTAKE-A');
    expect(outcome.status).toBe(403);
    expect(outcome.body.reason).toBe('permission-denied');
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.enteredOrgId).toBe(stationId);
    expect(
      await cloned.prisma.clueAssignment.count({ where: { clueId, kind: 'pool-reassign' } }),
    ).toBe(0);
    const deniedTrail = await cloned.prisma.$queryRaw<TrailRow[]>`
      SELECT action, outcome, reason FROM audit_trail
      WHERE action = 'authz.denied' AND resource_id = ${clueId} AND opcode = 'clue.pool.reassign'
    `;
    expect(deniedTrail).toHaveLength(1);
  });

  it('理由必填：400 missing-reassign-reason＋失败留痕＋业务行不变', async () => {
    const stationId = await addStation(deptAId);
    await seedPerson('P-216-ST-W', '停用所内勤丁', stationId, ['内勤'], '13900003013');
    await cookieOf('P-216-ST-W', INITIAL_PASSWORD);
    const registered = await register({ polygon: geojsonPolygon(square(75)), code: 'P-216-ST-W' });
    const clueId = registered.body.id ?? '';
    await cloned.prisma.orgUnit.update({
      where: { id: stationId },
      data: { deactivatedAt: new Date(T0) },
    });

    const outcome = await poolReassign(clueId, { orgUnitId: deptBId, reason: '  ' });
    expect(outcome.status).toBe(400);
    expect(outcome.body).toEqual({ result: 'non-compliant', rules: ['missing-reassign-reason'] });
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.enteredOrgId).toBe(stationId);
    const failed = (await trailOf('clue.pool-reassigned', clueId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('missing-reassign-reason');
  });

  it('目标机构已停用：409 org-unit-deactivated＋失败留痕', async () => {
    const stationId = await addStation(deptAId);
    const deadTargetId = await addStation(deptAId, true);
    await seedPerson('P-216-ST-V', '停用所内勤戊', stationId, ['内勤'], '13900003014');
    await cookieOf('P-216-ST-V', INITIAL_PASSWORD);
    const registered = await register({ polygon: geojsonPolygon(square(76)), code: 'P-216-ST-V' });
    const clueId = registered.body.id ?? '';
    await cloned.prisma.orgUnit.update({
      where: { id: stationId },
      data: { deactivatedAt: new Date(T0) },
    });

    const outcome = await poolReassign(clueId, { orgUnitId: deadTargetId });
    expect(outcome.status).toBe(409);
    expect(outcome.body).toEqual({ result: 'invalid-state', reason: 'org-unit-deactivated' });
    const failed = (await trailOf('clue.pool-reassigned', clueId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('org-unit-deactivated');
  });

  it('池机构未停用：409 org-unit-not-deactivated＋失败留痕', async () => {
    const registered = await register({ polygon: geojsonPolygon(square(77)) });
    const clueId = registered.body.id ?? '';

    const outcome = await poolReassign(clueId, { orgUnitId: deptBId });
    expect(outcome.status).toBe(409);
    expect(outcome.body).toEqual({ result: 'invalid-state', reason: 'org-unit-not-deactivated' });
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.enteredOrgId).toBe(deptAId);
    const failed = (await trailOf('clue.pool-reassigned', clueId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('org-unit-not-deactivated');
  });

  it('管理端池线索清单：停用机构可查；未停用机构与非系统管理员被拒', async () => {
    const stationId = await addStation(deptAId);
    await seedPerson('P-216-ST-T', '停用所内勤庚', stationId, ['内勤'], '13900003016');
    await cookieOf('P-216-ST-T', INITIAL_PASSWORD);
    const registered = await register({ polygon: geojsonPolygon(square(79)), code: 'P-216-ST-T' });
    const clueId = registered.body.id ?? '';
    // 池机构未停用：409。
    const activeList = await fetch(`${baseUrl}/api/admin/org-units/${stationId}/pool-clues`, {
      headers: { cookie: await cookieOf('P-ADMIN-HQ') },
    });
    expect(activeList.status).toBe(409);
    expect(await activeList.json()).toEqual({
      result: 'invalid-state',
      reason: 'org-unit-not-deactivated',
    });

    await cloned.prisma.orgUnit.update({
      where: { id: stationId },
      data: { deactivatedAt: new Date(T0) },
    });
    // 非系统管理员：403。
    const deniedList = await fetch(`${baseUrl}/api/admin/org-units/${stationId}/pool-clues`, {
      headers: { cookie: await cookieOf('P-INTAKE-A') },
    });
    expect(deniedList.status).toBe(403);

    const list = await fetch(`${baseUrl}/api/admin/org-units/${stationId}/pool-clues`, {
      headers: { cookie: await cookieOf('P-ADMIN-HQ') },
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      result: string;
      orgUnitId: string;
      clues: readonly { clueId: string; code: string; status: string }[];
    };
    expect(body.result).toBe('pool-clues');
    expect(body.orgUnitId).toBe(stationId);
    expect(body.clues.map((clue) => clue.clueId)).toContain(clueId);
    expect(body.clues.find((clue) => clue.clueId === clueId)?.status).toBe('in_pool');
  });

  it('expectedStatus 不符：409 concurrent-change＋失败留痕＋业务行不变', async () => {
    const stationId = await addStation(deptAId);
    await seedPerson('P-216-ST-U', '停用所内勤己', stationId, ['内勤'], '13900003015');
    await cookieOf('P-216-ST-U', INITIAL_PASSWORD);
    const registered = await register({ polygon: geojsonPolygon(square(78)), code: 'P-216-ST-U' });
    const clueId = registered.body.id ?? '';
    await cloned.prisma.orgUnit.update({
      where: { id: stationId },
      data: { deactivatedAt: new Date(T0) },
    });

    const outcome = await poolReassign(clueId, { orgUnitId: deptBId, expectedStatus: 'held' });
    expect(outcome.status).toBe(409);
    expect(outcome.body).toEqual({ result: 'concurrent-change', reason: 'concurrent-change' });
    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.enteredOrgId).toBe(stationId);
    const failed = (await trailOf('clue.pool-reassigned', clueId)).filter(
      (row) => row.outcome === 'failed',
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]?.reason).toBe('concurrent-change');
  });
});
