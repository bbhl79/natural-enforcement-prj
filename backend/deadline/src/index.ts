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
