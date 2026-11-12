// 用途：装入新的日历年份后，判断一条期限行是否要追加修订行，并算出修订行的到期日。只出计划，不写库。
// 调用方：backend/server/src/deadline.service.ts 的 installCalendar，对每组期限行的最新一行调用。
// 边界：只重算 dayBasis 为 working 的行，且按无不计入区间、无延长、未停表的口径重算。追加修订行与写留痕由调用方在事务内完成。
// 依据：#246。
// 换日历后只追加修订。面向当事人的期限不提前。已届满、已视为放弃的行不动。

import type { WorkCalendar } from './calendar.ts';
import { calculateDueDate } from './due-date.ts';

/**
 * 待判断的期限行快照。dueOn 是该行已存的到期日，historicalDueOns 是同一锚点各修订行的到期日（调用方已剔除 null，含该行自身）。
 * asOf 是判断当日（北京时间公历日），dueOn 早于 asOf 视为已届满。dayBasis、rowStatus、partyFacing 取自期限行。
 */
export interface RevisionSubject {
  readonly dayBasis: 'calendar' | 'working';
  readonly rowStatus: string;
  readonly partyFacing: boolean;
  readonly startedOn: string;
  readonly dayCount: number;
  readonly dueOn: string | null;
  readonly historicalDueOns: readonly string[];
  readonly asOf: string;
  readonly calendar: WorkCalendar;
}

/**
 * 修订判断结果。keep 表示不动。append 表示追加一行修订，带新到期日 dueOn（可为 null）、needsManualConfirmation、
 * 提示文案 trace、是否被抬到历史最晚到期日 clamped，以及所用日历的 calendarVersion。
 */
export type RevisionPlan =
  | { readonly action: 'keep' }
  | {
      readonly action: 'append';
      readonly dueOn: string | null;
      readonly needsManualConfirmation: boolean;
      readonly trace: string | null;
      readonly clamped: boolean;
      readonly calendarVersion: string;
    };

function laterDate(values: readonly (string | null)[]): string | null {
  let later: string | null = null;
  for (const value of values) {
    if (value === null) continue;
    if (later === null || value > later) later = value;
  }
  return later;
}

/**
 * 判断期限行在换日历后是否追加修订。返回 keep 的情形：dayBasis 不是 working；rowStatus 是 expired 或 deemed-waived；
 * 已存 dueOn 早于 asOf。其余一律返回 append，即使新到期日与旧值相同。
 * 新到期日按 working 口径重算，算不出（需人工确认）时 dueOn 为 null。partyFacing 为 true 时，新到期日不得早于
 * 已存与历史到期日中最晚的一个，否则抬到该日并置 clamped 为 true。
 */
export function planRevision(input: RevisionSubject): RevisionPlan {
  if (input.dayBasis !== 'working') return { action: 'keep' };
  if (input.rowStatus === 'expired' || input.rowStatus === 'deemed-waived') return { action: 'keep' };
  if (input.dueOn !== null && input.dueOn < input.asOf) return { action: 'keep' };
  const hit = calculateDueDate({
    startedOn: input.startedOn,
    dayCount: input.dayCount,
    dayBasis: 'working',
    exclusions: [],
    extensionDays: 0,
    paused: false,
    calendar: input.calendar,
  });
  if (hit.needsManualConfirmation || hit.dueOn === null) {
    return {
      action: 'append',
      dueOn: null,
      needsManualConfirmation: true,
      trace: hit.trace,
      clamped: false,
      calendarVersion: input.calendar.version,
    };
  }
  let dueOn = hit.dueOn;
  let clamped = false;
  if (input.partyFacing) {
    const floor = laterDate([input.dueOn, ...input.historicalDueOns]);
    if (floor !== null && dueOn < floor) {
      dueOn = floor;
      clamped = true;
    }
  }
  return {
    action: 'append',
    dueOn,
    needsManualConfirmation: false,
    trace: clamped ? '面向当事人的期限只许推后' : null,
    clamped,
    calendarVersion: input.calendar.version,
  };
}
