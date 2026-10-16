// 留痕设施包公共出口（ADR 0012）。只追加。动作取值在本包，不在 shield。
export { PrismaAuditTrail } from './prisma-audit-trail.ts';
export type { AuditTrailCreateClient } from './prisma-audit-trail.ts';
export { AUDIT_TRAIL_PORT } from './tokens.ts';
export {
  AUDIT_ACTION_AUTHZ_DENIED,
  AUTHZ_DENY_REASONS,
} from './port.ts';
export type {
  AuditAppend,
  AuditParties,
  AuditTrailPort,
  AuthzDeniedEntry,
  AuthzDenyReason,
} from './port.ts';
export {
  AUDIT_ACTIONS,
  AUDIT_SUCCEEDED_ACTIONS,
  AUTHZ_DENIED_REASONS,
  LOGIN_FAILED_REASONS,
  PASSWORD_CHANGED_REASONS,
  SESSION_END_REASONS,
} from './vocabulary.ts';
export type {
  AuditAction,
  AuthzDeniedReason,
  LoginFailedReason,
  PasswordChangedReason,
  SessionEndReason,
} from './vocabulary.ts';
