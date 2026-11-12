// 用途：期限计算的日期工具。日期都是 YYYY-MM-DD 字符串，指北京时间的公历日，加减不受运行环境时区影响。
// 民事日期按北京时间取日，日期间加减在公历日上做，不带时分。

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 严格判断：形如 YYYY-MM-DD 且是真实存在的公历日（2026-02-30 为 false）。不抛错。
 * 调用方：本包 anchor.ts、calendar.ts、period.ts；当前无外部调用方。
 */
export function isIsoDate(value: string): boolean {
  const matched = ISO_DATE.exec(value);
  if (!matched) return false;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

/**
 * 公历日加减，days 可为负，返回 YYYY-MM-DD。
 * 只校验形如 YYYY-MM-DD，不校验日期是否存在：2026-02-30 会被进位成 2026-03-02。形式不符时抛 Error（消息「非法日期：<iso>」）。
 * 调用方：本包 due-date.ts 与本文件的 datesThrough；当前无外部调用方。
 */
export function addDays(iso: string, days: number): string {
  const matched = ISO_DATE.exec(iso);
  if (!matched) throw new Error(`非法日期：${iso}`);
  const utc = new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]) + days));
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 生成 start 到 end 的每个公历日，两端都含，按日期升序。start 晚于 end 时返回空数组。
 * 按字符串字典序比较两端，入参须是合法 YYYY-MM-DD。
 * 调用方：本包 calendar.ts 生成放假日列表；当前无外部调用方。
 */
export function datesThrough(start: string, end: string): string[] {
  const days: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** 0 是周日，6 是周六。 */
export function weekday(iso: string): number {
  const matched = ISO_DATE.exec(iso);
  if (!matched) throw new Error(`非法日期：${iso}`);
  return new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))).getUTCDay();
}

/**
 * 取日期串前 4 位转成数字，不校验格式，前 4 位不是数字时返回 NaN。
 * 调用方：本包 calendar.ts；当前无外部调用方。
 */
export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

/** 时间戳在北京时间下的公历日。 */
export function civilDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
