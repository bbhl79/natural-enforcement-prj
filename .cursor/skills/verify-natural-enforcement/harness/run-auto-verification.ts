// 自动核查四条夹具的 API 跑次。
// 先在空图层地址下跑「查不成」，再调用 overlay 脚本接上假图层，跑成功、部分命中、疑似重复。
// 本文件不改产品进程里的业务规则。overlay 的打开与关闭由同目录脚本执行。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { EvidenceWriter } from './evidence.ts';
import { loadIdentity } from './load-fixtures.ts';
import { repoRoot } from './paths.ts';
import { runApiScenario } from './run-api-scenario.ts';
import { SessionCache } from './session.ts';

const EMPTY_SCENARIOS = ['vf-sc-auto-verify-land-empty-failed'] as const;
const LAYER_SCENARIOS = [
  'vf-sc-auto-verify-land-success',
  'vf-sc-auto-verify-land-partial',
  'vf-sc-auto-verify-land-duplicate',
] as const;

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
  if (result.status !== 0) return `页面取证 ${only} 退出 ${result.status ?? 'signal'}`;
  return null;
}

function overlay(mode: 'on' | 'off'): void {
  const script = path.join(
    repoRoot(),
    '.cursor/skills/verify-natural-enforcement/harness/layers/apply-layer-overlay.sh',
  );
  const result = spawnSync('bash', [script, mode], { stdio: 'inherit', cwd: repoRoot() });
  if (result.status !== 0) {
    throw new Error(`假图层 overlay ${mode} 退出 ${result.status ?? 'signal'}`);
  }
}

async function ensureIntake(sessions: SessionCache, baseUrl: string): Promise<void> {
  const admin = await loadIdentity('admin-hq');
  const cookie = await sessions.cookieOf(admin);
  const tree = await fetch(`${baseUrl}/api/org-units`, { headers: { cookie } });
  if (tree.status !== 200) throw new Error(`读取机构树失败：HTTP ${tree.status}`);
  const body = (await tree.json()) as { orgUnits?: { id?: string; code?: string }[] };
  const dept = body.orgUnits?.find((unit) => unit.code === 'ORG-DEPT-A');
  if (!dept?.id) throw new Error('机构树缺少 ORG-DEPT-A');
  const created = await fetch(`${baseUrl}/api/admin/personnel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      code: 'P-INTAKE-A',
      name: '甲区内勤',
      orgUnitId: dept.id,
      mobilePhone: '13900002001',
      initialPassword: 'Seed-pass-52',
      roles: ['内勤'],
    }),
  });
  if (created.status === 200 || created.status === 409) return;
  const text = await created.text();
  throw new Error(`种入 P-INTAKE-A 失败：HTTP ${created.status} ${text.slice(0, 300)}`);
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
    },
  };
  await fs.writeFile(path.join(runDir, 'clue-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const runId = arg('--run-id');
  const baseUrl = (process.env.VERIFY_BASE_URL ?? 'https://localhost:8080').replace(/\/$/, '');
  const scenarios = [...EMPTY_SCENARIOS, ...LAYER_SCENARIOS];
  const writer = new EvidenceWriter(runId, scenarios, 'cursor-cloud-vm');
  await writer.init();
  const sessions = new SessionCache(baseUrl);
  const ctx = { baseUrl, sessions };
  let blocked = false;
  try {
    await ensureIntake(sessions, baseUrl);
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

await main();
