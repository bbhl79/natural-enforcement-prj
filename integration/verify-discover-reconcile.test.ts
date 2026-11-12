// seam⑤（spec #322 Q16）：静态能力枚举 + 四环对账纯函数。
// 夹具控制器/路由/菜单 → 能力清单；三类错位注入 → 断言各自动作。
// 纯函数用例不连库；真实源码一致性用例由测试自身读盘后把文本交给纯函数。
// 入口 ./dev test integration 仍会重建 it_template。
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  controllerClassName,
  enumerateApiRoutes,
  enumerateClueViews,
  enumerateFeatureMap,
  enumerateMenu,
  enumerateUiRoutes,
  registeredControllerClasses,
  type ApiRoute,
  type FeatureMapNode,
  type MenuCapabilities,
  type MenuEntry,
  type UiRoute,
} from '../e2e/verify/harness/discover/enumerate-capabilities.ts';
import {
  ACTION_ENDPOINTS,
  reconcileCapabilities,
  type ReconcileInput,
  type ScenarioUsage,
  type StandardRegister,
} from '../e2e/verify/harness/discover/reconcile.ts';
import { loadDiscoverSources } from '../e2e/verify/harness/discover-sources.ts';

const CONTROLLER_X = [
  '// 夹具控制器甲',
  "import { Controller, Get, Post } from '@nestjs/common';",
  '',
  "@Controller('api/x')",
  'export class XController {',
  "  @Get('a')",
  '  readA() {}',
  '',
  "  @Post('b/:id')",
  '  createB() {}',
  '}',
].join('\n');

const CONTROLLER_Y = [
  '@Controller()',
  'export class YController {',
  "  @Post('api/y')",
  '  createY() {}',
  '',
  "  @Get('api/y/:id')",
  '  readY() {}',
  '}',
].join('\n');

const APP_MODULE_FIXTURE = [
  "import { Module } from '@nestjs/common';",
  '',
  '@Module({',
  '  controllers: [',
  '    XController,',
  '    YController,',
  '  ],',
  '})',
  'export class AppModule {}',
].join('\n');

// spec #322 Q16 seam⑤：从控制器装饰器枚举 API 能力清单。
describe('enumerateApiRoutes（seam⑤：控制器装饰器 → API 能力清单）', () => {
  it('只认 app.module.ts controllers 数组登记的控制器类；未登记类不计能力', () => {
    expect([...registeredControllerClasses(APP_MODULE_FIXTURE)].sort()).toEqual([
      'XController',
      'YController',
    ]);
    expect(controllerClassName(CONTROLLER_X)).toBe('XController');
    expect(controllerClassName(CONTROLLER_Y)).toBe('YController');
  });

  it('拼接类前缀与方法路径，空 @Controller() 用方法装饰器里的完整路径，带文件/类名/行号', () => {
    const routes = enumerateApiRoutes([
      { file: 'x.controller.ts', text: CONTROLLER_X },
      { file: 'y.controller.ts', text: CONTROLLER_Y },
    ]);

    expect(routes).toEqual([
      {
        file: 'x.controller.ts',
        className: 'XController',
        controllerPath: 'api/x',
        method: 'GET',
        path: '/api/x/a',
        line: 6,
      },
      {
        file: 'x.controller.ts',
        className: 'XController',
        controllerPath: 'api/x',
        method: 'POST',
        path: '/api/x/b/:id',
        line: 9,
      },
      {
        file: 'y.controller.ts',
        className: 'YController',
        controllerPath: '',
        method: 'POST',
        path: '/api/y',
        line: 3,
      },
      {
        file: 'y.controller.ts',
        className: 'YController',
        controllerPath: '',
        method: 'GET',
        path: '/api/y/:id',
        line: 6,
      },
    ]);
  });
});

const ROUTER_FIXTURE = [
  'export function appRoutes() {',
  '  return [',
  '    {',
  "      id: 'root',",
  "      path: '/',",
  '      children: [',
  "        { id: 'login', path: 'auth/login' },",
  '        {',
  "          id: 'shell',",
  '          children: [',
  '            {',
  "              id: 'pages',",
  '              children: [',
  "                { id: 'home', index: true },",
  "                { id: 'workbench', path: 'workbench' },",
  "                { id: 'case-detail', path: 'case/:caseId' },",
  "                { id: 'not-found', path: '*' },",
  '              ],',
  '            },',
  '          ],',
  '        },',
  '      ],',
  '    },',
  '  ];',
  '}',
].join('\n');

