// 用途：提供可注入时钟与密码有效期判定，供登录鉴权与账号管理流程读取当前时间。
/** 可注入时钟。测试拨动这一处，不在用例里真实等待。 */
export const CLOCK = Symbol('CLOCK');

/** 当前时刻来源；业务代码经 CLOCK 令牌注入，测试替换实现以控制时间。 */
export interface Clock {
  now(): Date;
}

/** 生成读取系统真实时间的 Clock；当前无外部调用方。 */
export function systemClock(): Clock {
  return { now: () => new Date() };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD_MAX_AGE_MS = 90 * DAY_MS;

/** 登录时对密码状态给出的拦截原因；由 passwordGate 返回。 */
export type PasswordGate = 'password-change-required' | 'password-expired';

/** 空值为首次改密。超过 90 天为到期。90 天整不算超过。时长与时区无关。 */
export function passwordGate(changedAt: Date | null, now: Date): PasswordGate | null {
  if (changedAt == null) return 'password-change-required';
  if (now.getTime() - changedAt.getTime() > PASSWORD_MAX_AGE_MS) return 'password-expired';
  return null;
}

/** 到期时刻减当前时刻，按天向上取整。 */
export function daysUntilPasswordExpiry(changedAt: Date, now: Date): number {
  const left = changedAt.getTime() + PASSWORD_MAX_AGE_MS - now.getTime();
  return Math.ceil(left / DAY_MS);
}

/** 密码到期提醒的提前天数阈值；调用方 backend/server/src/auth.service.ts 据此决定是否下发提醒。 */
export const EXPIRY_NOTICE_DAYS = 7;
