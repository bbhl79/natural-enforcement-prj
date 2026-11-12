// 用途：按起算日、天数和日历算出到期日，处理不计入区间、延长天数、停表与节假日顺延，并给出提示文案。纯函数，不读写数据库。
// 调用方：本包 anchor.ts、revision.ts；backend/server/src/deadline.service.ts（办案期限的实时计算与提示）。
// 边界：只消费调用方传入的 exclusions、extensionDays、paused，不查库；停表事件的读取与延长是否生效由调用方负责。
// 依据：GLOSSARY.md 词条「期限」「期限规则」；docs/research/suspension-termination.md（办案期限、延期与不计入期间的法规查证）。
// 到期日（规程 15.1）。起算日不计入。届满日遇节假日顺延。在途与停表期间不计入。
// 工作日口径跨入未装年份时只提示人工确认，不改按日历日。

import { dayKind, type WorkCalendar } from './calendar.ts';
import { addDays } from './dates.ts';

// 工作日口径逐日数到未装入年份，或逐日扫描超过 4000 天仍未数满时，写入 DueDateHit.trace 的提示。
// integration/case-deadline.test.ts 持有同文案的字面量，改文案须同步。
export const MANUAL_CONFIRMATION_TRACE = '工作日口径跨入未装入的年份，需人工确认，不按日历日计算。';
// 日历日口径的届满日落在未装入年份，或顺延途中进入未装入年份时，写入 DueDateHit.trace 的提示。
export const HOLIDAY_UNCHECKED_PROMPT = '届满日落入未装入的年份，节假日顺延需人工核对。';
// paused 为 true 时写入 DueDateHit.trace 的提示。integration/case-deadline.test.ts 持有同文案的字面量，改文案须同步。
export const PAUSE_PROMPT = '中止期间停表，恢复后继续计算。';
// 办案期限已届满的提示文案。本包不写入它：backend/server/src/deadline.service.ts 在办案期限的到期日早于 asOf 时把它加入响应的 prompts。
// integration/case-deadline.test.ts 与 frontend/src/case/deadline.test.tsx 持有同文案的字面量，改文案须同步。
export const OVERDUE_PROMPT = '办案期限已届满。只提示，不阻断。';

/** 半开区间 [start, end)。end 当天重新计入。 */
export interface HalfOpenInterval {
  readonly start: string;
  readonly end: string;
}

/**
 * 停表或续表事件。eventKind 为 stop 或 continue，其他取值被 exclusionsFromClock 忽略；on 是事件发生日（北京时间公历日）。
 * exclusionsFromClock 按传入顺序处理，调用方须按发生先后排列。
 * 调用方：backend/server/src/deadline.service.ts 的 handleHit，把期限事件的 createdAt 转成 on。
 */
export interface ClockEvent {
  readonly eventKind: string;
  readonly on: string;
}

/**
 * 到期日计算入参。startedOn 是起算日（YYYY-MM-DD），起算日本身不计入；需要数满的天数是 dayCount 加 extensionDays。
 * exclusions 内的日子不计入。dayBasis 为 working 时只数工作日，为 calendar 时按日历日数。paused 为 true 时不算到期日。
 */
export interface DueDateInput {
  readonly startedOn: string;
  readonly dayCount: number;
  readonly dayBasis: 'calendar' | 'working';
  readonly exclusions: readonly HalfOpenInterval[];
  readonly extensionDays: number;
  readonly paused: boolean;
  readonly calendar: WorkCalendar;
}

/**
 * 到期日计算结果。dueOn 为 null 表示没有给出到期日（paused 或 needsManualConfirmation 为 true），原因见 trace。
 * postponed 表示届满日因休息日顺延过，holidayUnchecked 表示顺延判断涉及未装入年份，trace 是给用户看的提示文案，没有则为 null。
 */
export interface DueDateHit {
  readonly dueOn: string | null;
  readonly paused: boolean;
  readonly postponed: boolean;
  readonly holidayUnchecked: boolean;
  readonly needsManualConfirmation: boolean;
  readonly trace: string | null;
}

/**
 * 把闭区间 [start, end]（两端日期都含）转成半开区间 [start, end 次日)，供 exclusions 使用。
 * end 不是 YYYY-MM-DD 形式时抛 Error（来自 addDays）。
 * 调用方：backend/server/src/deadline.service.ts 的 handleHit，把期间事件的起止日转成不计入区间。
 */
