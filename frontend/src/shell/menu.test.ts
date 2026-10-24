import { describe, expect, it } from 'vitest';

import {
  activePrimaryKey,
  activeSecondaryKey,
  ADMIN_HOME_OPCODES,
  ORG_MAINTENANCE_OPCODE,
  PRIMARY_ENTRIES,
  SECONDARY_ENTRIES,
  visiblePrimaries,
  visibleSecondaries,
  type PrimaryKey,
} from './menu';

/** 业务身份：内勤（选承办机构用的 org.tree.read，不是进系统管理的码）。 */
const CLERK = ['clue.read', 'case.read', 'org.tree.read'];
/** 系统管理：机构、人员、被锁人员、留痕四类码都有。 */
const ADMIN = [
  'org.tree.read',
  'org.unit.register',
  'personnel.profile.read',
  'personnel.locked.read',
  'audit.admin.read',
];
/** 监督：只读留痕。 */
const SUPERVISE = ['clue.read', 'case.read', 'audit.admin.read'];

const primaryKeys = (opcodes: string[]): PrimaryKey[] => visiblePrimaries(opcodes).map((item) => item.key);
const secondaryKeys = (primary: PrimaryKey, opcodes: string[]) =>
  visibleSecondaries(primary, opcodes).map((item) => item.key);

describe('顶栏一级五总入口（#207 导航锁）', () => {
  it('五个一级入口齐全，键位与顺序固定', () => {
    expect(PRIMARY_ENTRIES.map((item) => item.key)).toEqual([
      'workbench',
      'clue',
      'case',
      'supervise',
      'admin',
    ]);
    expect(PRIMARY_ENTRIES.map((item) => item.label)).toEqual([
      '统一工作台',
      '线索中心',
      '案件中心',
      '统筹督导',
      '系统管理',
    ]);
  });

  it('一级入口的地址按契约定型', () => {
    expect(PRIMARY_ENTRIES.map((item) => item.path)).toEqual([
      '/workbench',
      '/clue',
      '/case',
      '/supervise',
      '/admin',
    ]);
  });

  it('除系统管理外，四个一级入口所有登录人员可见', () => {
    expect(primaryKeys([])).toEqual(['workbench', 'clue', 'case', 'supervise']);
    expect(primaryKeys(CLERK)).toEqual(['workbench', 'clue', 'case', 'supervise']);
  });

  it('系统管理一级仅在会话有相应操作码时出现', () => {
    expect(primaryKeys(CLERK)).not.toContain('admin');
    expect(primaryKeys(['org.tree.read'])).not.toContain('admin');
    expect(primaryKeys(ADMIN)).toContain('admin');
    expect(primaryKeys(SUPERVISE)).toContain('admin');
  });

  it('系统管理入口按管理类操作码判定，不认只给内勤的 org.tree.read', () => {
    expect(ADMIN_HOME_OPCODES).toContain(ORG_MAINTENANCE_OPCODE);
    for (const code of ADMIN_HOME_OPCODES) expect(code).not.toBe('org.tree.read');
  });
});

