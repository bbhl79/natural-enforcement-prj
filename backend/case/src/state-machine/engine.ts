// 迁移引擎的纯判定（#235）。不写库。
// 顺序：监督（X17）、承办机构（X13）、终态（X12）、阅读／导出／回证放行、再开审批链（X18）、
// 未知编号、未启用、起点不符、另一条审批链（X18）、调用方附加的警告或提示。
// #255：映射 409 之前看 authority 与 userLock。userLock 非空保持 block。
// law、regulation、system 为 block。normative、internal 降为 warn，不产生效果。
// 阻断不写业务行。警告与提示同样不写业务行，只留给调用方落失败留痕。

import {
  CASE_SUPERVISION_ROLE,
  findIllegal,
  findTransition,
  isTerminalCaseStatus,
  isX12Whitelisted,
  stageIndex,
  type CaseInstanceStatus,
  type CaseMainStatus,
  type CaseStageCode,
  type FromSpec,
  type ToSpec,
  type TransitionEdge,
} from './catalog.ts';
import type { GuardResult } from './guard.ts';

export interface StageInstanceFact {
  readonly stage: string;
  readonly entrySeq: number;
  readonly status: string;
}

/** 引擎判定时能看到的案件与操作者事实。调用方负责喂入，本文件不读库。 */
export interface TransitionSubject {
  readonly caseId: string | null;
  readonly mainStatus: string | null;
  readonly stage: string | null;
  readonly stageEntrySeq: number | null;
  readonly suspended: boolean;
  readonly markers: readonly string[];
  readonly clueStatus: string | null;
  readonly handlingOrgId: string | null;
  readonly proposedHandlingOrgId: string | null;
  readonly actorRoles: readonly string[];
  readonly otherInFlightChains: number;
  readonly instances: readonly StageInstanceFact[];
}

export type TransitionOperation =
  | { readonly kind: 'transition'; readonly transitionId: string }
  | { readonly kind: 'open-approval-chain'; readonly chainKind?: string }
  | { readonly kind: 'read' }
  | { readonly kind: 'export' }
  | { readonly kind: 'post-close-receipt' };

export interface PlannedInstance {
  readonly stage: CaseStageCode;
  readonly entrySeq: number;
  readonly status: CaseInstanceStatus;
  readonly transitionCode: string;
}

export interface TransitionEffects {
  readonly kind: 'open-case' | 'close-clue' | 'advance' | 'open-chain' | 'none';
  readonly transitionCode: string | null;
  readonly mainStatus: CaseMainStatus | null;
  readonly currentStage: CaseStageCode | null;
  readonly stageEntrySeq: number | null;
  readonly suspended: boolean | null;
  readonly instances: readonly PlannedInstance[];
}

export type TransitionDecision =
  | {
      readonly ok: false;
      readonly httpStatus: 409;
      readonly level: 'block';
      readonly reason: string;
      readonly message: string;
      readonly citation: string | null;
      readonly outlet: string;
    }
  | {
      readonly ok: false;
      readonly httpStatus: 200;
      readonly level: 'warn' | 'hint';
      readonly reason: string;
      readonly message: string;
      readonly citation: string | null;
      readonly advisories: readonly GuardResult[];
    }
  | {
      readonly ok: true;
      readonly effects: TransitionEffects;
      readonly advisories: readonly GuardResult[];
    };

export function nextEntrySeq(instances: readonly StageInstanceFact[], stage: string): number {
  const seqs = instances.filter((row) => row.stage === stage).map((row) => row.entrySeq);
  if (seqs.length === 0) return 1;
  return Math.max(...seqs) + 1;
}

