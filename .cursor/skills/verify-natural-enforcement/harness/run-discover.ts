// 日常跑批收口。调用既有枚举、对账、聚类、ack 与 diff。
// 只写 .run/discover/<runId>/。不调用 applyFailureClusters，不开票。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { classifyProposals } from './discover/classify-proposals.ts';
import {
  coarseAcks,
  filterAcked,
  type CoverageAck,
  type RunSnapshot,
} from './discover/diff-runs.ts';
import {
  enumerateApiRoutes,
  enumerateClueViews,
  enumerateFeatureMap,
  enumerateMenu,
  enumerateUiRoutes,
} from './discover/enumerate-capabilities.ts';
import { reconcileCapabilities, type ScenarioUsage } from './discover/reconcile.ts';
import { writeDiffReport, writeDiscoverJson } from './discover/report.ts';
import { checkNodeSources, type AssertedNode } from './discover/source-check.ts';
import type { UncoveredItem } from './discover/uncovered.ts';
import { clusterFailures, planClusterActions } from './discover/cluster-failures.ts';
import { loadCoverageAcks } from './load-coverage-acks.ts';
import { loadDiscoverSources } from './discover-sources.ts';
import { loadFailureRecords } from './load-failure-records.ts';
import { IndexDiskForkError, loadScenarioRegister } from './load-scenario-register.ts';
import { activeVerifyFault } from '../../../../backend/case/src/clue/dispatch/rules.ts';
import { planHistoryDiff } from './journey-isolation.ts';
import { repoRoot } from './paths.ts';
import { recordOf } from './record-of.ts';

const CALL_CHAIN = [
  'harness/run-auto-verification.sh',
  'harness/run-auto-verification.ts',
  'harness/evidence.ts EvidenceWriter.finish',
  'harness/run-discover.ts runDiscoverClose',
  'harness/load-scenario-register.ts loadScenarioRegister',
  'harness/load-coverage-acks.ts loadCoverageAcks',
  'harness/discover-sources.ts loadDiscoverSources',
  'harness/discover/enumerate-capabilities.ts enumerate*',
  'harness/discover/reconcile.ts reconcileCapabilities',
  'harness/discover/classify-proposals.ts classifyProposals',
  'harness/load-failure-records.ts loadFailureRecords',
  'harness/discover/cluster-failures.ts clusterFailures',
  'harness/discover/cluster-failures.ts planClusterActions',
  'harness/discover/report.ts writeDiffReport',
  'harness/discover/report.ts writeDiscoverJson',
] as const;

export interface DiscoverChannels {
  readonly api: 'passed' | 'failed' | 'blocked' | 'not-run';
  readonly ui: 'passed' | 'failed' | 'blocked' | 'not-run';
}

export interface DiscoverCloseInput {
  readonly root?: string;
  readonly runDir: string;
  readonly runId: string;
  readonly mode: string;
  readonly command: string;
  readonly channels: DiscoverChannels;
}

interface SectionCandidate {
  readonly id: string;
  readonly section: string;
  readonly text: string;
  readonly status: string;
  readonly reason: string;
}

function gitStateOf(root: string): { headSha: string; dirty: boolean; porcelain: string } {
  let headSha = 'unknown';
  try {
    headSha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    headSha = 'unknown';
  }
  let porcelain = '';
  try {
    porcelain = execFileSync('git', ['-C', root, 'status', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    porcelain = '';
  }
  return { headSha, dirty: porcelain.trim() !== '', porcelain };
}

async function readSection5(root: string): Promise<SectionCandidate[]> {
  const file = path.join(
    root,
    '.cursor/skills/verify-natural-enforcement/fixtures/journeys/clue-dispatch-baseline/section5.json',
  );
  const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as { candidates?: SectionCandidate[] };
  return parsed.candidates ?? [];
}

function assertedFrom(candidates: readonly SectionCandidate[]): AssertedNode[] {
  return candidates.map((item) => ({
    nodeId: item.id,
    legalBasis: [{ documentName: item.section, articleNo: item.section }],
    roleBasis: [],
  }));
}

async function readSummaryUncovered(
  runDir: string,
): Promise<{ status: RunSnapshot['status']; uncovered: UncoveredItem[] } | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(runDir, 'summary.json'), 'utf8'));
    const record = recordOf(parsed);
    if (record === null || !Array.isArray(record.uncovered)) return null;
    const status = record.status;
    if (status !== 'passed' && status !== 'failed' && status !== 'blocked') return null;
    return { status, uncovered: record.uncovered as UncoveredItem[] };
  } catch {
    return null;
  }
}

