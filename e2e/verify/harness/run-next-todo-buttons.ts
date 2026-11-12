// 用途：跑下一待办按钮场景的 API 跑次，种入内勤人员并写证据包与线索清单。
// 下一待办按钮的 API 跑次。
// 用管理台接口种入甲区内勤与甲所内勤，不改产品种子。
// 不改分派视图的读取规则。读取按现行并集核对。

import fs from 'node:fs/promises';
import path from 'node:path';

import { EvidenceWriter } from './evidence.ts';
import { runApiScenario } from './run-api-scenario.ts';
import { ensurePersonnel, VERIFY_PERSONNEL } from './seed-personnel.ts';
import { SessionCache } from './session.ts';

const SCENARIO = 'vf-sc-next-todo-buttons';

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`缺少参数 ${name}`);
  return value;
}

function clueOf(actual: unknown): { id: string; code: string } {
  const row = actual as {
    body?: { id?: string; code?: string };
    note?: { clueId?: string };
  };
  return {
    id: row.body?.id ?? row.note?.clueId ?? '',
    code: row.body?.code ?? '',
  };
}

async function main(): Promise<void> {
  const runId = arg('--run-id');
  const baseUrl = (process.env.VERIFY_BASE_URL ?? 'https://localhost:8080').replace(/\/$/, '');
  if (!process.env.VERIFY_SPATIAL_SALT) process.env.VERIFY_SPATIAL_SALT = runId;
  const writer = new EvidenceWriter(runId, [SCENARIO], 'cursor-cloud-vm');
  await writer.init();
  const sessions = new SessionCache(baseUrl);
  let blocked = false;
  try {
    await ensurePersonnel(
      sessions,
      baseUrl,
      VERIFY_PERSONNEL.filter((person) => person.code === 'P-INTAKE-A' || person.code === 'P-INTAKE-ST'),
    );
    await runApiScenario({ baseUrl, sessions }, SCENARIO, writer);
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
  const stepDir = path.join(writer.runDir, 'steps', SCENARIO);
  const readClue = async (stepId: string): Promise<{ id: string; code: string }> => {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(stepDir, `${stepId}.json`), 'utf8')) as {
        actual?: unknown;
      };
      return clueOf(parsed.actual);
    } catch {
      return { id: '', code: '' };
    }
  };
  const pool = await readClue('register-pool');
  const decide = await readClue('register-decide');
  const org = await readClue('register-org');
  const manifest = {
    environment: 'cursor-cloud-vm',
    baseUrl,
    runDir: writer.runDir,
    readScope: 'entered-or-assigned-org',
    clues: {
      inPool: pool,
      pendingDecision: decide,
      orgAssigned: org,
    },
    summary,
  };
  await fs.writeFile(
    path.join(writer.runDir, 'clue-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify({ status: summary.status, runDir: writer.runDir, failed: summary.failed }));
  if (summary.status !== 'passed') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
