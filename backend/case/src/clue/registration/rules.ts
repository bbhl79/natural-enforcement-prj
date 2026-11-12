// 用途：定义登记接口可回的规则码封闭清单，以及布尔类要件取值的合法口径。
// 调用方：backend/server/src/clue-registration.service.ts（isBooleanValue、isAnonymousValue）、backend/case/src/persistence/prisma-clue-store.ts（isAnonymousValue）；规则码清单当前无外部调用方。
// 边界：纯常量与纯函数，不写库、不写留痕；规则码由调用方写进 400 响应并触发失败留痕。
// 依据：#211。
// 登记接口的规则码（#211）。
//
// `rules` 数组是 400 non-compliant 响应体里的校验码（沿用 #91/#105 错误码表）。
// 缺件键不进本表：缺件键就是要件键本身（ADR 0018），由声明给出。
// 本表是封闭清单：服务端只许回这些码，回其它码即视为实现走偏。

/** 登记接口可回的规则码。 */
export const CLUE_REGISTRATION_RULE_CODES = [
  // 表单层
  'source-code-invalid',
  'domain-invalid',
  'type-code-invalid',
  'idempotency-key-required',
  'value-invalid',
  'anonymity-confirmation-required',
  // 几何层
  'spatial-srid-rejected',
  'spatial-source-unparsable',
  'spatial-geometry-empty',
  'spatial-geometry-type-rejected',
  // 附件层
  'attachment-type-not-allowed',
  'attachment-content-mismatch',
  'attachment-empty',
  'attachment-size-exceeded',
  'attachment-count-exceeded',
  'attachment-total-size-exceeded',
] as const;

/** 登记接口规则码的联合类型。 */
export type ClueRegistrationRuleCode = (typeof CLUE_REGISTRATION_RULE_CODES)[number];

/**
 * 布尔类要件的取值口径（规范选择控件的取值集合）。
 * 「是否匿名」一栏只收这六个写法，其余写法按未填处理。
 */
const ANONYMOUS_TRUE_VALUES = ['true', 'yes', '1', '是'];
const ANONYMOUS_FALSE_VALUES = ['false', 'no', '0', '否'];

/** 布尔类要件的取值是否合法。 */
export function isBooleanValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ANONYMOUS_TRUE_VALUES.includes(normalized) || ANONYMOUS_FALSE_VALUES.includes(normalized);
}

/** 取值是否为「是」。 */
export function isAnonymousValue(value: string): boolean {
  return ANONYMOUS_TRUE_VALUES.includes(value.trim().toLowerCase());
}
