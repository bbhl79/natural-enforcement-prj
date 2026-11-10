import fs from 'node:fs/promises';
import path from 'node:path';

import {
  caseProfilesDir,
  identitiesDir,
  latentScenariosDir,
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
  /**
   * 为 true 时，按 VERIFY_SPATIAL_SALT 平移 overrideSpatial。
   * 同一跑次内相对位置不变。待派机构与待分派决定仍重合。已派机构那条不与它们重合。
   * 平移后不撞上以往跑次留在开发库里的面。
   */
  readonly isolateSpatial?: boolean;
}

export interface ScenarioStep {
  readonly id: string;
  readonly action: string;
  readonly fromProfile?: string;
  readonly path?: string;
  readonly identityRef?: string;
  /** 读分派视图用的身份；写动作仍用 identityRef。缺省同 identityRef。 */
  readonly viewIdentityRef?: string;
  readonly idempotencyKey?: string;
  readonly mutate?: StepMutate;
  /** poll-verification：轮询次数（默认 10，上限 60）。 */
  readonly pollAttempts?: number;
  /** poll-verification：收紧到这个核查状态才算过。缺省时 done／failed／not_required／running 都算观测到。 */
  readonly expectVerificationStatus?: string;
  /** read-side-effects：用这个身份再读一次分派视图，记录 mayDecide／mayAssignOrg。 */
  readonly dispatchIdentityRef?: string;
  /** read-side-effects：用这个身份读待分派列表，找本线索那一行。 */
  readonly listIdentityRef?: string;
  /** poll-verification：轮询间隔毫秒（默认 500）。 */
  readonly pollIntervalMs?: number;
  /** decide：dispatch｜hold；默认 dispatch。 */
  readonly decision?: string;
  readonly acknowledged?: boolean;
  readonly conflictResolution?: string;
  readonly conflictBasis?: string;
  /** 写动作的并发前置状态；缺省沿用上下文。 */
  readonly expectedStatus?: string;
  /** assign-org：按机构编码解析 id（如 ORG-STATION-A）。 */
  readonly orgUnitCode?: string;
  /** assign-org：从分派视图取机构，目前支持 assignment。 */
  readonly orgUnitFrom?: string;
  /** assign-people：主办人选的人员工号（如 P-HANDLER-ST1）；缺省取候选第一人。 */
  readonly mainFrom?: string;
  /** assign-people：协办人选的人员工号。 */
  readonly assistFrom?: string[];
  readonly designate?: boolean;
  readonly reason?: string;
  /**
   * read-dispatch-buttons：各身份自己读分派视图，核对已有按钮开关。
   * 不改产品读取范围，也不改工作台清单过滤。
   */
  readonly matrix?: readonly DispatchButtonExpect[];
  /** read-dispatch-buttons：200 响应里的线索主状态必须是这个值。 */
  readonly expectClueStatus?: string;
  /** read-dispatch-buttons：200 响应的 assignment.orgUnitId 必须等于该机构编码。 */
  readonly expectAssignmentOrgCode?: string;
}

/** 一个身份在分派视图上的按钮开关。403 行只核 http 与 reason。 */
export interface DispatchButtonExpect {
  readonly identityRef: string;
  readonly http: number;
  readonly reason?: string;
  readonly mayDecide?: boolean;
  readonly mayAssignOrg?: boolean;
  readonly mayAssignPeople?: boolean;
  readonly mayReassignOrg?: boolean;
}

export interface ApiScenario {
  readonly id: string;
  readonly status: string;
  readonly driver?: string;
  readonly kind?: string;
  readonly profileRefs: string[];
  readonly identityRefs: string[];
  /** Feature Map 节点引用；uncovered 的 featureMapRef 取首元素（spec #322 T1）。 */
  readonly featureMapRefs?: string[];
  readonly steps: ScenarioStep[];
  /** 为 true 时，任一步 pass 为 false 则整条 scenario 失败。 */
  readonly strictSteps?: boolean;
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
  const latent = path.join(latentScenariosDir(), `${id}.json`);
  const negative = path.join(negativesDir(), `${id}.json`);
  try {
    await fs.access(runnable);
    return readJson(runnable);
  } catch {
    // latent 只读加载。调用方不得把 status 改成 runnable。
  }
  try {
    await fs.access(latent);
    return readJson(latent);
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
