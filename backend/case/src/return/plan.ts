// 退回计划（#238 第三节不变式）。纯函数，不写库。
// 回流不改已有材料：本计划没有材料写入。
// 环节实例只追加。链内退回不加次序号，拟制中记在退回记录上。
// 回流到调查后，E04 及以后的旧实例列入失效名单。失效用追加记录，不改实例行。

import { nextEntrySeq, stageIndex, type CaseStageCode } from '../state-machine/index.ts';

import { isReturnCode, isReturnStageDisabled, type ReturnCode, type ReturnStage } from './catalog.ts';
import {
  bothHandlersUnavailable,
  checkReceiver,
  type HandlerAvailability,
  type ReceiverCandidate,
} from './receiver.ts';
import {
  findTarget,
  returnTarget,
  returnsToInvestigation,
  type ReturnCaseContext,
  type ReturnExit,
  type ReturnTarget,
} from './target.ts';

export const RETURN_REFUSAL_REASONS = [
  'missing-return-reason',
  'missing-return-note',
  'missing-return-target',
  'missing-receiver',
  'return-target-not-allowed',
  'transition-disabled',
  'external-return',
  'receiver-not-allowed',
] as const;
export type ReturnRefusalReason = (typeof RETURN_REFUSAL_REASONS)[number];

export function returnFailureStatus(reason: ReturnRefusalReason): 400 | 409 {
  return reason === 'missing-return-reason' ? 400 : 409;
}

export interface ReturnInstanceFact {
  readonly id: string;
  readonly stage: string;
  readonly entrySeq: number;
}

export interface PlanReturnInput {
  readonly reasonCode: string;
  readonly note: string;
  readonly currentStage: ReturnStage | null;
  readonly targetKey: string | null;
  /** 当前环节进入次序号。链内退回原样返回。 */
  readonly currentEntrySeq: number | null;
  readonly inheritedCode: string | null;
  readonly defectiveStage: CaseStageCode | null;
  readonly earlierChainLevels: readonly string[];
  readonly instances: readonly ReturnInstanceFact[];
  readonly invalidatedInstanceIds: readonly string[];
  readonly receiver: ReceiverCandidate | null;
  readonly handlers: readonly HandlerAvailability[];
}

export interface ReturnPlan {
  readonly reasonCode: ReturnCode;
  readonly inheritedCode: string | null;
  readonly note: string;
  readonly target: ReturnTarget;
  readonly n5: boolean;
  readonly receiverId: string;
  /** 回流到调查时，E04 及以后尚未失效的实例。 */
  readonly invalidateInstanceIds: readonly string[];
  /** 回流时新实例的次序号。链内退回与出口为 null。 */
  readonly nextEntrySeq: number | null;
  /** 需要改案件指针时给出。出口与链内退回为 null。 */
  readonly pointer: { readonly stage: string; readonly entrySeq: number } | null;
  readonly rehearingRequired: boolean;
  readonly revokeNotice: boolean;
  readonly exit: ReturnExit | null;
  readonly noticeValidity: 'deferred' | null;
  /** 计划不写材料。回流只追加。 */
  readonly touchesMaterials: false;
}

export type PlanReturnResult =
  | { readonly ok: true; readonly plan: ReturnPlan }
  | {
      readonly ok: false;
      readonly reason: ReturnRefusalReason;
      readonly httpStatus: 400 | 409;
      readonly message: string;
      readonly outlet: string;
    };

const REFUSAL_TEXT: Readonly<Record<ReturnRefusalReason, { readonly message: string; readonly outlet: string }>> = {
  'missing-return-reason': { message: '退回原因必填', outlet: '选择退回原因' },
  'missing-return-note': { message: '退回说明必填', outlet: '填写说明' },
  'missing-return-target': { message: '退回点必填', outlet: '选择退回点' },
  'missing-receiver': { message: '退回接收人必填', outlet: '在允许范围内指定接收人' },
  'return-target-not-allowed': { message: '退回点不在该原因的允许集合内', outlet: '改选该原因允许的退回点' },
  'transition-disabled': { message: '目标环节尚未启用', outlet: '等该环节启用后再退回' },
  'external-return': { message: '外部退回不走本规则', outlet: '外部退回另立记录' },
  'receiver-not-allowed': { message: '接收人不在允许范围内', outlet: '改选主办、协办，或符合条件的其他接收人' },
};

