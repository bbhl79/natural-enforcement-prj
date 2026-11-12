// 用途：校验一次期限锚点登记请求，按规则登记表算出到期日，返回可落库的计划。不读写数据库。
// 调用方：backend/server/src 下的 deadline.service.ts、case-review.service.ts、
// case-legal-review.service.ts、case-notice.service.ts、case-transfer.service.ts。
// 边界：只对规则键 case.handle 采纳 exclusions、extensionDays、paused，其他规则忽略这三项。
// 依据：GLOSSARY.md 词条「期限」「期限规则」；规则参数见 rules.ts。
// 四维锚点：案件、期限规则键、进入次序号、程序节点类型。起算文书只是期限行字段。

import type { WorkCalendar } from './calendar.ts';
import { isIsoDate } from './dates.ts';
import { calculateDueDate, type DueDateHit, type HalfOpenInterval } from './due-date.ts';
import { findDeadlineRule, type DeadlineRule } from './rules.ts';

/**
 * 锚点登记请求。caseId、ruleKey、entrySeq、procedureNode 四项合成锚点键，startingDocument 不入键。
 * startedOn 是起算日（北京时间公历日，YYYY-MM-DD），起算日本身不计入天数。
 * exclusions、extensionDays、paused 只对规则键 case.handle 生效。
 */
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

/**
 * planAnchor 成功时的计划：命中的规则、锚点字段、起算日、到期日结果，以及所用日历的版本号。
 * 本类型不含 caseId，规则键取 rule.key。
 */
export interface AnchorPlan {
  readonly rule: DeadlineRule;
  readonly entrySeq: number;
  readonly procedureNode: string;
  readonly startingDocument: string | null;
  readonly startedOn: string;
  readonly due: DueDateHit;
  readonly calendarVersion: string;
}

/**
 * 把四维锚点拼成一个字符串键，各维之间用 U+001F 分隔，startingDocument 不参与。不校验入参。
 * 当前无外部调用方，仅 backend/deadline/test/due-date.test.ts 引用。
 * backend/server/src/deadline.service.ts 的 groupsOf 自行拼了同一格式的键，改分隔符或维度须两处同改。
 */
export function anchorKey(input: {
  readonly caseId: string;
  readonly ruleKey: string;
  readonly entrySeq: number;
  readonly procedureNode: string;
}): string {
  return `${input.caseId}\u001f${input.ruleKey}\u001f${input.entrySeq}\u001f${input.procedureNode}`;
}

/**
 * 校验登记请求并算出到期日。校验失败返回 { ok: false, reason }，不抛错，按下列顺序检查：
 * unknown-rule（规则键未登记）、invalid-entry（entrySeq 不是不小于 1 的整数，或 procedureNode 为空白）、
 * invalid-start（startedOn 不是真实存在的 YYYY-MM-DD）。不校验 caseId 与 startingDocument。
 * 成功时 due 由 calculateDueDate 按规则的 dayCount 与 dayBasis 算出。
 */
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