// spec #322 Q16 seam⑤：从静态路由树枚举 UI 页面能力清单。
describe('enumerateUiRoutes（seam⑤：router.tsx 静态路由树 → UI 能力清单）', () => {
  it('按祖先拼接完整路径，保留 id/父子关系；index 与 * 不产生独立页面路径', () => {
    const routes = enumerateUiRoutes(ROUTER_FIXTURE);
    const byId = new Map(routes.map((route) => [route.id, route]));

    expect(routes.map((route) => route.id)).toEqual([
      'root',
      'login',
      'shell',
      'pages',
      'home',
      'workbench',
      'case-detail',
      'not-found',
    ]);
    expect(byId.get('root')).toMatchObject({ fullPath: '/', path: '/', parentId: null, index: false });
    expect(byId.get('login')).toMatchObject({
      fullPath: '/auth/login',
      path: 'auth/login',
      parentId: 'root',
    });
    expect(byId.get('shell')).toMatchObject({ fullPath: '/', path: null, parentId: 'root' });
    expect(byId.get('pages')).toMatchObject({ fullPath: '/', path: null, parentId: 'shell' });
    expect(byId.get('home')).toMatchObject({ fullPath: '/', path: null, index: true, parentId: 'pages' });
    expect(byId.get('workbench')).toMatchObject({ fullPath: '/workbench', parentId: 'pages' });
    expect(byId.get('case-detail')).toMatchObject({ fullPath: '/case/:caseId', parentId: 'pages' });
    expect(byId.get('not-found')).toMatchObject({ fullPath: '/*', path: '*', parentId: 'pages' });
  });
});

const MENU_FIXTURE = [
  'export const PRIMARY_ENTRIES: readonly PrimaryEntry[] = [',
  "  { id: 'workbench', label: '统一工作台', path: '/workbench', anyOf: [] },",
  "  { id: 'admin', label: '系统管理', path: '/admin', anyOf: ADMIN_HOME_OPCODES },",
  '];',
  '',
  'export const PLANNED_MODULES: readonly PlannedModule[] = [',
  '  {',
  "    id: 'admin-roles',",
  "    primary: 'admin',",
  "    label: '角色与权限',",
  "    path: '/admin/roles',",
  "    hint: '后续业务范围开放。',",
  '    inMenu: true,',
  '  },',
  '];',
  '',
  'export const SECONDARY_ENTRIES: readonly SecondaryEntry[] = [',
  '  ...CLUE_VIEWS.map((view) => ({',
  '    id: `clue-${view.id}`,',
  "    primary: 'clue' as PrimaryKey,",
  '    label: view.label,',
  '    path: `/clue?view=${view.id}`,',
  '  })),',
  "  { id: 'admin-home', primary: 'admin', label: '管理台首页', path: '/admin', anyOf: ADMIN_HOME_OPCODES },",
  '  ...PLANNED_MODULES.filter((item) => item.inMenu).map((item) => ({',
  '    id: item.id,',
  '    primary: item.primary,',
  '    label: item.label,',
  '    path: item.path,',
  '    planned: true,',
  '  })),',
  '];',
].join('\n');

const CLUE_URL_FIXTURE = [
  'export const CLUE_VIEWS = [',
  "  { id: 'all', label: '全部线索' },",
  "  { id: 'assign', label: '待分派 / 已分派' },",
  '] as const;',
].join('\n');

// spec #322 Q16 seam⑤：从静态菜单与线索视图枚举 UI 能力清单。
describe('enumerateClueViews / enumerateMenu（seam⑤：静态菜单 → UI 能力清单）', () => {
  it('展开 CLUE_VIEWS 与 PLANNED_MODULES 两处 spread：一级 2、二级 4（含 1 个 planned），共 6 条', () => {
    const clueViews = enumerateClueViews(CLUE_URL_FIXTURE);
    expect(clueViews).toEqual([
      { id: 'all', label: '全部线索' },
      { id: 'assign', label: '待分派 / 已分派' },
    ]);

    const menu = enumerateMenu({ menuSource: MENU_FIXTURE, clueViews });

    expect(menu.primaries.map((entry) => [entry.id, entry.path])).toEqual([
      ['workbench', '/workbench'],
      ['admin', '/admin'],
    ]);
    expect(menu.planned).toEqual([
      {
        id: 'admin-roles',
        primary: 'admin',
        label: '角色与权限',
        path: '/admin/roles',
        inMenu: true,
        line: 8,
      },
    ]);
    expect(menu.secondaries.map((entry) => [entry.id, entry.path, entry.planned])).toEqual([
      ['clue-all', '/clue?view=all', false],
      ['clue-assign', '/clue?view=assign', false],
      ['admin-home', '/admin', false],
      ['admin-roles', '/admin/roles', true],
    ]);
    expect(
      menu.primaries.length + menu.secondaries.length,
      '展开后菜单条目总数',
    ).toBe(6);
  });
});