function refuse(reason: ReturnRefusalReason): PlanReturnResult {
  const text = REFUSAL_TEXT[reason];
  return { ok: false, reason, httpStatus: returnFailureStatus(reason), message: text.message, outlet: text.outlet };
}

function contextOf(input: PlanReturnInput): ReturnCaseContext {
  return {
    defectiveStage: input.defectiveStage,
    earlierChainLevels: input.earlierChainLevels,
    inheritedCode: input.inheritedCode,
  };
}

/** 回流到调查后失效的下游：E04 及以后，已失效的不再列入。 */
export function investigationDownstreamIds(
  instances: readonly ReturnInstanceFact[],
  alreadyInvalidated: readonly string[],
): readonly string[] {
  const done = new Set(alreadyInvalidated);
  const floor = stageIndex('E04');
  return instances
    .filter((row) => stageIndex(row.stage) >= floor && !done.has(row.id))
    .map((row) => row.id);
}

function resolvedNeedsDefect(reasonCode: string, inheritedCode: string | null): boolean {
  return reasonCode === 'R5' || (reasonCode === 'R10' && inheritedCode === 'R5');
}

/**
 * 组装一次退回。失败不产生计划。
 * 顺序：原因、外部退回、说明、R10 退回点、目标是否允许、环节是否启用、接收人。
 */
export function planReturn(input: PlanReturnInput): PlanReturnResult {
  const reasonCode = input.reasonCode.trim();
  if (!isReturnCode(reasonCode)) return refuse('missing-return-reason');
  if (reasonCode === 'R3') return refuse('external-return');
  if (input.note.trim() === '') return refuse('missing-return-note');
  if (reasonCode === 'R10' && (input.inheritedCode === null || input.inheritedCode.trim() === '')) {
    return refuse('missing-return-target');
  }
  if (resolvedNeedsDefect(reasonCode, input.inheritedCode) && !input.defectiveStage) {
    return refuse('missing-return-target');
  }
  const listed = returnTarget(reasonCode, input.currentStage, contextOf(input));
  if (!listed.ok) {
    if (listed.reason === 'external-return') return refuse('external-return');
    if (listed.reason === 'missing-return-target') return refuse('missing-return-target');
    return refuse('missing-return-reason');
  }
  const key = input.targetKey?.trim() ?? '';
  if (key === '') return refuse('missing-return-target');
  const target = findTarget(listed.targets, key);
  if (!target) return refuse('return-target-not-allowed');
  if (target.kind === 'stage' && isReturnStageDisabled(target.stage)) return refuse('transition-disabled');
  if (!input.receiver) return refuse('missing-receiver');
  const receiver = checkReceiver(target, input.receiver, input.handlers);
  if (!receiver.ok) return refuse('receiver-not-allowed');

  const reflowStage = target.kind === 'stage';
  // 次序号只看环节和已有序号。status 不参与计算，这里补上是为了满足事实形状。
  const nextSeq = reflowStage
    ? nextEntrySeq(
        input.instances.map((row) => ({ stage: row.stage, entrySeq: row.entrySeq, status: 'drafting' })),
        target.stage,
      )
    : null;
  const invalidateInstanceIds =
    reflowStage && returnsToInvestigation(target)
      ? investigationDownstreamIds(input.instances, input.invalidatedInstanceIds)
      : [];
  return {
    ok: true,
    plan: {
      reasonCode: listed.code,
      inheritedCode: listed.inheritedCode,
      note: input.note.trim(),
      target,
      n5: receiver.n5,
      receiverId: input.receiver.personnelId,
      invalidateInstanceIds,
      nextEntrySeq: nextSeq,
      pointer: reflowStage && nextSeq !== null ? { stage: target.stage, entrySeq: nextSeq } : null,
      rehearingRequired: target.kind === 'stage' && target.rehearingRequired,
      revokeNotice: target.kind === 'stage' && target.revokeNotice,
      exit: target.kind === 'exit' ? target.exit : null,
      noticeValidity: listed.noticeValidity,
      touchesMaterials: false,
    },
  };
}

export function signatureReusable(instanceId: string, invalidatedInstanceIds: readonly string[]): boolean {
  return !invalidatedInstanceIds.includes(instanceId);
}

export function n5Applies(handlers: readonly HandlerAvailability[]): boolean {
  return bothHandlersUnavailable(handlers);
}
