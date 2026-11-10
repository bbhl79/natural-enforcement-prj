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

export function caseProfilesDir(): string {
  return path.join(fixturesRoot, 'case-profiles');
}

export function identitiesDir(): string {
  return path.join(fixturesRoot, 'identities');
}

export function runnableScenariosDir(): string {
  return path.join(fixturesRoot, 'scenarios', 'runnable');
}

export function negativesDir(): string {
  return path.join(fixturesRoot, 'negatives');
}
