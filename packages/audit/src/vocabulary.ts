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
  // 执法证登记（#105「执法证（#85）」，#133）。前值只写旧有效期和旧状态，不写证号。
  'cert.updated',
  // 人员编辑与调岗（#105「人员与登录凭据」，#129，ADR 0014）。
  'personnel.renamed',
  'personnel.mobile-changed',
  'personnel.role-granted',
  'personnel.role-revoked',
  'personnel.post-revoked',
  'personnel.transferred',
  // 人员停用、恢复与结束全部会话（#105「人员与登录凭据」，#130）。
  'personnel.deactivated',
  'personnel.restored',
  'personnel.sessions-ended',
  // 线索登记（#211，规格 G）：登记成功与缺件补齐。
  'clue.registered',
  'clue.items-supplemented',
  // 内业核查（#213，规格 G）：手动重跑。自动核查由业务表承载，不伪装成人为留痕。
  'clue.verify-retried',
  // 分派决定与两步分派（#214，规格 G）：决定（含已知晓）、派机构、派主办／协办。
  'clue.dispatched',
  'clue.held',
  'clue.org-assigned',
  'clue.handler-assigned',
] as const;

/**
 * 口令被拒的原因（ADR 0015，#132）：reused 重设或恢复的初始口令命中口令历史（含当前口令）；
 * concurrent-change 任一入口的并发条件更新失败（409）。本人改密命中历史不写留痕。
 */
export const PASSWORD_REJECTED_REASONS = ['reused', 'concurrent-change'] as const;
export type PasswordRejectedReason = (typeof PASSWORD_REJECTED_REASONS)[number];

