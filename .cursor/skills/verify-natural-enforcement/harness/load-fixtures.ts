import fs from 'node:fs/promises';
import path from 'node:path';

import {
  caseProfilesDir,
  identitiesDir,
  negativesDir,
  runnableScenariosDir,
} from './paths.ts';
import type { OracleAssert } from './oracle.ts';

export interface IdentityFixture {
  readonly id: string;
  readonly mobile: string;
  readonly passwordRef?: {
    readonly env?: string;
    readonly secretsFile?: string;
    readonly key?: string;
  };
}

export interface RegisterSystem {
  readonly sourceCode: string;
  readonly domain: string;
  readonly types?: string[];
  readonly subjectUnknown?: boolean;
  readonly anonymityConfirmed?: boolean;
  readonly confirm?: boolean;
  readonly values?: Record<string, string>;
  readonly spatialSource?: unknown;
}

export interface StepMutate {
  readonly omitValues?: string[];
  readonly setValues?: Record<string, string>;
  readonly setConfirm?: boolean;
  readonly overrideSpatial?: unknown;
}

export interface ScenarioStep {
  readonly id: string;
  readonly action: string;
  readonly fromProfile?: string;
  readonly path?: string;
  readonly identityRef?: string;
  readonly idempotencyKey?: string;
  readonly mutate?: StepMutate;
}

export interface ApiScenario {
  readonly id: string;
  readonly status: string;
  readonly driver?: string;
  readonly kind?: string;
  readonly profileRefs: string[];
  readonly identityRefs: string[];
  readonly steps: ScenarioStep[];
  readonly oracle: {
    readonly kind: string;
    readonly assert: OracleAssert[];
  };
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

export async function loadIdentity(id: string): Promise<IdentityFixture> {
  return readJson(path.join(identitiesDir(), `${id}.json`));
}

export async function loadProfile(id: string): Promise<Record<string, unknown>> {
  return readJson(path.join(caseProfilesDir(), `${id}.json`));
}

export async function loadScenario(id: string): Promise<ApiScenario> {
  const runnable = path.join(runnableScenariosDir(), `${id}.json`);
  const negative = path.join(negativesDir(), `${id}.json`);
  try {
    await fs.access(runnable);
    return readJson(runnable);
  } catch {
    return readJson(negative);
  }
}

/** 沿点分 path 取对象（如 stages.register.system）。 */
export function getByPath(root: Record<string, unknown>, dotted: string): unknown {
  const parts = dotted.split('.');
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function resolveSeedPassword(identity: IdentityFixture): string {
  const envName = identity.passwordRef?.env ?? 'VERIFY_PASSWORD_SEED';
  const fromEnv = process.env[envName];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  // 与 backend/prisma/seed.mjs 开发种子一致；集成环默认。
  return 'Seed-pass-52';
}
