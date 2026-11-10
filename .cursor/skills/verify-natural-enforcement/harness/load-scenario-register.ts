// 读取 scenarios/index.json，并与磁盘 json 名单对照。
// 分叉抛 index-disk-fork。latent 只登记为未验证，不提拔。
import fs from 'node:fs/promises';
import path from 'node:path';

import { repoRoot } from './paths.ts';

export interface IndexDiskFork {
  readonly runnableOnlyOnDisk: readonly string[];
  readonly runnableOnlyInIndex: readonly string[];
  readonly latentOnlyOnDisk: readonly string[];
  readonly latentOnlyInIndex: readonly string[];
  readonly negativeOnlyOnDisk: readonly string[];
  readonly negativeOnlyInIndex: readonly string[];
}

export class IndexDiskForkError extends Error {
  readonly code = 'index-disk-fork';
  readonly fork: IndexDiskFork;

  constructor(fork: IndexDiskFork) {
    super(`index-disk-fork：登记与磁盘不一致 ${JSON.stringify(fork)}`);
    this.name = 'IndexDiskForkError';
    this.fork = fork;
  }
}

export interface LatentRegistration {
  readonly scenarioId: string;
  readonly evaluation: 'unverified';
  readonly featureMapRefs: readonly string[];
}

export interface ScenarioRegister {
  readonly runnableIds: readonly string[];
  readonly latent: readonly LatentRegistration[];
  readonly negativeIds: readonly string[];
}

interface IndexFile {
  readonly runnable?: readonly string[];
  readonly latent?: readonly string[];
  readonly negatives?: readonly string[];
}

async function jsonIds(dir: string): Promise<string[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

function onlyIn(left: readonly string[], right: readonly string[]): string[] {
  const hold = new Set(right);
  return left.filter((item) => !hold.has(item)).sort();
}

function stringsOf(value: readonly string[] | undefined): string[] {
  return [...(value ?? [])].sort();
}

/** 对照 index 与三类目录。不一致抛 IndexDiskForkError。 */
export async function loadScenarioRegister(root: string = repoRoot()): Promise<ScenarioRegister> {
  const fixtures = path.join(root, '.cursor/skills/verify-natural-enforcement/fixtures');
  const indexPath = path.join(fixtures, 'scenarios/index.json');
  const raw = JSON.parse(await fs.readFile(indexPath, 'utf8')) as IndexFile;
  const runnableDir = path.join(fixtures, 'scenarios/runnable');
  const latentDir = path.join(fixtures, 'scenarios/latent');
  const negativeDir = path.join(fixtures, 'negatives');

  const runnableIndex = stringsOf(raw.runnable);
  const latentIndex = stringsOf(raw.latent);
  const negativeIndex = stringsOf(raw.negatives);
  const runnableDisk = await jsonIds(runnableDir);
  const latentDisk = await jsonIds(latentDir);
  const negativeDisk = await jsonIds(negativeDir);

  const fork: IndexDiskFork = {
    runnableOnlyOnDisk: onlyIn(runnableDisk, runnableIndex),
    runnableOnlyInIndex: onlyIn(runnableIndex, runnableDisk),
    latentOnlyOnDisk: onlyIn(latentDisk, latentIndex),
    latentOnlyInIndex: onlyIn(latentIndex, latentDisk),
    negativeOnlyOnDisk: onlyIn(negativeDisk, negativeIndex),
    negativeOnlyInIndex: onlyIn(negativeIndex, negativeDisk),
  };
  const diverged = Object.values(fork).some((items) => items.length > 0);
  if (diverged) throw new IndexDiskForkError(fork);

  const overlap = runnableIndex.filter((id) => latentIndex.includes(id));
  if (overlap.length > 0) {
    throw new IndexDiskForkError({
      ...fork,
      runnableOnlyInIndex: overlap,
      latentOnlyInIndex: overlap,
    });
  }

  const latent: LatentRegistration[] = [];
  for (const scenarioId of latentIndex) {
    const file = path.join(latentDir, `${scenarioId}.json`);
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as {
      status?: string;
      featureMapRefs?: string[];
    };
    if (parsed.status !== 'latent') {
      throw new Error(`latent 文件 ${scenarioId} 的 status=${String(parsed.status)}，拒绝提拔`);
    }
    latent.push({
      scenarioId,
      evaluation: 'unverified',
      featureMapRefs: parsed.featureMapRefs ?? [],
    });
  }

  return { runnableIds: runnableIndex, latent, negativeIds: negativeIndex };
}