function matchesOne(spec: FromSpec, subject: TransitionSubject, requiresSuspended: boolean): boolean {
  switch (spec.kind) {
    case 'clue':
      return subject.clueStatus === spec.status;
    case 'stage':
      return subject.stage === spec.stage && (!requiresSuspended || subject.suspended);
    case 'stages':
      return subject.stage !== null && (spec.stages as readonly string[]).includes(subject.stage);
    case 'main':
      return subject.mainStatus !== null && (spec.statuses as readonly string[]).includes(subject.mainStatus);
    case 'marker':
      return subject.markers.includes(spec.marker);
    case 'span': {
      const current = subject.stage === null ? -1 : stageIndex(subject.stage);
      const start = stageIndex(spec.start);
      const end = stageIndex(spec.end);
      return current >= start && current <= end;
    }
    case 'after': {
      const current = subject.stage === null ? -1 : stageIndex(subject.stage);
      return current >= stageIndex(spec.stage);
    }
    case 'any-handled':
      return subject.caseId !== null && subject.stage !== null;
    case 'side':
      return subject.markers.includes(spec.name);
  }
}

export function matchesFrom(edge: TransitionEdge, subject: TransitionSubject): boolean {
  const specs = Array.isArray(edge.from) ? edge.from : [edge.from];
  return specs.some((spec) => matchesOne(spec, subject, edge.requiresSuspended === true));
}

function refusal(
  reason: string,
  message: string,
  outlet: string,
  citation: string | null = null,
): TransitionDecision {
  return { ok: false, httpStatus: 409, level: 'block', reason, message, citation, outlet };
}

