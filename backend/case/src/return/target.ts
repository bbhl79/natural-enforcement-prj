// 退回点函数（#238）：returnTarget(原因, 当前环节, 案件上下文) → 允许的目标集合。
// R3 不经本函数。R4、R8 的告知有效性只留调用点，本票不判（#28 第四节，待有效性确认票）。

import { stageIndex, type CaseStageCode } from '../state-machine/catalog.ts';

import {
  FILING_RETURN_STAGE,
  findReturnReason,
  isInheritableReturnCode,
  isReturnCode,
  type ReturnCode,
  type ReturnInheritableCode,
  type ReturnStage,
} from './catalog.ts';

export const RETURN_EXITS = ['withdraw-after-terminate', 'no-penalty', 'transfer'] as const;
export type ReturnExit = (typeof RETURN_EXITS)[number];

export const RETURN_EXIT_NAMES: Readonly<Record<ReturnExit, string>> = {
  'withdraw-after-terminate': '终止调查后撤案',
  'no-penalty': '不予处罚',
  transfer: '移送',
};

export type ReturnTarget =
  | {
      readonly kind: 'exit';
      readonly key: `exit:${ReturnExit}`;
      readonly exit: ReturnExit;
      readonly reflow: false;
      readonly incrementEntrySeq: false;
    }
  | {
      readonly kind: 'stage';
      readonly key: `stage:${CaseStageCode}`;
      readonly stage: CaseStageCode;
      readonly reflow: true;
      readonly incrementEntrySeq: true;
      /** R2：回来后须重新提请审理。 */
      readonly rehearingRequired: boolean;
      /** R7：撤销原告知书。本票不执行撤销。 */
      readonly revokeNotice: boolean;
    }
  | {
      readonly kind: 'drafting';
      readonly key: `drafting:${string}`;
      readonly stage: ReturnStage;
      readonly reflow: false;
      readonly incrementEntrySeq: false;
    }
  | {
      readonly kind: 'chain';
      readonly key: `chain:${string}`;
      readonly level: string;
      readonly reflow: false;
      readonly incrementEntrySeq: false;
    };

export interface ReturnCaseContext {
  /** R5 有瑕疵的环节。缺了则允许集合为空。 */
  readonly defectiveStage?: CaseStageCode | null;
  /** R9 链内较早一级。调用方列出，本函数不发明级别。 */
  readonly earlierChainLevels?: readonly string[];
  /** R10 所选的 R1–R9。 */
  readonly inheritedCode?: string | null;
}

export type ReturnTargetResult =
  | {
      readonly ok: true;
      readonly code: ReturnCode;
      readonly inheritedCode: ReturnInheritableCode | null;
      readonly targets: readonly ReturnTarget[];
      /** R4、R8 告知有效性调用点。本票不判。 */
      readonly noticeValidity: 'deferred' | null;
    }
  | { readonly ok: false; readonly reason: 'external-return' | 'missing-return-target' | 'invalid-reason' };

/** 审理开始：当前环节在 E04 及以后。立案呈批链与空环节都算审理开始前。 */
export function hearingHasStarted(stage: ReturnStage | null): boolean {
  if (stage === null || stage === FILING_RETURN_STAGE) return false;
  return stageIndex(stage) >= stageIndex('E04');
}

function exitTarget(exit: ReturnExit): ReturnTarget {
  return { kind: 'exit', key: `exit:${exit}`, exit, reflow: false, incrementEntrySeq: false };
}

function stageTarget(
  stage: CaseStageCode,
  extra: { readonly rehearingRequired?: boolean; readonly revokeNotice?: boolean } = {},
): ReturnTarget {
  return {
    kind: 'stage',
    key: `stage:${stage}`,
    stage,
    reflow: true,
    incrementEntrySeq: true,
    rehearingRequired: extra.rehearingRequired === true,
    revokeNotice: extra.revokeNotice === true,
  };
}

