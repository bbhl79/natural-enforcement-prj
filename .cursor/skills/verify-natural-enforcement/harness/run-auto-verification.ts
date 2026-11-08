// 自动核查四条夹具的 API 跑次。
// 先在空图层地址下跑「查不成」，再调用 overlay 脚本接上假图层，跑成功、部分命中、疑似重复。
// 本文件不改产品进程里的业务规则。overlay 的打开与关闭由同目录脚本执行。

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { AuthGateError } from './auth-gate.cjs';
import { EvidenceWriter } from './evidence.ts';
import { loadIdentity } from './load-fixtures.ts';
import { repoRoot } from './paths.ts';
import { runApiScenario } from './run-api-scenario.ts';
import { runDiscoverClose, type DiscoverChannels } from './run-discover.ts';
import { SessionCache } from './session.ts';

const EMPTY_SCENARIOS = ['vf-sc-auto-verify-land-empty-failed'] as const;
const LAYER_SCENARIOS = [
  'vf-sc-auto-verify-land-success',
  'vf-sc-auto-verify-land-partial',
  'vf-sc-auto-verify-land-duplicate',
  'vf-sc-auto-verify-mineral-success',
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
      mineral: await clueOf(runDir, 'vf-sc-auto-verify-mineral-success', 'register').catch(() => null),
    },
  };
  await fs.writeFile(path.join(runDir, 'clue-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function commandOf(phase: string): string {
  if (phase === 'journey') {
    return 'VERIFY_PHASE=journey .cursor/skills/verify-natural-enforcement/harness/run-auto-verification.sh';
  }
  if (phase === 'mineral') {
    return 'VERIFY_PHASE=mineral .cursor/skills/verify-natural-enforcement/harness/run-auto-verification.sh';
  }
  return '.cursor/skills/verify-natural-enforcement/harness/run-auto-verification.sh';
}

async function listUiFailures(
  runDir: string,
  only: string,
): Promise<{ scenarioId: string; stepId: string; source: string }[]> {
  const dir = path.join(runDir, 'ui', only, 'steps');
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const found: { scenarioId: string; stepId: string; source: string }[] = [];
  for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as {
        scenarioId?: string;
        stepId?: string;
        pass?: boolean;
      };
      if (parsed.pass !== false) continue;
      if (typeof parsed.scenarioId !== 'string' || typeof parsed.stepId !== 'string') continue;
      found.push({
        scenarioId: parsed.scenarioId,
        stepId: parsed.stepId,
        source: path.posix.join('ui', only, 'steps', name),
      });
    } catch {
      found.push({ scenarioId: '_ui', stepId: name, source: path.posix.join('ui', only, 'steps', name) });
    }
  }
  return found;
}

async function writeUiMiss(
  writer: EvidenceWriter,
  only: string,
  message: string,
): Promise<void> {
  const failedSteps = await listUiFailures(writer.runDir, only);
  const environment =
    /browser image missing|没有 docker|cannot resolve WSL|transport|栈未启动|VERIFY_STACK/.test(message);
  await writer.writeStep({
    scenarioId: '_ui',
    stepId: only,
    pass: false,
    expected: { exit: 0 },
    actual: {
      error: message,
      failedSteps,
      ...(environment ? { disposition: 'environment-blocked' } : {}),
    },
    evidence: failedSteps.map((step) => step.source),
  });
}

async function closeDiscover(
  writer: EvidenceWriter,
  runId: string,
  mode: string,
  channels: DiscoverChannels,
): Promise<number> {
  const closed = await runDiscoverClose({
    runDir: writer.runDir,
    runId,
    mode,
    command: commandOf(mode),
    channels,
  });
  console.log(JSON.stringify({ discoverReport: closed.reportPath, exitSuggestion: closed.exitSuggestion }));
  return closed.exitSuggestion;
}

const JOURNEY_SCENARIO = 'vf-sc-journey-read-union';

