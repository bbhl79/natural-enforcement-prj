import path from 'node:path';

/** Skill 根目录（含 fixtures/）。相对仓库根，容器内 cwd 为 /work。 */
export const skillRoot = path.join(
  process.cwd(),
  '.cursor/skills/verify-natural-enforcement',
);

/** 夹具根目录。 */
export const fixturesRoot = path.join(skillRoot, 'fixtures');

/** 仓库根：容器内为 /work，宿主为项目根。 */
export function repoRoot(): string {
  return process.cwd();
}

export function caseProfilesDir(): string {
  return path.join(fixturesRoot, 'case-profiles');
}

export function identitiesDir(): string {
  return path.join(fixturesRoot, 'identities');
}

export function runnableScenariosDir(): string {
  return path.join(fixturesRoot, 'scenarios', 'runnable');
}

export function latentScenariosDir(): string {
  return path.join(fixturesRoot, 'scenarios', 'latent');
}

export function scenarioIndexPath(): string {
  return path.join(fixturesRoot, 'scenarios', 'index.json');
}

export function coverageAcksPath(): string {
  return path.join(fixturesRoot, 'coverage-acks.json');
}

export function negativesDir(): string {
  return path.join(fixturesRoot, 'negatives');
}
