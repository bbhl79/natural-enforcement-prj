// #235 最小校验合同（#30 三级校验未落地，本票只定可迁移的返回形状）。
// #255：authority 是依据层级。引擎在映射 409 之前按层级决定。
// userLock 非空时保持阻断，不因 normative 或 internal 降为警告。
// 阻断级由迁移引擎映射为 409。警告与提示只写失败留痕，不改业务行。

export const GUARD_LEVELS = ['block', 'warn', 'hint'] as const;
export type GuardLevel = (typeof GUARD_LEVELS)[number];

/** 依据层级（#255）。law、regulation、system 可阻断。normative、internal 降为警告，除非 userLock 非空。 */
export const GUARD_AUTHORITIES = ['law', 'regulation', 'normative', 'internal', 'system'] as const;
export type GuardAuthority = (typeof GUARD_AUTHORITIES)[number];

/** 守卫返回值。citation 可空：系统完整性守卫可以不引法条。authority 必填。 */
export interface GuardResult {
  readonly level: GuardLevel;
  readonly code: string;
  readonly message: string;
  readonly citation?: string;
  readonly authority: GuardAuthority;
  /** 明文要求阻断的锁定出处，例如 #111 L3。非空时引擎保持 block。 */
  readonly userLock?: string;
}
