// 用途：留痕查阅的只读接口与类别口径：筛选类别取值、动作与授权拒绝操作码到类别的归类、查阅条件与结果行的类型。
// 调用方：backend/server/src/audit-browse.service.ts（管理台留痕查阅与导出）；packages/audit/src/prisma-audit-trail.ts 的 PrismaAuditTrailReader 用类别口径预筛与精确筛。
// 边界：只读，不写库，不做授权。数据范围由调用方算好，经 orgUnitIds 与 includeUnanchored 传入。
// 依据：docs/adr/0011-认证留痕写入共用表.md、docs/adr/0013-人员导出写入共用留痕表.md。
// 管理台留痕的查阅（#126，#105「留痕查阅与导出」）：只读接口与类别口径。
// 有机构的行按所属机构（对象所属机构）套数据范围；没有机构的行视同根机构（项目负责人 7-8）。
// 所属机构：授权拒绝行取目标机构（target_org_unit_id，#105；ADR 0011 修正），其余行取 org_unit_id。
// 目标机构来源为空的旧拒绝行不补，仍按 org_unit_id 套。
// 数据库适配器在 prisma-audit-trail.ts。

/** 管理台留痕的筛选类别（原型 v0.4 P8，G33）。「全部操作」不是类别，筛选时不传。 */
export const AUDIT_CATEGORIES = [
  'auth-session',
  'personnel-view',
  'personnel-maintenance',
  'org-maintenance',
  'unlock-reset',
  'cert',
  'export',
] as const;
/** 筛选类别的取值类型，即 AUDIT_CATEGORIES 的成员。调用方：backend/server/src/audit-browse.service.ts 的筛选条件与行回显。 */
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** 按动作归类。包含以后各票会追加的动作词（#105 已定名），未入取值表前不会出现在库里。 */
const CATEGORY_OF_ACTION: Readonly<Record<string, AuditCategory>> = {
  'login.succeeded': 'auth-session',
  'login.failed': 'auth-session',
  'login.locked': 'auth-session',
  'login.locked-retry': 'auth-session',
  'login.deactivated': 'auth-session',
  'login.password-expired': 'auth-session',
  'login.password-change-required': 'auth-session',
  'login.source-limited': 'auth-session',
  'login.capacity-reached': 'auth-session',
  'session.ended': 'auth-session',
  'account.password-changed': 'auth-session',
  'personnel.viewed': 'personnel-view',
  'personnel.registered': 'personnel-maintenance',
  'personnel.renamed': 'personnel-maintenance',
  'personnel.mobile-changed': 'personnel-maintenance',
  'personnel.role-granted': 'personnel-maintenance',
  'personnel.role-revoked': 'personnel-maintenance',
  'personnel.transferred': 'personnel-maintenance',
  'personnel.deactivated': 'personnel-maintenance',
  'personnel.restored': 'personnel-maintenance',
  'personnel.sessions-ended': 'personnel-maintenance',
  'personnel.post-granted': 'personnel-maintenance',
  'personnel.post-revoked': 'personnel-maintenance',
  'bootstrap.root-registered': 'personnel-maintenance',
  'bootstrap.admin-registered': 'personnel-maintenance',
  'org.unit.registered': 'org-maintenance',
  'org.unit.renamed': 'org-maintenance',
  'org.unit.deactivated': 'org-maintenance',
  'account.unlocked': 'unlock-reset',
  'account.password-reset': 'unlock-reset',
  'account.password-rejected': 'unlock-reset',
  'cert.updated': 'cert',
  'personnel.exported': 'export',
  'audit.exported': 'export',
};

/**
 * 库里预筛用的条件：动作在 actions 里，或者是授权拒绝且操作码在 deniedOpcodes 里、或以 deniedOpcodePrefixes 之一开头。
 * 这是 auditCategoryOf 的超集（前缀会多带几个别类的码），取回后仍按 auditCategoryOf 精确筛一遍。
 */
export interface AuditCategoryPrefilter {
  readonly actions: readonly string[];
  readonly deniedOpcodes: readonly string[];
  readonly deniedOpcodePrefixes: readonly string[];
}

