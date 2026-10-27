// 机关层利害关系提示（#263）。纯规则，不依赖 Nest 与存储。
//
// 主干最小版：人工勾选后只提示，不阻断签出、呈批、迁移。
// 勾选只追加一行。取消勾选不写新行，调用方必须拒绝。
// 第二人确认取消不在本文件。

/** 界面提示原文。 */
export const AGENCY_CONFLICT_WARNING = '本机关与本案当事人存在利害关系';
/** 提示的出路。线下处理，系统不阻断。 */
export const AGENCY_CONFLICT_OUTLET = '线下报请上级处理';
/** 取消勾选被拒的原文。 */
export const AGENCY_CONFLICT_UNCHECK_MESSAGE = '机关层利害关系不能取消勾选';
/** 重复勾选被拒的原文。 */
export const AGENCY_CONFLICT_ALREADY_MARKED_MESSAGE = '机关层利害关系已登记';

/** 机关层不参与的闸口。返回值固定为不阻断。 */
export const AGENCY_CONFLICT_GATES = ['sign', 'submission', 'transition'] as const;
export type AgencyConflictGate = (typeof AGENCY_CONFLICT_GATES)[number];

/** 一案至多一行的勾选记录。 */
export interface AgencyConflictMark {
  readonly id: string;
  readonly caseId: string;
  readonly orgUnitId: string;
  readonly markedBy: string;
  readonly createdAt: Date;
}

/** 有一行即已勾选。 */
export function agencyConflictMarked(marks: readonly AgencyConflictMark[]): boolean {
  return marks.length > 0;
}

/**
 * 机关层利害关系不阻断任何闸口。
 * 签出、呈批、迁移都得到 false。调用方不得把本函数的结果当成拒绝条件。
 */
export function agencyConflictBlocks(gate: AgencyConflictGate): false {
  switch (gate) {
    case 'sign':
    case 'submission':
    case 'transition':
      return false;
  }
}

/** 已勾选时给出提示与出路。未勾选时两者都空。 */
export function agencyConflictNotice(marks: readonly AgencyConflictMark[]): {
  readonly marked: boolean;
  readonly warning: string | null;
  readonly outlet: string | null;
} {
  if (!agencyConflictMarked(marks)) return { marked: false, warning: null, outlet: null };
  return { marked: true, warning: AGENCY_CONFLICT_WARNING, outlet: AGENCY_CONFLICT_OUTLET };
}