const JOURNEY_CALL_SITES = [
  { stepId: 'seed-intake-a', identity: 'admin-hq', method: 'POST', path: '/api/admin/personnel' },
  { stepId: 'seed-intake-st', identity: 'admin-hq', method: 'POST', path: '/api/admin/personnel' },
  { stepId: 'register', identity: 'clerk-a', method: 'POST', path: '/api/clues' },
  { stepId: 'read-union-before', identity: 'clerk-a', method: 'GET', path: '/api/clues/:id/dispatch' },
  { stepId: 'read-union-before', identity: 'intake-st', method: 'GET', path: '/api/clues/:id/dispatch' },
  { stepId: 'read-union-before', identity: 'clerk-b', method: 'GET', path: '/api/clues/:id/dispatch' },
  { stepId: 'assign-org', identity: 'intake-a', method: 'POST', path: '/api/clues/:id/assign-org' },
  { stepId: 'read-union-after', identity: 'clerk-a', method: 'GET', path: '/api/clues/:id/dispatch' },
  { stepId: 'read-union-after', identity: 'intake-a', method: 'GET', path: '/api/clues/:id/dispatch' },
  { stepId: 'read-union-after', identity: 'intake-st', method: 'GET', path: '/api/clues/:id/dispatch' },
  { stepId: 'read-union-after', identity: 'clerk-b', method: 'GET', path: '/api/clues/:id/dispatch' },
  { stepId: 'read-union-after', identity: 'admin-hq', method: 'GET', path: '/api/org-units' },
] as const;

