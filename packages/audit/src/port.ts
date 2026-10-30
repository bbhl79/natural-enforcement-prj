import type {
  AccountMaintenanceFailedReason,
  AuditTargetOrgBasis,
  CaseComparisonFailedReason,
  CaseConflictDecidedFailedReason,
  CaseConflictDeclaredFailedReason,
  CaseFilingApprovedFailedReason,
  CaseFilingDraftedFailedReason,
  CaseInvestigationRecordedFailedReason,
  CaseSignRefusedReason,
  CaseFilingReturnedFailedReason,
  CaseFilingReviewedFailedReason,
  CaseFilingSubmittedFailedReason,
  CaseFilingWithdrawnFailedReason,
  CaseDeadlineAction,
  CaseDeadlineFailedReason,
  CaseReviewAction,
  CaseReviewFailedReason,
  CaseLegalReviewAction,
  CaseLegalReviewFailedReason,
  CaseValidityAction,
  CaseValidityFailedReason,
  CaseTransferAction,
  CaseTransferFailedReason,
  CaseFinalizeAction,
  CaseFinalizeFailedReason,
  CaseDecisionAction,
  CaseDecisionFailedReason,
  CaseCloseoutAction,
  CaseCloseoutFailedReason,
  CaseNoticeAction,
  CaseNoticeFailedReason,
  CaseInvestigationAction,
  CaseInvestigationFailedReason,
  CaseMaterialEffectivityFailedReason,
  CaseReassignmentApprovedFailedReason,
  CaseReassignmentSubmittedFailedReason,
  CaseReassignmentWithdrawnFailedReason,
  CaseOpenedFailedReason,
  CaseReturnedFailedReason,
  CaseTransitionedFailedReason,
  ClueDesignateRejectedFailedReason,
  ClueDesignateRequestedFailedReason,
  ClueDispatchDecideFailedReason,
  ClueDispositionRecordedFailedReason,
  ClueExternalTransferAttachedFailedReason,
  ClueHandlerAssignedFailedReason,
  ClueItemsSupplementFailedReason,
  ClueOrgAssignedFailedReason,
  CluePoolReassignedFailedReason,
  ClueRegisterFailedReason,
  ClueGeometryUpdateFailedReason,
  ClueReminderResolvedFailedReason,
  ClueVerifyRetryFailedReason,
  ClueWithdrawnFailedReason,
  StorageQuarantinedFailedReason,
  StorageSecrecyReportCreatedFailedReason,
  StorageSecrecyReportReportedFailedReason,
  StorageSecrecyReportReceiptedFailedReason,
  CertUpdateFailedReason,
  AuthzDeniedReason,
  LoginFailedReason,
  OrgUnitDeactivateFailedReason,
  OrgUnitRegisterFailedReason,
  PasswordChangedReason,
  PasswordRejectedReason,
  PersonnelDeactivateFailedReason,
  PersonnelMobileChangeFailedReason,
  PersonnelPostGrantFailedReason,
  PersonnelPostRevokeFailedReason,
  PersonnelRegisterFailedReason,
  PersonnelRenameFailedReason,
  PersonnelRestoreFailedReason,
  PersonnelRoleGrantFailedReason,
  PersonnelRoleRevokeFailedReason,
  PersonnelTransferFailedReason,
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
  /** 后值（#128）。只有 AUDIT_NEXT_VALUE_ACTIONS 里的动作带，其余为空。 */
  nextValue?: string | null;
  /**
   * 结构化快照（#211，规格 G）。只有 AUDIT_DETAIL_ACTIONS 里的动作带，其余为空。
   * 只写不回：查阅接口不返回这一列。
   */
  detail?: string | null;
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
  | (AuditParties & { action: 'account.unlocked'; outcome: 'failed'; reason: AccountMaintenanceFailedReason })
  | (AuditParties & { action: 'account.password-reset' })
  | (AuditParties & { action: 'account.password-reset'; outcome: 'failed'; reason: AccountMaintenanceFailedReason })
  | (AuditParties & { action: 'account.password-changed'; reason: PasswordChangedReason })
  /** 口令被拒（ADR 0015，#132）：只记失败。口令、散列、前值不进任何一列。 */
  | (AuditParties & { action: 'account.password-rejected'; outcome: 'failed'; reason: PasswordRejectedReason })
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
  | (AuditParties & { action: 'org.unit.deactivated' })
  | (AuditParties & { action: 'org.unit.deactivated'; outcome: 'failed'; reason: OrgUnitDeactivateFailedReason })
  | (AuditParties & { action: 'personnel.exported'; itemCount: number })
  | (AuditParties & { action: 'bootstrap.root-registered' })
  | (AuditParties & { action: 'bootstrap.admin-registered' })
  | (AuditParties & { action: 'audit.viewed' })
  | (AuditParties & { action: 'audit.exported'; itemCount: number })
  | (AuditParties & { action: 'personnel.registered' })
  | (AuditParties & { action: 'personnel.registered'; outcome: 'failed'; reason: PersonnelRegisterFailedReason })
  | (AuditParties & { action: 'personnel.viewed' })
  | (AuditParties & { action: 'personnel.post-granted'; nextValue: string })
  | (AuditParties & {
    action: 'personnel.post-granted';
    outcome: 'failed';
    reason: PersonnelPostGrantFailedReason;
    nextValue: string;
  })
  /** 执法证登记（#133）。前值只写旧有效期和旧状态，不写证号（#105:232、ADR 0011）。 */
  | (AuditParties & { action: 'cert.updated' })
  /** 对方已停用时拒绝登记与修改（#158）。 */
  | (AuditParties & { action: 'cert.updated'; outcome: 'failed'; reason: CertUpdateFailedReason })
  // 人员编辑与调岗（#129，ADR 0014）。改名前值写旧名；改手机号前值留空（#105:219）。
  // 对方已停用时编辑与调岗一律被拒（#130 定口径），失败行的动作词与成功时相同。
  | (AuditParties & { action: 'personnel.renamed' })
  | (AuditParties & { action: 'personnel.renamed'; outcome: 'failed'; reason: PersonnelRenameFailedReason })
  | (AuditParties & { action: 'personnel.mobile-changed' })
  | (AuditParties & { action: 'personnel.mobile-changed'; outcome: 'failed'; reason: PersonnelMobileChangeFailedReason })
  | (AuditParties & { action: 'personnel.role-granted'; nextValue: string })
  | (AuditParties & {
    action: 'personnel.role-granted';
    outcome: 'failed';
    reason: PersonnelRoleGrantFailedReason;
    nextValue: string;
  })
  | (AuditParties & { action: 'personnel.role-revoked'; nextValue: string })
  | (AuditParties & {
    action: 'personnel.role-revoked';
    outcome: 'failed';
    reason: PersonnelRoleRevokeFailedReason;
    nextValue: string;
  })
  | (AuditParties & { action: 'personnel.post-revoked'; nextValue: string })
  | (AuditParties & {
    action: 'personnel.post-revoked';
    outcome: 'failed';
    reason: PersonnelPostRevokeFailedReason;
    nextValue: string;
  })
  | (AuditParties & { action: 'personnel.transferred'; nextValue: string })
  | (AuditParties & {
    action: 'personnel.transferred';
    outcome: 'failed';
    reason: PersonnelTransferFailedReason;
    nextValue: string;
  })
  // 人员停用、恢复与结束全部会话（#130）。结束全部会话只记成功，被拒走 authz.denied。
  | (AuditParties & { action: 'personnel.deactivated' })
  | (AuditParties & {
    action: 'personnel.deactivated';
    outcome: 'failed';
    reason: PersonnelDeactivateFailedReason;
  })
  | (AuditParties & { action: 'personnel.restored' })
  | (AuditParties & { action: 'personnel.restored'; outcome: 'failed'; reason: PersonnelRestoreFailedReason })
  | (AuditParties & { action: 'personnel.sessions-ended' })
  // 线索登记（#211，规格 G）：动作词与业务事实同事务写入，detail 存结构化快照。
  | (AuditParties & { action: 'clue.registered' })
  | (AuditParties & { action: 'clue.registered'; outcome: 'failed'; reason: ClueRegisterFailedReason })
  | (AuditParties & { action: 'clue.items-supplemented' })
  | (AuditParties & { action: 'clue.items-supplemented'; outcome: 'failed'; reason: ClueItemsSupplementFailedReason })
  // 内业核查手动重跑（#213，规格 G）：动作词与新运行行同事务写入，detail 存新运行序号。
  | (AuditParties & { action: 'clue.verify-retried' })
  | (AuditParties & { action: 'clue.verify-retried'; outcome: 'failed'; reason: ClueVerifyRetryFailedReason })
  // 疑似重复重绘（#212，规格 G）：动作词与新空间版本同事务写入，detail 存前后命中摘要。
  | (AuditParties & { action: 'clue.geometry-updated' })
  | (AuditParties & {
    action: 'clue.geometry-updated';
    outcome: 'failed';
    reason: ClueGeometryUpdateFailedReason;
  })
  // 实名查阅（#212，规格 G）：只记查看事实，detail 存编号，不记明文。
  | (AuditParties & { action: 'clue.reference-viewed' })
  // 分派决定与两步分派（#214，规格 G）：动作词与状态写入同事务，detail 存前后状态等结构化快照。
  | (AuditParties & { action: 'clue.dispatched' })
  | (AuditParties & { action: 'clue.dispatched'; outcome: 'failed'; reason: ClueDispatchDecideFailedReason })
  | (AuditParties & { action: 'clue.held' })
  | (AuditParties & { action: 'clue.held'; outcome: 'failed'; reason: ClueDispatchDecideFailedReason })
  | (AuditParties & { action: 'clue.org-assigned' })
  | (AuditParties & { action: 'clue.org-assigned'; outcome: 'failed'; reason: ClueOrgAssignedFailedReason })
  | (AuditParties & { action: 'clue.handler-assigned' })
  | (AuditParties & { action: 'clue.handler-assigned'; outcome: 'failed'; reason: ClueHandlerAssignedFailedReason })
  // 处置登记（#216 移送、#217 不予立案／随旧线索办结，规格 G）：同一动作词承载两种处置入口。
  | (AuditParties & { action: 'clue.disposition-recorded' })
  | (AuditParties & {
      action: 'clue.disposition-recorded';
      outcome: 'failed';
      reason: ClueDispositionRecordedFailedReason;
    })
  // 系统外移送附加记录（#229）：不改线索状态，成功／失败同行动作词。
  | (AuditParties & { action: 'clue.external-transfer-attached' })
  | (AuditParties & {
      action: 'clue.external-transfer-attached';
      outcome: 'failed';
      reason: ClueExternalTransferAttachedFailedReason;
    })
  // 移送与停用机构池重新指定（#216，规格 G）：停用机构与新接收机构。
  | (AuditParties & { action: 'clue.pool-reassigned' })
  | (AuditParties & { action: 'clue.pool-reassigned'; outcome: 'failed'; reason: CluePoolReassignedFailedReason })
  // 报请指定管辖与驳回（#215，规格 G）：动作词与报请行同事务写入，detail 存报请机构、拟归属机构与受理机构。
  | (AuditParties & { action: 'clue.designate-requested' })
  | (AuditParties & {
      action: 'clue.designate-requested';
      outcome: 'failed';
      reason: ClueDesignateRequestedFailedReason;
    })
  | (AuditParties & { action: 'clue.designate-rejected' })
  | (AuditParties & {
      action: 'clue.designate-rejected';
      outcome: 'failed';
      reason: ClueDesignateRejectedFailedReason;
    })
  // 撤回不派与结案（#217，规格 G）：动作词与状态写入同事务，detail 存原因编码／提醒处理结果。
  | (AuditParties & { action: 'clue.withdrawn' })
  | (AuditParties & { action: 'clue.withdrawn'; outcome: 'failed'; reason: ClueWithdrawnFailedReason })
  | (AuditParties & { action: 'clue.reminder-resolved' })
  | (AuditParties & {
      action: 'clue.reminder-resolved';
      outcome: 'failed';
      reason: ClueReminderResolvedFailedReason;
    })
  // 涉密误传隔离（#224）：成功／失败同行动作词；detail 存对象 id 与简述。
  | (AuditParties & { action: 'storage.quarantined' })
  | (AuditParties & {
      action: 'storage.quarantined';
      outcome: 'failed';
      reason: StorageQuarantinedFailedReason;
    })
  // 保密报告工单（#225）：生成、登记已报、录入回执；detail 存工单 id、对象 id 与人工录入内容。
  | (AuditParties & { action: 'storage.secrecy-report-created' })
  | (AuditParties & {
      action: 'storage.secrecy-report-created';
      outcome: 'failed';
      reason: StorageSecrecyReportCreatedFailedReason;
    })
  | (AuditParties & { action: 'storage.secrecy-report-reported' })
  | (AuditParties & {
      action: 'storage.secrecy-report-reported';
      outcome: 'failed';
      reason: StorageSecrecyReportReportedFailedReason;
    })
  | (AuditParties & { action: 'storage.secrecy-report-receipted' })
  | (AuditParties & {
      action: 'storage.secrecy-report-receipted';
      outcome: 'failed';
      reason: StorageSecrecyReportReceiptedFailedReason;
    })
  | (AuditParties & { action: 'case.filing-drafted' })
  | (AuditParties & { action: 'case.filing-drafted'; outcome: 'failed'; reason: CaseFilingDraftedFailedReason })
  | (AuditParties & { action: 'case.filing-submitted' })
  | (AuditParties & { action: 'case.filing-submitted'; outcome: 'failed'; reason: CaseFilingSubmittedFailedReason })
  | (AuditParties & { action: 'case.filing-reviewed' })
  | (AuditParties & { action: 'case.filing-reviewed'; outcome: 'failed'; reason: CaseFilingReviewedFailedReason })
  | (AuditParties & { action: 'case.filing-approved' })
  | (AuditParties & { action: 'case.filing-approved'; outcome: 'failed'; reason: CaseFilingApprovedFailedReason })
  | (AuditParties & { action: 'case.filing-returned' })
  | (AuditParties & { action: 'case.filing-returned'; outcome: 'failed'; reason: CaseFilingReturnedFailedReason })
  | (AuditParties & { action: 'case.filing-withdrawn' })
  | (AuditParties & { action: 'case.filing-withdrawn'; outcome: 'failed'; reason: CaseFilingWithdrawnFailedReason })
  | (AuditParties & { action: 'case.opened' })
  | (AuditParties & { action: 'case.opened'; outcome: 'failed'; reason: CaseOpenedFailedReason })
  | (AuditParties & { action: 'case.transitioned' })
  | (AuditParties & { action: 'case.transitioned'; outcome: 'failed'; reason: CaseTransitionedFailedReason })
  | (AuditParties & { action: 'case.rule-confirmed' })
  | (AuditParties & { action: 'case.conflict-declared' })
  | (AuditParties & { action: 'case.conflict-declared'; outcome: 'failed'; reason: CaseConflictDeclaredFailedReason })
  | (AuditParties & { action: 'case.conflict-decided' })
  | (AuditParties & { action: 'case.conflict-decided'; outcome: 'failed'; reason: CaseConflictDecidedFailedReason })
  | (AuditParties & { action: 'case.investigation-recorded' })
  | (AuditParties & {
      action: 'case.investigation-recorded';
      outcome: 'failed';
      reason: CaseInvestigationRecordedFailedReason;
    })
  | (AuditParties & { action: 'case.comparison-recorded' })
  | (AuditParties & { action: 'case.comparison-refused'; reason: CaseComparisonFailedReason })
  | (AuditParties & { action: 'case.sign-refused'; reason: CaseSignRefusedReason })
  | (AuditParties & { action: 'case.returned' })
  | (AuditParties & { action: 'case.returned'; outcome: 'failed'; reason: CaseReturnedFailedReason })
  | (AuditParties & { action: CaseInvestigationAction })
  | (AuditParties & { action: CaseInvestigationAction; outcome: 'failed'; reason: CaseInvestigationFailedReason })
  | (AuditParties & { action: CaseDeadlineAction })
  | (AuditParties & { action: CaseDeadlineAction; outcome: 'failed'; reason: CaseDeadlineFailedReason })
  // 审理与异议呈批（#240）：报告呈批、审理人指定、意见签出、异议呈批。
  | (AuditParties & { action: CaseReviewAction })
  | (AuditParties & { action: CaseReviewAction; outcome: 'failed'; reason: CaseReviewFailedReason })
  // 改派呈批与材料效力认定（#239）。
  | (AuditParties & { action: 'case.reassignment-submitted' })
  | (AuditParties & {
    action: 'case.reassignment-submitted';
    outcome: 'failed';
    reason: CaseReassignmentSubmittedFailedReason;
  })
  | (AuditParties & { action: 'case.reassignment-approved' })
  | (AuditParties & {
    action: 'case.reassignment-approved';
    outcome: 'failed';
    reason: CaseReassignmentApprovedFailedReason;
  })
  // 改派呈批撤回（#279）：发起人批准前撤回，关链并置已撤回。
  | (AuditParties & { action: 'case.reassignment-withdrawn' })
  | (AuditParties & {
    action: 'case.reassignment-withdrawn';
    outcome: 'failed';
    reason: CaseReassignmentWithdrawnFailedReason;
  })
  | (AuditParties & { action: 'case.material-effectivity-recorded' })
  | (AuditParties & {
    action: 'case.material-effectivity-recorded';
    outcome: 'failed';
    reason: CaseMaterialEffectivityFailedReason;
  })
  // 告知／陈述申辩／听证（#272）。成功与失败都记同一动作。
  | (AuditParties & { action: CaseNoticeAction })
  | (AuditParties & { action: CaseNoticeAction; outcome: 'failed'; reason: CaseNoticeFailedReason })
  // 法制审核与集体讨论（#269）。成功与失败都记同一动作。
  | (AuditParties & { action: CaseLegalReviewAction })
  | (AuditParties & { action: CaseLegalReviewAction; outcome: 'failed'; reason: CaseLegalReviewFailedReason })
  // 有效性确认与重新告知（#248）。成功与失败都记同一动作。
  | (AuditParties & { action: CaseValidityAction })
  | (AuditParties & { action: CaseValidityAction; outcome: 'failed'; reason: CaseValidityFailedReason })
  // 案件阶段三类移送（#242）。成功与失败都记同一动作。
  | (AuditParties & { action: CaseTransferAction })
  | (AuditParties & { action: CaseTransferAction; outcome: 'failed'; reason: CaseTransferFailedReason })
  // 定型（#243）：材料入卷与归档审批。成功与失败都记同一动作。
  | (AuditParties & { action: CaseFinalizeAction })
  | (AuditParties & { action: CaseFinalizeAction; outcome: 'failed'; reason: CaseFinalizeFailedReason })
  // 决定、送达、执行记载与结案（#270）。成功与失败都记同一动作。
  | (AuditParties & { action: CaseDecisionAction })
  | (AuditParties & { action: CaseDecisionAction; outcome: 'failed'; reason: CaseDecisionFailedReason })
  | (AuditParties & { action: CaseCloseoutAction })
  | (AuditParties & { action: CaseCloseoutAction; outcome: 'failed'; reason: CaseCloseoutFailedReason })
;

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
