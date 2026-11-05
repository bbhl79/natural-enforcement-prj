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
): Promise<StepObservation> {
  const identityId = step.identityRef;
  if (!identityId) throw new Error(`step ${step.id} 缺少 identityRef`);
  const identity = await loadIdentity(identityId);
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
      cookie: await ctx.sessions.cookieOf(identity),
      'idempotency-key': idem,
    },
    body: form,
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { http: { status: response.status }, body };
}

async function runStep(
  ctx: HarnessContext,
  step: ScenarioStep,
): Promise<StepObservation> {
  if (step.action !== 'register-clue') {
    throw new Error(`本轮 harness 不支持 action=${step.action}`);
  }
  if (!step.fromProfile || !step.path) {
    throw new Error(`step ${step.id} 需要 fromProfile 与 path`);
  }
  const profile = await loadProfile(step.fromProfile);
  const raw = getByPath(profile, step.path);
  if (!raw || typeof raw !== 'object') {
    throw new Error(`profile ${step.fromProfile} 缺少 ${step.path}`);
  }
  const system = applyMutate(raw as RegisterSystem, step);
  return postRegister(ctx, step, system);
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

  let last: StepObservation | null = null;
  for (const step of scenario.steps) {
    last = await runStep(ctx, step);
    const isLast = step === scenario.steps[scenario.steps.length - 1];
    if (!isLast) {
      await writer.writeStep(
        {
          scenarioId,
          stepId: step.id,
          pass: true,
          expected: { note: 'intermediate' },
          actual: { http: last.http, body: last.body },
          evidence: [`evidence/${scenarioId}/${step.id}-response.json`],
        },
        last,
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
  const failures = evaluateOracle(last, asserts);
  const pass = failures.length === 0;
  const lastStep = scenario.steps[scenario.steps.length - 1];
  await writer.writeStep(
    {
      scenarioId,
      stepId: lastStep.id,
      pass,
      expected: { assert: asserts },
      actual: { http: last.http, body: last.body },
      evidence: [`evidence/${scenarioId}/${lastStep.id}-response.json`],
      failures,
    },
    last,
  );
  return { pass, observation: last };
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
