// 换日历后只追加修订。面向当事人的期限不提前。已届满、已视为放弃的行不动。

import type { WorkCalendar } from './calendar.ts';
import { calculateDueDate } from './due-date.ts';

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
