// 用途：期限预警模块的公共出口，集中再导出各文件的函数、常量与类型。只含再导出，不含逻辑。
// 调用方：backend/server/src 下的 app.module.ts、deadline.service.ts、case-review.service.ts、
// case-legal-review.service.ts、case-notice.service.ts、case-transfer.service.ts（经包名 @natural-enforcement/deadline 导入）；
// 测试 backend/deadline/test/due-date.test.ts 与 integration/notice-hearing.test.ts。
// 边界：新增导出须同步写进本文件，否则外部包取不到。深路径导入由结构测试 module-public-entry 拦截，
// integration/notice-hearing.test.ts 经相对路径导入，列在 tools/structural-test.sh 的 ASSEMBLY_EXEMPT 豁免名单内。
// 依据：backend/README.md 的依赖矩阵与「往来形态」一节。
// 期限模块公共出口（#246）。跨模块消费只许经本文件。
export { DeadlineModule } from './deadline.module.ts';
export {
  WORK_CALENDAR_SOURCE_URL,
  WORK_CALENDAR_V1,
  checkCalendarPatch,
  dayKind,
  mergeCalendars,
} from './calendar.ts';
export type { CalendarYearPatch, DayKind, WorkCalendar } from './calendar.ts';
export { addDays, civilDate, datesThrough, isIsoDate, weekday, yearOf } from './dates.ts';
export {
  HOLIDAY_UNCHECKED_PROMPT,
  MANUAL_CONFIRMATION_TRACE,
  OVERDUE_PROMPT,
  PAUSE_PROMPT,
  calculateDueDate,
  exclusionsFromClock,
  inclusiveInterval,
} from './due-date.ts';
export type { ClockEvent, DueDateHit, DueDateInput, HalfOpenInterval } from './due-date.ts';
export {
  COMPLEX_CASE_REASON,
  CONSUMPTION_NAMES,
  DEADLINE_RULES,
  DEADLINE_RULE_VERSION,
  DEFAULT_EXTENSION_CAP_DAYS,
  DEFAULT_HANDLING_DAYS,
  findDeadlineRule,
} from './rules.ts';
export type { DeadlineRule } from './rules.ts';
export { anchorKey, planAnchor } from './anchor.ts';
export type { AnchorPlan, AnchorRequest } from './anchor.ts';
export { planRevision } from './revision.ts';
export type { RevisionPlan, RevisionSubject } from './revision.ts';
export { checkExtension } from './extension.ts';
export {
  BUSINESS_EXCLUSION_NOTE,
  EXCLUSION_KINDS,
  basisNoteFor,
  checkManualPeriod,
  checkSystemPeriod,
  isExclusionKind,
} from './period.ts';
export type { ExclusionKind, PeriodDraft } from './period.ts';