export function inclusiveInterval(start: string, end: string): HalfOpenInterval {
  return { start, end: addDays(end, 1) };
}

/** 停表到续表之间不计入。未配对的停表表示仍在停表。 */
export function exclusionsFromClock(events: readonly ClockEvent[]): {
  readonly intervals: readonly HalfOpenInterval[];
  readonly paused: boolean;
} {
  const intervals: HalfOpenInterval[] = [];
  let open: string | null = null;
  for (const event of events) {
    if (event.eventKind === 'stop') {
      if (open === null) open = event.on;
      continue;
    }
    if (event.eventKind === 'continue' && open !== null) {
      if (event.on > open) intervals.push({ start: open, end: event.on });
      open = null;
    }
  }
  return { intervals, paused: open !== null };
}

function excluded(iso: string, intervals: readonly HalfOpenInterval[]): boolean {
  return intervals.some((item) => iso >= item.start && iso < item.end);
}

function postpone(calendar: WorkCalendar, iso: string): Pick<DueDateHit, 'dueOn' | 'postponed' | 'holidayUnchecked'> {
  if (dayKind(calendar, iso) === 'unknown') {
    return { dueOn: iso, postponed: false, holidayUnchecked: true };
  }
  let cursor = iso;
  let postponed = false;
  while (dayKind(calendar, cursor) === 'rest') {
    const next = addDays(cursor, 1);
    if (dayKind(calendar, next) === 'unknown') {
      return { dueOn: cursor, postponed, holidayUnchecked: true };
    }
    cursor = next;
    postponed = true;
  }
  return { dueOn: cursor, postponed, holidayUnchecked: false };
}

/**
 * 算到期日：从 startedOn 次日起逐日数，数满 dayCount + extensionDays 个计入日，最后一个计入日是届满日。
 * exclusions 内的日子不计入。working 口径只数工作日，数到未装入年份就不给到期日。
 * calendar 口径数满后若届满日是休息日则顺延到下一个非休息日；届满日或顺延途中落入未装入年份时不再顺延，holidayUnchecked 为 true。
 * dueOn 为 null 的情形：paused 为 true；working 口径遇未装入年份；逐日扫描超过 4000 天（后两种 needsManualConfirmation 为 true）。
 * 逐日扫描设 4000 天上限，防止天数异常大或日历数据缺失时长时间循环；超限返回 null 并要求人工确认。
 * 不抛业务错误；startedOn 不是 YYYY-MM-DD 形式时抛 Error（来自 addDays）。
 * 调用方：本包 anchor.ts、revision.ts；backend/server/src/deadline.service.ts 的 handleHit。
 */
export function calculateDueDate(input: DueDateInput): DueDateHit {
  if (input.paused) {
    return {
      dueOn: null,
      paused: true,
      postponed: false,
      holidayUnchecked: false,
      needsManualConfirmation: false,
      trace: PAUSE_PROMPT,
    };
  }
  const need = input.dayCount + input.extensionDays;
  let cursor = input.startedOn;
  let counted = 0;
  let guard = 0;
  while (counted < need) {
    guard += 1;
    if (guard > 4000) {
      return {
        dueOn: null,
        paused: false,
        postponed: false,
        holidayUnchecked: false,
        needsManualConfirmation: true,
        trace: MANUAL_CONFIRMATION_TRACE,
      };
    }
    cursor = addDays(cursor, 1);
    if (input.dayBasis === 'working' && dayKind(input.calendar, cursor) === 'unknown') {
      return {
        dueOn: null,
        paused: false,
        postponed: false,
        holidayUnchecked: false,
        needsManualConfirmation: true,
        trace: MANUAL_CONFIRMATION_TRACE,
      };
    }
    if (excluded(cursor, input.exclusions)) continue;
    if (input.dayBasis === 'working' && dayKind(input.calendar, cursor) !== 'work') continue;
    counted += 1;
  }
  if (input.dayBasis === 'working') {
    return {
      dueOn: cursor,
      paused: false,
      postponed: false,
      holidayUnchecked: false,
      needsManualConfirmation: false,
      trace: null,
    };
  }
  const shifted = postpone(input.calendar, cursor);
  return {
    dueOn: shifted.dueOn,
    paused: false,
    postponed: shifted.postponed,
    holidayUnchecked: shifted.holidayUnchecked,
    needsManualConfirmation: false,
    trace: shifted.holidayUnchecked ? HOLIDAY_UNCHECKED_PROMPT : null,
  };
}
