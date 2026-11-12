// 用途：持有工作日历数据，判定某个公历日是工作日、休息日还是未装入年份，并支持追加年份补丁。
// 调用方：本包 due-date.ts 调 dayKind；backend/server/src/deadline.service.ts 校验并合并补丁；
// backend/server/src 下的 case-review.service.ts、case-legal-review.service.ts、
// case-notice.service.ts、case-transfer.service.ts 取 WORK_CALENDAR_V1 并合并补丁。
// 边界：不读写数据库。补丁由 backend/server 经案件存储持久化与读取。
// 依据：#246；数据出处见 WORK_CALENDAR_V1 的 sourceTitle、documentNo、sourceUrl 字段。
// 工作日历（#246 G1）。一期只装国务院当年放假通知。2027 年通知未发布，表中不装，不按往年推测。

import { datesThrough, isIsoDate, weekday, yearOf } from './dates.ts';

/**
 * 一份工作日历：覆盖的年份、放假日、调休上班日，以及出处。日期都是 YYYY-MM-DD，指北京时间的公历日。
 * years 之外的日期，dayKind 返回 unknown。version 写入期限行的 calendarVersion，合并补丁后形如「基础版本+补丁版本」。
 */
export interface WorkCalendar {
  readonly version: string;
  readonly sourceTitle: string;
  readonly documentNo: string;
  readonly sourceUrl: string;
  readonly years: readonly number[];
  readonly holidays: readonly string[];
  readonly makeupWorkdays: readonly string[];
}

/**
 * 对某一年追加的放假日与调休上班日。由 checkCalendarPatch 校验，由 mergeCalendars 并入基础日历。
 * 调用方：backend/server/src/deadline.service.ts 的 installCalendar 接收、校验并写库。
 */
export interface CalendarYearPatch {
  readonly version: string;
  readonly year: number;
  readonly holidays: readonly string[];
  readonly makeupWorkdays: readonly string[];
  readonly sourceUrl: string;
}

/** WORK_CALENDAR_V1 记载的出处网址。backend/deadline/test/due-date.test.ts 以字面量断言它，改网址须同步。 */
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

/** 某一天的类别：work 工作日，rest 休息日，unknown 表示该日所在年份不在日历的 years 内。 */
export type DayKind = 'work' | 'rest' | 'unknown';

/**
 * 判定 iso 这一天的类别。先查 holidays（rest），再查 makeupWorkdays（work），其余周六周日为 rest、其他为 work。
 * 年份不在 calendar.years 内时返回 unknown，不按周末推断。iso 应是合法的 YYYY-MM-DD。
 * 调用方：本包 due-date.ts；当前无外部调用方。
 */
export function dayKind(calendar: WorkCalendar, iso: string): DayKind {
  if (!calendar.years.includes(yearOf(iso))) return 'unknown';
  if (calendar.holidays.includes(iso)) return 'rest';
  if (calendar.makeupWorkdays.includes(iso)) return 'work';
  const day = weekday(iso);
  if (day === 0 || day === 6) return 'rest';
  return 'work';
}

/**
 * 把年份补丁并入基础日历，返回新日历。补丁为空时返回 base 本身。
 * years、holidays、makeupWorkdays 与 base 取并集后排序，补丁不覆盖也不删除 base 已有的日期，不校验补丁。
 * version 拼成「base.version+各补丁 version（以 + 连接）」；sourceTitle、documentNo、sourceUrl 沿用 base，补丁的 sourceUrl 不带入。
 * 调用方：backend/server/src 下的 deadline.service.ts、case-review.service.ts、case-legal-review.service.ts、
 * case-notice.service.ts、case-transfer.service.ts，均传入 WORK_CALENDAR_V1 与已装入的补丁。
 */
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

/**
 * 校验年份补丁，不通过返回 { ok: false, reason: 'invalid-calendar' }，不抛错。
 * 检查项：year 是 2000 至 2100 的整数；version 与 sourceUrl 非空白；每个日期是真实存在的 YYYY-MM-DD 且属于 patch.year。
 * 不检查日期重复，也不检查放假日与调休日是否重叠。
 * 调用方：backend/server/src/deadline.service.ts 的 installCalendar，写库前调用。
 */
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
