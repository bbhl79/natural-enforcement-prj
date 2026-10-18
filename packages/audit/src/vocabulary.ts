/**
 * 记成功的动作。其余动作记失败。取值来自 ADR 0011，并追加 login.capacity-reached、personnel.exported（ADR 0013），
 * 以及管理台留痕的查阅 audit.viewed、导出 audit.exported（#126）。
 */
export const AUDIT_SUCCEEDED_ACTIONS = [
  'login.succeeded',
  'session.ended',
  'account.unlocked',
  'account.password-reset',
  'account.password-changed',
  // 机构树（#105「机构树」，#123）。
  'org.unit.registered',
  'org.unit.renamed',
  // 机构停用（#105「停用（D4）」，#124）。
  'org.unit.deactivated',
  'personnel.exported',
  // 生产引导命令（#105「生产引导命令（D5）」，ADR 0013 第 3 条，#131）。所属机构写根机构。
  'bootstrap.root-registered',
  'bootstrap.admin-registered',
  'audit.viewed',
  'audit.exported',
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

/** 带条数的动作（ADR 0013）：itemCount 必填，记导出条数，非负整数。其余动作的 itemCount 一律为空。 */
export const AUDIT_COUNTED_ACTIONS = ['personnel.exported', 'audit.exported'] as const;
export type AuditCountedAction = (typeof AUDIT_COUNTED_ACTIONS)[number];

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

/**
 * 停用机构被拒（409 invalid-state）时的失败原因（#124）。判定顺序同表序，只记第一条：
 * org-unit-root 根机构；org-has-active-children 有未停用下级；org-has-assignments 有生效任职
 *（含已停用人员挂着的未结束任职）；org-has-open-items 有以本机构为承办机构、尚未办结的线索或案件（A2）。
 * 只有 org-has-open-items 同时作为响应体的 reason 返回（#105 错误码表）。
 */
export const ORG_UNIT_DEACTIVATE_FAILED_REASONS = [
  'org-unit-root',
  'org-has-active-children',
  'org-has-assignments',
  'org-has-open-items',
] as const;
export type OrgUnitDeactivateFailedReason = (typeof ORG_UNIT_DEACTIVATE_FAILED_REASONS)[number];

/** 登记人员被拒（outcome=failed）的原因（#128）：目标机构已停用；工号或手机号已被占用。 */
export const PERSONNEL_REGISTER_FAILED_REASONS = ['org-unit-deactivated', 'already-exists'] as const;
export type PersonnelRegisterFailedReason = (typeof PERSONNEL_REGISTER_FAILED_REASONS)[number];

/** 带「后值」的动作（#128）。后值写标记取值；其余动作不许带后值。 */
export const AUDIT_NEXT_VALUE_ACTIONS = ['personnel.post-granted'] as const;
export type AuditNextValueAction = (typeof AUDIT_NEXT_VALUE_ACTIONS)[number];

/**
 * 授权拒绝行的目标机构从哪来（#119 修正，ADR 0011）。
 * object：对象所属机构；actor-fallback：对象机构解析不出（如对象不存在），取操作者当时任职机构。
 */
export const AUDIT_TARGET_ORG_BASES = ['object', 'actor-fallback'] as const;
export type AuditTargetOrgBasis = (typeof AUDIT_TARGET_ORG_BASES)[number];
