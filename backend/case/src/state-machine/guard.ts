// #235 最小校验合同（#30 三级校验未落地，本票只定可迁移的返回形状）。
// 阻断级由迁移引擎映射为 409。警告与提示只写失败留痕，不改业务行。

export const GUARD_LEVELS = ['block', 'warn', 'hint'] as const;
export type GuardLevel = (typeof GUARD_LEVELS)[number];

/** 守卫返回值。citation 可空：系统完整性守卫可以不引法条。 */
export interface GuardResult {
  readonly level: GuardLevel;
  readonly code: string;
  readonly message: string;
  readonly citation?: string;
}
