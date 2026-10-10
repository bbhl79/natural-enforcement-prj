// 身份组织模块公共出口（#47/#51 定案：跨模块消费只许经本文件；内部路径导入由结构测试
// module-public-entry 拦截）。#52 落地：四类动作强校验闸 + 人员/机构服务（只失效不删除、
// 名称版本化）+ 口令凭证 + 持久化端口。PrismaIdentityStore 适配器为模块内唯一
// import 生成客户端的文件，经根 tsconfig 排除（unit 层无生成产物），由 integration 层
// 深路径装配——故本出口不 re-export 它。

export {
  ACCESS_ACTIONS,
  AccessDeniedError,
  isAccessDenied,
  isPersonnelRole,
  PERSONNEL_ROLES,
  ROLE_ACTION_MATRIX,
} from './domain/access.ts';
export type { AccessAction, DenyReason, PersonnelRole } from './domain/access.ts';
export type { ActorRef } from './domain/actor.ts';
export { newUlid } from './domain/ulid.ts';
export {
  IDENTITY_STORE,
  type ExportAuditRow,
  type IdentityStore,
  type OrgUnitNameVersionRow,
  type OrgUnitRow,
  type OrgUnitToCreate,
  type PersonnelAssignmentRow,
  type PersonnelNameVersionRow,
  type PersonnelRow,
  type PersonnelToCreate,
} from './persistence/identity-store.ts';
export { AccessControlService } from './services/access-control.service.ts';
export { CredentialService } from './services/credential.service.ts';
export type {
  RegisterOrgUnitInput,
} from './services/org-unit.service.ts';
export { OrgUnitService } from './services/org-unit.service.ts';
export type {
  ExportResult,
  PersonnelDetail,
  RegisterPersonnelInput,
} from './services/personnel.service.ts';
export { PersonnelService } from './services/personnel.service.ts';
export { IdentityModule } from './identity.module.ts';
