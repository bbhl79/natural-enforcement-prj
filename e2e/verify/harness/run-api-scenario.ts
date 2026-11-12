// 用途：逐步执行一个 API 场景的登记、分派、查重等动作，写步骤证据并按 oracle 判定结果。
// 调用方：run-api-suite.ts、run-auto-verification.ts、run-next-todo-buttons.ts、integration/verify-skill-loop.test.ts。
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
import { recordOf } from './record-of.ts';
import { BUTTON_FLAGS } from './dispatch-buttons.ts';

/** 执行场景所需的运行环境：基地址与按身份缓存的会话。 */
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

/**
 * 把本步面平移到一块空域。同一 VERIFY_SPATIAL_SALT 下，相对位置保持不变。
 * 待派机构与待分派决定两条仍重合。已派机构那条保持原有间隔，不与它们重合。
 */
function isolateSpatial(spatial: unknown, enabled: boolean): unknown {
  if (!enabled || spatial === null || spatial === undefined) return spatial;
  const digits = (process.env.VERIFY_SPATIAL_SALT ?? '').replace(/\D/g, '');
  const salt = digits.length > 0 ? Number.parseInt(digits.slice(-8), 10) : Date.now() % 1_000_000_000;
  const cell = salt % 6400;
  const col = cell % 80;
  const row = Math.floor(cell / 80);
  const dx = 5 + col * 0.02;
  const dy = 5 + row * 0.02;
  return shiftPositions(spatial, dx, dy);
}