const FEATURE_MAP_FIXTURE = [
  '# 夹具地图',
  '',
  '| id | 名称 | 路径 | 备注 |',
  '| ---- | ---- | ---- | ---- |',
  '| `nav.workbench` | 工作台 | `/workbench` | |',
  '| `nav.workbench.verify.step2` | 内业核查续办 | `/workbench?step=2&clue=:id` | |',
  '| `nav.case.conflict` | 案件冲突页 | `/case/:caseId` | |',
].join('\n');

// spec #322 Q16 seam⑤：从 Feature Map 文本提取 nav 节点清单。
describe('enumerateFeatureMap（seam⑤：Feature Map 文本 → 节点清单）', () => {
  it('按行首 nav.* 提取节点；路径取行内首个反引号包裹的 / 串，带 query 原样保留', () => {
    expect(enumerateFeatureMap(FEATURE_MAP_FIXTURE)).toEqual([
      { id: 'nav.workbench', name: '工作台', path: '/workbench', line: 5 },
      {
        id: 'nav.workbench.verify.step2',
        name: '内业核查续办',
        path: '/workbench?step=2&clue=:id',
        line: 6,
      },
      { id: 'nav.case.conflict', name: '案件冲突页', path: '/case/:caseId', line: 7 },
    ]);
  });
});

// ---------- 对账注入夹具 ----------

function apiRoute(method: ApiRoute['method'], path: string): ApiRoute {
  return { file: 'f.controller.ts', className: 'C', controllerPath: '', method, path, line: 1 };
}

function uiRoute(id: string, fullPath: string | null, path: string | null = fullPath): UiRoute {
  return { id, path, fullPath, index: path === null, parentId: null, line: 1 };
}

function mapNode(id: string, path: string | null): FeatureMapNode {
  return { id, name: id, path, line: 1 };
}

function menuEntry(id: string, path: string, planned = false): MenuEntry {
  return { id, label: id, path, primary: 'admin', planned, line: 1 };
}

function menuOf(secondaries: readonly MenuEntry[]): MenuCapabilities {
  return { primaries: [], secondaries, planned: [] };
}

function scenario(usage: Partial<ScenarioUsage> & Pick<ScenarioUsage, 'scenarioId'>): ScenarioUsage {
  return { status: 'runnable', featureMapRefs: [], actions: [], ...usage };
}

function register(overrides: Partial<StandardRegister> = {}): StandardRegister {
  return { stages: ['register', 'verify', 'dispatch', 'decide'], ...overrides };
}

/** 只取指定类别的提案，避免无关缺口干扰断言。 */
function proposalsOfKind(input: ReconcileInput, kind: string) {
  return reconcileCapabilities(input).proposals.filter((proposal) => proposal.kind === kind);
}

// spec #322 Q16 seam⑤ 第一类错位：产品有能力而地图无节点，产地图漂移提案。
describe('reconcileCapabilities 第一类错位：产品有地图无 → 地图漂移提案', () => {
  it('router/菜单同一路径只报一条，/、*、index 不计；已 ack 路由与「等权威」路由不报', () => {
    const input: ReconcileInput = {
      apiRoutes: [apiRoute('POST', '/api/clues')],
      uiRoutes: [
        uiRoute('root', '/'),
        uiRoute('home', '/', null),
        uiRoute('workbench', '/workbench'),
        uiRoute('case-phantom', '/case/phantom'),
        uiRoute('not-found', '/*', '*'),
      ],
      menu: menuOf([menuEntry('case-phantom', '/case/phantom'), menuEntry('admin-ghost', '/admin/ghost')]),
      featureMap: [mapNode('nav.workbench', '/workbench')],
      scenarios: [
        scenario({ scenarioId: 'vf-sc-ok', featureMapRefs: ['nav.workbench'], actions: ['register-clue'] }),
      ],
      register: register(),
      acks: [{ key: '/admin/ghost', keyType: 'route' }],
    };

    const drift = proposalsOfKind(input, 'map-drift');

    expect(drift).toEqual([
      {
        kind: 'map-drift',
        route: '/case/phantom',
        source: 'router',
        labels: ['enhancement'],
        reason: expect.any(String),
      },
    ]);
  });

  it('「等权威」路由不报地图漂移；未确认的同类路由仍报', () => {
    const input: ReconcileInput = {
      apiRoutes: [],
      uiRoutes: [uiRoute('case-phantom', '/case/phantom'), uiRoute('case-pending', '/case/pending')],
      menu: menuOf([]),
      featureMap: [],
      scenarios: [],
      register: register(),
      assertedNodes: [{ nodeId: '/case/pending' }],
    };

    expect(proposalsOfKind(input, 'map-drift').map((proposal) => proposal.route)).toEqual([
      '/case/phantom',
    ]);
  });
});