describe('侧栏二级随一级切换（#207 导航锁）', () => {
  it('线索中心二级是四个视图，地址带视图参数', () => {
    expect(secondaryKeys('clue', CLERK)).toEqual(['clue-all', 'clue-assign', 'clue-held', 'clue-remind']);
    const paths = visibleSecondaries('clue', CLERK).map((item) => item.path);
    expect(paths).toEqual([
      '/clue?view=all',
      '/clue?view=assign',
      '/clue?view=held',
      '/clue?view=remind',
    ]);
  });

  it('案件中心二级是现场核查与立案呈批、案件查办与审理，均标记规划中', () => {
    const items = visibleSecondaries('case', CLERK);
    expect(items.map((item) => item.label)).toEqual(['现场核查与立案呈批', '案件查办与审理']);
    expect(items.every((item) => item.planned)).toBe(true);
  });

  it('统筹督导二级是执法监督与卷宗评查，标记规划中', () => {
    const items = visibleSecondaries('supervise', CLERK);
    expect(items.map((item) => item.label)).toEqual(['执法监督与卷宗评查']);
    expect(items.every((item) => item.planned)).toBe(true);
  });

  it('系统管理二级承载既有管理台入口，各按自身操作码出现', () => {
    expect(secondaryKeys('admin', ADMIN)).toEqual([
      'admin-home',
      'org',
      'person',
      'locked',
      'audit',
      'admin-config',
    ]);
    expect(secondaryKeys('admin', SUPERVISE)).toEqual(['admin-home', 'audit']);
    expect(secondaryKeys('admin', CLERK)).toEqual([]);
  });

  it('既有管理台子页地址保持可达', () => {
    const paths = visibleSecondaries('admin', ADMIN).map((item) => item.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/admin',
        '/admin/org-units',
        '/admin/personnel',
        '/admin/locked-personnel',
        '/admin/audit',
      ]),
    );
  });

  it('一级与二级不出现同一键位', () => {
    const primaryKeysAll = PRIMARY_ENTRIES.map((item) => item.key);
    for (const item of SECONDARY_ENTRIES) expect(primaryKeysAll).not.toContain(item.key);
  });
});

describe('当前所在一级与二级', () => {
  it('按地址前缀判定当前一级，最长前缀优先', () => {
    expect(activePrimaryKey('/workbench')).toBe('workbench');
    expect(activePrimaryKey('/clue')).toBe('clue');
    expect(activePrimaryKey('/clue?view=held')).toBe('clue');
    expect(activePrimaryKey('/case')).toBe('case');
    expect(activePrimaryKey('/case/onsite-check')).toBe('case');
    expect(activePrimaryKey('/supervise/review')).toBe('supervise');
    expect(activePrimaryKey('/admin')).toBe('admin');
    expect(activePrimaryKey('/admin/personnel/abc')).toBe('admin');
    expect(activePrimaryKey('/no/such/page')).toBeNull();
  });

  it('二级按地址与视图参数判定命中项', () => {
    expect(activeSecondaryKey('clue', '/clue', '')).toBe('clue-all');
    expect(activeSecondaryKey('clue', '/clue', '?view=assign')).toBe('clue-assign');
    expect(activeSecondaryKey('clue', '/clue', '?view=held')).toBe('clue-held');
    expect(activeSecondaryKey('clue', '/clue', '?view=remind&q=abc')).toBe('clue-remind');
  });

  it('管理台二级按最长地址前缀命中', () => {
    expect(activeSecondaryKey('admin', '/admin', '')).toBe('admin-home');
    expect(activeSecondaryKey('admin', '/admin/org-units', '')).toBe('org');
    expect(activeSecondaryKey('admin', '/admin/personnel/new', '')).toBe('person');
    expect(activeSecondaryKey('admin', '/admin/personnel/abc', '')).toBe('person');
    expect(activeSecondaryKey('admin', '/admin/locked-personnel', '')).toBe('locked');
    expect(activeSecondaryKey('admin', '/admin/audit', '')).toBe('audit');
  });

  it('本人不可见的二级不高亮', () => {
    expect(activeSecondaryKey('admin', '/admin/audit', '', ['clue.read'])).toBeNull();
    expect(activeSecondaryKey('admin', '/admin', '', ['clue.read'])).toBeNull();
  });
});

describe('界面文案纪律（#207 交互锁）', () => {
  const labels = [
    ...PRIMARY_ENTRIES.map((item) => item.label),
    ...SECONDARY_ENTRIES.map((item) => item.label),
  ];

  it('文案不出现票号样式', () => {
    for (const label of labels) expect(label).not.toMatch(/#\d+/);
  });

  it('文案不出现区块字母符号', () => {
    for (const label of labels) expect(label).not.toMatch(/区块\s*[A-E]/);
  });

  it('文案不出现「捞回」', () => {
    for (const label of labels) expect(label).not.toContain('捞回');
  });

  it('文案不出现操作码原文', () => {
    for (const label of labels) expect(label).not.toMatch(/[a-z]+\.[a-z]+/);
  });
});
