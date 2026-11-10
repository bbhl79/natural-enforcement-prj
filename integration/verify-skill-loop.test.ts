// Verification Skill 第一条 API 环：读 scenario → 克隆库 HTTP → 评 oracle → 写 e2e/results/verify-*。
// 本轮必绿：01/02/03 happy + 各自 punch 负例。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import {
  runApiScenario,
  runApiScenarios,
} from '../e2e/verify/harness/run-api-scenario.ts';
import { EvidenceWriter, newRunId } from '../e2e/verify/harness/evidence.ts';
import { SessionCache } from '../e2e/verify/harness/session.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-17T03:00:00.000Z');
const SEED_PASSWORD = process.env.VERIFY_PASSWORD_SEED || 'Seed-pass-52';
const ADMIN_NEW_PASSWORD = 'Verify-loop-admin-52!';

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

/** 记录投递的假队列端口：核查停在「进行中」，轮询可稳定观测 running。 */
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
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
let sessions: SessionCache;
const queue = new RecordingQueue();
const adminCookies = new Map<string, string>();

function sessionCookie(response: Response): string {
  const found = response.headers.getSetCookie().find((item) => item.startsWith('__Host-sid='));
  const pair = found?.split(';')[0];
  if (!pair) throw new Error('缺少会话 Cookie');
  return pair;
}

/** 系统管理员会话（种子 P-ADMIN-HQ；首登强制改密）。 */
async function adminCookie(): Promise<string> {
  const known = adminCookies.get('P-ADMIN-HQ');
  if (known) return known;
  const person = await cloned.prisma.personnel.findUnique({ where: { code: 'P-ADMIN-HQ' } });
  if (!person?.mobilePhone) throw new Error('缺少种子人员 P-ADMIN-HQ');
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mobilePhone: person.mobilePhone,
      password: SEED_PASSWORD,
      rememberMe: false,
    }),
  });
  expect(login.status).toBe(200);
  const cookie = sessionCookie(login);
  const changed = await fetch(`${baseUrl}/api/auth/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ currentPassword: SEED_PASSWORD, newPassword: ADMIN_NEW_PASSWORD }),
  });
  expect(changed.status).toBe(200);
  adminCookies.set('P-ADMIN-HQ', cookie);
  return cookie;
}

/** 以系统管理员身份种入分派链所需人员；初始口令与 Skill 会话默认一致。 */
async function seedPerson(
  code: string,
  name: string,
  orgUnitId: string,
  roles: readonly string[],
  mobilePhone: string,
): Promise<void> {
  const response = await fetch(`${baseUrl}/api/admin/personnel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: await adminCookie() },
    body: JSON.stringify({
      code,
      name,
      orgUnitId,
      mobilePhone,
      initialPassword: SEED_PASSWORD,
      roles: [...roles],
    }),
  });
  expect(response.status, `${code} 种入失败`).toBe(200);
}

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(T0) },
    undefined,
    { storagePort: new RecordingStorage(), queuePort: queue },
  );
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();
  sessions = new SessionCache(baseUrl);

  const orgOf = async (code: string): Promise<string> => {
    const org = await cloned.prisma.orgUnit.findUnique({ where: { code } });
    if (!org) throw new Error(`缺少种子机构 ${code}`);
    return org.id;
  };
  const deptAId = await orgOf('ORG-DEPT-A');
  const stationAId = await orgOf('ORG-STATION-A');
  await seedPerson('P-INTAKE-A', '甲区内勤', deptAId, ['内勤'], '13900002001');
  await seedPerson('P-INTAKE-ST', '甲所内勤', stationAId, ['内勤'], '13900002003');
  await seedPerson('P-HANDLER-ST1', '甲所主办甲', stationAId, ['经办'], '13900002004');
}, 60_000);

afterAll(async () => {
  await closeApp();
  await cloned?.close();
});

describe('e2e/verify API 环', () => {
  it('happy 01：vf-sc-verify-loop-survey-register 变绿并写证据包', async () => {
    const runId = newRunId();
    const writer = new EvidenceWriter(runId, ['vf-sc-verify-loop-survey-register']);
    await writer.init();
    const result = await runApiScenario(
      { baseUrl, sessions },
      'vf-sc-verify-loop-survey-register',
      writer,
    );
    const summary = await writer.finish(result.pass ? 'passed' : 'failed');
    expect(result.pass, JSON.stringify(summary)).toBe(true);
    expect(summary.status).toBe('passed');
    expect(result.observation?.http.status).toBeGreaterThanOrEqual(200);
  });

  it('happy 02：vf-sc-verify-loop-land-register 变绿并写证据包', async () => {
    const runId = newRunId();
    const writer = new EvidenceWriter(runId, ['vf-sc-verify-loop-land-register']);
    await writer.init();
    const result = await runApiScenario(
      { baseUrl, sessions },
      'vf-sc-verify-loop-land-register',
      writer,
    );
    const summary = await writer.finish(result.pass ? 'passed' : 'failed');
    expect(result.pass, JSON.stringify(summary)).toBe(true);
    expect(summary.status).toBe('passed');
    expect(result.observation?.http.status).toBeGreaterThanOrEqual(200);
  });

  it('happy 03：vf-sc-verify-loop-land-verify-dispatch 核查轮询与两步分派变绿', async () => {
    const runId = newRunId();
    const writer = new EvidenceWriter(runId, ['vf-sc-verify-loop-land-verify-dispatch']);
    await writer.init();
    const result = await runApiScenario(
      { baseUrl, sessions },
      'vf-sc-verify-loop-land-verify-dispatch',
      writer,
    );
    const summary = await writer.finish(result.pass ? 'passed' : 'failed');
    expect(result.pass, JSON.stringify(summary)).toBe(true);
    expect(summary.status).toBe('passed');
    expect(result.observation?.http.status).toBe(200);
    expect(result.observation?.body.status).toBe('handler_assigned');
  });

  it('punch 01：vf-sc-neg-type-unconfirmed 正确拒绝算绿', async () => {
    const summary = await runApiScenarios(
      { baseUrl, sessions },
      ['vf-sc-neg-type-unconfirmed'],
    );
    expect(summary.status, JSON.stringify(summary)).toBe('passed');
    expect(summary.failed).toEqual([]);
  });

  it('punch 02：vf-sc-neg-missing-narrative 正确拒绝算绿', async () => {
    const summary = await runApiScenarios(
      { baseUrl, sessions },
      ['vf-sc-neg-missing-narrative'],
    );
    expect(summary.status, JSON.stringify(summary)).toBe('passed');
    expect(summary.failed).toEqual([]);
  });
});
