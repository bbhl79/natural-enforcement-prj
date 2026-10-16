/** 记成功的动作。其余动作记失败。取值来自 ADR 0011，并追加 login.capacity-reached。 */
export const AUDIT_SUCCEEDED_ACTIONS = [
  'login.succeeded',
  'session.ended',
  'account.unlocked',
  'account.password-reset',
  'account.password-changed',
] as const;

export const AUDIT_ACTIONS = [
  ...AUDIT_SUCCEEDED_ACTIONS,
  'login.failed',
  'login.locked',
  'login.locked-retry',
  'login.deactivated',
  'login.password-expired',
  'login.password-change-required',
  'login.source-limited',
  'login.capacity-reached',
  'authz.denied',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const LOGIN_FAILED_REASONS = ['unknown-identifier', 'bad-credential'] as const;
export type LoginFailedReason = (typeof LOGIN_FAILED_REASONS)[number];

export const SESSION_END_REASONS = [
  'logout',
  'idle-timeout',
  'absolute-timeout',
  'admin-ended',
  'displaced',
  'personnel-deactivated',
  'remember-me-reuse',
] as const;
export type SessionEndReason = (typeof SESSION_END_REASONS)[number];

export const PASSWORD_CHANGED_REASONS = ['first-login', 'expired', 'voluntary'] as const;
export type PasswordChangedReason = (typeof PASSWORD_CHANGED_REASONS)[number];

/** 与 identity 的 DenyReason 同词。留痕包不依赖 identity，避免以后互相引用。 */
export const AUTHZ_DENIED_REASONS = [
  'identity-unknown',
  'not-authenticated',
  'identity-deactivated',
  'permission-denied',
  'scope-denied',
] as const;
export type AuthzDeniedReason = (typeof AUTHZ_DENIED_REASONS)[number];
