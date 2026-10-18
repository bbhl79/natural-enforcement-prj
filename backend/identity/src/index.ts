// 身份组织模块公共出口（#47/#51 定案：跨模块消费只许经本文件；内部路径导入由结构测试
// module-public-entry 拦截）。#96：授权按操作码。人员/机构服务仍只失效不删除、名称版本化。
// PrismaIdentityStore 适配器为模块内唯一 import 生成客户端的文件，经根 tsconfig 排除
//（unit 层无生成产物），由 integration 层深路径装配——故本出口不 re-export 它。

export { AccessDeniedError, isAccessDenied } from './domain/access.ts';
export type {
  AuthorizationResource,
  DenyReason,
  IdentityContext,
} from './domain/access.ts';
export type { AuthorizationDecision } from './services/access-control.service.ts';
export type { ActorRef } from './domain/actor.ts';
export { AlreadyExistsError, isAlreadyExists } from './domain/already-exists.ts';
export { newUlid } from './domain/ulid.ts';
export {
  PASSWORD_RULES,
  rejectedPasswordRules,
} from './domain/password-policy.ts';
export type {
  PasswordCheck,
  PasswordRuleCode,
} from './domain/password-policy.ts';
export {
  IDENTITY_STORE,
  type AssignmentTransfer,
  type ExportAuditRow,
  type IdentityStore,
  type IdentityTransaction,
  type IdentityUniqueConflict,
  type OpcodeGrant,
  type OrgUnitNameVersionRow,
  type OrgUnitRow,
  type OrgUnitToCreate,
  type PersonnelAssignmentRow,
  type PersonnelNameVersionRow,
  type PersonnelDirectoryRow,
  type PersonnelPostToCreate,
  type PersonnelProfileRow,
  type PersonnelRoleToCreate,
  type PersonnelRow,
  type PersonnelToCreate,
  type UniqueWriteResult,
} from './persistence/identity-store.ts';
export { AccessControlService } from './services/access-control.service.ts';
export { CredentialService } from './services/credential.service.ts';
export type {
  DeactivateOrgUnitResult,
  DeactivationBlocker,
  OrgTree,
  OrgTreeUnit,
  RegisterOrgUnitInput,
  RegisterOrgUnitResult,
  RenameOrgUnitResult,
} from './services/org-unit.service.ts';
export {
  ORG_TREE_READ_OPCODE,
  ORG_UNIT_DEACTIVATE_OPCODE,
  ORG_UNIT_LEVELS,
  ORG_UNIT_NAME_MAX_LENGTH,
  ORG_UNIT_REGISTER_OPCODE,
  ORG_UNIT_RENAME_OPCODE,
  ROOT_ORG_UNIT_LEVEL,
  childLevelOf,
  isOrgUnitLevel,
} from './domain/org-unit.ts';
export type { OrgUnitLevel, OrgUnitRuleCode } from './domain/org-unit.ts';
export { OrgUnitService } from './services/org-unit.service.ts';
export { NO_OPEN_ITEMS, OPEN_ITEMS_COUNTER } from './domain/open-items.ts';
export type { OpenItems, OpenItemsCounter } from './domain/open-items.ts';
export type {
  PersonnelDetail,
  PersonnelExportItem,
  RegisterPersonnelInput,
} from './services/personnel.service.ts';
export { PERSONNEL_EXPORT_OPCODE, PersonnelService } from './services/personnel.service.ts';
export {
  CERT_EXPIRING_DAYS,
  PERSONNEL_CODE_MAX_LENGTH,
  PERSONNEL_NAME_MAX_LENGTH,
  PERSONNEL_POSTS,
  PERSONNEL_PROFILE_READ_OPCODE,
  PERSONNEL_PROFILE_REGISTER_OPCODE,
  PERSONNEL_PROFILE_UPDATE_OPCODE,
  ROLE_ORDER,
  certStatusOf,
  isEmptyDiff,
  isPersonnelPost,
  normalizeUpdate,
  parseCalendarDay,
  registrationRules,
  sortRoleNames,
  transferRules,
  updateDiff,
  updateRules,
} from './domain/personnel-profile.ts';
export type {
  CertStatus,
  NormalizedUpdate,
  PersonnelCurrentEdit,
  PersonnelEditDiff,
  PersonnelPost,
  PersonnelRuleCode,
  RegisterPersonnelProfileInput,
  RegisterRuleCode,
  TransferRuleCode,
  UpdatePersonnelProfileInput,
  UpdateRuleCode,
} from './domain/personnel-profile.ts';
export {
  ROOT_GUARD_MESSAGE,
  ROOT_GUARD_REASON,
  ROOT_GUARD_ROLE,
} from './domain/root-guard.ts';
export { PersonnelProfileService } from './services/personnel-profile.service.ts';
export type {
  PersonnelList,
  PersonnelListItem,
  PersonnelProfile,
  ReadProfileResult,
  RegisterPersonnelProfileResult,
  ScreenRegistrationResult,
} from './services/personnel-profile.service.ts';
export {
  BOOTSTRAP_ADMIN_ROLE,
  BOOTSTRAP_CODE_MAX_LENGTH,
  BOOTSTRAP_NAME_MAX_LENGTH,
  BootstrapPrerequisiteError,
  bootstrapInputRules,
  judgeBootstrap,
} from './domain/bootstrap.ts';
export type {
  BootstrapDifference,
  BootstrapInputRule,
  BootstrapOutcome,
  BootstrapProfile,
  BootstrapSnapshot,
} from './domain/bootstrap.ts';
export { BootstrapService } from './services/bootstrap.service.ts';
export type { BootstrapHooks, BootstrapRequest } from './services/bootstrap.service.ts';
export { IdentityModule } from './identity.module.ts';
