// 留痕设施包公共出口（ADR 0012）。只追加。动作取值在本包，不在 shield。
export { PrismaAuditTrail } from './prisma-audit-trail.ts';
export type { AuditTrailCreateClient } from './prisma-audit-trail.ts';
export {
  AUDIT_ACTION_AUTHZ_DENIED,
  AUTHZ_DENY_REASONS,
} from './port.ts';
export type { AuditTrailPort, AuthzDeniedEntry, AuthzDenyReason } from './port.ts';
export { AUDIT_TRAIL_PORT } from './tokens.ts';
