// e2e 层 API 稳定用例的驱动（e2e/cases/08-verify-api.sh 调用）。
// 在整栈上经 nginx 跑一批 API scenario 与负例，写一个证据包，全绿时退出码 0。
// 本驱动只用 node 内建模块，在工具链容器里以 --experimental-transform-types 直接运行。
//
// 可重复跑由调用方保证，驱动自身不做口令与空间的善后：
// - 首登改密只能发生一次：登录后种子口令即被改成固定新口令。08 用例每次新建独立库，
//   种子口令因此每次一致。对同一个旧库重跑本驱动，登录会得 401，跑次记 blocked。
// - 空间不重叠：调用方设置 VERIFY_SPATIAL_SALT，声明了 isolateSpatial 的步骤按盐平移。
// 场景清单见 suites.ts 的 API_SUITE。

import { EvidenceWriter, newRunId } from './evidence.ts';
import { runApiScenario } from './run-api-scenario.ts';
import { ensurePersonnel, VERIFY_PERSONNEL } from './seed-personnel.ts';
import { SessionCache } from './session.ts';
import { API_SUITE } from './suites.ts';

async function main(): Promise<void> {
  const baseUrl = (process.env.VERIFY_BASE_URL ?? 'https://localhost:8080').replace(/\/$/, '');
  const runId = process.env.VERIFY_RUN_ID ?? newRunId();
  if (!process.env.VERIFY_SPATIAL_SALT) process.env.VERIFY_SPATIAL_SALT = runId;
  const writer = new EvidenceWriter(runId, [...API_SUITE], 'e2e-stack');
  await writer.init();
  const sessions = new SessionCache(baseUrl);
  let blocked = false;
  try {
    await ensurePersonnel(sessions, baseUrl, VERIFY_PERSONNEL);
    // 判红不靠返回值：runApiScenario 把未过的步骤写进 writer，finish 据此给出 failed。
    for (const id of API_SUITE) await runApiScenario({ baseUrl, sessions }, id, writer);
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
  console.log(JSON.stringify({ status: summary.status, runDir: summary.runDir, failed: summary.failed }));
  if (summary.status !== 'passed') process.exitCode = 1;
}

// integration 的 tsc 按 NodeNext 把本文件当 CommonJS，顶层 await 会报 TS1309。
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