// spec #322 Q16 seam⑤ 第二类错位：地图有节点而判据无，产 latent stub 提案。
describe('reconcileCapabilities 第二类错位：地图有判据无 → latent stub 提案', () => {
  it('无人引用的地图节点报 latent stub；被 runnable 引用、已 ack、「等权威」的节点不报', () => {
    const input: ReconcileInput = {
      apiRoutes: [],
      uiRoutes: [
        uiRoute('case-phantom', '/case/phantom'),
        uiRoute('case-pending', '/case/pending'),
        uiRoute('case-kept', '/case/kept'),
        uiRoute('case-lonely', '/case/lonely'),
      ],
      menu: menuOf([]),
      featureMap: [
        mapNode('nav.case.phantom', '/case/phantom'),
        mapNode('nav.case.pending', '/case/pending'),
        mapNode('nav.case.kept', '/case/kept'),
        mapNode('nav.case.lonely', '/case/lonely'),
      ],
      scenarios: [
        scenario({ scenarioId: 'vf-sc-kept', featureMapRefs: ['nav.case.kept'], actions: ['read-dispatch'] }),
      ],
      register: register(),
      assertedNodes: [
        { nodeId: 'nav.case.pending' },
        {
          nodeId: 'nav.case.lonely',
          legalBasis: [{ documentCode: 'doc_002', articleNo: '2.5' }],
          roleBasis: ['经办'],
        },
      ],
      acks: [{ key: 'nav.case.phantom', keyType: 'feature-map-node' }],
    };

    expect(proposalsOfKind(input, 'latent-stub')).toEqual([
      {
        kind: 'latent-stub',
        featureMapRef: 'nav.case.lonely',
        route: '/case/lonely',
        labels: ['enhancement'],
        reason: expect.any(String),
      },
    ]);
  });
});

