// 延长办案期限。默认上限 30 日。超过上限须写明案情特别复杂，否则拒绝。

import { COMPLEX_CASE_REASON, DEFAULT_EXTENSION_CAP_DAYS } from './rules.ts';

export function checkExtension(
  days: number,
  reason: string,
  cap: number = DEFAULT_EXTENSION_CAP_DAYS,
): { readonly ok: true; readonly complex: boolean } | { readonly ok: false; readonly reason: 'invalid-days' | 'over-cap' } {
  if (!Number.isInteger(days) || days < 1) return { ok: false, reason: 'invalid-days' };
  const complex = reason.includes(COMPLEX_CASE_REASON);
  if (days > cap && !complex) return { ok: false, reason: 'over-cap' };
  return { ok: true, complex };
}
