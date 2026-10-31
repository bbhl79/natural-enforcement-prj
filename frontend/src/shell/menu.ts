// 顶栏一级五总入口与侧栏二级（#207 导航锁、#209 执行票）。
// 一级键位固定：workbench｜clue｜case｜supervise｜admin；二级键位同样固定，文案可改、键位不改。
// 菜单可见性只是便利；真正的授权由服务端每次校验（#207「菜单可见性仍只是便利」）。
// 操作码原文只在这里和 data- 属性上，不进用户可见文本。

import { CLUE_VIEWS, withPreservedQuery } from './clueUrl';

/** 顶栏一级入口键位。键位稳定：文案可改，键位不改。 */
export type PrimaryKey = 'workbench' | 'clue' | 'case' | 'supervise' | 'admin';

export interface PrimaryEntry {
  id: PrimaryKey;
  label: string;
  /** 一级入口地址。 */
  path: string;
  /**
   * 会话清单含其中任一码即渲染该一级入口；空数组＝所有登录人员可见。
   * 「系统管理」一级无权限时不渲染，也不在页面上作说明。
   */
  anyOf: readonly string[];
}

export interface SecondaryEntry {
  id: string;
  /** 所属一级入口。 */
  primary: PrimaryKey;
  label: string;
  /** 站内地址（含查询串）。 */
  path: string;
  /** 会话清单含其中任一码即渲染该二级入口；缺省＝该一级下人人可见。 */
  anyOf?: readonly string[];
  /** 规划中占位：本期不进入真实业务，点了只在主区提示。 */
  planned?: boolean;
  /** 规划中占位的补充说明（进主区提示里）。 */
  hint?: string;
}

/**
 * 规划中占位模块。一级入口本身与它们下面的二级占位同表登记，
 * 路由表与侧栏都从这张表派生，避免两处各写一份而走样。
 */
export interface PlannedModule {
  id: string;
  /** 所属一级入口。 */
  primary: PrimaryKey;
  label: string;
  /** 站内地址。 */
  path: string;
  /** 主区提示的补充说明。 */
  hint: string;
  /** 是否进侧栏二级菜单。 */
  inMenu: boolean;
  /** 进侧栏时的操作码门槛；缺省＝人人可见。 */
  anyOf?: readonly string[];
}

/**
 * 机构维护的入口码。#105:178：`org.tree.read` 也给内勤（选承办机构用），
 * `org.unit.register` 等三码只给系统管理。凭 `org.tree.read` 判定会让内勤看到
 * 「系统管理」一级，与原型 P1 noadmin 相反，所以「机构」入口和维护视角都按
 * `org.unit.register` 判定。
 */
export const ORG_MAINTENANCE_OPCODE = 'org.unit.register';

/**
 * 「系统管理」一级的入口码：持有任一即可看到该一级入口。只收系统管理或监督才有的码，
 * 不收内勤也有的码。
 */
export const ADMIN_HOME_OPCODES = [
  ORG_MAINTENANCE_OPCODE,
  'personnel.profile.read',
  'personnel.locked.read',
  'audit.admin.read',
] as const;

/** 顶栏一级五总入口。四个业务一级人人可见；「系统管理」按操作码出现。 */
export const PRIMARY_ENTRIES: readonly PrimaryEntry[] = [
  { id: 'workbench', label: '统一工作台', path: '/workbench', anyOf: [] },
  { id: 'clue', label: '线索中心', path: '/clue', anyOf: [] },
  { id: 'case', label: '案件中心', path: '/case', anyOf: [] },
  { id: 'supervise', label: '统筹督导', path: '/supervise', anyOf: [] },
  { id: 'admin', label: '系统管理', path: '/admin', anyOf: ADMIN_HOME_OPCODES },
];

/**
 * 规划中占位模块登记表。侧栏二级与主区提示页都从这张表派生。
 * 占位各有独立地址，便于分享与截图；地址不另开一级。
 */
