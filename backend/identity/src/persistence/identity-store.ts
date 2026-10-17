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
  passwordHash: string | null;
  enforcementCertNo: string | null;
  enforcementCertExpiresOn: Date | null;
  deactivatedAt: Date | null;
}

/**
 * 一次调岗的三笔写入，必须在同一事务里完成：
 * 先关止旧任职，再插入新的当前任职，再更新人员当前归属。
 * 关止在前，才能满足「每人最多一条 endedAt 为空」的部分唯一约束。
 */
export interface AssignmentTransfer {
  closedAssignmentId: string;
  endedAt: Date;
  personnelId: string;
  toOrgUnitId: string;
  next: PersonnelAssignmentRow;
}

/** 任职记录（当前 assignment = endedAt 为 null 的那条；库层保证至多一条） */
export interface PersonnelAssignmentRow {
  id: string;
  personnelId: string;
  orgUnitId: string;
  startedAt: Date;
  endedAt: Date | null;
}

/**
 * 导出留痕行（写入后不可变：库层触发器拒 UPDATE/DELETE，见迁移 0002_identity_org）。
 * 冻结（ADR 0013，#125）：不再写入，端口没有写入方法；已有行只读可查。人员导出改写共用留痕表。
 */
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
  passwordHash: string | null;
  /** 登录标识。有值时全库唯一。不传即为空。 */
  mobilePhone?: string | null;
}

/** 人员—角色新行。授予 = 插入新行；摘除 = 给旧行置失效时间。 */
export interface PersonnelRoleToCreate {
  id: string;
  personnelId: string;
  roleId: string;
}

/** 业务唯一冲突的种类：工号、手机号、重复授予同一角色。 */
export type IdentityUniqueConflict = 'personnel-code' | 'mobile-phone' | 'personnel-role';

/**
 * 受业务唯一约束的写入结果（#119）。
 * 冲突不抛异常，统一映射为「已存在」。接口层据此返回 409 already-exists 或按幂等处理。
 * 在交互式事务里发生冲突时，只撤销这一笔写入，事务仍可继续使用。
 */
export type UniqueWriteResult =
  | { result: 'written' }
  | { result: 'already-exists'; conflict: IdentityUniqueConflict };

/**
 * 绑定到一个交互式事务的身份存储。
 * client 是事务客户端，交给留痕工厂（AUDIT_TRAIL_FACTORY）取同一事务里的留痕写入接口。
 */
export interface IdentityTransaction {
  store: IdentityStore;
  client: unknown;
}

export interface IdentityStore {
  /**
   * 在一个交互式事务里执行 work（#119）。work 抛错则整体回滚。
   * 本存储已绑定事务时不另开事务，直接在当前事务里执行。
   */
  inTransaction<T>(work: (tx: IdentityTransaction) => Promise<T>): Promise<T>;

  // 查询
  findPersonnelById(id: string): Promise<PersonnelRow | null>;
  findOrgUnitById(id: string): Promise<OrgUnitRow | null>;
  /** 当前生效的任职记录（endedAt = null）；无则 null */
  findCurrentAssignment(personnelId: string): Promise<PersonnelAssignmentRow | null>;
  /** 目标机构的祖先链（含自身），自根向叶排列；用于数据范围判定 */
  findOrgUnitPathToRoot(orgUnitId: string): Promise<string[]>;
  /** 某机构及其全部下级机构的 id，含自身 */
  listOrgUnitSubtreeIds(orgUnitId: string): Promise<string[]>;
  /** 人员当前未失效的角色名 */
  listActiveRoleNames(personnelId: string): Promise<string[]>;
  /** 人员当前仍能放行该操作码的角色名。只含未失效的人员—角色、角色、允许行和权限。 */
  listGrantingRoleNames(personnelId: string, opcode: string): Promise<string[]>;
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
  /** 工号或手机号已被占用时返回 already-exists（personnel-code / mobile-phone）。 */
  insertPersonnel(input: PersonnelToCreate): Promise<UniqueWriteResult>;
  /** 手机号已被他人占用时返回 already-exists（mobile-phone）。 */
  updatePersonnelMobilePhone(personnelId: string, mobilePhone: string | null): Promise<UniqueWriteResult>;
  /** 同一人员已持有该角色的未失效行时返回 already-exists（personnel-role）。 */
  insertPersonnelRole(row: PersonnelRoleToCreate): Promise<UniqueWriteResult>;
  insertPersonnelNameVersion(row: PersonnelNameVersionRow): Promise<void>;
  updatePersonnelCurrentName(personnelId: string, name: string): Promise<void>;
  /** 调岗后同步人员当前归属机构（任职记录为权威史，此处为读模型冗余） */
  updatePersonnelOrgUnit(personnelId: string, orgUnitId: string): Promise<void>;
  deactivatePersonnel(personnelId: string, deactivatedAt: Date): Promise<void>;
  /**
   * 只更换口令散列，不改上次改密时间。
   * 仅当库中散列仍等于 expectedHash 时写入；返回是否命中。
   * 并发重设或改密已换掉散列时不命中，旧口令不会因重散列复活。
   */
  replacePasswordHash(personnelId: string, expectedHash: string, passwordHash: string): Promise<boolean>;
  /** 写入新口令散列，并记下这次改密时间。 */
  changePassword(personnelId: string, passwordHash: string, passwordChangedAt: Date): Promise<void>;
  insertAssignment(row: PersonnelAssignmentRow): Promise<void>;
  /** 结束当前任职（调岗旧权限失效的数据层载体） */
  closeAssignment(assignmentId: string, endedAt: Date): Promise<void>;
  /** 调岗三笔写入的唯一入口；实现必须放在同一数据库事务中（已绑定事务时用当前事务） */
  transferAssignment(transfer: AssignmentTransfer): Promise<void>;
}
