// 授权拒绝的只追加写入（ADR 0011 / ADR 0012）。
// 本切片不提供登录、会话结束、口令维护的写入。接口没有更新和删除。

export const AUDIT_ACTION_AUTHZ_DENIED = 'authz.denied';

export const AUTHZ_DENY_REASONS = [
  'identity-unknown',
  'not-authenticated',
  'identity-deactivated',
  'permission-denied',
  'scope-denied',
] as const;

export type AuthzDenyReason = (typeof AUTHZ_DENY_REASONS)[number];

/** 一行授权拒绝。被作用人员、来源地址、前值在本动作里为空。登录标识和执法证号不进入。 */
export interface AuthzDeniedEntry {
  readonly action: typeof AUDIT_ACTION_AUTHZ_DENIED;
  readonly outcome: 'failed';
  readonly actorId: string | null;
  readonly actorCode: string | null;
  readonly subjectPersonnelId: null;
  readonly subjectCode: null;
  readonly orgUnitId: string | null;
  readonly sourceIp: null;
  readonly reason: AuthzDenyReason;
  readonly opcode: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly previousValue: null;
}

export interface AuditTrailPort {
  append(entry: AuthzDeniedEntry): Promise<void>;
}
