// 民事日期按北京时间取日，日期间加减在公历日上做，不带时分。

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const matched = ISO_DATE.exec(value);
  if (!matched) return false;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

export function addDays(iso: string, days: number): string {
  const matched = ISO_DATE.exec(iso);
  if (!matched) throw new Error(`非法日期：${iso}`);
  const utc = new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]) + days));
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utc.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
