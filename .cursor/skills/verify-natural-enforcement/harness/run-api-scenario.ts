import {
  getByPath,
  loadIdentity,
  loadProfile,
  loadScenario,
  type ApiScenario,
  type RegisterSystem,
  type ScenarioStep,
} from './load-fixtures.ts';
import { evaluateOracle, type StepObservation } from './oracle.ts';
import { EvidenceWriter, newRunId, type RunSummary } from './evidence.ts';
import { SessionCache } from './session.ts';

export interface HarnessContext {
  readonly baseUrl: string;
  readonly sessions: SessionCache;
}

/** 跨步骤上下文：register 得到的线索 id 与主状态。 */
interface ScenarioContext {
  clueId: string;
  status: string;
  identityRef: string;
  readonly orgUnitIds: Map<string, string>;
}

/** 单步执行结果：观测、动作是否成功、附加证据。 */
interface StepResult {
  observation: StepObservation;
  pass: boolean;
  note?: Record<string, unknown>;
}

const TERMINAL_VERIFICATION = new Set(['done', 'failed', 'not_required']);
/** 观测成功的核查状态；running 表示 worker 未起或未跑完，仍算观测成功。 */
const OBSERVED_VERIFICATION = new Set(['done', 'failed', 'not_required', 'running']);

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function listOf(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = recordOf(item);
    return row === null ? [] : [row];
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jsonRequest(
  ctx: HarnessContext,
  cookie: string,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<StepObservation> {
  const headers: Record<string, string> = { cookie };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${ctx.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(raw);
    parsed = recordOf(value) ?? { value };
  } catch {
    parsed = { raw };
  }
  return { http: { status: response.status }, body: parsed };
}

async function cookieOfIdentity(ctx: HarnessContext, identityRef: string): Promise<string> {
  const identity = await loadIdentity(identityRef);
  return ctx.sessions.cookieOf(identity);
}

async function cookieOf(
  ctx: HarnessContext,
  step: ScenarioStep,
  run: ScenarioContext,
): Promise<string> {
  const identityId = step.identityRef ?? run.identityRef;
  if (!identityId) throw new Error(`step ${step.id} 缺少 identityRef`);
  run.identityRef = identityId;
  return cookieOfIdentity(ctx, identityId);
}

/** 分派视图的读取身份：可显式 viewIdentityRef，缺省同写身份。 */
async function viewCookieOf(
  ctx: HarnessContext,
  step: ScenarioStep,
  writeCookie: string,
): Promise<string> {
  if (!step.viewIdentityRef) return writeCookie;
  return cookieOfIdentity(ctx, step.viewIdentityRef);
}

function applyMutate(system: RegisterSystem, step: ScenarioStep): RegisterSystem {
  const mutate = step.mutate;
  const values = { ...(system.values ?? {}) };
  if (mutate?.omitValues) {
    for (const key of mutate.omitValues) delete values[key];
  }
  if (mutate?.setValues) {
    Object.assign(values, mutate.setValues);
  }
  let confirm = system.confirm;
  if (mutate?.setConfirm !== undefined) confirm = mutate.setConfirm;
  const spatialSource =
    mutate?.overrideSpatial !== undefined ? mutate.overrideSpatial : system.spatialSource;
  return {
    ...system,
    values,
    confirm,
    spatialSource,
  };
}

async function postRegister(
  ctx: HarnessContext,
  step: ScenarioStep,
  system: RegisterSystem,
  cookie: string,
): Promise<StepObservation> {
  const form = new FormData();
  form.set('sourceCode', system.sourceCode);
  form.set('domain', system.domain);
  if (system.types !== undefined) form.set('types', system.types.join(','));
  form.set('values', JSON.stringify(system.values ?? {}));
  if (system.confirm !== undefined) form.set('confirm', String(system.confirm));
  if (system.subjectUnknown !== undefined) {
    form.set('subjectUnknown', String(system.subjectUnknown));
  }
  if (system.anonymityConfirmed !== undefined) {
    form.set('anonymityConfirmed', String(system.anonymityConfirmed));
  }
  if (system.spatialSource !== undefined && system.spatialSource !== null) {
    const payload =
      typeof system.spatialSource === 'string'
        ? system.spatialSource
        : JSON.stringify(system.spatialSource);
    form.set(
      'spatial-source',
      new Blob([payload], { type: 'application/geo+json' }),
      'area.geojson',
    );
  }
  const idem =
    step.idempotencyKey ?? `vf-key-${step.id}-${Math.random().toString(36).slice(2)}`;
  const response = await fetch(`${ctx.baseUrl}/api/clues`, {
    method: 'POST',
    headers: {
      cookie,
      'idempotency-key': idem,
    },
    body: form,
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { http: { status: response.status }, body };
}

function requireClueId(step: ScenarioStep, run: ScenarioContext): string {
  if (run.clueId === '') throw new Error(`step ${step.id} 缺少上下文 clueId（需先 register-clue）`);
  return run.clueId;
}

async function resolveOrgUnitId(
  ctx: HarnessContext,
  step: ScenarioStep,
  cookie: string,
  run: ScenarioContext,
): Promise<string> {
  const code = step.orgUnitCode;
  if (!code) return '';
  const cached = run.orgUnitIds.get(code);
  if (cached) return cached;
  const tree = await jsonRequest(ctx, cookie, 'GET', '/api/org-units');
  if (tree.http.status !== 200) {
    throw new Error(`读取机构树失败：HTTP ${tree.http.status}`);
  }
  const found = listOf(tree.body.orgUnits).find((unit) => asText(unit.code) === code);
  const id = asText(found?.id);
  if (id === '') throw new Error(`机构树缺少编码 ${code}`);
  run.orgUnitIds.set(code, id);
  return id;
}

async function runStep(
  ctx: HarnessContext,
  step: ScenarioStep,
  run: ScenarioContext,
): Promise<StepResult> {
  const cookie = await cookieOf(ctx, step, run);

  if (step.action === 'register-clue') {
    if (!step.fromProfile || !step.path) {
      throw new Error(`step ${step.id} 需要 fromProfile 与 path`);
    }
    const profile = await loadProfile(step.fromProfile);
    const raw = getByPath(profile, step.path);
    if (!raw || typeof raw !== 'object') {
      throw new Error(`profile ${step.fromProfile} 缺少 ${step.path}`);
    }
    const system = applyMutate(raw as RegisterSystem, step);
    const observation = await postRegister(ctx, step, system, cookie);
    const clueId = asText(observation.body.id);
    if (clueId !== '') run.clueId = clueId;
    run.status = asText(observation.body.status);
    return {
      observation,
      pass: observation.http.status >= 200 && observation.http.status < 300 && clueId !== '',
      note: { clueId, status: run.status },
    };
  }

  if (step.action === 'read-dispatch') {
    const clueId = requireClueId(step, run);
    const observation = await jsonRequest(ctx, cookie, 'GET', `/api/clues/${clueId}/dispatch`);
    run.status = asText(observation.body.status);
    return {
      observation,
      pass: observation.http.status === 200,
      note: {
        status: run.status,
        suggestion: observation.body.suggestion ?? null,
        candidates: observation.body.candidates ?? null,
      },
    };
  }

  if (step.action === 'poll-verification') {
    const clueId = requireClueId(step, run);
    const attempts = Math.min(15, Math.max(1, step.pollAttempts ?? 10));
    const intervalMs = Math.max(0, step.pollIntervalMs ?? 500);
    const history: { attempt: number; http: number; verificationStatus: string; label: string }[] = [];
    let observation: StepObservation = { http: { status: 0 }, body: {} };
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      observation = await jsonRequest(
        ctx,
        cookie,
        'GET',
        `/api/clues/${clueId}/verification`,
      );
      const verificationStatus = asText(observation.body.verificationStatus);
      history.push({
        attempt,
        http: observation.http.status,
        verificationStatus,
        label: asText(observation.body.verificationStatusLabel),
      });
      if (observation.http.status !== 200 || TERMINAL_VERIFICATION.has(verificationStatus)) {
        break;
      }
      if (attempt < attempts) await sleep(intervalMs);
    }
    const finalStatus = history.at(-1)?.verificationStatus ?? '';
    // worker 没跑成或未起都只记录观测，不把整环判红。
    return {
      observation,
      pass: observation.http.status === 200 && OBSERVED_VERIFICATION.has(finalStatus),
      note: {
        action: 'poll-verification',
        attemptsUsed: history.length,
        finalVerificationStatus: finalStatus,
        history,
      },
    };
  }

  if (step.action === 'decide') {
    const clueId = requireClueId(step, run);
    const view = await jsonRequest(ctx, cookie, 'GET', `/api/clues/${clueId}/dispatch`);
    const status = asText(view.body.status);
    if (view.http.status !== 200) {
      return {
        observation: view,
        pass: false,
        note: { action: 'decide', step: 'read-view', status },
      };
    }
    if (status !== 'pending_decision') {
      run.status = status;
      return {
        observation: {
          http: { status: view.http.status },
          body: { result: 'skipped', reason: 'not-pending-decision', clueStatus: status },
        },
        pass: true,
        note: { action: 'decide', skipped: true, clueStatus: status, view: view.body },
      };
    }
    const observation = await jsonRequest(ctx, cookie, 'POST', `/api/clues/${clueId}/decide`, {
      decision: step.decision ?? 'dispatch',
      acknowledged: step.acknowledged ?? true,
      expectedStatus: step.expectedStatus ?? status,
      ...(step.conflictResolution !== undefined
        ? { conflictResolution: step.conflictResolution }
        : {}),
      ...(step.conflictBasis !== undefined ? { conflictBasis: step.conflictBasis } : {}),
    });
    run.status = asText(observation.body.status);
    return {
      observation,
      pass: observation.http.status === 200,
      note: { action: 'decide', decision: step.decision ?? 'dispatch', status: run.status },
    };
  }

  if (step.action === 'assign-org') {
    const clueId = requireClueId(step, run);
    let orgUnitId = '';
    if (step.orgUnitCode) {
      orgUnitId = await resolveOrgUnitId(ctx, step, cookie, run);
    } else if (step.orgUnitFrom === 'assignment') {
      const viewCookie = await viewCookieOf(ctx, step, cookie);
      const view = await jsonRequest(ctx, viewCookie, 'GET', `/api/clues/${clueId}/dispatch`);
      orgUnitId = asText(recordOf(view.body.assignment)?.orgUnitId);
    }
    if (orgUnitId === '') {
      throw new Error(`step ${step.id} 缺少 orgUnitCode 或可解析的 orgUnitFrom`);
    }
    const expectedStatus = step.expectedStatus ?? (run.status || 'in_pool');
    const observation = await jsonRequest(ctx, cookie, 'POST', `/api/clues/${clueId}/assign-org`, {
      orgUnitId,
      expectedStatus,
      reason: step.reason ?? '',
      designate: step.designate ?? false,
    });
    run.status = asText(observation.body.status);
    return {
      observation,
      pass: observation.http.status === 200,
      note: { action: 'assign-org', orgUnitId, expectedStatus, status: run.status },
    };
  }

  if (step.action === 'assign-people') {
    const clueId = requireClueId(step, run);
    const viewCookie = await viewCookieOf(ctx, step, cookie);
    const view = await jsonRequest(ctx, viewCookie, 'GET', `/api/clues/${clueId}/dispatch`);
    const viewStatus = asText(view.body.status);
    const candidates = listOf(view.body.candidates);
    const idOfCode = (code: string): string => {
      const found = candidates.find((person) => asText(person.code) === code);
      return asText(found?.personnelId);
    };
    const mainFrom = step.mainFrom ?? '';
    const mainId =
      mainFrom !== '' && mainFrom !== 'candidates'
        ? idOfCode(mainFrom)
        : asText(candidates[0]?.personnelId);
    if (mainId === '') {
      throw new Error(
        `step ${step.id} 无法从候选解析主办人选（mainFrom=${mainFrom}，viewHttp=${view.http.status}，viewStatus=${viewStatus}）`,
      );
    }
    const assistIds = (step.assistFrom ?? []).map(idOfCode).filter((id) => id !== '');
    const expectedStatus = step.expectedStatus ?? (run.status || viewStatus || 'org_assigned');
    const observation = await jsonRequest(
      ctx,
      cookie,
      'POST',
      `/api/clues/${clueId}/assign-people`,
      { mainId, assistIds, expectedStatus },
    );
    run.status = asText(observation.body.status);
    return {
      observation,
      pass: observation.http.status === 200,
      note: {
        action: 'assign-people',
        mainId,
        assistIds,
        expectedStatus,
        status: run.status,
      },
    };
  }

  throw new Error(`本轮 harness 不支持 action=${step.action}`);
}

/** 跑单个 API scenario，写证据；oracle 评末步观测。 */
export async function runApiScenario(
  ctx: HarnessContext,
  scenarioId: string,
  writer: EvidenceWriter,
): Promise<{ pass: boolean; observation: StepObservation | null }> {
  const scenario = await loadScenario(scenarioId);
  if (scenario.status !== 'runnable') {
    await writer.writeStep({
      scenarioId,
      stepId: 'skip',
      pass: false,
      expected: { status: 'runnable' },
      actual: { status: scenario.status },
      evidence: [],
    });
    return { pass: false, observation: null };
  }
  if (scenario.driver !== 'api') {
    await writer.writeStep({
      scenarioId,
      stepId: 'skip',
      pass: false,
      expected: { driver: 'api' },
      actual: { driver: scenario.driver ?? null },
      evidence: [],
    });
    return { pass: false, observation: null };
  }

  const run: ScenarioContext = {
    clueId: '',
    status: '',
    identityRef: scenario.identityRefs[0] ?? '',
    orgUnitIds: new Map(),
  };
  let last: StepResult | null = null;
  for (const step of scenario.steps) {
    last = await runStep(ctx, step, run);
    const isLast = step === scenario.steps[scenario.steps.length - 1];
    if (!isLast) {
      const evidence = {
        http: last.observation.http,
        body: last.observation.body,
        note: last.note ?? null,
      };
      await writer.writeStep(
        {
          scenarioId,
          stepId: step.id,
          pass: last.pass,
          expected: { note: 'intermediate' },
          actual: evidence,
          evidence: [`evidence/${scenarioId}/${step.id}-response.json`],
        },
        evidence,
      );
    }
  }

  if (!last) {
    await writer.writeStep({
      scenarioId,
      stepId: 'empty',
      pass: false,
      expected: { steps: 'non-empty' },
      actual: { steps: 0 },
      evidence: [],
    });
    return { pass: false, observation: null };
  }

  const asserts = scenario.oracle?.assert ?? [];
  const failures = evaluateOracle(last.observation, asserts);
  // 末步以 oracle 为准：负例的「正确拒绝」本身就是动作层面的非 2xx。
  const pass = failures.length === 0;
  const lastStep = scenario.steps[scenario.steps.length - 1];
  const evidence = {
    http: last.observation.http,
    body: last.observation.body,
    note: last.note ?? null,
    actionPass: last.pass,
  };
  await writer.writeStep(
    {
      scenarioId,
      stepId: lastStep.id,
      pass,
      expected: { assert: asserts },
      actual: evidence,
      evidence: [`evidence/${scenarioId}/${lastStep.id}-response.json`],
      failures,
    },
    evidence,
  );
  return { pass, observation: last.observation };
}

/** 跑一批 scenario，返回 summary。 */
export async function runApiScenarios(
  ctx: HarnessContext,
  scenarioIds: readonly string[],
): Promise<RunSummary> {
  const runId = newRunId();
  const writer = new EvidenceWriter(runId, [...scenarioIds]);
  await writer.init();
  let allPass = true;
  try {
    for (const id of scenarioIds) {
      const result = await runApiScenario(ctx, id, writer);
      if (!result.pass) allPass = false;
    }
    return writer.finish(allPass ? 'passed' : 'failed');
  } catch (error) {
    await writer.writeStep({
      scenarioId: '_harness',
      stepId: 'blocked',
      pass: false,
      expected: { ok: true },
      actual: { error: error instanceof Error ? error.message : String(error) },
      evidence: [],
    });
    return writer.finish('blocked');
  }
}

export type { ApiScenario, RunSummary };