async function readManifestTimes(runDir: string): Promise<{ startedAt: string; endedAt: string | null } | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    const record = recordOf(parsed);
    if (record === null || typeof record.startedAt !== 'string') return null;
    return {
      startedAt: record.startedAt,
      endedAt: typeof record.endedAt === 'string' ? record.endedAt : null,
    };
  } catch {
    return null;
  }
}

async function loadHistory(
  root: string,
  currentRunId: string,
): Promise<{ snapshots: RunSnapshot[]; skipped: string[] }> {
  const runRoot = path.join(root, '.run');
  let names: string[] = [];
  try {
    names = await fs.readdir(runRoot);
  } catch {
    return { snapshots: [], skipped: [] };
  }
  const snapshots: RunSnapshot[] = [];
  const skipped: string[] = [];
  for (const name of names) {
    if (!name.startsWith('verify-')) continue;
    const runDir = path.join(runRoot, name);
    const times = await readManifestTimes(runDir);
    const summary = await readSummaryUncovered(runDir);
    if (times === null || summary === null) {
      skipped.push(name);
      continue;
    }
    const runId = name.slice('verify-'.length);
    if (runId === currentRunId) continue;
    snapshots.push({
      runId,
      status: summary.status,
      startedAt: times.startedAt,
      endedAt: times.endedAt,
      uncovered: summary.uncovered,
    });
  }
  return { snapshots, skipped };
}

async function scenarioUsages(root: string, runnableIds: readonly string[]): Promise<ScenarioUsage[]> {
  const dir = path.join(root, '.cursor/skills/verify-natural-enforcement/fixtures/scenarios/runnable');
  const usages: ScenarioUsage[] = [];
  for (const scenarioId of runnableIds) {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, `${scenarioId}.json`), 'utf8')) as {
      status?: string;
      featureMapRefs?: string[];
      steps?: { action?: string }[];
    };
    if (parsed.status !== 'runnable') {
      throw new Error(`runnable 登记 ${scenarioId} 的 status=${String(parsed.status)}，拒绝提拔或降级`);
    }
    usages.push({
      scenarioId,
      status: 'runnable',
      featureMapRefs: parsed.featureMapRefs ?? [],
      actions: (parsed.steps ?? []).map((step) => step.action ?? '').filter((action) => action !== ''),
    });
  }
  return usages;
}