export const PLANNED_MODULES: readonly PlannedModule[] = [
  {
    id: 'case-onsite',
    primary: 'case',
    label: '现场核查与立案呈批',
    path: '/case/onsite-check',
    hint: '案件程序主干不在本期范围。',
    inMenu: true,
  },
  {
    id: 'case-trial',
    primary: 'case',
    label: '案件查办与审理',
    path: '/case/trial',
    hint: '案件程序主干不在本期范围。',
    inMenu: true,
  },
  {
    id: 'supervise-review',
    primary: 'supervise',
    label: '执法监督与卷宗评查',
    path: '/supervise/review',
    hint: '含卷宗评查，归属统筹督导，不进案件中心。',
    inMenu: true,
  },
  {
    id: 'admin-roles',
    primary: 'admin',
    label: '角色与权限',
    path: '/admin/roles',
    hint: '角色与操作码矩阵的绑定维护在后续业务范围开放。',
    inMenu: true,
    anyOf: [ORG_MAINTENANCE_OPCODE],
  },
  {
    id: 'admin-reference',
    primary: 'admin',
    label: '参照数据与配置类对象',
    path: '/admin/reference',
    hint: '参照数据与配置类对象的维护在后续业务范围开放。',
    inMenu: true,
    anyOf: [ORG_MAINTENANCE_OPCODE],
  },
];

/** 某一级下的规划中占位项（按登记表顺序）。 */
export function plannedModulesOf(primary: PrimaryKey): PlannedModule[] {
  return PLANNED_MODULES.filter((item) => item.primary === primary);
}

/** 某一级是否整体为规划中占位（该级下所有二级都是占位）。 */
export function primaryIsPlanned(primary: PrimaryKey): boolean {
  const items = SECONDARY_ENTRIES.filter((item) => item.primary === primary);
  return items.length > 0 && items.every((item) => item.planned);
}

/** 侧栏二级菜单。键位固定，顺序固定。统一工作台无侧栏，分区由主区页签承担。 */
export const SECONDARY_ENTRIES: readonly SecondaryEntry[] = [
  // 线索中心：四个视图与 /clue?view= 对应
  ...CLUE_VIEWS.map((view) => ({
    id: `clue-${view.id}`,
    primary: 'clue' as PrimaryKey,
    label: view.label,
    path: `/clue?view=${view.id}`,
  })),
  // 系统管理：既有管理台入口，各按自身操作码出现
  { id: 'admin-home', primary: 'admin', label: '管理台首页', path: '/admin', anyOf: ADMIN_HOME_OPCODES },
  { id: 'org', primary: 'admin', label: '机构', path: '/admin/org-units', anyOf: [ORG_MAINTENANCE_OPCODE] },
  { id: 'person', primary: 'admin', label: '人员', path: '/admin/personnel', anyOf: ['personnel.profile.read'] },
  { id: 'locked', primary: 'admin', label: '被锁人员', path: '/admin/locked-personnel', anyOf: ['personnel.locked.read'] },
  { id: 'audit', primary: 'admin', label: '管理台留痕', path: '/admin/audit', anyOf: ['audit.admin.read'] },
  // 规划中占位：按登记表派生，二级菜单与主区提示页同源
  ...PLANNED_MODULES.filter((item) => item.inMenu).map((item) => ({
    id: item.id,
    primary: item.primary,
    label: item.label,
    path: item.path,
    anyOf: item.anyOf,
    planned: true,
    hint: item.hint,
  })),
];

export function hasAny(opcodes: readonly string[], wanted: readonly string[]): boolean {
  return wanted.some((code) => opcodes.includes(code));
}

/** 按会话清单裁剪后的一级入口，保持定义顺序。 */
export function visiblePrimaries(opcodes: readonly string[]): PrimaryEntry[] {
  return PRIMARY_ENTRIES.filter((item) => item.anyOf.length === 0 || hasAny(opcodes, item.anyOf));
}

