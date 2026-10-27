// 四维锚点：案件、期限规则键、进入次序号、程序节点类型。起算文书只是期限行字段。

import type { WorkCalendar } from './calendar.ts';
import { isIsoDate } from './dates.ts';
import { calculateDueDate, type DueDateHit, type HalfOpenInterval } from './due-date.ts';
import { findDeadlineRule, type DeadlineRule } from './rules.ts';

export interface AnchorRequest {
  readonly caseId: string;
  readonly ruleKey: string;
  readonly entrySeq: number;
  readonly procedureNode: string;
  readonly startingDocument: string | null;
  readonly startedOn: string;
  readonly exclusions: readonly HalfOpenInterval[];
  readonly extensionDays: number;
  readonly paused: boolean;
  readonly calendar: WorkCalendar;
}

export interface AnchorPlan {
  readonly rule: DeadlineRule;
  readonly entrySeq: number;
  readonly procedureNode: string;
  readonly startingDocument: string | null;
  readonly startedOn: string;
  readonly due: DueDateHit;
  readonly calendarVersion: string;
}

export function anchorKey(input: {
  readonly caseId: string;
  readonly ruleKey: string;
  readonly entrySeq: number;
  readonly procedureNode: string;
}): string {
  return `${input.caseId}\u001f${input.ruleKey}\u001f${input.entrySeq}\u001f${input.procedureNode}`;
}

export function planAnchor(
  input: AnchorRequest,
): { readonly ok: true; readonly plan: AnchorPlan } | { readonly ok: false; readonly reason: 'unknown-rule' | 'invalid-entry' | 'invalid-start' } {
  const rule = findDeadlineRule(input.ruleKey);
  if (!rule) return { ok: false, reason: 'unknown-rule' };
  if (!Number.isInteger(input.entrySeq) || input.entrySeq < 1 || input.procedureNode.trim() === '') {
    return { ok: false, reason: 'invalid-entry' };
  }
  if (!isIsoDate(input.startedOn)) return { ok: false, reason: 'invalid-start' };
  const due = calculateDueDate({
    startedOn: input.startedOn,
    dayCount: rule.dayCount,
    dayBasis: rule.dayBasis,
    exclusions: rule.key === 'case.handle' ? input.exclusions : [],
    extensionDays: rule.key === 'case.handle' ? input.extensionDays : 0,
    paused: rule.key === 'case.handle' ? input.paused : false,
    calendar: input.calendar,
  });
  return {
    ok: true,
    plan: {
      rule,
      entrySeq: input.entrySeq,
      procedureNode: input.procedureNode,
      startingDocument: input.startingDocument,
      startedOn: input.startedOn,
      due,
      calendarVersion: input.calendar.version,
    },
  };
}