/** 收口一次跑批。缺关键输入写入报告并给出非零 exitSuggestion，不用空数组表示零缺口。 */
export async function runDiscoverClose(input: DiscoverCloseInput): Promise<{
  reportPath: string;
  exitSuggestion: 0 | 1 | 2;
}> {
  const root = input.root ?? repoRoot();
  const missingInputs: { name: string; status: 'unevaluated' | 'failed'; reason: string }[] = [];
  const candidates = await readSection5(root);
  const sourceChecks = checkNodeSources(assertedFrom(candidates));

  let register: Awaited<ReturnType<typeof loadScenarioRegister>> | null = null;
  let indexDisk: { status: 'ok' | 'fork'; detail?: unknown } = { status: 'ok' };
  try {
    register = await loadScenarioRegister(root);
  } catch (error) {
    if (error instanceof IndexDiskForkError) {
      indexDisk = { status: 'fork', detail: error.fork };
      missingInputs.push({
        name: 'scenario-index',
        status: 'failed',
        reason: error.message,
      });
    } else {
      missingInputs.push({
        name: 'scenario-index',
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let acks: CoverageAck[] = [];
  try {
    acks = await loadCoverageAcks(root);
  } catch (error) {
    missingInputs.push({
      name: 'coverage-acks',
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  missingInputs.push(
    {
      name: 'mappedEndpoints',
      status: 'unevaluated',
      reason: '无已核标准链端点登记。api-uncovered 不计算。缺少该输入不是零缺口。',
    },
    {
      name: 'mappedRoutes',
      status: 'unevaluated',
      reason: '无已核标准链路由登记。reverse-drift 不计算。缺少该输入不是零缺口。',
    },
  );

  let proposals: {
    status: 'evaluated' | 'not-run';
    actionable?: unknown[];
    classified?: { planned: unknown[]; intentionalLatent: unknown[] };
    reason?: string;
  } = { status: 'not-run', reason: '对账未跑' };

  if (register !== null && indexDisk.status === 'ok') {
    const sources = await loadDiscoverSources(root);
    const menu = enumerateMenu({
      menuSource: sources.menuSource,
      clueViews: enumerateClueViews(sources.clueUrlSource),
    });
    const usages = [
      ...(await scenarioUsages(root, register.runnableIds)),
      ...register.latent.map((item) => ({
        scenarioId: item.scenarioId,
        status: 'latent' as const,
        featureMapRefs: item.featureMapRefs,
        actions: [],
      })),
    ];
    const reconciled = reconcileCapabilities({
      apiRoutes: enumerateApiRoutes(sources.controllers),
      uiRoutes: enumerateUiRoutes(sources.routerSource),
      menu,
      featureMap: enumerateFeatureMap(sources.featureMapSource),
      scenarios: usages,
      register: { stages: [] },
      assertedNodes: assertedFrom(candidates),
      acks,
    });
    const classified = classifyProposals(reconciled.proposals, {
      plannedPaths: [
        ...menu.planned.map((item) => item.path),
        ...menu.primaries.filter((item) => item.planned).map((item) => item.path),
        ...menu.secondaries.filter((item) => item.planned).map((item) => item.path),
      ],
      latentNodeIds: register.latent.flatMap((item) => item.featureMapRefs),
    });
    proposals = {
      status: 'evaluated',
      actionable: classified.actionable,
      classified: {
        planned: classified.planned,
        intentionalLatent: classified.intentionalLatent,
      },
    };
  }

  const records = await loadFailureRecords([input.runDir]).catch((error: unknown) => {
    missingInputs.push({
      name: 'failure-records',
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    });
    return [];
  });
  const clusters = clusterFailures(records);
  const clusterActionsDryRun = planClusterActions(clusters, []);

  const summary = await readSummaryUncovered(input.runDir);
  const times = await readManifestTimes(input.runDir);
  const history = await loadHistory(root, input.runId);
  const requestedBaseline = process.env.VERIFY_DIFF_BASELINE ?? '';
  const diffPlan = planHistoryDiff(
    requestedBaseline,
    history.snapshots.map((item) => ({
      runId: item.runId,
      status: item.status,
      endedAt: item.endedAt,
    })),
  );
  const ignored = coarseAcks(acks);
  let diffBody: {
    status: 'compared' | 'first-run' | 'not-run' | 'baseline-missing' | 'blocked-baseline' | 'interrupted';
    compared: boolean;
    baselineRunId: string | null;
    added?: UncoveredItem[];
    removed?: UncoveredItem[];
    coarseAcksIgnored?: CoverageAck[];
    reason?: string;
    historySkipped: string[];
  };
  if (summary === null || times === null) {
    diffBody = {
      status: 'not-run',
      compared: false,
      baselineRunId: null,
      reason: '当前跑次缺少 summary.uncovered 或 manifest。不把缺省当成零缺口。',
      historySkipped: history.skipped,
    };
    missingInputs.push({
      name: 'current-uncovered',
      status: 'failed',
      reason: 'summary.uncovered 或 manifest 缺失',
    });
  } else if (input.channels.api === 'blocked') {
    diffBody = {
      status: 'not-run',
      compared: false,
      baselineRunId: diffPlan.baselineRunId,
      reason: '当前跑次 api 通道为 blocked。阻塞不入账，也不把 uncovered 写成业务零缺口。',
      historySkipped: history.skipped,
    };
  } else if (diffPlan.status !== 'compared' || diffPlan.baselineRunId === null) {
    filterAcked(summary.uncovered, acks);
    diffBody = {
      status: diffPlan.status === 'compared' ? 'first-run' : diffPlan.status,
      compared: false,
      baselineRunId: diffPlan.baselineRunId,
      coarseAcksIgnored: ignored,
      reason:
        diffPlan.status === 'first-run'
          ? '无历史入账跑次。未把当前 uncovered 写成跨跑次 added。'
          : `历史比较未进行：${diffPlan.status}。`,
      historySkipped: history.skipped,
    };
  } else {
    const current: RunSnapshot = {
      runId: input.runId,
      status: summary.status,
      startedAt: times.startedAt,
      endedAt: times.endedAt,
      uncovered: summary.uncovered,
    };
    const chosen = history.snapshots.find((item) => item.runId === diffPlan.baselineRunId);
    const diff = await writeDiffReport({
      current,
      history: chosen === undefined ? [] : [chosen],
      acks,
      root,
    });
    diffBody = {
      status: 'compared',
      compared: true,
      baselineRunId: diff.baselineRunId,
      added: diff.added,
      removed: diff.removed,
      coarseAcksIgnored: diff.coarseAcksIgnored,
      reason: 'added 与 removed 是相对基线的机械 uncovered。权威条目见 authorityItems。',
      historySkipped: history.skipped,
    };
  }

  const git = gitStateOf(root);
  const fault = activeVerifyFault({
    VERIFY_FAULT: process.env.VERIFY_FAULT,
    NE_DEPLOYMENT: process.env.NE_DEPLOYMENT,
    NODE_ENV: process.env.NODE_ENV,
    COMPOSE_PROJECT_NAME: process.env.COMPOSE_PROJECT_NAME,
    VERIFY_ISOLATION: process.env.VERIFY_ISOLATION,
  });
  const slicePassed = input.mode === 'journey' && input.channels.api === 'passed';
  const report = {
    schema: 'verify-discover-report/1',
    runId: input.runId,
    headSha: git.headSha,
    dirty: git.dirty,
    dirtyPorcelain: git.dirty ? git.porcelain : '',
    mode: input.mode,
    command: input.command,
    faultActive: fault ?? '',
    callChain: CALL_CHAIN,
    channels: input.channels,
    uiNote: '本切片不调用 UI。ui 通道 not-run 不是 UI 汇合通过。',
    claims: {
      fullJourney: false,
      uiConverged: false,
      flagContract: slicePassed ? 'asserted' : 'not-run',
      writeAuthorization: 'untested',
      writeNote: '未发送 assign-people。mayAssignPeople 只是读响应旗标。真实写授权未测。',
    },
    journeyAcceptance: slicePassed ? 'api-read-union-flag-only' : 'not-accepted',
    sourceGate: {
      bypassed: false,
      composePassthrough: 'NE_SOURCE_GATE_ALLOWED_SOURCES',
      liveAuth: 'not-run',
    },
    injectRestore: 'not-run',
    indexDisk,
    latentUnverified:
      register === null
        ? { status: 'not-run', reason: '登记加载失败。不把空名单当成没有 latent。' }
        : { status: 'listed', items: register.latent },
    diff: diffBody,
    clusters,
    clusterActionsDryRun,
    ticketsOpened: false,
    proposals,
    authorityItems: candidates,
    sourceChecks,
    missingInputs,
    nextSteps: [
      '读并集切片：VERIFY_PHASE=journey 跑 vf-sc-journey-read-union。',
      '注入：同一命令加 VERIFY_FAULT=drop-assigned-org-read。恢复：去掉该变量再跑。',
      '签收是产品差距，不在本轮造功能。',
      'TE 在 docker、SourceGate 与目录访问核过之前，不把 blocked 跑次当成切片通过。',
    ],
    evidenceRefs: [input.runDir, path.join(input.runDir, 'call-sites.json')],
  };

  const reportPath = await writeDiscoverJson({
    root,
    runId: input.runId,
    name: 'discover-report.json',
    body: report,
  });

  const productBad = input.channels.api === 'failed' || input.channels.ui === 'failed';
  const blocked = input.channels.api === 'blocked' || input.channels.ui === 'blocked';
  const fork = indexDisk.status === 'fork' || missingInputs.some((item) => item.status === 'failed');
  let exitSuggestion: 0 | 1 | 2 = 0;
  if (productBad || blocked || fork) exitSuggestion = 1;
  else if (input.mode === 'journey' && input.channels.api !== 'passed') exitSuggestion = 2;
  return { reportPath, exitSuggestion };
}