export const AUDIT_ACTIONS = [
  ...AUDIT_SUCCEEDED_ACTIONS,
  // 口令被拒（ADR 0015，#132）：只记失败。
  'account.password-rejected',
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

/**
 * 根机构守卫（ADR 0014，#129）：始终保留一名「当前任职在根机构、未停用、持有未停用系统管理角色」的人员。
 * 摘除系统管理角色、调岗出根机构违反时记这个原因，返回 409 invalid-state。
 */
export const ROOT_GUARD_FAILED_REASON = 'root-admin-required';
export type RootGuardFailedReason = typeof ROOT_GUARD_FAILED_REASON;

/**
 * 停用态人员禁止编辑与调岗（#130 定口径，PR #148 复核遗留①）。
 * 请求要改的每一项各记一行失败留痕，动作词与成功时相同，原因都是这个词。
 * 同一个词也作为 409 返回体的 reason（#105 错误码表「409 可读原因」：留痕的失败原因取同一个词）。
 */
export const PERSONNEL_DEACTIVATED_REASON = 'personnel-deactivated';
export type PersonnelDeactivatedReason = typeof PERSONNEL_DEACTIVATED_REASON;

/** 改手机号被拒（outcome=failed）的原因（#129、#130）：手机号已被他人占用；对方已停用。 */
export const PERSONNEL_MOBILE_CHANGE_FAILED_REASONS = ['already-exists', PERSONNEL_DEACTIVATED_REASON] as const;
export type PersonnelMobileChangeFailedReason = (typeof PERSONNEL_MOBILE_CHANGE_FAILED_REASONS)[number];

/** 摘除角色被拒（outcome=failed）的原因（#129、#130）：根机构守卫；对方已停用。 */
export const PERSONNEL_ROLE_REVOKE_FAILED_REASONS = [ROOT_GUARD_FAILED_REASON, PERSONNEL_DEACTIVATED_REASON] as const;
export type PersonnelRoleRevokeFailedReason = (typeof PERSONNEL_ROLE_REVOKE_FAILED_REASONS)[number];

/** 调岗被拒（outcome=failed）的原因（#129、#130）：调入机构已停用；根机构守卫；对方已停用。 */
export const PERSONNEL_TRANSFER_FAILED_REASONS = [
  'org-unit-deactivated',
  ROOT_GUARD_FAILED_REASON,
  PERSONNEL_DEACTIVATED_REASON,
] as const;
export type PersonnelTransferFailedReason = (typeof PERSONNEL_TRANSFER_FAILED_REASONS)[number];

/**
 * 停用态人员禁止编辑与调岗（#130 定口径，PR #148 复核遗留①）的原因词见上文
 * PERSONNEL_DEACTIVATED_REASON。下面四张表是它落到的动作。
 */

/** 改名被拒（outcome=failed）的原因（#130）：只有对方已停用一条。 */
export const PERSONNEL_RENAME_FAILED_REASONS = [PERSONNEL_DEACTIVATED_REASON] as const;
export type PersonnelRenameFailedReason = (typeof PERSONNEL_RENAME_FAILED_REASONS)[number];

/** 授予角色被拒（outcome=failed）的原因（#130）：只有对方已停用一条。 */
export const PERSONNEL_ROLE_GRANT_FAILED_REASONS = [PERSONNEL_DEACTIVATED_REASON] as const;
export type PersonnelRoleGrantFailedReason = (typeof PERSONNEL_ROLE_GRANT_FAILED_REASONS)[number];

/** 加岗位标记被拒（outcome=failed）的原因（#130）：只有对方已停用一条。 */
export const PERSONNEL_POST_GRANT_FAILED_REASONS = [PERSONNEL_DEACTIVATED_REASON] as const;
export type PersonnelPostGrantFailedReason = (typeof PERSONNEL_POST_GRANT_FAILED_REASONS)[number];

/** 摘岗位标记被拒（outcome=failed）的原因（#130）：只有对方已停用一条。 */
export const PERSONNEL_POST_REVOKE_FAILED_REASONS = [PERSONNEL_DEACTIVATED_REASON] as const;
export type PersonnelPostRevokeFailedReason = (typeof PERSONNEL_POST_REVOKE_FAILED_REASONS)[number];

/** 执法证登记被拒（outcome=failed）的原因（#158）：只有对方已停用一条。 */
export const CERT_UPDATE_FAILED_REASONS = [PERSONNEL_DEACTIVATED_REASON] as const;
export type CertUpdateFailedReason = (typeof CERT_UPDATE_FAILED_REASONS)[number];

/** A10 解锁、重设初始口令被拒（outcome=failed）的原因（#158）：只有对方已停用一条。 */
export const ACCOUNT_MAINTENANCE_FAILED_REASONS = [PERSONNEL_DEACTIVATED_REASON] as const;
export type AccountMaintenanceFailedReason = (typeof ACCOUNT_MAINTENANCE_FAILED_REASONS)[number];

/** 停用人员被拒（outcome=failed）的原因（#130，ADR 0014）：只有根机构守卫一条。 */
export const PERSONNEL_DEACTIVATE_FAILED_REASONS = [ROOT_GUARD_FAILED_REASON] as const;
export type PersonnelDeactivateFailedReason = (typeof PERSONNEL_DEACTIVATE_FAILED_REASONS)[number];

/**
 * 恢复人员被拒（outcome=failed）的原因（#130，#105 故事 37–39）。判定顺序同表序，只记第一条：
 * not-deactivated 对方没有停用；org-unit-required 原任职机构已停用且没有带新任职机构；
 * org-unit-deactivated 所选新任职机构已停用。口令不合规是 400，不写留痕。
 */
export const PERSONNEL_RESTORE_FAILED_REASONS = [
  'not-deactivated',
  'org-unit-required',
  'org-unit-deactivated',
] as const;
export type PersonnelRestoreFailedReason = (typeof PERSONNEL_RESTORE_FAILED_REASONS)[number];

/**
 * 带「后值」的动作（#128、#129）。后值写这次动作把对象改成了什么：
 * 岗位标记取值、角色名、调入机构名。其余动作不许带后值。
 */
export const AUDIT_NEXT_VALUE_ACTIONS = [
  'personnel.post-granted',
  'personnel.post-revoked',
  'personnel.role-granted',
  'personnel.role-revoked',
  'personnel.transferred',
] as const;
export type AuditNextValueAction = (typeof AUDIT_NEXT_VALUE_ACTIONS)[number];

/**
 * 授权拒绝行的目标机构从哪来（#119 修正，ADR 0011）。
 * object：对象所属机构；actor-fallback：对象机构解析不出（如对象不存在），取操作者当时任职机构。
 */
export const AUDIT_TARGET_ORG_BASES = ['object', 'actor-fallback'] as const;
export type AuditTargetOrgBasis = (typeof AUDIT_TARGET_ORG_BASES)[number];

/**
 * 登记线索被拒（outcome=failed）的原因（#211，规格 G）。
 * missing-required-items 公共层或来源层阻断项缺失、类型层缺件未确认；
 * invalid-form 来源、法域、类型编码或要件取值不合规；
 * invalid-attachment 附件类型、真实内容、件数或字节数不合规；
 * invalid-geometry 几何来源文件不合规。
 */
export const CLUE_REGISTER_FAILED_REASONS = [
  'missing-required-items',
  'invalid-form',
  'invalid-attachment',
  'invalid-geometry',
] as const;
export type ClueRegisterFailedReason = (typeof CLUE_REGISTER_FAILED_REASONS)[number];

/**
 * 补齐缺件被拒（outcome=failed）的原因（#211，规格 G）。
 * missing-required-items 同一次提交里有一项补齐不合格（整单不保存）；
 * invalid-form 提交值本身不合规。
 */
export const CLUE_ITEMS_SUPPLEMENT_FAILED_REASONS = ['missing-required-items', 'invalid-form'] as const;
export type ClueItemsSupplementFailedReason = (typeof CLUE_ITEMS_SUPPLEMENT_FAILED_REASONS)[number];

/**
 * 手动重跑内业核查被拒（outcome=failed）的原因（#213，规格 G）。
 * invalid-state 线索终态或该法域不设内业核查；
 * concurrent-change 该线索已有进行中的核查（并发手动重跑）。
 */
export const CLUE_VERIFY_RETRY_FAILED_REASONS = ['invalid-state', 'concurrent-change'] as const;
export type ClueVerifyRetryFailedReason = (typeof CLUE_VERIFY_RETRY_FAILED_REASONS)[number];

/**
 * 分派决定被拒（outcome=failed）的原因（#214，规格 G）。
 * complaint-must-dispatch 举报类线索只能派、不能选不派；
 * ack-required 存在未结案的疑似重复命中、派出前须点「已知晓」；
 * invalid-state 线索不在待分派决定等状态；
 * concurrent-change 决定与并发写入冲突。
 */
export const CLUE_DISPATCH_DECIDE_FAILED_REASONS = [
  'invalid-form',
  'complaint-must-dispatch',
  'ack-required',
  'invalid-state',
  'concurrent-change',
] as const;
export type ClueDispatchDecideFailedReason = (typeof CLUE_DISPATCH_DECIDE_FAILED_REASONS)[number];

/**
 * 派机构（首次分派、重新分派、指定管辖）被拒（outcome=failed）的原因（#214，规格 G）。
 * missing-reassign-reason 重新分派与指定管辖的理由必填；
 * org-unit-deactivated 目标机构已停用；
 * designated-lock 指定管辖之后下级机构不能再重新分派；
 * invalid-state 线索状态不允许派机构；
 * concurrent-change 与并发写入冲突。
 */
export const CLUE_ORG_ASSIGNED_FAILED_REASONS = [
  'invalid-form',
  'missing-reassign-reason',
  'org-unit-deactivated',
  'designated-lock',
  'invalid-state',
  'concurrent-change',
] as const;
export type ClueOrgAssignedFailedReason = (typeof CLUE_ORG_ASSIGNED_FAILED_REASONS)[number];

/**
 * 派主办／协办被拒（outcome=failed）的原因（#214，规格 G）。
 * missing-required-items 主办必填；
 * assignee-not-qualified 承办人已停用或不属于承办机构；
 * invalid-state 线索不在已派机构状态；
 * concurrent-change 与并发写入冲突。
 */
export const CLUE_HANDLER_ASSIGNED_FAILED_REASONS = [
  'missing-required-items',
  'assignee-not-qualified',
  'invalid-state',
  'concurrent-change',
] as const;
export type ClueHandlerAssignedFailedReason = (typeof CLUE_HANDLER_ASSIGNED_FAILED_REASONS)[number];

/**
 * 带结构化快照（detail）的动作（#211，规格 G）。
 * 线索动作把编号、当前命中集摘要、缺件键写进 detail，不占用 previousValue/nextValue/itemCount。
 * detail 只写不回：查阅接口不返回它。其余动作一律不带 detail。
 */
export const AUDIT_DETAIL_ACTIONS = [
  'clue.registered',
  'clue.items-supplemented',
  'clue.verify-retried',
  // 分派决定与两步分派（#214，规格 G）：前后状态、已知晓、原／新机构、指定管辖与承办人变更。
  'clue.dispatched',
  'clue.held',
  'clue.org-assigned',
  'clue.handler-assigned',
] as const;
export type AuditDetailAction = (typeof AUDIT_DETAIL_ACTIONS)[number];
