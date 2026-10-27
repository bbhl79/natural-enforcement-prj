// 工作日历（#246 G1）。一期只装国务院当年放假通知。2027 年通知未发布，表中不装，不按往年推测。

import { datesThrough, isIsoDate, weekday, yearOf } from './dates.ts';

export interface WorkCalendar {
  readonly version: string;
  readonly sourceTitle: string;
  readonly documentNo: string;
  readonly sourceUrl: string;
  readonly years: readonly number[];
  readonly holidays: readonly string[];
  readonly makeupWorkdays: readonly string[];
}

export interface CalendarYearPatch {
  readonly version: string;
  readonly year: number;
  readonly holidays: readonly string[];
  readonly makeupWorkdays: readonly string[];
  readonly sourceUrl: string;
}

export const WORK_CALENDAR_SOURCE_URL = 'https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm';

const HOLIDAYS_2026 = [
  ...datesThrough('2026-01-01', '2026-01-03'),
  ...datesThrough('2026-02-15', '2026-02-23'),
  ...datesThrough('2026-04-04', '2026-04-06'),
  ...datesThrough('2026-05-01', '2026-05-05'),
  ...datesThrough('2026-06-19', '2026-06-21'),
  ...datesThrough('2026-09-25', '2026-09-27'),
  ...datesThrough('2026-10-01', '2026-10-07'),
];

const MAKEUP_2026 = ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10'];

/** 2026 年国务院办公厅放假通知。2027 年不在 years 里。 */
export const WORK_CALENDAR_V1: WorkCalendar = {
  version: '2026-guobanfa-2025-7',
  sourceTitle: '国务院办公厅关于2026年部分节假日安排的通知',
  documentNo: '国办发明电〔2025〕7号',
  sourceUrl: WORK_CALENDAR_SOURCE_URL,
  years: [2026],
  holidays: HOLIDAYS_2026,
  makeupWorkdays: MAKEUP_2026,
};

export type DayKind = 'work' | 'rest' | 'unknown';

export function dayKind(calendar: WorkCalendar, iso: string): DayKind {
  if (!calendar.years.includes(yearOf(iso))) return 'unknown';
  if (calendar.holidays.includes(iso)) return 'rest';
  if (calendar.makeupWorkdays.includes(iso)) return 'work';
  const day = weekday(iso);
  if (day === 0 || day === 6) return 'rest';
  return 'work';
}

export function mergeCalendars(base: WorkCalendar, patches: readonly CalendarYearPatch[]): WorkCalendar {
  if (patches.length === 0) return base;
  const years = new Set<number>(base.years);
  const holidays = new Set<string>(base.holidays);
  const makeup = new Set<string>(base.makeupWorkdays);
  for (const patch of patches) {
    years.add(patch.year);
    for (const day of patch.holidays) holidays.add(day);
    for (const day of patch.makeupWorkdays) makeup.add(day);
  }
  return {
    version: `${base.version}+${patches.map((item) => item.version).join('+')}`,
    sourceTitle: base.sourceTitle,
    documentNo: base.documentNo,
    sourceUrl: base.sourceUrl,
    years: [...years].sort((left, right) => left - right),
    holidays: [...holidays].sort(),
    makeupWorkdays: [...makeup].sort(),
  };
}

export function checkCalendarPatch(
  patch: CalendarYearPatch,
): { readonly ok: true } | { readonly ok: false; readonly reason: 'invalid-calendar' } {
  if (!Number.isInteger(patch.year) || patch.year < 2000 || patch.year > 2100) return { ok: false, reason: 'invalid-calendar' };
  if (patch.version.trim() === '' || patch.sourceUrl.trim() === '') return { ok: false, reason: 'invalid-calendar' };
  const days = [...patch.holidays, ...patch.makeupWorkdays];
  for (const day of days) {
    if (!isIsoDate(day) || yearOf(day) !== patch.year) return { ok: false, reason: 'invalid-calendar' };
  }
  return { ok: true };
}
