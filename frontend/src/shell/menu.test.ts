import { describe, expect, it } from 'vitest';

import { activeMenuId, ADMIN_HOME_OPCODES, MENU, visibleMenu, visibleSections } from './menu';

const ids = (opcodes: string[]) => visibleMenu(opcodes).map((item) => item.id);

describe('按操作码裁剪菜单（#105「菜单来源」）', () => {
  it('没有任何码时菜单为空', () => {
    expect(ids([])).toEqual([]);
    expect(visibleSections([])).toEqual([]);
  });

  it('只有业务码：只出业务办理区', () => {
    expect(ids(['clue.read', 'case.read', 'case.open'])).toEqual(['home', 'clue', 'case']);
    expect(visibleSections(['clue.read'])).toEqual(['业务办理']);
  });

  it('只有被锁人员码：出管理台首页和被锁人员', () => {
    expect(ids(['personnel.locked.read', 'personnel.locked.release'])).toEqual(['admin', 'locked']);
  });

  it('监督只读留痕：管理台首页和留痕', () => {
    expect(ids(['audit.admin.read', 'audit.admin.export'])).toEqual(['admin', 'audit']);
  });

  it('兼任多角色时是并集，顺序按菜单定义', () => {
    const union = ids(['audit.admin.read', 'clue.read', 'personnel.locked.read', 'org.unit.register', 'personnel.profile.read']);
    expect(union).toEqual(['home', 'clue', 'admin', 'org', 'person', 'locked', 'audit']);
    expect(visibleSections(['audit.admin.read', 'clue.read'])).toEqual(['业务办理', '管理台']);
  });

  it('内勤反例：持有 org.tree.read 也没有「管理台」一区（#105:178）', () => {
    const clerk = ['clue.read', 'case.read', 'org.tree.read'];
    expect(ids(clerk)).toEqual(['home', 'clue', 'case']);
    expect(visibleSections(clerk)).toEqual(['业务办理']);
  });

  it('「机构」菜单和管理台入口按只给系统管理的 org.unit.register 判定，不认 org.tree.read', () => {
    expect(MENU.find((item) => item.id === 'org')?.anyOf).toEqual(['org.unit.register']);
    expect(ADMIN_HOME_OPCODES).toContain('org.unit.register');
    for (const item of MENU) expect(item.anyOf).not.toContain('org.tree.read');
    expect(ids(['org.unit.register'])).toEqual(['admin', 'org']);
  });

  it('不认识的码不影响菜单', () => {
    expect(ids(['no.such.code'])).toEqual([]);
  });

  it('当前菜单项按最长路径前缀判定', () => {
    expect(activeMenuId('/', MENU)).toBe('home');
    expect(activeMenuId('/admin', MENU)).toBe('admin');
    expect(activeMenuId('/admin/audit', MENU)).toBe('audit');
    expect(activeMenuId('/admin/locked-personnel/abc', MENU)).toBe('locked');
    expect(activeMenuId('/admins', MENU)).toBeNull();
    expect(activeMenuId('/admin/audit', visibleMenu(['personnel.locked.read']))).toBe('admin');
  });

  it('菜单文字里不出现操作码原文', () => {
    for (const item of MENU) expect(item.label).not.toMatch(/[a-z]+\.[a-z]+/);
  });
});
