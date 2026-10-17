// 管理台留痕的查阅（#126，#105「留痕查阅与导出」）：只读接口与类别口径。
// 有机构的行按所属机构（对象所属机构）套数据范围；没有机构的行视同根机构（Lei Hu 7-8）。
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
  'personnel.cert.updated': 'cert',
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
  readonly orgUnitId: string | null;
  readonly orgUnitName: string | null;
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
