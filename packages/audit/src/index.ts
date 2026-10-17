// 留痕设施包公共出口（ADR 0012）。只追加。动作取值在本包，不在 shield。
export { AuditVocabularyError, PrismaAuditTrail, prismaAuditTrailFactory } from './prisma-audit-trail.ts';
export type { AuditTrailCreateClient } from './prisma-audit-trail.ts';
export { AUDIT_TRAIL_FACTORY, AUDIT_TRAIL_PORT } from './tokens.ts';
export { isRejected, rejected, runAuditedTransaction } from './transaction.ts';
export type { AuditEntry, AuditTrailFactory, OpenTransaction, Rejected } from './transaction.ts';
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
  ORG_UNIT_DEACTIVATE_FAILED_REASONS,
  ORG_UNIT_REGISTER_FAILED_REASONS,
  PASSWORD_CHANGED_REASONS,
  SESSION_END_REASONS,
} from './vocabulary.ts';
export type {
  AuditAction,
  AuthzDeniedReason,
  LoginFailedReason,
  OrgUnitDeactivateFailedReason,
  OrgUnitRegisterFailedReason,
  PasswordChangedReason,
  SessionEndReason,
} from './vocabulary.ts';
