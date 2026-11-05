// Verification Skill 第一条 API 环：读 scenario → 克隆库 HTTP → 评 oracle → 写 .run/verify-*。
// 本轮必绿：01/02 happy + 各自 punch 负例。
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../backend/server/src/persistence.module.ts';
import {
  runApiScenario,
  runApiScenarios,
} from '../.cursor/skills/verify-natural-enforcement/harness/run-api-scenario.ts';
import { EvidenceWriter, newRunId } from '../.cursor/skills/verify-natural-enforcement/harness/evidence.ts';
import { SessionCache } from '../.cursor/skills/verify-natural-enforcement/harness/session.ts';
import { openClonedDatabase, type ClonedDatabase } from './cloned-database.ts';

const T0 = Date.parse('2026-10-17T03:00:00.000Z');

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
let baseUrl = '';
let closeApp: () => Promise<void> = async () => {};
let sessions: SessionCache;

beforeAll(async () => {
  cloned = await openClonedDatabase();
  const app = await createApplication(
    cloned.connectionString,
    { now: () => new Date(T0) },
    undefined,
    { storagePort: new RecordingStorage() },
  );
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeApp = () => app.close();
  sessions = new SessionCache(baseUrl);
}, 60_000);

afterAll(async () => {
  await closeApp();
  await cloned?.close();
});

describe('verify-natural-enforcement API 环', () => {
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
