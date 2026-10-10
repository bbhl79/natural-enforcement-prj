// 身份组织持久化端口（#52）：模块对存储的唯一面向，可注入（IDENTITY_STORE 令牌）。
// 只失效不删除的纪律在本接口成形：全接口不存在任何物理删除方法——人员/机构只有
// deactivate（失效标记 + 失效时间），留痕/名称版本只有 insert（append-only，库层
// 触发器再兜底拒 UPDATE/DELETE，见迁移 0002_identity_org）。
// 首个真实调用方 = integration/e2-access-matrix.test.ts（PrismaIdentityStore 适配）。
// 主键形制约定（#16 §1.1）：ULID，由领域层 newUlid 生成；端口内以 string 承载。

/** 注入令牌：宿主/调用方绑定 store 实现（模块自身不直连具体存储） */
export const IDENTITY_STORE = Symbol('IDENTITY_STORE');

/** 机构行（org_unit 当前态；名称历史在 OrgUnitNameVersionRow） */
export interface OrgUnitRow {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  deactivatedAt: Date | null;
}

/** 人员行（personnel 当前态；名称历史在 PersonnelNameVersionRow） */
export interface PersonnelRow {
  id: string;
  code: string;
  name: string;
  orgUnitId: string;
  role: string;
  passwordHash: string | null;
  deactivatedAt: Date | null;
}

/** 任职记录（当前 assignment = endedAt 为 null 的那条） */
export interface PersonnelAssignmentRow {
  id: string;
  personnelId: string;
  orgUnitId: string;
  startedAt: Date;
  endedAt: Date | null;
}

/** 导出留痕行（写入后不可变：库层触发器拒 UPDATE/DELETE，见迁移 0002_identity_org） */
export interface ExportAuditRow {
  id: string;
  actorId: string;
  targetOrgUnitId: string;
  exportedCount: number;
  createdAt: Date;
}

export interface OrgUnitNameVersionRow {
  id: string;
  orgUnitId: string;
  name: string;
  version: number;
  createdAt: Date;
}

export interface PersonnelNameVersionRow {
  id: string;
  personnelId: string;
  name: string;
  version: number;
  createdAt: Date;
}

/** 机构新建输入（名称同时落当前行与 v1 版本行） */
export interface OrgUnitToCreate {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
}

export interface PersonnelToCreate {
  id: string;
  code: string;
  name: string;
  orgUnitId: string;
  role: string;
  passwordHash: string | null;
}

export interface IdentityStore {
  // 查询
  findPersonnelById(id: string): Promise<PersonnelRow | null>;
  findOrgUnitById(id: string): Promise<OrgUnitRow | null>;
  /** 当前生效的任职记录（endedAt = null）；无则 null */
  findCurrentAssignment(personnelId: string): Promise<PersonnelAssignmentRow | null>;
  /** 目标机构的祖先链（含自身），自根向叶排列；用于数据范围判定 */
  findOrgUnitPathToRoot(orgUnitId: string): Promise<string[]>;
  /** 机构全部历史名称版本，按版本号升序 */
  listOrgUnitNameVersions(orgUnitId: string): Promise<OrgUnitNameVersionRow[]>;
  listPersonnelNameVersions(personnelId: string): Promise<PersonnelNameVersionRow[]>;
  /** 某机构（不含下级）全部未失效人员 */
  listActivePersonnelOfOrgUnit(orgUnitId: string): Promise<PersonnelRow[]>;
  findExportAuditById(id: string): Promise<ExportAuditRow | null>;

  // 写入（只增/只失效；无删除路径）
  insertOrgUnit(input: OrgUnitToCreate): Promise<void>;
  insertOrgUnitNameVersion(row: OrgUnitNameVersionRow): Promise<void>;
  /** 仅更新机构当前名（历史在版本行，版本行不可改） */
  updateOrgUnitCurrentName(orgUnitId: string, name: string): Promise<void>;
  deactivateOrgUnit(orgUnitId: string, deactivatedAt: Date): Promise<void>;
  insertPersonnel(input: PersonnelToCreate): Promise<void>;
  insertPersonnelNameVersion(row: PersonnelNameVersionRow): Promise<void>;
  updatePersonnelCurrentName(personnelId: string, name: string): Promise<void>;
  /** 调岗后同步人员当前归属机构（任职记录为权威史，此处为读模型冗余） */
  updatePersonnelOrgUnit(personnelId: string, orgUnitId: string): Promise<void>;
  deactivatePersonnel(personnelId: string, deactivatedAt: Date): Promise<void>;
  insertAssignment(row: PersonnelAssignmentRow): Promise<void>;
  /** 结束当前任职（调岗旧权限失效的数据层载体） */
  closeAssignment(assignmentId: string, endedAt: Date): Promise<void>;
  insertExportAudit(row: ExportAuditRow): Promise<void>;
}
