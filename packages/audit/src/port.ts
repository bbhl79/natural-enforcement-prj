import type {
  AuthzDeniedReason,
  LoginFailedReason,
  PasswordChangedReason,
  SessionEndReason,
} from './vocabulary.ts';

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
  | (AuditParties & { action: 'authz.denied'; reason: AuthzDeniedReason });

/** 只追加。没有更新，也没有删除。 */
export interface AuditTrailPort {
  append(entry: AuditAppend): Promise<void>;
}
