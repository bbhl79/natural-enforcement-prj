// 自动核查四条夹具的 API 跑次。
// 先在空图层地址下跑「查不成」，再调用 overlay 脚本接上假图层，跑成功、部分命中、疑似重复。
// 本文件不改产品进程里的业务规则。overlay 的打开与关闭由同目录脚本执行。

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { AuthGateError } from './auth-gate.cjs';
import { EvidenceWriter } from './evidence.ts';
import { repoRoot } from './paths.ts';
import { runApiScenario } from './run-api-scenario.ts';
import { ensurePersonnel, VERIFY_PERSONNEL } from './seed-personnel.ts';
import { SessionCache } from './session.ts';
import { LAYER_OVERLAY_SUITE } from './suites.ts';

const [EMPTY_SCENARIO, ...LAYER_SCENARIOS] = LAYER_OVERLAY_SUITE;
const EMPTY_SCENARIOS = [EMPTY_SCENARIO] as const;

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`缺少参数 ${name}`);
  return value;
}

function uiHook(only: string, runDir: string): string | null {
  const hook = process.env.VERIFY_UI_HOOK;
  if (!hook) return null;
  const result = spawnSync('bash', [hook, only], {
    stdio: 'inherit',
    cwd: repoRoot(),
    env: { ...process.env, VERIFY_UI_ONLY: only, VERIFY_RUN_DIR: runDir },
  });
  if (result.status !== 0) {
    const summaryFile = path.join(runDir, 'ui', only, 'summary.json');
    try {
      const summary = JSON.parse(readFileSync(summaryFile, 'utf8')) as { status?: string };
      if (summary.status === 'blocked') {
        throw new AuthGateError('auth-rejected', null, `页面取证 ${only} 认证门禁停止`);
      }
    } catch (error) {
      if (error instanceof AuthGateError) throw error;
    }
    return `页面取证 ${only} 退出 ${result.status ?? 'signal'}`;
  }
  return null;
}

function overlay(mode: 'on' | 'off'): void {
  const script = path.join(
    repoRoot(),
    'e2e/verify/harness/layers/apply-layer-overlay.sh',
  );
  const result = spawnSync('bash', [script, mode], { stdio: 'inherit', cwd: repoRoot() });
  if (result.status !== 0) {
    throw new Error(`假图层 overlay ${mode} 退出 ${result.status ?? 'signal'}`);
  }
}

async function clueOf(
  runDir: string,
  scenarioId: string,
  stepId: string,
): Promise<{ clueId: string; code: string }> {
  const file = path.join(runDir, 'steps', scenarioId, `${stepId}.json`);
  const raw = await fs.readFile(file, 'utf8');
  const parsed = JSON.parse(raw) as {
    actual?: { note?: { clueId?: string }; body?: { code?: string; id?: string } };
  };
  const clueId = parsed.actual?.note?.clueId ?? parsed.actual?.body?.id ?? '';
  const code = parsed.actual?.body?.code ?? '';
  return { clueId, code };
}

async function writeManifest(runDir: string, baseUrl: string): Promise<void> {
  const manifest = {
    environment: 'cursor-cloud-vm',
    baseUrl,
    runDir,
    clues: {
      failure: await clueOf(runDir, EMPTY_SCENARIOS[0], 'register').catch(() => null),
      success: await clueOf(runDir, 'vf-sc-auto-verify-land-success', 'register').catch(() => null),
      partial: await clueOf(runDir, 'vf-sc-auto-verify-land-partial', 'register').catch(() => null),
      duplicate: await clueOf(runDir, 'vf-sc-auto-verify-land-duplicate', 'register-b').catch(() => null),
      mineral: await clueOf(runDir, 'vf-sc-auto-verify-mineral-success', 'register').catch(() => null),
    },
  };
  await fs.writeFile(path.join(runDir, 'clue-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const runId = arg('--run-id');
  const baseUrl = (process.env.VERIFY_BASE_URL ?? 'https://localhost:8080').replace(/\/$/, '');
  const mineralOnly = process.env.VERIFY_PHASE === 'mineral';
  const scenarios = mineralOnly
    ? ['vf-sc-auto-verify-mineral-success']
    : [...EMPTY_SCENARIOS, ...LAYER_SCENARIOS];
  const writer = new EvidenceWriter(runId, scenarios, 'cursor-cloud-vm');
  await writer.init();
  const sessions = new SessionCache(baseUrl);
  const ctx = { baseUrl, sessions };
  let blocked = false;
  try {
    if (mineralOnly) {
      overlay('on');
      await runApiScenario(ctx, 'vf-sc-auto-verify-mineral-success', writer);
      await writeManifest(writer.runDir, baseUrl);
      const mineralUi = uiHook('mineral', writer.runDir);
      if (mineralUi !== null) {
        await writer.writeStep({
          scenarioId: '_ui',
          stepId: 'mineral',
          pass: false,
          expected: { exit: 0 },
          actual: { error: mineralUi },
          evidence: [],
        });
      }
      const summary = await writer.finish(blocked ? 'blocked' : 'passed');
      await writeManifest(writer.runDir, baseUrl);
      const manifestPath = path.join(writer.runDir, 'clue-manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      manifest.summary = summary;
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      console.log(JSON.stringify({ status: summary.status, runDir: writer.runDir, failed: summary.failed }));
      if (summary.status !== 'passed') process.exitCode = 1;
      return;
    }
    await ensurePersonnel(
      sessions,
      baseUrl,
      VERIFY_PERSONNEL.filter((person) => person.code === 'P-INTAKE-A'),
    );
    overlay('off');
    for (const id of EMPTY_SCENARIOS) {
      await runApiScenario(ctx, id, writer);
    }
    await writeManifest(writer.runDir, baseUrl);
    const failureUi = uiHook('failure', writer.runDir);
    if (failureUi !== null) {
      await writer.writeStep({
        scenarioId: '_ui',
        stepId: 'failure',
        pass: false,
        expected: { exit: 0 },
        actual: { error: failureUi },
        evidence: [],
      });
    }
    overlay('on');
    for (const id of LAYER_SCENARIOS) {
      await runApiScenario(ctx, id, writer);
    }
    await writeManifest(writer.runDir, baseUrl);
    const layersUi = uiHook('layers', writer.runDir);
    if (layersUi !== null) {
      await writer.writeStep({
        scenarioId: '_ui',
        stepId: 'layers',
        pass: false,
        expected: { exit: 0 },
        actual: { error: layersUi },
        evidence: [],
      });
    }
  } catch (error) {
    blocked = true;
    await writer.writeStep({
      scenarioId: '_harness',
      stepId: 'blocked',
      pass: false,
      expected: { ok: true },
      actual: { error: error instanceof Error ? error.message : String(error) },
      evidence: [],
    });
  }
  const summary = await writer.finish(blocked ? 'blocked' : 'passed');
  await writeManifest(writer.runDir, baseUrl);
  const manifestPath = path.join(writer.runDir, 'clue-manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.summary = summary;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: summary.status, runDir: writer.runDir, failed: summary.failed }));
  if (summary.status !== 'passed') process.exitCode = 1;
}

// integration 的 tsc 按 NodeNext 把本文件当 CommonJS，顶层 await 会报 TS1309。
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
