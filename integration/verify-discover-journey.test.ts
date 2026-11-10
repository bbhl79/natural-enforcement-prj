// 单旅程登记与收口。不连业务栈。不把第 5 节未评估写成通过。
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EvidenceWriter } from '../.cursor/skills/verify-natural-enforcement/harness/evidence.ts';
import { loadCoverageAcks } from '../.cursor/skills/verify-natural-enforcement/harness/load-coverage-acks.ts';
import { loadScenario } from '../.cursor/skills/verify-natural-enforcement/harness/load-fixtures.ts';
import {
  IndexDiskForkError,
  loadScenarioRegister,
} from '../.cursor/skills/verify-natural-enforcement/harness/load-scenario-register.ts';
import { runDiscoverClose } from '../.cursor/skills/verify-natural-enforcement/harness/run-discover.ts';

const roots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function writeFixture(root: string, rel: string, body: unknown): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
}

describe('登记加载：index 分叉与 latent 未验证', () => {
  it('当前仓库 index 与磁盘一致，latent 为未验证且不进入 runnable', async () => {
    const register = await loadScenarioRegister(process.cwd());
    expect(register.runnableIds).toContain('vf-sc-next-todo-buttons');
    expect(register.runnableIds).toContain('vf-sc-verify-loop-ui-full-register-click-write');
    expect(register.latent.length).toBeGreaterThan(0);
    expect(register.latent.every((item) => item.evaluation === 'unverified')).toBe(true);
    const latentIds = new Set(register.latent.map((item) => item.scenarioId));
    expect(register.runnableIds.some((id) => latentIds.has(id))).toBe(false);
  });

  it('磁盘多出的 runnable 抛 index-disk-fork，不静默忽略', async () => {
    const root = await tempRoot('discover-fork-');
    const base = '.cursor/skills/verify-natural-enforcement/fixtures';
    await writeFixture(root, `${base}/scenarios/index.json`, {
      runnable: ['vf-sc-listed'],
      latent: [],
      negatives: [],
    });
    await writeFixture(root, `${base}/scenarios/runnable/vf-sc-listed.json`, {
      id: 'vf-sc-listed',
      status: 'runnable',
    });
    await writeFixture(root, `${base}/scenarios/runnable/vf-sc-extra.json`, {
      id: 'vf-sc-extra',
      status: 'runnable',
    });
    await expect(loadScenarioRegister(root)).rejects.toBeInstanceOf(IndexDiskForkError);
  });

  it('latent 文件 status 不是 latent 时拒绝提拔', async () => {
    const root = await tempRoot('discover-promote-');
    const base = '.cursor/skills/verify-natural-enforcement/fixtures';
    await writeFixture(root, `${base}/scenarios/index.json`, {
      runnable: [],
      latent: ['vf-sc-latent-sample'],
      negatives: [],
    });
    await writeFixture(root, `${base}/scenarios/latent/vf-sc-latent-sample.json`, {
      id: 'vf-sc-latent-sample',
      status: 'runnable',
    });
    await expect(loadScenarioRegister(root)).rejects.toThrow(/拒绝提拔/);
  });

  it('loadScenario 能读到 latent，且不改磁盘 status', async () => {
    const loaded = await loadScenario('vf-sc-latent-close');
    expect(loaded.status).toBe('latent');
    const file = path.join(
      process.cwd(),
      '.cursor/skills/verify-natural-enforcement/fixtures/scenarios/latent/vf-sc-latent-close.json',
    );
    const onDisk = JSON.parse(await fs.readFile(file, 'utf8')) as { status: string };
    expect(onDisk.status).toBe('latent');
  });
});

describe('coverage-acks 形状与未评估收口', () => {
  it('真实清单是 { acks: [] }；裸数组明确失败', async () => {
    await expect(loadCoverageAcks(process.cwd())).resolves.toEqual([]);
    const root = await tempRoot('discover-acks-');
    await writeFixture(
      root,
      '.cursor/skills/verify-natural-enforcement/fixtures/coverage-acks.json',
      [],
    );
    await expect(loadCoverageAcks(root)).rejects.toThrow(/形状错误/);
  });

  it('未验证步骤不把跑次打成产品失败', async () => {
    const writer = new EvidenceWriter(`journey-unit-${Date.now()}`, ['vf-sc-latent-close']);
    await writer.init();
    await writer.writeStep({
      scenarioId: 'vf-sc-latent-close',
      stepId: 'skip',
      pass: false,
      expected: { status: 'runnable' },
      actual: { status: 'latent', evaluation: 'unverified' },
      evidence: [],
    });
    const summary = await writer.finish('passed');
    expect(summary.status).toBe('passed');
    expect(summary.failed).toEqual([]);
    expect(summary.uncovered[0]?.kind).toBe('latent-skipped');
    await fs.rm(writer.runDir, { recursive: true, force: true });
  });

  it('收口报告把第 5 节保持未评估，且不开票', async () => {
    const runId = `journey-close-${Date.now()}`;
    const writer = new EvidenceWriter(runId, ['vf-journey-clue-dispatch']);
    await writer.init();
    await writer.writeStep({
      scenarioId: 'vf-journey-clue-dispatch',
      stepId: 's5-read-union',
      pass: false,
      expected: { section: 'USER LOCK rev3 §1' },
      actual: { evaluation: 'unevaluated', reason: '未观测' },
      evidence: [],
    });
    await writer.finish('passed');
    const closed = await runDiscoverClose({
      runDir: writer.runDir,
      runId,
      mode: 'journey',
      command: 'VERIFY_PHASE=journey .cursor/skills/verify-natural-enforcement/harness/run-auto-verification.sh',
      channels: { api: 'not-run', ui: 'not-run' },
    });
    expect(closed.exitSuggestion).toBe(2);
    const report = JSON.parse(await fs.readFile(closed.reportPath, 'utf8')) as {
      journeyAcceptance: string;
      ticketsOpened: boolean;
      authorityItems: { id: string; status: string }[];
      sourceChecks: { verdict: string; authority: string }[];
      missingInputs: { name: string; status: string; reason: string }[];
      latentUnverified: { status: string };
      diff: { status: string };
    };
    expect(report.journeyAcceptance).toBe('not-accepted');
    expect(report.ticketsOpened).toBe(false);
    expect(report.authorityItems.map((item) => item.status).sort()).toEqual([
      'executable',
      'not-in-slice',
      'not-in-slice',
      'not-in-slice',
      'product-gap',
      'product-gap',
    ]);
    expect(report.authorityItems.find((item) => item.id === 's5-read-union')?.status).toBe('executable');
    expect(report.diff.status === 'first-run' || report.diff.status === 'compared').toBe(true);
    expect(report.sourceChecks.some((item) => item.verdict === 'ok')).toBe(false);
    expect(report.missingInputs).toContainEqual({
      name: 'mappedEndpoints',
      status: 'unevaluated',
      reason: expect.any(String),
    });
    expect(report.latentUnverified.status).toBe('listed');
    await fs.rm(writer.runDir, { recursive: true, force: true });
    await fs.rm(path.dirname(closed.reportPath), { recursive: true, force: true });
  });
});
