// 用途：校验期间事件（EXCLUSION_KINDS 所列类别的不计入时段）的登记内容，返回可落库的草稿。只校验与整理字段，不写库。
// 调用方：backend/server/src/deadline.service.ts 的 savePeriod、saveSystemPeriod（受理时）与 parsePeriod（读取已存呈批内容时），
// 其 handleHit 用 isExclusionKind 挑选类别。
// 边界：不决定是否经呈批。起止日按闭区间校验，转成不计入区间用 due-date.ts 的 inclusiveInterval。
// 依据：docs/research/suspension-termination.md（办案期限与不计入期间的法规查证）。
// 期间事件。系统事件不经呈批。人工登记和补登须有理由、依据标签，且区间合法。

import { isIsoDate } from './dates.ts';

/**
 * business-exclusion 类期间事件的依据备注（basisNote），固定取此文案，不随登记人填的 basisLabel 变，见 basisNoteFor。
 * 文案为「依据待法制部门确认」。backend/case/src/investigation/rules.ts 的 SUSPENSION_CLOCK_PARAMETER 另持同文案的字面量。
 */
export const BUSINESS_EXCLUSION_NOTE = '依据待法制部门确认';

/**
 * 期间事件的合法类别。checkManualPeriod 全部接受，checkSystemPeriod 不接受 business-exclusion。
 * frontend/src/case/DeadlinePanel.tsx 的类别下拉手写了同样的取值，两处不会联动，增删类别须同步。
 */
export const EXCLUSION_KINDS = [
  'appraisal',
  'hearing',
  'announcement',
  'in-transit',
  'criminal-wait',
  'business-exclusion',
] as const;

/** 期间事件类别的取值类型，由 EXCLUSION_KINDS 推出，增删类别只改 EXCLUSION_KINDS。 */
export type ExclusionKind = (typeof EXCLUSION_KINDS)[number];

const EXCLUSION = new Set<string>(EXCLUSION_KINDS);

/**
 * 类型守卫：kind 是否为 EXCLUSION_KINDS 中的取值，区分大小写，不去空白。
 * 调用方：本包 checkManualPeriod、checkSystemPeriod；backend/server/src/deadline.service.ts 的 handleHit
 * 用它挑出可作为不计入区间的期间事件，其余类别（如 extension）被跳过。
 */
export function isExclusionKind(kind: string): kind is ExclusionKind {
  return EXCLUSION.has(kind);
}

/**
 * 生成期间事件的依据备注：kind 为 business-exclusion 时返回 BUSINESS_EXCLUSION_NOTE，其余原样返回 basisLabel，不去空白。
 * 调用方：本包 checkManualPeriod、checkSystemPeriod；当前无外部调用方。
 */
export function basisNoteFor(kind: string, basisLabel: string): string {
  if (kind === 'business-exclusion') return BUSINESS_EXCLUSION_NOTE;
  return basisLabel;
}

/**
 * 通过校验的期间事件草稿，reason 与 basisLabel 已去首尾空白。startedOn、endedOn 是闭区间两端，两端日期都含。
 * 系统事件的 reason 为空串，backfill 恒为 false。
 */
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

/**
 * 校验人工登记或补登的期间事件，backfill 原样带入草稿。失败返回 { ok: false, reason }，不抛错，按下列顺序检查：
 * invalid-kind（类别不在 EXCLUSION_KINDS）、missing-reason、missing-basis（理由或依据标签为空白）、
 * invalid-interval（起止日不是真实日期，或 endedOn 早于 startedOn，起止同日合法）。
 * 成功时返回去空白后的 PeriodDraft，basisNote 由 basisNoteFor 生成。
 * 调用方：backend/server/src/deadline.service.ts 的 savePeriod，以及 parsePeriod 读取已存呈批内容时。
 */
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

/**
 * 校验系统事件的期间。与 checkManualPeriod 的差别：不要求理由（草稿 reason 为空串，backfill 为 false），
 * 不接受 business-exclusion（返回 invalid-kind）。失败原因：invalid-kind、missing-basis、invalid-interval，不抛错。
 * 调用方：backend/server/src/deadline.service.ts 的 saveSystemPeriod，通过后直接落库，不经呈批。
 */
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
