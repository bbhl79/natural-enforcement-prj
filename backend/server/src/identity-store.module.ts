import { Global, Injectable, Module } from '@nestjs/common';

import {
  IDENTITY_STORE,
  type AssignmentTransfer,
  type ExportAuditRow,
  type IdentityStore,
  type OrgUnitNameVersionRow,
  type OrgUnitToCreate,
  type PersonnelAssignmentRow,
  type PersonnelNameVersionRow,
  type PersonnelToCreate,
} from '@natural-enforcement/identity';

function unbound(...values: readonly unknown[]): never {
  void values;
  throw new Error('身份存储尚未装配');
}

/**
 * 本票不登录、不建立会话，因此不绑定身份数据库适配器。
 * ADR 0004 允许启动包里仅一个文件直接引用该适配器。该文件留到登录票。
 * 这里只提供注入令牌，让身份模块能被装入进程。调用任一方法即失败。
 */
@Injectable()
export class UnboundIdentityStore implements IdentityStore {
  findPersonnelById(id: string) { return unbound(id); }
  findOrgUnitById(id: string) { return unbound(id); }
  findCurrentAssignment(personnelId: string) { return unbound(personnelId); }
  findOrgUnitPathToRoot(orgUnitId: string) { return unbound(orgUnitId); }
  listOrgUnitNameVersions(orgUnitId: string) { return unbound(orgUnitId); }
  listPersonnelNameVersions(personnelId: string) { return unbound(personnelId); }
  listActivePersonnelOfOrgUnit(orgUnitId: string) { return unbound(orgUnitId); }
  findExportAuditById(id: string) { return unbound(id); }
  insertOrgUnit(input: OrgUnitToCreate) { return unbound(input); }
  insertOrgUnitNameVersion(row: OrgUnitNameVersionRow) { return unbound(row); }
  updateOrgUnitCurrentName(orgUnitId: string, name: string) { return unbound(orgUnitId, name); }
  deactivateOrgUnit(orgUnitId: string, deactivatedAt: Date) { return unbound(orgUnitId, deactivatedAt); }
  insertPersonnel(input: PersonnelToCreate) { return unbound(input); }
  insertPersonnelNameVersion(row: PersonnelNameVersionRow) { return unbound(row); }
  updatePersonnelCurrentName(personnelId: string, name: string) { return unbound(personnelId, name); }
  updatePersonnelOrgUnit(personnelId: string, orgUnitId: string) { return unbound(personnelId, orgUnitId); }
  deactivatePersonnel(personnelId: string, deactivatedAt: Date) { return unbound(personnelId, deactivatedAt); }
  insertAssignment(row: PersonnelAssignmentRow) { return unbound(row); }
  closeAssignment(assignmentId: string, endedAt: Date) { return unbound(assignmentId, endedAt); }
  transferAssignment(transfer: AssignmentTransfer) { return unbound(transfer); }
  insertExportAudit(row: ExportAuditRow) { return unbound(row); }
}

@Global()
@Module({
  providers: [{ provide: IDENTITY_STORE, useClass: UnboundIdentityStore }],
  exports: [IDENTITY_STORE],
})
export class IdentityStoreModule {}
