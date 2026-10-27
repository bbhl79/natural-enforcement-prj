// 期间事件。系统事件不经呈批。人工登记和补登须有理由、依据标签，且区间合法。

import { isIsoDate } from './dates.ts';

export const BUSINESS_EXCLUSION_NOTE = '依据待法制部门确认';

export const EXCLUSION_KINDS = [
  'appraisal',
  'hearing',
  'announcement',
  'in-transit',
  'criminal-wait',
  'business-exclusion',
] as const;

export type ExclusionKind = (typeof EXCLUSION_KINDS)[number];

const EXCLUSION = new Set<string>(EXCLUSION_KINDS);

export function isExclusionKind(kind: string): kind is ExclusionKind {
  return EXCLUSION.has(kind);
}

export function basisNoteFor(kind: string, basisLabel: string): string {
  if (kind === 'business-exclusion') return BUSINESS_EXCLUSION_NOTE;
  return basisLabel;
}

export interface PeriodDraft {
  readonly eventKind: ExclusionKind;
  readonly reason: string;
  readonly basisLabel: string;
  readonly basisNote: string;
  readonly startedOn: string;
  readonly endedOn: string;
  readonly backfill: boolean;
}

type PeriodError = 'invalid-kind' | 'missing-reason' | 'missing-basis' | 'invalid-interval';

export function checkManualPeriod(input: {
  readonly eventKind: string;
  readonly reason: string;
  readonly basisLabel: string;
  readonly startedOn: string;
  readonly endedOn: string;
  readonly backfill: boolean;
}): { readonly ok: true; readonly event: PeriodDraft } | { readonly ok: false; readonly reason: PeriodError } {
  if (!isExclusionKind(input.eventKind)) return { ok: false, reason: 'invalid-kind' };
  if (input.reason.trim() === '') return { ok: false, reason: 'missing-reason' };
  if (input.basisLabel.trim() === '') return { ok: false, reason: 'missing-basis' };
  if (!isIsoDate(input.startedOn) || !isIsoDate(input.endedOn) || input.endedOn < input.startedOn) {
    return { ok: false, reason: 'invalid-interval' };
  }
  return {
    ok: true,
    event: {
      eventKind: input.eventKind,
      reason: input.reason.trim(),
      basisLabel: input.basisLabel.trim(),
      basisNote: basisNoteFor(input.eventKind, input.basisLabel.trim()),
      startedOn: input.startedOn,
      endedOn: input.endedOn,
      backfill: input.backfill,
    },
  };
}

export function checkSystemPeriod(input: {
  readonly eventKind: string;
  readonly basisLabel: string;
  readonly startedOn: string;
  readonly endedOn: string;
}): { readonly ok: true; readonly event: PeriodDraft } | { readonly ok: false; readonly reason: 'invalid-kind' | 'missing-basis' | 'invalid-interval' } {
  if (!isExclusionKind(input.eventKind) || input.eventKind === 'business-exclusion') {
    return { ok: false, reason: 'invalid-kind' };
  }
  if (input.basisLabel.trim() === '') return { ok: false, reason: 'missing-basis' };
  if (!isIsoDate(input.startedOn) || !isIsoDate(input.endedOn) || input.endedOn < input.startedOn) {
    return { ok: false, reason: 'invalid-interval' };
  }
  return {
    ok: true,
    event: {
      eventKind: input.eventKind,
      reason: '',
      basisLabel: input.basisLabel.trim(),
      basisNote: basisNoteFor(input.eventKind, input.basisLabel.trim()),
      startedOn: input.startedOn,
      endedOn: input.endedOn,
      backfill: false,
    },
  };
}