function nonEmptyLock(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/** userLock 非空（结果上或登记表上）保持阻断。否则只拦 law、regulation、system。 */
function keepsBlock(item: GuardResult): boolean {
  const registered = findIllegal(item.code)?.userLock;
  if (nonEmptyLock(item.userLock) || nonEmptyLock(registered)) return true;
  return item.authority === 'law' || item.authority === 'regulation' || item.authority === 'system';
}

function firstHardBlock(results: readonly GuardResult[]): GuardResult | null {
  return results.find((item) => item.level === 'block' && keepsBlock(item)) ?? null;
}

/** 尚未构成阻断的警告、提示，以及被层级降下来的阻断。 */
function softNotes(results: readonly GuardResult[]): GuardResult[] {
  const notes: GuardResult[] = [];
  for (const item of results) {
    if (item.level === 'warn' || item.level === 'hint') {
      notes.push(item);
      continue;
    }
    if (item.level === 'block' && !keepsBlock(item)) notes.push({ ...item, level: 'warn' });
  }
  return notes;
}

function illegalBlock(id: string, message: string): TransitionDecision {
  const row = findIllegal(id);
  const hit: GuardResult = {
    level: 'block',
    code: id,
    message,
    authority: row?.authority ?? 'system',
    ...(row?.citation ? { citation: row.citation } : {}),
    ...(row?.userLock ? { userLock: row.userLock } : {}),
  };
  if (!keepsBlock(hit)) return advisory([{ ...hit, level: 'warn' }]);
  return refusal(id, message, row?.outlet ?? '该操作不能继续', row?.citation ?? null);
}

function onlySupervision(roles: readonly string[]): boolean {
  return roles.length > 0 && roles.every((role) => role === CASE_SUPERVISION_ROLE);
}

function terminalBlocks(operation: TransitionOperation, subject: TransitionSubject): boolean {
  if (!subject.mainStatus || !isTerminalCaseStatus(subject.mainStatus)) return false;
  if (operation.kind === 'read' || operation.kind === 'export' || operation.kind === 'post-close-receipt') {
    return false;
  }
  if (operation.kind === 'transition' && isX12Whitelisted(operation.transitionId)) return false;
  return true;
}

function planInstance(
  instances: readonly StageInstanceFact[],
  stage: CaseStageCode,
  status: CaseInstanceStatus,
  transitionCode: string,
): PlannedInstance {
  return { stage, entrySeq: nextEntrySeq(instances, stage), status, transitionCode };
}

/** 按迁移的「到」组装只追加的实例与指针。不检查 enabled。 */
export function buildTransitionEffects(edge: TransitionEdge, subject: TransitionSubject): TransitionEffects | null {
  const code = edge.id;
  const to: ToSpec = edge.to;
  if (to.kind === 'open-case') {
    return {
      kind: 'open-case',
      transitionCode: code,
      mainStatus: 'in_progress',
      currentStage: 'E02',
      stageEntrySeq: 1,
      suspended: false,
      instances: [
        { stage: 'E01', entrySeq: 1, status: 'completed', transitionCode: code },
        { stage: 'E02', entrySeq: 1, status: 'drafting', transitionCode: code },
      ],
    };
  }
  if (to.kind === 'close-clue') {
    return {
      kind: 'close-clue',
      transitionCode: code,
      mainStatus: null,
      currentStage: null,
      stageEntrySeq: null,
      suspended: null,
      instances: [],
    };
  }
  if (to.kind === 'branch') return null;
  if (to.kind === 'same') {
    return {
      kind: 'advance',
      transitionCode: code,
      mainStatus: (subject.mainStatus as CaseMainStatus | null) ?? null,
      currentStage: (subject.stage as CaseStageCode | null) ?? null,
      stageEntrySeq: subject.stageEntrySeq,
      suspended: subject.suspended,
      instances: [],
    };
  }
  if (to.kind === 'overlay') {
    return {
      kind: 'advance',
      transitionCode: code,
      mainStatus: (subject.mainStatus as CaseMainStatus | null) ?? null,
      currentStage: (subject.stage as CaseStageCode | null) ?? null,
      stageEntrySeq: subject.stageEntrySeq,
      suspended: to.suspended,
      instances: [],
    };
  }
  if (to.kind === 'main') {
    return {
      kind: 'advance',
      transitionCode: code,
      mainStatus: to.status,
      currentStage: (subject.stage as CaseStageCode | null) ?? null,
      stageEntrySeq: subject.stageEntrySeq,
      suspended: to.status === 'in_progress' ? subject.suspended : false,
      instances: [],
    };
  }
  const instances: PlannedInstance[] = [];
  if (to.completeStage) {
    instances.push(planInstance(subject.instances, to.completeStage, 'completed', code));
  }
  const entered = planInstance(
    to.completeStage ? [...subject.instances, ...instances] : subject.instances,
    to.stage,
    to.instanceStatus,
    code,
  );
  instances.push(entered);
  return {
    kind: 'advance',
    transitionCode: code,
    mainStatus: to.mainStatus ?? ((subject.mainStatus as CaseMainStatus | null) ?? null),
    currentStage: to.stage,
    stageEntrySeq: entered.entrySeq,
    suspended: false,
    instances,
  };
}

function advisoriesOf(results: readonly GuardResult[]): GuardResult[] {
  return results.filter((item) => item.level === 'warn' || item.level === 'hint');
}

export function decideTransition(input: {
  readonly operation: TransitionOperation;
  readonly subject: TransitionSubject;
  readonly advisories?: readonly GuardResult[];
}): TransitionDecision {
  const subject = input.subject;
  const extra = input.advisories ?? [];

  if (onlySupervision(subject.actorRoles) && input.operation.kind !== 'read' && input.operation.kind !== 'export') {
    return illegalBlock('X17', '监督角色不能推进案件');
  }
  if (
    subject.caseId &&
    subject.proposedHandlingOrgId &&
    subject.handlingOrgId &&
    subject.proposedHandlingOrgId !== subject.handlingOrgId
  ) {
    return illegalBlock('X13', '立案后不能修改承办机构');
  }
  if (terminalBlocks(input.operation, subject)) {
    return illegalBlock('X12', '案件已终态，该业务写操作不能继续');
  }

  if (input.operation.kind === 'read' || input.operation.kind === 'export' || input.operation.kind === 'post-close-receipt') {
    return { ok: true, effects: emptyEffects(), advisories: advisoriesOf(extra) };
  }

  if (input.operation.kind === 'transition' && subject.mainStatus === 'terminated_pending') {
    if (input.operation.transitionId !== 'T06' && input.operation.transitionId !== 'T07') {
      return illegalBlock('X03', '待收尾状态下只能撤案或结案');
    }
  }

  if (input.operation.kind === 'open-approval-chain') {
    if (subject.mainStatus === 'terminated_pending' && input.operation.chainKind !== 'withdraw' && input.operation.chainKind !== 'close') {
      return illegalBlock('X03', '待收尾状态下只能撤案或结案');
    }
    if (subject.otherInFlightChains > 0) {
      return illegalBlock('X18', '本案已有进行中的审批链');
    }
    const hit = firstHardBlock(extra);
    if (hit) {
      const row = findIllegal(hit.code);
      return refusal(hit.code, hit.message, row?.outlet ?? '该操作不能继续', row?.citation ?? null);
    }
    const notes = softNotes(extra);
    if (notes.length > 0) return advisory(notes);
    return {
      ok: true,
      advisories: [],
      effects: {
        kind: 'open-chain',
        transitionCode: null,
        mainStatus: (subject.mainStatus as CaseMainStatus | null) ?? null,
        currentStage: (subject.stage as CaseStageCode | null) ?? null,
        stageEntrySeq: subject.stageEntrySeq,
        suspended: subject.suspended,
        instances: [],
      },
    };
  }

  const edge = findTransition(input.operation.transitionId);
  if (!edge) {
    return refusal('unknown-transition', '没有这条迁移', '使用已登记的迁移编号');
  }
  if (subject.suspended && advancesPastInvestigation(edge)) {
    return illegalBlock('X02', '中止期间不能推进到调查终结及以后');
  }
  if (!edge.enabled) {
    return refusal('transition-disabled', '该迁移尚未启用', '该迁移尚未由实现票启用');
  }
  if (!matchesFrom(edge, subject)) {
    return refusal('invalid-state', '当前环节或主状态不是该迁移的起点', '当前环节或主状态不是该迁移的起点');
  }
  if (edge.id === 'T03' && subject.suspended) {
    return refusal('invalid-state', '案件已处于中止', '中止期间可恢复或终止调查');
  }
  if (subject.otherInFlightChains > 0) {
    return illegalBlock('X18', '本案已有进行中的审批链');
  }
  const hit = firstHardBlock(extra);
  if (hit) {
    const row = findIllegal(hit.code);
    return refusal(hit.code, hit.message, row?.outlet ?? '该操作不能继续', hit.citation ?? row?.citation ?? null);
  }
  const notes = softNotes(extra);
  if (notes.length > 0) return advisory(notes);
  const effects = buildTransitionEffects(edge, subject);
  if (!effects) {
    return refusal('invalid-state', '该迁移的去向还不是单一落点', '该迁移尚未拆成可执行的单一去向');
  }
  return { ok: true, effects, advisories: [] };
}

/** 去向进入调查终结（E03）或更后的环节。中止期间这类迁移是 X02，不论该边是否已启用。 */
function advancesPastInvestigation(edge: TransitionEdge): boolean {
  const to = edge.to;
  if (to.kind !== 'enter') return false;
  if (stageIndex(to.stage) >= stageIndex('E03')) return true;
  return to.completeStage !== undefined && stageIndex(to.completeStage) >= stageIndex('E03');
}

function emptyEffects(): TransitionEffects {
  return {
    kind: 'none',
    transitionCode: null,
    mainStatus: null,
    currentStage: null,
    stageEntrySeq: null,
    suspended: null,
    instances: [],
  };
}

function advisory(notes: readonly GuardResult[]): TransitionDecision {
  const first = notes[0] as GuardResult;
  return {
    ok: false,
    httpStatus: 200,
    level: first.level === 'hint' ? 'hint' : 'warn',
    reason: first.code,
    message: first.message,
    citation: first.citation ?? null,
    advisories: notes,
  };
}