const DENIED_OPCODE_PREFILTER: Readonly<Record<AuditCategory, Pick<AuditCategoryPrefilter, 'deniedOpcodes' | 'deniedOpcodePrefixes'>>> = {
  'auth-session': { deniedOpcodes: [], deniedOpcodePrefixes: [] },
  'personnel-view': { deniedOpcodes: ['personnel.profile.read'], deniedOpcodePrefixes: [] },
  'personnel-maintenance': { deniedOpcodes: ['personnel.sessions.end'], deniedOpcodePrefixes: ['personnel.profile.'] },
  'org-maintenance': { deniedOpcodes: [], deniedOpcodePrefixes: ['org.'] },
  'unlock-reset': {
    deniedOpcodes: ['personnel.locked.read', 'personnel.locked.release', 'personnel.password.reset'],
    deniedOpcodePrefixes: [],
  },
  cert: { deniedOpcodes: ['personnel.cert.update'], deniedOpcodePrefixes: [] },
  export: { deniedOpcodes: ['personnel.profile.export', 'audit.admin.export'], deniedOpcodePrefixes: [] },
};

/**
 * 按类别给出库里预筛的条件：动作清单、被拒操作码清单与被拒操作码前缀清单。结果是 auditCategoryOf 的超集。
 * 调用方：packages/audit/src/prisma-audit-trail.ts 的 PrismaAuditTrailReader 组装查询条件。
 */
export function auditCategoryPrefilter(category: AuditCategory): AuditCategoryPrefilter {
  return {
    actions: Object.keys(CATEGORY_OF_ACTION).filter((action) => CATEGORY_OF_ACTION[action] === category),
    ...DENIED_OPCODE_PREFILTER[category],
  };
}

/** 授权拒绝按被拒的操作码归类。归不进任何类别的（如业务区的码），只在「全部操作」里出现。 */
function categoryOfDeniedOpcode(opcode: string | null): AuditCategory | null {
  if (!opcode) return null;
  if (opcode === 'personnel.locked.read' || opcode === 'personnel.locked.release' || opcode === 'personnel.password.reset') {
    return 'unlock-reset';
  }
  if (opcode === 'personnel.profile.export' || opcode === 'audit.admin.export') return 'export';
  if (opcode === 'personnel.profile.read') return 'personnel-view';
  if (opcode === 'personnel.cert.update') return 'cert';
  if (opcode.startsWith('personnel.profile.') || opcode === 'personnel.sessions.end') return 'personnel-maintenance';
  if (opcode.startsWith('org.')) return 'org-maintenance';
  return null;
}

/** 一行留痕属于哪个类别；不属于任何类别时为 null。 */
export function auditCategoryOf(action: string, opcode: string | null): AuditCategory | null {
  if (action === 'authz.denied') return categoryOfDeniedOpcode(opcode);
  return CATEGORY_OF_ACTION[action] ?? null;
}

/**
 * 类型守卫：判断外部传入的值是否为 AUDIT_CATEGORIES 之一。
 * 调用方：backend/server/src/audit-browse.service.ts 解析筛选条件，类别不在取值内时该函数判筛选条件无效。
 */
export function isAuditCategory(value: unknown): value is AuditCategory {
  return typeof value === 'string' && (AUDIT_CATEGORIES as readonly string[]).includes(value);
}

/** 查阅条件。时间为左闭右开。 */
export interface AuditTrailQuery {
  readonly from: Date;
  readonly to: Date;
  /** 数据范围内的机构（含下级）。 */
  readonly orgUnitIds: readonly string[];
  /** 是否带上没有所属机构的行：只有范围根是根机构时为真。 */
  readonly includeUnanchored: boolean;
  readonly category?: AuditCategory | null;
  /** 操作人工号，精确匹配。 */
  readonly actorCode?: string | null;
  readonly outcome?: 'succeeded' | 'failed' | null;
}

/** 查阅返回的一行。不含来源地址和前值：页面与导出都不展示，也就不交出。 */
export interface AuditTrailRecord {
  readonly id: string;
  readonly createdAt: Date;
  readonly action: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly actorCode: string | null;
  readonly subjectCode: string | null;
  /** 操作者或被作用人员当时的任职机构（写入快照）。 */
  readonly orgUnitId: string | null;
  readonly orgUnitName: string | null;
  /** 所属机构：查阅范围按它套。授权拒绝行是目标机构，其余行同 orgUnitId（ADR 0011 修正）。 */
  readonly anchorOrgUnitId: string | null;
  /** 授权拒绝行的目标机构来源：object、actor-fallback；其余行和旧拒绝行为空。 */
  readonly targetOrgUnitBasis: string | null;
  readonly opcode: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly itemCount: number | null;
}

/** 只读。按时间倒序（同一时刻按主键倒序）。 */
export interface AuditTrailReader {
  list(query: AuditTrailQuery): Promise<AuditTrailRecord[]>;
  /** 只数条数（管理台首页「今日 N 条」）：不取行，不按类别筛。 */
  count(query: Omit<AuditTrailQuery, 'category'>): Promise<number>;
}
