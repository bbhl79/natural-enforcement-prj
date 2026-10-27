// 退回原因目录（#238，#28/6409849846 第二节）。
// R3 不经 returnTarget。R1、R6 本票只给出出口类型。

import type { CaseStageCode } from '../state-machine/catalog.ts';

export const RETURN_CODES = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'] as const;
export type ReturnCode = (typeof RETURN_CODES)[number];

/** R10 只能继承 R1–R9 的退回点。 */
export const RETURN_INHERITABLE_CODES = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9'] as const;
export type ReturnInheritableCode = (typeof RETURN_INHERITABLE_CODES)[number];

/** 告知票、决定／送达票启用前，指向这些环节的执行返回 409 transition-disabled。 */
export const RETURN_DISABLED_STAGES = ['E05', 'E10'] as const;
export type ReturnDisabledStage = (typeof RETURN_DISABLED_STAGES)[number];

export const FILING_RETURN_STAGE = 'filing' as const;
export type ReturnStage = CaseStageCode | typeof FILING_RETURN_STAGE;

/** 立案呈批不批的链内目标：回到呈批拟制中（#234 去向不变）。 */
export const FILING_DRAFT_TARGET = 'drafting:filing' as const;

export interface ReturnReasonSpec {
  readonly code: ReturnCode;
  readonly name: string;
  /** 是否回流。R3 不经本函数，标 external。R10 继承所选原因。 */
  readonly reflow: boolean | 'external' | 'inherit';
  /** 回流时目标环节进入次序号加 1。链内退回为 false。 */
  readonly incrementsEntrySeq: boolean | 'inherit';
}

export const RETURN_REASONS: readonly ReturnReasonSpec[] = [
  { code: 'R1', name: '无违法事实（违法事实不成立）', reflow: false, incrementsEntrySeq: false },
  { code: 'R2', name: '事实不清、证据不足，需补充调查', reflow: true, incrementsEntrySeq: true },
  { code: 'R3', name: '事实清楚但不构成犯罪', reflow: 'external', incrementsEntrySeq: false },
  { code: 'R4', name: '定性或法律适用错误，事实不变', reflow: true, incrementsEntrySeq: true },
  { code: 'R5', name: '程序瑕疵（未依法告知、送达瑕疵、人员不足等）', reflow: true, incrementsEntrySeq: true },
  { code: 'R6', name: '超出本机关管辖', reflow: false, incrementsEntrySeq: false },
  { code: 'R7', name: '法律依据变化（新法施行、补录法条版本）', reflow: true, incrementsEntrySeq: true },
  { code: 'R8', name: '裁量不当（罚种、金额、并处事项）', reflow: false, incrementsEntrySeq: false },
  { code: 'R9', name: '文字、格式、文号', reflow: false, incrementsEntrySeq: false },
  { code: 'R10', name: '其他（须写明）', reflow: 'inherit', incrementsEntrySeq: 'inherit' },
];

const REASON_BY_CODE = new Map(RETURN_REASONS.map((item) => [item.code, item]));

export function isReturnCode(value: string): value is ReturnCode {
  return REASON_BY_CODE.has(value as ReturnCode);
}

export function isInheritableReturnCode(value: string): value is ReturnInheritableCode {
  return (RETURN_INHERITABLE_CODES as readonly string[]).includes(value);
}

export function findReturnReason(code: string): ReturnReasonSpec | null {
  return REASON_BY_CODE.get(code as ReturnCode) ?? null;
}

export function isReturnStageDisabled(stage: string): boolean {
  return (RETURN_DISABLED_STAGES as readonly string[]).includes(stage);
}