// spec #322 Q16 seam⑤ 第三类错位：runnable 能力消失，产转红或降级提案。
describe('reconcileCapabilities 第三类错位：runnable 能力消失 → 转红/降级提案', () => {
  it('runnable 引用的地图节点不存在报一条；action 映射端点不在 API 清单报一条；latent/未知 action 不报', () => {
    const input: ReconcileInput = {
      apiRoutes: [
        apiRoute('POST', '/api/clues'),
        apiRoute('GET', '/api/clues'),
        apiRoute('GET', '/api/clues/:id/dispatch'),
        apiRoute('GET', '/api/clues/:id/verification'),
        apiRoute('GET', '/api/clues/:id/verification/report'),
        apiRoute('GET', '/api/clues/:id/verification/analysis'),
      ],
      uiRoutes: [],
      menu: menuOf([]),
      featureMap: [mapNode('nav.workbench', '/workbench')],
      scenarios: [
        scenario({
          scenarioId: 'vf-sc-gone-node',
          featureMapRefs: ['nav.case.gone'],
          actions: ['read-dispatch'],
        }),
        scenario({
          scenarioId: 'vf-sc-gone-endpoint',
          featureMapRefs: ['nav.workbench'],
          actions: ['read-side-effects'],
        }),
        scenario({
          scenarioId: 'vf-sc-latent-gone',
          status: 'latent',
          featureMapRefs: ['nav.case.also-gone'],
          actions: ['read-dispatch'],
        }),
        scenario({
          scenarioId: 'vf-sc-unknown-action',
          featureMapRefs: ['nav.workbench'],
          actions: ['filing-submit'],
        }),
      ],
      register: register(),
    };

    expect(proposalsOfKind(input, 'runnable-regression')).toEqual([
      {
        kind: 'runnable-regression',
        scenarioId: 'vf-sc-gone-node',
        featureMapRef: 'nav.case.gone',
        labels: ['bug'],
        reason: expect.any(String),
      },
      {
        kind: 'runnable-regression',
        scenarioId: 'vf-sc-gone-endpoint',
        featureMapRef: 'nav.workbench',
        endpoint: 'GET /api/clues/:id/duplicates',
        route: '/api/clues/:id/duplicates',
        labels: ['bug'],
        reason: expect.any(String),
      },
    ]);
  });

  it('端点 ack 与地图节点 ack 分别压制对应回归提案', () => {
    const input: ReconcileInput = {
      apiRoutes: [apiRoute('GET', '/api/clues/:id/dispatch')],
      uiRoutes: [],
      menu: menuOf([]),
      featureMap: [],
      scenarios: [
        scenario({
          scenarioId: 'vf-sc-acked',
          featureMapRefs: ['nav.case.acked'],
          actions: ['read-dispatch'],
        }),
      ],
      register: register(),
      acks: [{ key: 'nav.case.acked', keyType: 'feature-map-node' }],
    };

    expect(proposalsOfKind(input, 'runnable-regression')).toEqual([]);
  });

  it('runnable 引用的地图节点 UI 路由/菜单消失 → 转红/降级提案；UI 输入为空时不判', () => {
    const base: ReconcileInput = {
      apiRoutes: [],
      uiRoutes: [uiRoute('workbench', '/workbench')],
      menu: menuOf([]),
      featureMap: [mapNode('nav.case.vanished', '/case/vanished')],
      scenarios: [scenario({ scenarioId: 'vf-sc-vanished', featureMapRefs: ['nav.case.vanished'] })],
      register: register(),
    };

    expect(proposalsOfKind(base, 'runnable-regression')).toEqual([
      {
        kind: 'runnable-regression',
        scenarioId: 'vf-sc-vanished',
        featureMapRef: 'nav.case.vanished',
        route: '/case/vanished',
        labels: ['bug'],
        reason: expect.any(String),
      },
    ]);

    const noUiData: ReconcileInput = { ...base, uiRoutes: [], menu: menuOf([]) };
    expect(proposalsOfKind(noUiData, 'runnable-regression')).toEqual([]);

    const routePresent: ReconcileInput = {
      ...base,
      uiRoutes: [uiRoute('case-vanished', '/case/vanished')],
    };
    expect(proposalsOfKind(routePresent, 'runnable-regression')).toEqual([]);
  });
});

// spec #322 Q16 seam⑤：source-check 判为待权威的节点从三类缺口同时排除。
describe('reconcileCapabilities 等权威过滤：source-check 判定不进对账缺口', () => {
  it('出处齐备节点不排除；缺角色依据节点从三类缺口同时排除', () => {
    const input: ReconcileInput = {
      apiRoutes: [],
      uiRoutes: [uiRoute('case-ok', '/case/ok'), uiRoute('case-pending', '/case/pending')],
      menu: menuOf([]),
      featureMap: [
        mapNode('nav.case.ok', '/case/ok'),
        mapNode('nav.case.pending', '/case/pending'),
      ],
      scenarios: [],
      register: register(),
      assertedNodes: [
        {
          nodeId: 'nav.case.ok',
          legalBasis: [{ documentCode: 'doc_002', articleNo: '2.5' }],
          roleBasis: ['经办'],
        },
        { nodeId: 'nav.case.pending', legalBasis: [], roleBasis: ['经办'] },
      ],
    };

    expect(proposalsOfKind(input, 'latent-stub').map((proposal) => proposal.featureMapRef)).toEqual([
      'nav.case.ok',
    ]);
    expect(proposalsOfKind(input, 'map-drift')).toEqual([]);
  });
});

