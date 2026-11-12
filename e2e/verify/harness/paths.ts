// 用途：集中定义验证资产目录与运行产物目录的路径换算，统一按仓库根解析。
// 调用方：e2e/verify/harness 下的运行器、发现器与 integration/verify-suites.test.ts。
import path from 'node:path';

/** 验证资产根目录（含 fixtures/）。相对仓库根，容器内 cwd 为 /work。 */
export const verifyRoot = path.join(process.cwd(), 'e2e/verify');

/** 夹具根目录。 */
export const fixturesRoot = path.join(verifyRoot, 'fixtures');

/** 仓库根：容器内为 /work，宿主为项目根。 */
export function repoRoot(): string {
  return process.cwd();
}

/**
 * 运行产物根（相对仓库根）：与 dev test e2e 的产物目录同一处，已 gitignore。
 * 跑次证据落 <根>/verify-<runId>/，发现器报告落 <根>/discover/<runId>/。
 */
export const RESULTS_DIR = 'e2e/results';

/** 案件档案夹具目录。调用方：load-fixtures.ts。 */
export function caseProfilesDir(): string {
  return path.join(fixturesRoot, 'case-profiles');
}

/** 身份夹具目录。调用方：load-fixtures.ts。 */
export function identitiesDir(): string {
  return path.join(fixturesRoot, 'identities');
}

/** 可运行场景目录。调用方：load-fixtures.ts、integration/verify-suites.test.ts。 */
export function runnableScenariosDir(): string {
  return path.join(fixturesRoot, 'scenarios', 'runnable');
}

/** 负例场景目录。调用方：load-fixtures.ts、integration/verify-suites.test.ts。 */
export function negativesDir(): string {
  return path.join(fixturesRoot, 'negatives');
}