function draftingTarget(stage: ReturnStage): ReturnTarget {
  return {
    kind: 'drafting',
    key: `drafting:${stage}`,
    stage,
    reflow: false,
    incrementEntrySeq: false,
  };
}

function chainTarget(level: string): ReturnTarget {
  return { kind: 'chain', key: `chain:${level}`, level, reflow: false, incrementEntrySeq: false };
}

/**
 * R4、R8 的告知有效性按 #28 第四节判。
 * 退回点只保留调用点；#248 在决定呈批闸口 assertValidityGate 统一判 A／B／C，
 * 因此返回值仍是 deferred，本函数不重复判。
 */
export function noticeValidityCallSite(code: 'R4' | 'R8'): 'deferred' {
  switch (code) {
    case 'R4':
    case 'R8':
      return 'deferred';
  }
}

function targetsOf(
  code: Exclude<ReturnCode, 'R3' | 'R10'>,
  currentStage: ReturnStage | null,
  context: ReturnCaseContext,
): { readonly targets: readonly ReturnTarget[]; readonly noticeValidity: 'deferred' | null } {
  switch (code) {
    case 'R1':
      // 批2 Q5：审理开始后已过追诉时效，与事实不成立同样走不予处罚。出口相同，不另设类型。
      return {
        targets: [exitTarget(hearingHasStarted(currentStage) ? 'no-penalty' : 'withdraw-after-terminate')],
        noticeValidity: null,
      };
    case 'R2':
      return { targets: [stageTarget('E02', { rehearingRequired: true })], noticeValidity: null };
    case 'R4':
      return { targets: [stageTarget('E04')], noticeValidity: noticeValidityCallSite('R4') };
    case 'R5':
      return {
        targets: context.defectiveStage ? [stageTarget(context.defectiveStage)] : [],
        noticeValidity: null,
      };
    case 'R6':
      return { targets: [exitTarget('transfer')], noticeValidity: null };
    case 'R7':
      return { targets: [stageTarget('E05', { revokeNotice: true })], noticeValidity: null };
    case 'R8':
      return {
        targets: currentStage === 'E09' ? [draftingTarget('E09')] : [],
        noticeValidity: noticeValidityCallSite('R8'),
      };
    case 'R9': {
      const targets: ReturnTarget[] = [];
      if (currentStage !== null) targets.push(draftingTarget(currentStage));
      for (const level of context.earlierChainLevels ?? []) {
        if (level.trim() !== '') targets.push(chainTarget(level.trim()));
      }
      return { targets, noticeValidity: null };
    }
  }
}

/** 允许的退回点。R3 与继承 R3 的 R10 返回 external-return，不给目标。 */
export function returnTarget(
  reason: string,
  currentStage: ReturnStage | null,
  context: ReturnCaseContext = {},
): ReturnTargetResult {
  if (!isReturnCode(reason) || !findReturnReason(reason)) {
    return { ok: false, reason: 'invalid-reason' };
  }
  if (reason === 'R3') return { ok: false, reason: 'external-return' };
  if (reason === 'R10') {
    const inherited = context.inheritedCode ?? '';
    if (!isInheritableReturnCode(inherited)) return { ok: false, reason: 'missing-return-target' };
    if (inherited === 'R3') return { ok: false, reason: 'external-return' };
    const inner = targetsOf(inherited, currentStage, context);
    return { ok: true, code: 'R10', inheritedCode: inherited, ...inner };
  }
  const inner = targetsOf(reason, currentStage, context);
  return { ok: true, code: reason, inheritedCode: null, ...inner };
}

export function targetKeys(targets: readonly ReturnTarget[]): readonly string[] {
  return targets.map((item) => item.key);
}

export function findTarget(targets: readonly ReturnTarget[], key: string): ReturnTarget | null {
  return targets.find((item) => item.key === key) ?? null;
}

/** 原因要求回调查：目标环节是 E02。 */
export function returnsToInvestigation(target: ReturnTarget): boolean {
  return target.kind === 'stage' && target.stage === 'E02';
}
