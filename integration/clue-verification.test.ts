// #213 内业核查编排接口。
// 断言打在克隆库上：自动入队的投递参数、确定性失败与瞬时失败的不同处置、
// 手动重跑的权限与并发、产物落位与下载鉴权。
// 队列与核查执行端口都用注入替身：接缝是队列接口与内业核查执行端口。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import { ClueVerificationService } from '../backend/server/src/clue-verification.service.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

// 集成层不引业务模块的深路径（结构规则 module-public-entry）：替身的形状就地声明，
// 注入点由 TypeScript 按结构校验，与真实端口对不上即编译不过。

/** 一个相交要素的事实。 */
interface VerificationFeature {
  readonly featureId: string;
  readonly geometry: string;
  readonly intersection: string;
  readonly featureArea: number;
  readonly overlapArea: number;
}

/** 一层的核查事实。 */
interface VerificationLayerResult {
  readonly layerKey: string;
  readonly layerName: string;
  readonly state: 'overlapped' | 'no_overlap' | 'unavailable';
  readonly serviceUrl: string | null;
  readonly queriedAt: string | null;
  readonly unavailableReason: string | null;
  readonly features: readonly VerificationFeature[];
}

/** 一次核查的结果。 */
interface VerificationOutcome {
  readonly layers: readonly VerificationLayerResult[];
}

/** 核查的入参。 */
interface VerificationRequest {
  readonly clueId: string;
  readonly domain: string;
  readonly spatialVersion: string;
  readonly totalArea: number;
  readonly parts: readonly { readonly partId: string; readonly partIndex: number; readonly geojson: string }[];
}

/** 内业核查执行端口（替身）。 */
interface ClueVerificationPort {
  run(request: VerificationRequest): Promise<VerificationOutcome>;
}

/** 投递参数。 */
interface EnqueueOptions {
  readonly attempts?: number;
  readonly backoff?: { readonly type: 'fixed' | 'exponential'; readonly delay: number };
}

/** 队列端口（替身）。 */
interface QueuePort {
  enqueue(jobName: string, payload: unknown, options?: EnqueueOptions): Promise<{ id: string }>;
  waitForCompletion(ref: { id: string }, timeoutMs: number): Promise<unknown>;
  close(): Promise<void>;
}

const T0 = Date.parse('2026-10-17T03:00:00.000Z');
const SEED_PASSWORD = 'Seed-pass-52';
const NEW_PASSWORD = 'Clue-verify-213!';

const SQUARE = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [113, 23],
      [113.1, 23],
      [113.1, 23.1],
      [113, 23.1],
      [113, 23],
    ],
  ],
});

function geojsonPolygon(ring: readonly (readonly number[])[]): string {
  return JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} });
}

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

/** 记录写的假存储端口。 */
class RecordingStorage {
  readonly writes: { fileKey: string; byteSize: number }[] = [];
  private readonly contents = new Map<string, Uint8Array>();

  async putVersion(fileKey: string, content: Uint8Array): Promise<{ fileKey: string; versionId: string }> {
    this.writes.push({ fileKey, byteSize: content.byteLength });
    this.contents.set(fileKey, content);
    return { fileKey, versionId: `version-${this.writes.length}` };
  }

  async readVersion(ref: { fileKey: string }): Promise<Uint8Array> {
    return this.contents.get(ref.fileKey) ?? new Uint8Array(0);
  }
}

/** 记录投递的假队列端口。 */
class RecordingQueue implements QueuePort {
  readonly enqueued: {
    readonly jobName: string;
    readonly payload: unknown;
    readonly options?: EnqueueOptions;
  }[] = [];

  async enqueue(jobName: string, payload: unknown, options?: EnqueueOptions) {
    this.enqueued.push({ jobName, payload, options });
    return { id: `job-${this.enqueued.length}` };
  }

  async waitForCompletion() {
    return null;
  }

  async close() {}
}

/** 可编排的核查执行端口替身。 */
class ScriptedVerificationPort implements ClueVerificationPort {
  mode: 'success' | 'unavailable' | 'transient' = 'success';
  calls = 0;
  /** 最近一次核查的线索编号。 */
  lastClueId = '';