function shiftPositions(value: unknown, dx: number, dy: number): unknown {
  if (!Array.isArray(value)) {
    if (typeof value !== 'object' || value === null) return value;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) next[key] = shiftPositions(item, dx, dy);
    return next;
  }
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    return [value[0] + dx, value[1] + dy, ...value.slice(2)];
  }
  return value.map((item) => shiftPositions(item, dx, dy));
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
  const spatialSource = isolateSpatial(
    mutate?.overrideSpatial !== undefined ? mutate.overrideSpatial : system.spatialSource,
    mutate?.isolateSpatial === true,
  );
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

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function readText(
  ctx: HarnessContext,
  cookie: string,
  path: string,
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${ctx.baseUrl}${path}`, { headers: { cookie } });
  return { status: response.status, text: await response.text() };
}

function layerRows(body: Record<string, unknown>): readonly Record<string, unknown>[] {
  const current = recordOf(body.current);
  return listOf(current?.layers);
}

/** 把核查、报告、分析图、查重、分派收成 oracle 能点到的 facts。 */
async function readSideEffects(
  ctx: HarnessContext,
  step: ScenarioStep,
  run: ScenarioContext,
  cookie: string,
): Promise<StepResult> {
  const clueId = requireClueId(step, run);
  const verification = await jsonRequest(ctx, cookie, 'GET', `/api/clues/${clueId}/verification`);
  const duplicate = await jsonRequest(ctx, cookie, 'GET', `/api/clues/${clueId}/duplicates`);
  const dispatch = await jsonRequest(ctx, cookie, 'GET', `/api/clues/${clueId}/dispatch`);
  const report = await readText(ctx, cookie, `/api/clues/${clueId}/verification/report`);
  const analysis = await readText(ctx, cookie, `/api/clues/${clueId}/verification/analysis`);

  let otherDispatch: Record<string, unknown> | null = null;
  if (step.dispatchIdentityRef) {
    const otherCookie = await cookieOfIdentity(ctx, step.dispatchIdentityRef);
    const viewed = await jsonRequest(ctx, otherCookie, 'GET', `/api/clues/${clueId}/dispatch`);
    otherDispatch = {
      identityRef: step.dispatchIdentityRef,
      http: viewed.http.status,
      status: asText(viewed.body.status),
      mayDecide: viewed.body.mayDecide === true,
      mayAssignOrg: viewed.body.mayAssignOrg === true,
    };
  }

  let listRow: Record<string, unknown> | null = null;
  if (step.listIdentityRef) {
    const listCookie = await cookieOfIdentity(ctx, step.listIdentityRef);
    const listed = await jsonRequest(
      ctx,
      listCookie,
      'GET',
      '/api/clues?view=assign&page=1&size=100',
    );
    const row = listOf(listed.body.rows).find((item) => asText(item.id) === clueId) ?? null;
    listRow = {
      identityRef: step.listIdentityRef,
      http: listed.http.status,
      found: row !== null,
      status: asText(row?.status),
      verificationStatus: asText(row?.verificationStatus),
    };
  }

  const layers = layerRows(verification.body);
  const states = layers.map((layer) => asText(layer.state));
  const reasons = layers.map((layer) => asText(layer.unavailableReason)).filter((reason) => reason !== '');
  const positiveRatios = layers
    .map((layer) => asNumber(layer.overlapRatio))
    .filter((ratio): ratio is number => ratio !== null && ratio > 0);
  const current = recordOf(verification.body.current);
  const runs = listOf(verification.body.runs);
  const missing = listOf(current?.missingLayers).map((layer) => asText(layer.name)).filter((name) => name !== '');
  const groups = listOf(duplicate.body.groups);
  const ratios = groups.flatMap((group) =>
    listOf(group.faces)
      .map((face) => asNumber(face.selfRatio))
      .filter((ratio): ratio is number => ratio !== null),
  );
  let reportOverlapAreas: number[] = [];
  let analysisKinds: string[] = [];
  try {
    const parsed = JSON.parse(report.text) as { layers?: { overlapArea?: number }[] };
    reportOverlapAreas = (parsed.layers ?? [])
      .map((layer) => layer.overlapArea)
      .filter((area): area is number => typeof area === 'number');
  } catch {
    reportOverlapAreas = [];
  }
  try {
    const parsed = JSON.parse(analysis.text) as { features?: { properties?: { kind?: string } }[] };
    analysisKinds = (parsed.features ?? [])
      .map((feature) => feature.properties?.kind ?? '')
      .filter((kind) => kind !== '');
  } catch {
    analysisKinds = [];
  }

  const facts = {
    domain: asText(verification.body.domain),
    verificationStatus: asText(verification.body.verificationStatus),
    verificationStatusLabel: asText(verification.body.verificationStatusLabel),
    clueStatus: asText(verification.body.clueStatus),
    canRetry: verification.body.canRetry === true,
    trigger: asText(current?.trigger),
    triggers: runs.map((item) => asText(item.trigger)),
    runNo: asNumber(current?.runNo) ?? 0,
    failureCategory: current?.failureCategory ?? null,
    missingLayerNames: missing,
    layerStates: states,
    unavailableReasons: reasons,
    overlappedCount: states.filter((state) => state === 'overlapped').length,
    noOverlapCount: states.filter((state) => state === 'no_overlap').length,
    unavailableCount: states.filter((state) => state === 'unavailable').length,
    positiveOverlapRatios: positiveRatios,
    hasArtifacts: verification.body.artifacts !== null && verification.body.artifacts !== undefined,
    reportHttp: report.status,
    analysisHttp: analysis.status,
    reportOverlapAreas,
    analysisKinds,
    duplicateGroupCount: groups.length,
    maxSelfRatio: ratios.length === 0 ? 0 : Math.max(...ratios),
    mayDecide: dispatch.body.mayDecide === true,
    mayAssignOrg: dispatch.body.mayAssignOrg === true,
    dispatchStatus: asText(dispatch.body.status),
    otherDispatch,
    listRow,
  };
  const observation: StepObservation = {
    http: { status: verification.http.status },
    body: { facts, verification: verification.body, duplicate: duplicate.body, dispatch: dispatch.body },
  };
  const pass =
    verification.http.status === 200 &&
    duplicate.http.status === 200 &&
    dispatch.http.status === 200;
  return {
    observation,
    pass,
    note: { action: 'read-side-effects', clueId, facts },
  };
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
    const attempts = Math.min(60, Math.max(1, step.pollAttempts ?? 10));
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
    const expectedStatus = step.expectVerificationStatus ?? '';
    // 未收紧时：worker 没跑成或未起都只记录观测，不把整环判红。
    // 收紧后：只有落到指定核查状态才算过。空地址失败与图层查成用的是这条。
    const statusOk =
      expectedStatus === ''
        ? OBSERVED_VERIFICATION.has(finalStatus)
        : finalStatus === expectedStatus;
    return {
      observation,
      pass: observation.http.status === 200 && statusOk,
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

  if (step.action === 'retry-verification') {
    const clueId = requireClueId(step, run);
    const observation = await jsonRequest(ctx, cookie, 'POST', `/api/clues/${clueId}/verification/retry`);
    return {
      observation,
      pass: observation.http.status === 200,
      note: {
        action: 'retry-verification',
        verificationStatus: asText(observation.body.verificationStatus),
      },
    };
  }

  if (step.action === 'read-side-effects') {
    return readSideEffects(ctx, step, run, cookie);
  }

  if (step.action === 'read-dispatch-buttons') {
    return readDispatchButtons(ctx, step, run);
  }

  throw new Error(`本轮 harness 不支持 action=${step.action}`);
}

/**
 * 各身份自己读分派视图。
 * 未派机构时，承办机构内勤得到 403 scope-denied。
 * 已派到该承办机构时得到 200。readScope 记为 entered-or-assigned-org。
 */
async function readDispatchButtons(
  ctx: HarnessContext,
  step: ScenarioStep,
  run: ScenarioContext,
): Promise<StepResult> {
  const clueId = requireClueId(step, run);
  const matrix = step.matrix ?? [];
  if (matrix.length === 0) throw new Error(`step ${step.id} 缺少 matrix`);
  const rows: Record<string, unknown>[] = [];
  const misses: string[] = [];
  for (const expect of matrix) {
    const cookie = await cookieOfIdentity(ctx, expect.identityRef);
    const viewed = await jsonRequest(ctx, cookie, 'GET', `/api/clues/${clueId}/dispatch`);
    const listed = await jsonRequest(
      ctx,
      cookie,
      'GET',
      '/api/clues?view=assign&page=1&size=100',
    );
    const found =
      listed.http.status === 200 &&
      listOf(listed.body.rows).some((item) => asText(item.id) === clueId);
    const row = {
      identityRef: expect.identityRef,
      http: viewed.http.status,
      reason: asText(viewed.body.reason),
      status: asText(viewed.body.status),
      mayDecide: viewed.body.mayDecide === true,
      mayAssignOrg: viewed.body.mayAssignOrg === true,
      mayAssignPeople: viewed.body.mayAssignPeople === true,
      mayReassignOrg: viewed.body.mayReassignOrg === true,
      listedInAssignView: found,
    };
    rows.push(row);
    if (row.http !== expect.http) misses.push(`${expect.identityRef} http=${row.http}`);
    if (expect.reason !== undefined && row.reason !== expect.reason) {
      misses.push(`${expect.identityRef} reason=${row.reason}`);
    }
    for (const flag of BUTTON_FLAGS) {
      if (expect[flag] !== undefined && row[flag] !== expect[flag]) {
        misses.push(`${expect.identityRef} ${flag}=${String(row[flag])}`);
      }
    }
  }
  const readable = rows.find((row) => row.http === 200);
  const clueStatus = asText(readable?.status);
  if (clueStatus !== '') run.status = clueStatus;
  if (step.expectClueStatus !== undefined && clueStatus !== step.expectClueStatus) {
    misses.push(`clueStatus=${clueStatus}`);
  }
  const facts = { clueStatus, rows };
  return {
    observation: {
      http: { status: 200 },
      body: {
        result: 'button-matrix',
        readScope: 'entered-or-assigned-org',
        facts,
      },
    },
    pass: misses.length === 0,
    note: { action: 'read-dispatch-buttons', clueId, misses, facts },
  };
}

/** 跑单个 API scenario，写证据；oracle 评末步观测。 */
export async function runApiScenario(
  ctx: HarnessContext,
  scenarioId: string,
  writer: EvidenceWriter,
): Promise<{ pass: boolean; observation: StepObservation | null }> {
  const scenario = await loadScenario(scenarioId);
  // 注册元数据供 finish() 推导 uncovered（featureMapRef、matrix 未核开关）。
  writer.registerScenario(scenarioId, scenario);
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
  let stepsPass = true;
  for (const step of scenario.steps) {
    last = await runStep(ctx, step, run);
    if (!last.pass) stepsPass = false;
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
  // strictSteps 另要求中间步也过，避免轮询没落到指定状态仍被末步 oracle 放过。
  const pass = failures.length === 0 && (scenario.strictSteps !== true || stepsPass);
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