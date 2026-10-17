/** 记成功的动作。其余动作记失败。取值来自 ADR 0011，并追加 login.capacity-reached。 */
export const AUDIT_SUCCEEDED_ACTIONS = [
  'login.succeeded',
  'session.ended',
  'account.unlocked',
  'account.password-reset',
  'account.password-changed',
  // 机构树（#105「机构树」，#123）。
  'org.unit.registered',
  'org.unit.renamed',
  // 人员登记与查看、岗位标记（#105「人员与登录凭据」，#128）。
  'personnel.registered',
  'personnel.viewed',
  'personnel.post-granted',
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

/**
 * 记成功的动作被拒绝时（outcome=failed）的封闭原因表（#105「失败留痕」= 动作词加 outcome=failed）。
 * 成功写入不带原因。不在表里的成功动作不能记失败。
 */
export const ORG_UNIT_REGISTER_FAILED_REASONS = ['org-unit-deactivated'] as const;
export type OrgUnitRegisterFailedReason = (typeof ORG_UNIT_REGISTER_FAILED_REASONS)[number];

/** 登记人员被拒（outcome=failed）的原因（#128）：目标机构已停用；工号或手机号已被占用。 */
export const PERSONNEL_REGISTER_FAILED_REASONS = ['org-unit-deactivated', 'already-exists'] as const;
export type PersonnelRegisterFailedReason = (typeof PERSONNEL_REGISTER_FAILED_REASONS)[number];

/** 带「后值」的动作（#128）。后值写标记取值；其余动作不许带后值。 */
export const AUDIT_NEXT_VALUE_ACTIONS = ['personnel.post-granted'] as const;
export type AuditNextValueAction = (typeof AUDIT_NEXT_VALUE_ACTIONS)[number];
