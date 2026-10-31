import { describe, expect, it } from 'vitest';

import {
  activePrimaryKey,
  activeSecondaryKey,
  ADMIN_HOME_OPCODES,
  globalSearchPath,
  ORG_MAINTENANCE_OPCODE,
  plannedModuleByPath,
  plannedModulesOf,
  plannedSecondary,
  primaryIsPlanned,
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

const primaryIds = (opcodes: string[]): PrimaryKey[] => visiblePrimaries(opcodes).map((item) => item.id);
const secondaryIds = (primary: PrimaryKey, opcodes: string[]) =>
  visibleSecondaries(primary, opcodes).map((item) => item.id);

describe('顶栏一级五总入口（#207 导航锁）', () => {
  it('五个一级入口齐全，键位与顺序固定', () => {
    expect(PRIMARY_ENTRIES.map((item) => item.id)).toEqual([
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
    expect(primaryIds([])).toEqual(['workbench', 'clue', 'case', 'supervise']);
    expect(primaryIds(CLERK)).toEqual(['workbench', 'clue', 'case', 'supervise']);
  });

  it('系统管理一级仅在会话有相应操作码时出现', () => {
    expect(primaryIds(CLERK)).not.toContain('admin');
    expect(primaryIds(['org.tree.read'])).not.toContain('admin');
    expect(primaryIds(ADMIN)).toContain('admin');
    expect(primaryIds(SUPERVISE)).toContain('admin');
  });

  it('系统管理入口按管理类操作码判定，不认只给内勤的 org.tree.read', () => {
    expect(ADMIN_HOME_OPCODES).toContain(ORG_MAINTENANCE_OPCODE);
    for (const code of ADMIN_HOME_OPCODES) expect(code).not.toBe('org.tree.read');
  });
});

describe('侧栏二级随一级切换（#207 导航锁）', () => {
  it('统一工作台无侧栏二级：主区承担统一待办清单与录入线索', () => {
    expect(secondaryIds('workbench', CLERK)).toEqual([]);
    expect(visibleSecondaries('workbench', CLERK)).toEqual([]);
  });

  it('线索中心二级是四个视图，地址带视图参数', () => {
    expect(secondaryIds('clue', CLERK)).toEqual(['clue-all', 'clue-assign', 'clue-held', 'clue-remind']);
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
    expect(secondaryIds('admin', ADMIN)).toEqual([
      'admin-home',
      'org',
      'person',
      'locked',
      'audit',
      'admin-roles',
      'admin-reference',
    ]);
    expect(secondaryIds('admin', SUPERVISE)).toEqual(['admin-home', 'audit']);
    expect(secondaryIds('admin', CLERK)).toEqual([]);
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
    const primaryIdsAll = PRIMARY_ENTRIES.map((item) => item.id);
    for (const item of SECONDARY_ENTRIES) expect(primaryIdsAll).not.toContain(item.id);
  });
});

describe('当前所在一级与二级', () => {
  it('按地址前缀判定当前一级，最长前缀优先', () => {
    expect(activePrimaryKey('/workbench')).toBe('workbench');
    expect(activePrimaryKey('/clue')).toBe('clue');
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

  it('工作台不再有侧栏二级命中项', () => {
    expect(activeSecondaryKey('workbench', '/workbench', '')).toBeNull();
    expect(activeSecondaryKey('workbench', '/workbench', '?step=1')).toBeNull();
    expect(activeSecondaryKey('workbench', '/workbench/register', '?step=1')).toBeNull();
    expect(activeSecondaryKey('workbench', '/workbench', '?step=3')).toBeNull();
  });

  it('管理台二级按最长地址前缀命中', () => {
    expect(activeSecondaryKey('admin', '/admin', '', ADMIN)).toBe('admin-home');
    expect(activeSecondaryKey('admin', '/admin/org-units', '', ADMIN)).toBe('org');
    expect(activeSecondaryKey('admin', '/admin/personnel/new', '', ADMIN)).toBe('person');
    expect(activeSecondaryKey('admin', '/admin/personnel/abc', '', ADMIN)).toBe('person');
    expect(activeSecondaryKey('admin', '/admin/locked-personnel', '', ADMIN)).toBe('locked');
    expect(activeSecondaryKey('admin', '/admin/audit', '', ADMIN)).toBe('audit');
  });

  it('本人不可见的二级不高亮', () => {
    expect(activeSecondaryKey('admin', '/admin/audit', '', ['clue.read'])).toBeNull();
    expect(activeSecondaryKey('admin', '/admin', '', ['clue.read'])).toBeNull();
  });
});

describe('综合查询（顶栏全局搜，人人可用，不占一级）', () => {
  it('提交后进入线索中心并带关键词', () => {
    expect(globalSearchPath('红线')).toBe('/clue?q=%E7%BA%A2%E7%BA%BF');
  });

  it('关键词为空时只进线索中心，不带查询串', () => {
    expect(globalSearchPath('')).toBe('/clue');
    expect(globalSearchPath('   ')).toBe('/clue');
  });

  it('综合查询不占一级入口', () => {
    expect(PRIMARY_ENTRIES.map((item) => item.id)).not.toContain('search');
  });
});

describe('规划中占位（案件中心、统筹督导、系统管理）', () => {
  it('规划中的二级按键位取回，附带说明', () => {
    expect(plannedSecondary('case-onsite')?.label).toBe('现场核查与立案呈批');
    expect(plannedSecondary('case-trial')?.planned).toBe(true);
    expect(plannedSecondary('supervise-review')?.planned).toBe(true);
    expect(plannedSecondary('admin-roles')?.planned).toBe(true);
  });

  it('不是规划中项时取不到', () => {
    expect(plannedSecondary('admin-home')).toBeNull();
    expect(plannedSecondary('org')).toBeNull();
    expect(plannedSecondary('nope')).toBeNull();
  });

  it('一级入口本身也可给出规划中说明', () => {
    expect(plannedModulesOf('case').map((item) => item.label)).toEqual([
      '现场核查与立案呈批',
      '案件查办与审理',
    ]);
    expect(plannedModulesOf('supervise').map((item) => item.label)).toEqual(['执法监督与卷宗评查']);
    expect(plannedModulesOf('workbench')).toEqual([]);
    expect(plannedModulesOf('clue')).toEqual([]);
  });

  it('案件中心与统筹督导整级都是规划中占位', () => {
    expect(primaryIsPlanned('case')).toBe(true);
    expect(primaryIsPlanned('supervise')).toBe(true);
    expect(primaryIsPlanned('workbench')).toBe(false);
    expect(primaryIsPlanned('clue')).toBe(false);
  });

  it('规划中占位按地址取回', () => {
    expect(plannedModuleByPath('/case/onsite-check')?.label).toBe('现场核查与立案呈批');
    expect(plannedModuleByPath('/supervise/review')?.label).toBe('执法监督与卷宗评查');
    expect(plannedModuleByPath('/workbench')).toBeNull();
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
