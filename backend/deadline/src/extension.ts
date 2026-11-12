// 用途：校验延长办案期限的申请天数与理由是否可受理。只做判定，不写库。
// 调用方：backend/server/src/deadline.service.ts 的 saveExtension（受理时）与 parseExtend（读取已存呈批内容时）。
// 边界：只校验天数与理由文字，不计算新到期日，不判断案件状态与批准权限。
// 依据：docs/research/suspension-termination.md（办案期限与延期的法规查证）。
// 延长办案期限。默认上限 30 日。超过上限须写明案情特别复杂，否则拒绝。

import { COMPLEX_CASE_REASON, DEFAULT_EXTENSION_CAP_DAYS } from './rules.ts';

/**
 * 校验延长天数与理由。days 须是不小于 1 的整数，否则返回 invalid-days。
 * days 大于 cap（默认 DEFAULT_EXTENSION_CAP_DAYS）且 reason 不含 COMPLEX_CASE_REASON（案情特别复杂的标识）时返回 over-cap，days 等于 cap 放行。
 * 通过时 complex 表示 reason 含 COMPLEX_CASE_REASON（子串匹配，不去空白）。不抛错。
 */
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
