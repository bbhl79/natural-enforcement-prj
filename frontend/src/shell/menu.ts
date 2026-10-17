// 菜单项 → 所需操作码（#105「菜单来源」）。前端写死，不建表。
// 菜单可见只是方便；真正的授权由服务端每次校验（故事 16）。
// 操作码原文只在这里和 data- 属性上，不进用户可见文本。

export type MenuSection = '业务办理' | '管理台';

export interface MenuItem {
  id: string;
  label: string;
  path: string;
  section: MenuSection;
  /** 会话清单含其中任一码即显示 */
  anyOf: readonly string[];
}

/**
 * 机构维护的入口码。#105:178：`org.tree.read` 也给内勤（选承办机构用），
 * `org.unit.register` 等三码只给系统管理。凭 `org.tree.read` 判定会让内勤看到「管理台」一区，
 * 与原型 P1 noadmin 相反，所以「机构」菜单、管理台入口和维护视角都按 `org.unit.register` 判定。
 * 该码由 #123 入名册；入册前「机构」菜单对所有人都不显示。
 */
export const ORG_MAINTENANCE_OPCODE = 'org.unit.register';

/** 管理台首页的入口码：持有任一即可进入管理台区。只收系统管理或监督才有的码，不收内勤也有的码。 */
export const ADMIN_HOME_OPCODES = [
  ORG_MAINTENANCE_OPCODE,
  'personnel.profile.read',
  'personnel.locked.read',
  'audit.admin.read',
] as const;

/** 业务区工作台的入口码（原型 P1：业务读码任一）。 */
export const BUSINESS_OPCODES = ['clue.read', 'case.read'] as const;

export const MENU: readonly MenuItem[] = [
  { id: 'home', label: '工作台', path: '/', section: '业务办理', anyOf: BUSINESS_OPCODES },
  { id: 'clue', label: '线索', path: '/clues', section: '业务办理', anyOf: ['clue.read'] },
  { id: 'case', label: '案件', path: '/cases', section: '业务办理', anyOf: ['case.read'] },
  { id: 'admin', label: '管理台首页', path: '/admin', section: '管理台', anyOf: ADMIN_HOME_OPCODES },
  { id: 'org', label: '机构', path: '/admin/org-units', section: '管理台', anyOf: [ORG_MAINTENANCE_OPCODE] },
  { id: 'person', label: '人员', path: '/admin/personnel', section: '管理台', anyOf: ['personnel.profile.read'] },
  { id: 'locked', label: '被锁人员', path: '/admin/locked-personnel', section: '管理台', anyOf: ['personnel.locked.read'] },
  { id: 'audit', label: '管理台留痕', path: '/admin/audit', section: '管理台', anyOf: ['audit.admin.read'] },
];

export function hasAny(opcodes: readonly string[], wanted: readonly string[]): boolean {
  return wanted.some((code) => opcodes.includes(code));
}

/** 按会话清单裁剪后的菜单，保持定义顺序。兼任多角色时自然是并集。 */
export function visibleMenu(opcodes: readonly string[]): MenuItem[] {
  return MENU.filter((item) => hasAny(opcodes, item.anyOf));
}

export function visibleSections(opcodes: readonly string[]): MenuSection[] {
  const sections: MenuSection[] = [];
  for (const item of visibleMenu(opcodes)) {
    if (!sections.includes(item.section)) sections.push(item.section);
  }
  return sections;
}

/**
 * 当前地址落在哪个菜单项上：先在全部菜单里取路径前缀最长的一项，即当前页自己的菜单项；
 * 这一项对本人可见才高亮，不可见（无权限页）时不高亮任何项。
 * 原型 `assets/shell.js:48` 只在菜单项就是当前页时高亮，P2-forbidden、P4-denied、P7-denied 都不高亮。
 */
export function activeMenuId(pathname: string, items: readonly MenuItem[]): string | null {
  let best: MenuItem | null = null;
  for (const item of MENU) {
    const hit = item.path === '/'
      ? pathname === '/'
      : pathname === item.path || pathname.startsWith(`${item.path}/`);
    if (hit && (!best || item.path.length > best.path.length)) best = item;
  }
  const id = best?.id ?? null;
  return id !== null && items.some((item) => item.id === id) ? id : null;
}