// spec #322 Q16 seam⑤ API 双向：标准链登记端点无 scenario 调用时判据缺口提案。
describe('reconcileCapabilities API 双向：标准链登记端点无 scenario 调用 → 判据缺口提案', () => {
  it('只对 mappedEndpoints 登记端点提案；已调用与未登记端点不入提案', () => {
    const input: ReconcileInput = {
      apiRoutes: [
        apiRoute('POST', '/api/clues'),
        apiRoute('GET', '/api/clues/registered'),
        apiRoute('GET', '/api/clues/internal'),
      ],
      uiRoutes: [],
      menu: menuOf([]),
      featureMap: [],
      scenarios: [scenario({ scenarioId: 'vf-sc-calls', actions: ['register-clue'] })],
      register: register({ mappedEndpoints: ['GET /api/clues/registered'] }),
    };

    expect(proposalsOfKind(input, 'api-uncovered')).toEqual([
      {
        kind: 'api-uncovered',
        endpoint: 'GET /api/clues/registered',
        route: '/api/clues/registered',
        labels: ['enhancement'],
        reason: expect.any(String),
      },
    ]);
  });
});

// spec #322 Q16 seam⑤ 反向漂移：产品有能力而标准链查无节点，产 needs-triage 提案。
describe('reconcileCapabilities 反向漂移：产品有能力、标准链查无节点 → needs-triage 提案', () => {
  it('标准链有映射且路由不在映射内 → reverse-drift；未给映射时不硬判，降为地图漂移', () => {
    const base: ReconcileInput = {
      apiRoutes: [],
      uiRoutes: [uiRoute('case-phantom', '/case/phantom')],
      menu: menuOf([]),
      featureMap: [],
      scenarios: [],
      register: register({ mappedRoutes: ['/workbench'] }),
    };

    expect(proposalsOfKind(base, 'reverse-drift')).toEqual([
      {
        kind: 'reverse-drift',
        route: '/case/phantom',
        source: 'router',
        labels: ['needs-triage'],
        reason: expect.any(String),
      },
    ]);
    expect(proposalsOfKind(base, 'map-drift')).toEqual([]);

    const noMapping: ReconcileInput = { ...base, register: register() };
    expect(proposalsOfKind(noMapping, 'map-drift').map((proposal) => proposal.route)).toEqual([
      '/case/phantom',
    ]);
    expect(proposalsOfKind(noMapping, 'reverse-drift')).toEqual([]);
  });

  it('scenario 轨：runnable 场景无地图节点且端点在标准链映射外 → reverse-drift 带 scenarioId', () => {
    const input: ReconcileInput = {
      apiRoutes: [apiRoute('POST', '/api/clues')],
      uiRoutes: [],
      menu: menuOf([]),
      featureMap: [],
      scenarios: [
        scenario({
          scenarioId: 'vf-sc-unmapped',
          featureMapRefs: [],
          actions: ['register-clue'],
        }),
      ],
      register: register({ mappedRoutes: ['/workbench'] }),
      reverseDriftScope: 'scenario',
    };

    expect(proposalsOfKind(input, 'reverse-drift')).toEqual([
      {
        kind: 'reverse-drift',
        scenarioId: 'vf-sc-unmapped',
        labels: ['needs-triage'],
        reason: expect.any(String),
      },
    ]);
  });
});

// spec #322 Q16 seam⑤：对账汇总与 action 到端点映射的单一来源校验。
describe('reconcileCapabilities 汇总与 action→端点映射单一来源', () => {
  it('ACTION_ENDPOINTS 覆盖 run-api-scenario 的 9 个 action，端点模式可用于回归核对', () => {
    expect(Object.keys(ACTION_ENDPOINTS).sort()).toEqual([
      'assign-org',
      'assign-people',
      'decide',
      'poll-verification',
      'read-dispatch',
      'read-dispatch-buttons',
      'read-side-effects',
      'register-clue',
      'retry-verification',
    ]);
    expect(ACTION_ENDPOINTS['register-clue']).toEqual([{ method: 'POST', path: '/api/clues' }]);
    expect(ACTION_ENDPOINTS['read-side-effects']).toContainEqual({
      method: 'GET',
      path: '/api/clues/:id/duplicates',
    });
  });

  it('ACTION_ENDPOINTS 与 run-api-scenario runStep 分派字面量一致（防静默漂移）', () => {
    const runnerPath = path.join(
      process.cwd(),
      'e2e/verify/harness/run-api-scenario.ts',
    );
    const source = readFileSync(runnerPath, 'utf8');
    const dispatched = new Set(
      [...source.matchAll(/step\.action === '([^']+)'/g)].map((match) => match[1]),
    );

    expect([...dispatched].sort()).toEqual(Object.keys(ACTION_ENDPOINTS).sort());
  });

  it('汇总输出 API/UI/地图/runnable 计数，供报告引用', () => {
    const input: ReconcileInput = {
      apiRoutes: [apiRoute('POST', '/api/clues'), apiRoute('GET', '/api/clues')],
      uiRoutes: [uiRoute('root', '/'), uiRoute('home', '/', null), uiRoute('workbench', '/workbench')],
      menu: menuOf([menuEntry('clue', '/clue')]),
      featureMap: [mapNode('nav.workbench', '/workbench')],
      scenarios: [
        scenario({ scenarioId: 'vf-sc-ok', featureMapRefs: ['nav.workbench'], actions: ['register-clue'] }),
        scenario({ scenarioId: 'vf-sc-latent', status: 'latent' }),
      ],
      register: register(),
    };

    expect(reconcileCapabilities(input).summary).toEqual({
      apiRoutes: 2,
      apiRoutesCalled: 1,
      uiRoutes: 1,
      mapNodes: 1,
      runnableScenarios: 1,
      standardStages: 4,
    });
  });
});

