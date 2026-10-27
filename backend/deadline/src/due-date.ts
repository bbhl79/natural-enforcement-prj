// 到期日（规程 15.1）。起算日不计入。届满日遇节假日顺延。在途与停表期间不计入。
// 工作日口径跨入未装年份时只提示人工确认，不改按日历日。

import { dayKind, type WorkCalendar } from './calendar.ts';
import { addDays } from './dates.ts';

export const MANUAL_CONFIRMATION_TRACE = '工作日口径跨入未装入的年份，需人工确认，不按日历日计算。';
export const HOLIDAY_UNCHECKED_PROMPT = '届满日落入未装入的年份，节假日顺延需人工核对。';
export const PAUSE_PROMPT = '中止期间停表，恢复后继续计算。';
export const OVERDUE_PROMPT = '办案期限已届满。只提示，不阻断。';

/** 半开区间 [start, end)。end 当天重新计入。 */
export interface HalfOpenInterval {
  readonly start: string;
  readonly end: string;
}

export interface ClockEvent {
  readonly eventKind: string;
  readonly on: string;
}

export interface DueDateInput {
  readonly startedOn: string;
  readonly dayCount: number;
  readonly dayBasis: 'calendar' | 'working';
  readonly exclusions: readonly HalfOpenInterval[];
  readonly extensionDays: number;
  readonly paused: boolean;
  readonly calendar: WorkCalendar;
}

export interface DueDateHit {
  readonly dueOn: string | null;
  readonly paused: boolean;
  readonly postponed: boolean;
  readonly holidayUnchecked: boolean;
  readonly needsManualConfirmation: boolean;
  readonly trace: string | null;
}

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
