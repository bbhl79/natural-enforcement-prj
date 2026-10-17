/** 可注入时钟。测试拨动这一处，不在用例里真实等待。 */
export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

export function systemClock(): Clock {
  return { now: () => new Date() };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD_MAX_AGE_MS = 90 * DAY_MS;

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

export const EXPIRY_NOTICE_DAYS = 7;