async function ensureJourneyPerson(
  sessions: SessionCache,
  baseUrl: string,
  input: { code: string; name: string; orgCode: string; mobilePhone: string },
): Promise<void> {
  const admin = await loadIdentity('admin-hq');
  const cookie = await sessions.cookieOf(admin);
  const tree = await fetch(`${baseUrl}/api/org-units`, { headers: { cookie } });
  if (tree.status !== 200) throw new Error(`读取机构树失败：HTTP ${tree.status}`);
  const body = (await tree.json()) as { orgUnits?: { id?: string; code?: string }[] };
  const org = body.orgUnits?.find((unit) => unit.code === input.orgCode);
  if (!org?.id) throw new Error(`机构树缺少 ${input.orgCode}`);
  const created = await fetch(`${baseUrl}/api/admin/personnel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      code: input.code,
      name: input.name,
      orgUnitId: org.id,
      mobilePhone: input.mobilePhone,
      initialPassword: 'Seed-pass-52',
      roles: ['内勤'],
    }),
  });
  if (created.status === 200 || created.status === 409) return;
  const text = await created.text();
  throw new Error(`种入 ${input.code} 失败：HTTP ${created.status} ${text.slice(0, 300)}`);
}

async function writeAuthorityNotes(writer: EvidenceWriter): Promise<void> {
  const sectionFile = path.join(
    repoRoot(),
    '.cursor/skills/verify-natural-enforcement/fixtures/journeys/clue-dispatch-baseline/section5.json',
  );
  const section = JSON.parse(await fs.readFile(sectionFile, 'utf8')) as {
    candidates: { id: string; section: string; text: string; status: string; reason: string }[];
  };
  for (const candidate of section.candidates) {
    if (candidate.status === 'executable') continue;
    await writer.writeStep({
      scenarioId: 'vf-journey-clue-dispatch',
      stepId: candidate.id,
      pass: false,
      expected: { section: candidate.section, text: candidate.text },
      actual: { evaluation: candidate.status, reason: candidate.reason },
      evidence: [
        '.cursor/skills/verify-natural-enforcement/fixtures/journeys/clue-dispatch-baseline/section5.json',
      ],
    });
  }
}

async function runJourney(runId: string, baseUrl: string): Promise<void> {
  if (!process.env.VERIFY_SPATIAL_SALT) process.env.VERIFY_SPATIAL_SALT = runId;
  const writer = new EvidenceWriter(
    runId,
    ['vf-journey-clue-dispatch', JOURNEY_SCENARIO],
    'cursor-cloud-vm',
  );
  await writer.init();
  await fs.writeFile(
    path.join(writer.runDir, 'call-sites.json'),
    `${JSON.stringify({ scenarioId: JOURNEY_SCENARIO, sites: JOURNEY_CALL_SITES }, null, 2)}\n`,
    'utf8',
  );
  await writeAuthorityNotes(writer);
  const stackUnavailable = process.env.VERIFY_STACK === 'unavailable';
  let blocked = stackUnavailable;
  if (stackUnavailable) {
    await writer.writeStep({
      scenarioId: '_harness',
      stepId: 'blocked',
      pass: false,
      expected: { ok: true },
      actual: {
        error: '业务栈不可用。原因 stack-unavailable。读并集步骤未发出。',
        disposition: 'environment-blocked',
      },
      evidence: ['call-sites.json'],
    });
  } else {
    const sessions = new SessionCache(baseUrl);
    const ctx = { baseUrl, sessions };
    try {
      await ensureJourneyPerson(sessions, baseUrl, {
        code: 'P-INTAKE-A',
        name: '甲区内勤',
        orgCode: 'ORG-DEPT-A',
        mobilePhone: '13900002001',
      });
      await ensureJourneyPerson(sessions, baseUrl, {
        code: 'P-INTAKE-ST',
        name: '甲所内勤',
        orgCode: 'ORG-STATION-A',
        mobilePhone: '13900002003',
      });
      await runApiScenario(ctx, JOURNEY_SCENARIO, writer);
    } catch (error) {
      blocked = true;
      await writer.writeStep({
        scenarioId: '_harness',
        stepId: 'blocked',
        pass: false,
        expected: { ok: true },
        actual: {
          error: error instanceof Error ? error.message : String(error),
          disposition: 'environment-blocked',
        },
        evidence: ['call-sites.json'],
      });
    }
  }
  const summary = await writer.finish(blocked ? 'blocked' : 'passed');
  const channels: DiscoverChannels = {
    api: blocked ? 'blocked' : summary.status,
    ui: 'not-run',
  };
  const exitSuggestion = await closeDiscover(writer, runId, 'journey', channels);
  console.log(
    JSON.stringify({
      status: summary.status,
      acceptance: channels.api === 'passed' ? 'slice-read-union' : 'not-accepted',
      runDir: writer.runDir,
      failed: summary.failed,
      fault: process.env.VERIFY_FAULT ?? '',
    }),
  );
  process.exitCode = channels.api === 'failed' ? 1 : exitSuggestion;
}

async function main(): Promise<void> {
  const runId = arg('--run-id');
  const baseUrl = (process.env.VERIFY_BASE_URL ?? 'https://localhost:8080').replace(/\/$/, '');
  const phase = process.env.VERIFY_PHASE ?? '';
  if (phase === 'journey') {
    await runJourney(runId, baseUrl);
    return;
  }
  const mineralOnly = phase === 'mineral';
  const scenarios = mineralOnly
    ? ['vf-sc-auto-verify-mineral-success']
    : [...EMPTY_SCENARIOS, ...LAYER_SCENARIOS];
  const writer = new EvidenceWriter(runId, scenarios, 'cursor-cloud-vm');
  await writer.init();
  const sessions = new SessionCache(baseUrl);
  const ctx = { baseUrl, sessions };
  let blocked = false;
  let failureUi: string | null = null;
  let layersUi: string | null = null;
  let uiRan = false;
  try {
    if (mineralOnly) {
      overlay('on');
      await runApiScenario(ctx, 'vf-sc-auto-verify-mineral-success', writer);
      await writeManifest(writer.runDir, baseUrl);
      const mineralUi = uiHook('mineral', writer.runDir);
      if (mineralUi !== null) await writeUiMiss(writer, 'mineral', mineralUi);
      const summary = await writer.finish(blocked ? 'blocked' : 'passed');
      await writeManifest(writer.runDir, baseUrl);
      const manifestPath = path.join(writer.runDir, 'clue-manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      manifest.summary = summary;
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      console.log(JSON.stringify({ status: summary.status, runDir: writer.runDir, failed: summary.failed }));
      const mineralExit = await closeDiscover(writer, runId, 'mineral', {
        api: summary.status,
        ui: mineralUi === null ? 'passed' : 'failed',
      });
      process.exitCode = summary.status !== 'passed' ? 1 : mineralExit;
      return;
    }
    await ensureIntake(sessions, baseUrl);
    overlay('off');
    for (const id of EMPTY_SCENARIOS) {
      await runApiScenario(ctx, id, writer);
    }
    await writeManifest(writer.runDir, baseUrl);
    uiRan = true;
    failureUi = uiHook('failure', writer.runDir);
    if (failureUi !== null) await writeUiMiss(writer, 'failure', failureUi);
    overlay('on');
    for (const id of LAYER_SCENARIOS) {
      await runApiScenario(ctx, id, writer);
    }
    await writeManifest(writer.runDir, baseUrl);
    layersUi = uiHook('layers', writer.runDir);
    if (layersUi !== null) await writeUiMiss(writer, 'layers', layersUi);
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
  const hookConfigured = Boolean(process.env.VERIFY_UI_HOOK);
  const uiMessages = [failureUi, layersUi].filter((item): item is string => item !== null);
  const uiBlocked = uiMessages.some((item) =>
    /browser image missing|没有 docker|cannot resolve WSL|transport|栈未启动/.test(item),
  );
  const ui: DiscoverChannels['ui'] = !hookConfigured || !uiRan
    ? 'not-run'
    : uiMessages.length === 0
      ? 'passed'
      : uiBlocked
        ? 'blocked'
        : 'failed';
  const batchExit = await closeDiscover(writer, runId, 'auto-verification', {
    api: summary.status,
    ui,
  });
  process.exitCode = summary.status !== 'passed' ? 1 : batchExit;
}

// integration 的 tsc 按 NodeNext 把本文件当 CommonJS，顶层 await 会报 TS1309。
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