  async run(request: VerificationRequest): Promise<VerificationOutcome> {
    this.calls += 1;
    this.lastClueId = request.clueId;
    if (this.mode === 'transient') throw new Error('瞬时故障');
    if (this.mode === 'unavailable') {
      return {
        layers: [
          {
            layerKey: 'permanent-farmland',
            layerName: '永久基本农田',
            state: 'unavailable',
            serviceUrl: null,
            queriedAt: null,
            unavailableReason: 'service-not-configured',
            features: [],
          },
        ],
      };
    }
    return {
      layers: [
        {
          layerKey: 'permanent-farmland',
          layerName: '永久基本农田',
          state: 'overlapped',
          serviceUrl: 'https://layers.example/permanent-farmland',
          queriedAt: '2026-10-25T01:00:00.000Z',
          unavailableReason: null,
          features: [
            {
              featureId: 'f-1',
              geometry: SQUARE,
              intersection: SQUARE,
              featureArea: 400,
              overlapArea: 250,
            },
          ],
        },
      ],
    };
  }
}

let cloned: ClonedDatabase;
const storage = new RecordingStorage();
const queue = new RecordingQueue();
const port = new ScriptedVerificationPort();
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
let verification: ClueVerificationService;
const cookies = new Map<string, string>();

function sessionCookie(response: Response): string {
  const found = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='));
  const pair = found?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

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

const BASE_VALUES = {
  'clue.received_at': '2026-10-25',
  'clue.narrative': '巡查发现一处硬化地面',
  'clue.finder': '巡查员甲',
  'clue.patrol_no': 'XC-2026-001',
};

/** 方斑序号：逐次递增，各条线索互不重叠。 */
let squareCounter = 0;
function nextOffset(): number {
  squareCounter += 1;
  return squareCounter;
}

interface RegisterBody {
  readonly result: string;
  readonly id?: string;
  readonly code?: string;
}

async function register(options: {
  readonly domain?: string;
  readonly polygon?: string | null;
  readonly code?: string;
}): Promise<{ status: number; body: RegisterBody }> {
  const form = new FormData();
  form.set('sourceCode', '16');
  form.set('domain', options.domain ?? 'land');
  form.set('values', JSON.stringify(BASE_VALUES));
  if (options.polygon !== null) {
    // 每条线索换一个方斑，免得互相撞成疑似重复。
    form.set(
      'spatial-source',
      new Blob([options.polygon ?? geojsonPolygon(square(nextOffset()))], { type: 'application/geo+json' }),
      'area.geojson',
    );
  }
  const response = await fetch(`${baseUrl}/api/clues`, {
    method: 'POST',
    headers: {
      cookie: await cookieOf(options.code ?? 'P-CLERK-A'),
      'idempotency-key': `key-${Math.random().toString(36).slice(2)}`,
    },
    body: form,
  });
  return { status: response.status, body: (await response.json()) as RegisterBody };
}

interface VerificationView {
  readonly result: string;
  readonly required: boolean;
  readonly verificationStatus: string;
  readonly verificationStatusLabel: string;
  readonly canRetry: boolean;
  readonly retryBlockedReason: string | null;
  readonly current: { readonly runNo: number; readonly status: string; readonly attemptsUsed: number } | null;
  readonly runs: readonly { readonly runNo: number; readonly status: string; readonly attemptsUsed: number }[];
  readonly layers?: readonly { readonly layerKey: string; readonly state: string }[];
}

async function readVerification(clueId: string, code = 'P-CLERK-A') {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/verification`, {
    headers: { cookie: await cookieOf(code) },
  });
  return { status: response.status, body: (await response.json()) as VerificationView };
}

async function retryVerification(clueId: string, code = 'P-CLERK-A') {
  const response = await fetch(`${baseUrl}/api/clues/${clueId}/verification/retry`, {
    method: 'POST',
    headers: { cookie: await cookieOf(code) },
  });
  return { status: response.status, body: (await response.json()) as VerificationView };
}

interface TrailRow {
  readonly action: string;
  readonly outcome: string;
  readonly reason: string | null;
}

async function trailOf(action: string, resourceId?: string): Promise<TrailRow[]> {
  if (resourceId === undefined) {
    return cloned.prisma.$queryRaw<TrailRow[]>`
      SELECT action, outcome, reason FROM audit_trail
      WHERE action = ${action} ORDER BY created_at DESC, id DESC LIMIT 5
    `;
  }
  return cloned.prisma.$queryRaw<TrailRow[]>`
    SELECT action, outcome, reason FROM audit_trail
    WHERE action = ${action} AND resource_id = ${resourceId}
  `;
}

interface RunRow {
  readonly id: string;
  readonly run_no: number;
  readonly status: string;
  readonly attempts_used: number;
  readonly trigger: string;
  readonly failure_category: string | null;
  readonly missing_layers: string | null;
  readonly artifacts_json: string | null;
}

async function runsOf(clueId: string): Promise<RunRow[]> {
  return cloned.prisma.$queryRaw<RunRow[]>`
    SELECT id, run_no, status, attempts_used, trigger, failure_category, missing_layers, artifacts_json
    FROM clue_verification_run WHERE clue_id = ${clueId} ORDER BY run_no
  `;
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(T0) },
    undefined,
    { storagePort: storage, queuePort: queue, clueVerificationPort: port },
  );
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  verification = app.get(ClueVerificationService);
  closeApp = () => app.close();
}, 60_000);

afterAll(async () => {
  await closeApp();
  await cloned?.close();
});

beforeEach(() => {
  queue.enqueued.length = 0;
  storage.writes.length = 0;
  port.mode = 'success';
  port.calls = 0;
});

describe('#213 内业核查编排', () => {
  it('USER-LOCK-L2 土地类线索登记保存成功后自动入队：总尝试次数 4，重试延迟 30／60／120 秒', async () => {
    const result = await register({});
    expect(result.status).toBe(201);
    const clueId = result.body.id ?? '';

    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0]?.jobName).toBe('clue.verification');
    expect(queue.enqueued[0]?.options?.attempts).toBe(4);
    expect(queue.enqueued[0]?.options?.backoff).toEqual({ type: 'exponential', delay: 30_000 });

    const runs = await runsOf(clueId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('running');
    expect(runs[0]?.trigger).toBe('auto');

    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.verificationStatus).toBe('running');
  });

  it('测绘类线索不投递核查任务，核查状态是「不设内业核查」', async () => {
    const point = JSON.stringify({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [113.05, 23.05] },
      properties: {},
    });
    const result = await register({ domain: 'survey', polygon: point });
    expect(result.status).toBe(201);

    expect(queue.enqueued).toHaveLength(0);
    const view = await readVerification(result.body.id ?? '');
    expect(view.status).toBe(200);
    expect(view.body.required).toBe(false);
    expect(view.body.verificationStatus).toBe('not_required');
    expect(view.body.verificationStatusLabel).toBe('不设内业核查');
  });

  it('核查跑成：报告与分析图落位，状态完成，产物可下载且不回缓存', async () => {
    const result = await register({});
    const clueId = result.body.id ?? '';
    const payload = queue.enqueued[0]?.payload as { runId: string; clueId: string };

    await verification.execute(payload, 1);

    const runs = await runsOf(clueId);
    expect(runs[0]?.status).toBe('done');
    expect(runs[0]?.attempts_used).toBe(1);
    expect(runs[0]?.failure_category).toBeNull();
    expect(runs[0]?.artifacts_json).toContain('report');

    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.verificationStatus).toBe('done');

    const view = await readVerification(clueId);
    expect(view.body.verificationStatus).toBe('done');
    expect(view.body.verificationStatusLabel).toBe('已完成');

    const report = await fetch(`${baseUrl}/api/clues/${clueId}/verification/report`, {
      headers: { cookie: await cookieOf('P-CLERK-A') },
    });
    expect(report.status).toBe(200);
    expect(report.headers.get('cache-control')).toBe('no-store');
    expect(report.headers.get('x-content-type-options')).toBe('nosniff');
    const reportBody = (await report.json()) as {
      readonly layers: readonly { readonly layerKey: string; readonly state: string; readonly overlapArea: number }[];
    };
    expect(reportBody.layers[0]?.layerKey).toBe('permanent-farmland');
    expect(reportBody.layers[0]?.state).toBe('overlapped');
    expect(reportBody.layers[0]?.overlapArea).toBe(250);

    const analysis = await fetch(`${baseUrl}/api/clues/${clueId}/verification/analysis`, {
      headers: { cookie: await cookieOf('P-CLERK-A') },
    });
    expect(analysis.status).toBe(200);
    const analysisBody = (await analysis.json()) as { readonly features: readonly unknown[] };
    expect(analysisBody.features.length).toBeGreaterThan(0);
  });

  it('确定性失败：不重试、当次没跑成、缺图层落位，不生成成功报告', async () => {
    port.mode = 'unavailable';
    const result = await register({});
    const clueId = result.body.id ?? '';
    const payload = queue.enqueued[0]?.payload as { runId: string; clueId: string };

    const failure = await verification.execute(payload, 1).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).name).toBe('NonRetryableError');
    const runs = await runsOf(clueId);
    expect(runs[0]?.status).toBe('failed');
    expect(runs[0]?.failure_category).toBe('deterministic');
    expect(runs[0]?.missing_layers).toContain('permanent-farmland');
    expect(runs[0]?.artifacts_json).toBeNull();

    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.verificationStatus).toBe('failed');
    expect(storage.writes.filter((write) => write.fileKey.includes('report.json'))).toHaveLength(0);
  });

  it('瞬时失败：自动重试至多 3 次，共 4 次尝试后判没跑成，提示仍在', async () => {
    port.mode = 'transient';
    const result = await register({});
    const clueId = result.body.id ?? '';
    const payload = queue.enqueued[0]?.payload as { runId: string; clueId: string };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await verification.execute(payload, attempt).catch(() => undefined);
    }
    let runs = await runsOf(clueId);
    expect(runs[0]?.status).toBe('running');

    await verification.execute(payload, 4).catch(() => undefined);
    runs = await runsOf(clueId);
    expect(runs[0]?.status).toBe('failed');
    expect(runs[0]?.attempts_used).toBe(4);
    expect(runs[0]?.failure_category).toBe('transient');

    const view = await readVerification(clueId);
    expect(view.body.verificationStatus).toBe('failed');
    expect(view.body.canRetry).toBe(true);
  });

  it('手动重跑：投递 attempts=1 的任务，只执行 1 次；成功即完成', async () => {
    const result = await register({});
    const clueId = result.body.id ?? '';
    const first = queue.enqueued[0]?.payload as { runId: string; clueId: string };
    await verification.execute(first, 1);
    queue.enqueued.length = 0;

    const retried = await retryVerification(clueId);
    expect(retried.status).toBe(200);
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0]?.options?.attempts).toBe(1);

    const payload = queue.enqueued[0]?.payload as { runId: string; clueId: string };
    await verification.execute(payload, 1);

    const runs = await runsOf(clueId);
    expect(runs).toHaveLength(2);
    expect(runs[1]?.run_no).toBe(2);
    expect(runs[1]?.trigger).toBe('manual');
    expect(runs[1]?.status).toBe('done');
    expect(runs[1]?.attempts_used).toBe(1);

    const trail = await trailOf('clue.verify-retried', clueId);
    expect(trail).toHaveLength(1);
    expect(trail[0]?.outcome).toBe('succeeded');
  });

  it('手动重跑失败：即判没跑成，提示继续挂着，可再次手动重跑', async () => {
    port.mode = 'unavailable';
    const result = await register({});
    const clueId = result.body.id ?? '';
    const payload = queue.enqueued[0]?.payload as { runId: string; clueId: string };
    await verification.execute(payload, 1).catch(() => undefined);

    const view = await readVerification(clueId);
    expect(view.body.verificationStatus).toBe('failed');
    expect(view.body.canRetry).toBe(true);
    expect(view.body.retryBlockedReason).toBeNull();
  });

  it('监督重跑被拒：403 并留失败痕，业务行不变', async () => {
    const result = await register({});
    const clueId = result.body.id ?? '';
    const before = await runsOf(clueId);

    const denied = await retryVerification(clueId, 'P-SUPER-HQ');
    expect(denied.status).toBe(403);

    const after = await runsOf(clueId);
    expect(after).toHaveLength(before.length);
    const trail = await trailOf('authz.denied', clueId);
    expect(trail.length).toBeGreaterThan(0);
    expect(trail[0]?.outcome).toBe('failed');
  });

  it('本单位之外的内勤重跑被拒：403', async () => {
    const result = await register({});
    const clueId = result.body.id ?? '';

    const denied = await retryVerification(clueId, 'P-INTAKE-HQ');
    expect(denied.status).toBe(403);
    expect((await runsOf(clueId)).length).toBe(1);
  });

  it('并发手动重跑：409，且不新增运行行', async () => {
    const result = await register({});
    const clueId = result.body.id ?? '';
    const before = await runsOf(clueId);

    const conflict = await retryVerification(clueId);
    expect(conflict.status).toBe(409);
    expect((conflict.body as unknown as { result: string }).result).toBe('concurrent-change');

    const after = await runsOf(clueId);
    expect(after).toHaveLength(before.length);
  });

  it('终态线索不允许再手动重跑：409', async () => {
    const result = await register({});
    const clueId = result.body.id ?? '';
    await cloned.prisma.clue.update({ where: { id: clueId }, data: { status: 'closed' } });

    const refused = await retryVerification(clueId);
    expect(refused.status).toBe(409);
    expect((refused.body as unknown as { result: string }).result).toBe('invalid-state');
  });

  it('核查没跑成不拦分派：线索主状态照常可读可派', async () => {
    port.mode = 'unavailable';
    const result = await register({});
    const clueId = result.body.id ?? '';
    const payload = queue.enqueued[0]?.payload as { runId: string; clueId: string };
    await verification.execute(payload, 1).catch(() => undefined);

    const clue = await cloned.prisma.clue.findUnique({ where: { id: clueId } });
    expect(clue?.status).toBe('in_pool');
    const view = await readVerification(clueId);
    expect(view.status).toBe(200);
    expect(view.body.verificationStatus).toBe('failed');
  });
});