// spec #322 Q16 seam⑤：能力清单与真实源码静态内容一致。
describe('真实源码一致性（seam⑤：能力清单与静态代码一致）', () => {
  it('38 个控制器 / 184 条方法路由 / 46 GET + 138 POST / 无重复 / 全部 /api/ 开头', async () => {
    const sources = await loadDiscoverSources(process.cwd());
    const routes = enumerateApiRoutes(sources.controllers);

    expect(sources.controllers).toHaveLength(38);
    expect(routes).toHaveLength(184);
    expect(routes.filter((route) => route.method === 'GET')).toHaveLength(46);
    expect(routes.filter((route) => route.method === 'POST')).toHaveLength(138);
    expect(
      routes.filter(
        (route) =>
          route.method === 'POST' && route.path === '/api/clues/:id/confirm-unit-receipt',
      ),
    ).toHaveLength(1);
    const keys = routes.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(routes.every((route) => route.path.startsWith('/api/'))).toBe(true);
  });

  it('router.tsx：33 个 id、30 个 path、去 * 与 / 后 28 条页面路径', async () => {
    const sources = await loadDiscoverSources(process.cwd());
    const routes = enumerateUiRoutes(sources.routerSource);

    expect(routes).toHaveLength(33);
    expect(routes.filter((route) => route.path !== null)).toHaveLength(30);
    const pages = routes.filter(
      (route) =>
        route.path !== null &&
        !route.index &&
        route.path !== '*' &&
        route.fullPath !== '/' &&
        route.fullPath !== '/*',
    );
    expect(pages).toHaveLength(28);
  });

  it('router.tsx 的 path 字面量不含 query；去 query 归一仅作用于菜单/地图视图键', async () => {
    const sources = await loadDiscoverSources(process.cwd());
    const paths = [...sources.routerSource.matchAll(/\bpath:\s*['"]([^'"]*)['"]/g)].map(
      (match) => match[1],
    );

    expect(paths).toHaveLength(30);
    expect(paths.some((routePath) => routePath.includes('?'))).toBe(false);
  });

  it('menu.ts：一级 5、二级 14（含 5 个 planned），clue 视图 4 条保留 query', async () => {
    const sources = await loadDiscoverSources(process.cwd());
    const clueViews = enumerateClueViews(sources.clueUrlSource);
    const menu = enumerateMenu({ menuSource: sources.menuSource, clueViews });

    expect(menu.primaries).toHaveLength(5);
    expect(menu.planned).toHaveLength(5);
    expect(menu.secondaries).toHaveLength(14);
    expect(menu.secondaries.filter((entry) => entry.planned)).toHaveLength(5);
    expect(menu.secondaries.filter((entry) => entry.primary === 'clue')).toEqual([
      expect.objectContaining({ id: 'clue-all', path: '/clue?view=all' }),
      expect.objectContaining({ id: 'clue-assign', path: '/clue?view=assign' }),
      expect.objectContaining({ id: 'clue-held', path: '/clue?view=held' }),
      expect.objectContaining({ id: 'clue-remind', path: '/clue?view=remind' }),
    ]);
  });

  it('feature-map.md：28 个 nav.* 节点，每节点路径可提取', async () => {
    const sources = await loadDiscoverSources(process.cwd());
    const nodes = enumerateFeatureMap(sources.featureMapSource);

    expect(nodes).toHaveLength(28);
    expect(nodes.every((node) => node.id.startsWith('nav.'))).toBe(true);
    expect(nodes.filter((node) => node.path !== null)).toHaveLength(28);
  });
});