/** 按会话清单裁剪后的某一级下的二级入口，保持定义顺序。 */
export function visibleSecondaries(primary: PrimaryKey, opcodes: readonly string[]): SecondaryEntry[] {
  return SECONDARY_ENTRIES.filter(
    (item) => item.primary === primary && (!item.anyOf || hasAny(opcodes, item.anyOf)),
  );
}

/** 规划中占位模块按键位取回；不是规划中项时返回 null。 */
export function plannedModule(id: string): PlannedModule | null {
  return PLANNED_MODULES.find((item) => item.id === id) ?? null;
}

/** 规划中占位项按键位取回（只认进侧栏的二级占位）；不是规划中项时返回 null。 */
export function plannedSecondary(id: string): SecondaryEntry | null {
  const found = SECONDARY_ENTRIES.find((item) => item.id === id);
  return found && found.planned ? found : null;
}

/** 当前地址落在哪个一级入口上：按路径前缀取最长的一项。地址不属任何一级时返回 null。 */
export function activePrimaryKey(pathname: string): PrimaryKey | null {
  let best: PrimaryEntry | null = null;
  for (const item of PRIMARY_ENTRIES) {
    const hit = pathname === item.path || pathname.startsWith(`${item.path}/`);
    if (hit && (!best || item.path.length > best.path.length)) best = item;
  }
  return best?.id ?? null;
}

/** 参数缺省值：线索中心不带 view 时按「全部线索」算。 */
const PARAM_DEFAULT: Record<string, string> = { view: 'all' };

/**
 * 当前地址落在哪个二级入口上：地址前缀最长者优先；带参数的二级按参数值匹配。
 * 本人不可见的二级不高亮（无权限页不高亮任何导航项）。
 */
export function activeSecondaryKey(
  primary: PrimaryKey,
  pathname: string,
  search: string,
  opcodes: readonly string[] = [],
): string | null {
  const current = new URLSearchParams(search);
  let best: { id: string; pathLength: number; paramCount: number } | null = null;
  for (const item of visibleSecondaries(primary, opcodes)) {
    const [base, query] = item.path.split('?');
    const pathHit = pathname === base || pathname.startsWith(`${base}/`);
    if (!pathHit) continue;
    const params = new URLSearchParams(query ?? '');
    let paramsHit = true;
    for (const [key, value] of params) {
      const actual = current.get(key) ?? PARAM_DEFAULT[key] ?? '';
      if (actual !== value) {
        paramsHit = false;
        break;
      }
    }
    if (!paramsHit) continue;
    const candidate = { id: item.id, pathLength: base.length, paramCount: params.size };
    if (
      !best ||
      candidate.pathLength > best.pathLength ||
      (candidate.pathLength === best.pathLength && candidate.paramCount > best.paramCount)
    ) {
      best = candidate;
    }
  }
  return best?.id ?? null;
}

/** 一级入口的地址。 */
export function primaryPathOf(primary: PrimaryKey): string {
  return PRIMARY_ENTRIES.find((item) => item.id === primary)?.path ?? `/${primary}`;
}

/** 规划中占位模块按地址取回；不是规划中项时返回 null。 */
export function plannedModuleByPath(pathname: string): PlannedModule | null {
  return PLANNED_MODULES.find((item) => item.path === pathname) ?? null;
}

/**
 * 二级入口的实际地址：线索中心的视图切换保留关键词、筛选、日期与分页。
 */
export function secondaryHref(item: SecondaryEntry, search: string): string {
  return item.primary === 'clue' ? withPreservedQuery(item.path, search) : item.path;
}

/**
 * 综合查询的落点：提交后进入线索中心并带关键词。人人可用，不占一级。
 * 关键词为空时只进线索中心，不带查询串。
 */
export function globalSearchPath(keyword: string): string {
  const trimmed = keyword.trim();
  return trimmed ? `/clue?q=${encodeURIComponent(trimmed)}` : '/clue';
}
