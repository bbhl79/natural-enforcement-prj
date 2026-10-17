import type {
  AuditTargetOrgBasis,
  AuthzDeniedReason,
  LoginFailedReason,
  OrgUnitRegisterFailedReason,
  PasswordChangedReason,
  SessionEndReason,
} from './vocabulary.ts';

export const AUDIT_ACTION_AUTHZ_DENIED = 'authz.denied' as const;

export {
  AUTHZ_DENIED_REASONS as AUTHZ_DENY_REASONS,
} from './vocabulary.ts';
export type { AuthzDeniedReason as AuthzDenyReason } from './vocabulary.ts';

/** 写入当时能确定的人员与机构。手机号、执法证号、口令不在此列。 */
export interface AuditParties {
  actorId: string | null;
  actorCode: string | null;
  subjectPersonnelId: string | null;
  subjectCode: string | null;
  orgUnitId: string | null;
  sourceIp: string | null;
  opcode?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  previousValue?: string | null;
  /** 导出条数（ADR 0013）。只有带条数的动作（AUDIT_COUNTED_ACTIONS）写值，其余为空。 */
  itemCount?: number | null;
}

export type AuditAppend =
  | (AuditParties & { action: 'login.succeeded' })
  | (AuditParties & { action: 'login.failed'; reason: LoginFailedReason })
  | (AuditParties & { action: 'login.locked' })
  | (AuditParties & { action: 'login.locked-retry' })
  | (AuditParties & { action: 'login.deactivated' })
  | (AuditParties & { action: 'login.password-expired' })
  | (AuditParties & { action: 'login.password-change-required' })
  | (AuditParties & { action: 'login.source-limited' })
  | (AuditParties & { action: 'login.capacity-reached' })
  | (AuditParties & { action: 'session.ended'; reason: SessionEndReason })
  | (AuditParties & { action: 'account.unlocked' })
  | (AuditParties & { action: 'account.password-reset' })
  | (AuditParties & { action: 'account.password-changed'; reason: PasswordChangedReason })
  | (AuditParties & {
    action: 'authz.denied';
    reason: AuthzDeniedReason;
    /** 不给时按操作者机构（orgUnitId）兜底，并记 actor-fallback。 */
    targetOrgUnitId?: string | null;
    targetOrgUnitBasis?: AuditTargetOrgBasis;
  })
  | (AuditParties & { action: 'org.unit.registered' })
  | (AuditParties & { action: 'org.unit.registered'; outcome: 'failed'; reason: OrgUnitRegisterFailedReason })
  | (AuditParties & { action: 'org.unit.renamed' })
  | (AuditParties & { action: 'personnel.exported'; itemCount: number })
  | (AuditParties & { action: 'bootstrap.root-registered' })
  | (AuditParties & { action: 'bootstrap.admin-registered' });

/**
 * 一行授权拒绝。被作用人员、来源地址、前值为空。登录标识和执法证号不进入。
 * orgUnitId 是操作者当时任职机构，照记，不用来套范围。
 * targetOrgUnitId 是目标机构，查阅范围按它套（#119 修正，ADR 0011）。
 */
export interface AuthzDeniedEntry {
  readonly action: typeof AUDIT_ACTION_AUTHZ_DENIED;
  readonly outcome: 'failed';
  readonly actorId: string | null;
  readonly actorCode: string | null;
  readonly subjectPersonnelId: null;
  readonly subjectCode: null;
  readonly orgUnitId: string | null;
  readonly sourceIp: null;
  readonly reason: AuthzDeniedReason;
  readonly opcode: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly previousValue: null;
  readonly targetOrgUnitId: string | null;
  readonly targetOrgUnitBasis: AuditTargetOrgBasis;
}

/** 只追加。没有更新，也没有删除。 */
export interface AuditTrailPort {
  append(entry: AuditAppend | AuthzDeniedEntry): Promise<void>;
}
