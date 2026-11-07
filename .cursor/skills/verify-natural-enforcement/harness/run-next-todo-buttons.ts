// 下一待办按钮的 API 跑次。
// 用管理台接口种入甲区内勤与甲所内勤，不改产品种子。
// 不改分派视图的读取规则。读取按现行并集核对。

import fs from 'node:fs/promises';
import path from 'node:path';

import { EvidenceWriter } from './evidence.ts';
import { loadIdentity } from './load-fixtures.ts';
import { runApiScenario } from './run-api-scenario.ts';
import { SessionCache } from './session.ts';

const SCENARIO = 'vf-sc-next-todo-buttons';

function arg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`缺少参数 ${name}`);
  return value;
}

async function ensurePerson(
  sessions: SessionCache,
  baseUrl: string,
  input: {
    readonly code: string;
    readonly name: string;
    readonly orgCode: string;
    readonly mobilePhone: string;
  },
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
    await ensurePerson(sessions, baseUrl, {
      code: 'P-INTAKE-A',
      name: '甲区内勤',
      orgCode: 'ORG-DEPT-A',
      mobilePhone: '13900002001',
    });
    await ensurePerson(sessions, baseUrl, {
      code: 'P-INTAKE-ST',
      name: '甲所内勤',
      orgCode: 'ORG-STATION-A',
      mobilePhone: '13900002003',
    });
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
