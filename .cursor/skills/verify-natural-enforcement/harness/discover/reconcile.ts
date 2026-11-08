// 发现器信号源 2（spec #322 二期 T5）：标准链四环对账。
// 纯函数，零 I/O：只接收能力清单、标准寄存器、scenario 实际用量与 ack，产出 issue 提案数据结构。
// 提案只是内存对象：不建 issue、不改地图/fixtures、不写盘。
//
// 路由 ack 键语义（T5 固定，勿与地图节点键混用）：
// - UI 路由：规范化站内路径，如 `/case/onsite-check`
// - API 路由：`METHOD /path`，如 `GET /api/clues/:id/dispatch`
// diff-runs.ts 的 filterAcked 保持首期语义（只过滤地图节点），路由 ack 在本文内处理。
import type { CoverageAck } from './diff-runs.ts';
import type {
  ApiRoute,
  FeatureMapNode,
  MenuCapabilities,
  UiRoute,
} from './enumerate-capabilities.ts';
import {
  admittedNodeIds,
  checkNodeSources,
  type AssertedNode,
} from './source-check.ts';

/** `run-api-scenario.ts` runStep 分支里的 HTTP 调用模式（scenario 实际调用的单一来源）。 */
export interface EndpointPattern {
  readonly method: 'GET' | 'POST';
  readonly path: string;
}

/**
 * action → 端点映射。只收 `run-api-scenario.ts` 里真会发 HTTP 的 9 个 action；
 * 无 runner 的 action（filing-*、dispatch-* 等）不在表内，不能算作 API 实际调用。
 */
export const ACTION_ENDPOINTS: Readonly<Record<string, readonly EndpointPattern[]>> = {
  'register-clue': [{ method: 'POST', path: '/api/clues' }],
  'read-dispatch': [{ method: 'GET', path: '/api/clues/:id/dispatch' }],
  'poll-verification': [{ method: 'GET', path: '/api/clues/:id/verification' }],
  decide: [
    { method: 'GET', path: '/api/clues/:id/dispatch' },
    { method: 'POST', path: '/api/clues/:id/decide' },
  ],
  'assign-org': [
    { method: 'GET', path: '/api/org-units' },
    { method: 'GET', path: '/api/clues/:id/dispatch' },
    { method: 'POST', path: '/api/clues/:id/assign-org' },
  ],
  'assign-people': [
    { method: 'GET', path: '/api/clues/:id/dispatch' },
    { method: 'POST', path: '/api/clues/:id/assign-people' },
  ],
  'retry-verification': [{ method: 'POST', path: '/api/clues/:id/verification/retry' }],
  'read-side-effects': [
    { method: 'GET', path: '/api/clues/:id/verification' },
    { method: 'GET', path: '/api/clues/:id/duplicates' },
    { method: 'GET', path: '/api/clues/:id/dispatch' },
    { method: 'GET', path: '/api/clues/:id/verification/report' },
    { method: 'GET', path: '/api/clues/:id/verification/analysis' },
    { method: 'GET', path: '/api/clues' },
  ],
  'read-dispatch-buttons': [
    { method: 'GET', path: '/api/clues/:id/dispatch' },
    { method: 'GET', path: '/api/clues' },
  ],
};

/** scenario 静态用量：状态/地图引用/步骤 action。 */
export interface ScenarioUsage {
  readonly scenarioId: string;
  readonly status: 'runnable' | 'latent';
  readonly featureMapRefs?: readonly string[];
  readonly actions?: readonly string[];
}

/**
 * 标准寄存器：profiles stages +（#19 落地后的）标准链路由映射。
 * mappedRoutes 缺省空 = 标准链尚无可判节点，反向漂移不硬判（未知不报）。
 * mappedEndpoints = 已登记标准链的 API 端点（`METHOD /path`）；只有这些端点参与
 * 「API 路由无 scenario 调用」提案，避免 183 条全量产票压垮信噪比（Q15）。
 * 「等权威」节点由 ReconcileInput.assertedNodes 经 source-check 判定，此处不另设键表。
 */
export interface StandardRegister {
  readonly stages: readonly string[];
  readonly mappedRoutes?: readonly string[];
  readonly mappedEndpoints?: readonly string[];
}

/** 反向漂移判定范围：UI 路由（默认）或 scenario 轨。 */
export type ReverseDriftScope = 'ui' | 'scenario';

/** 对账输入（全部由调用方读盘/加载后传入）。 */
export interface ReconcileInput {
  readonly apiRoutes: readonly ApiRoute[];
  readonly uiRoutes: readonly UiRoute[];
  readonly menu: MenuCapabilities;
  readonly featureMap: readonly FeatureMapNode[];
  readonly scenarios: readonly ScenarioUsage[];
  readonly register: StandardRegister;
  /** 应然模型草案节点；经 source-check 判为待权威的节点不计对账缺口。 */
  readonly assertedNodes?: readonly AssertedNode[];
  readonly acks?: readonly CoverageAck[];
  readonly reverseDriftScope?: ReverseDriftScope;
}

/** 提案类别：三类错位 + 反向漂移 + API 判据缺口。 */
export type ProposalKind =
  | 'map-drift'
  | 'latent-stub'
  | 'runnable-regression'
  | 'reverse-drift'
  | 'api-uncovered';

/** 一条 issue 提案（数据结构；只立提案，不自动开票）。 */
export interface DiscoverProposal {
  readonly kind: ProposalKind;
  readonly route?: string;
  readonly source?: 'router' | 'menu' | 'api';
  readonly featureMapRef?: string;
  readonly scenarioId?: string;
  readonly endpoint?: string;
  readonly labels: readonly string[];
  readonly reason: string;
}

/** 对账汇总计数，供报告引用。 */
export interface ReconcileSummary {
  readonly apiRoutes: number;
  readonly apiRoutesCalled: number;
  readonly uiRoutes: number;
  readonly mapNodes: number;
  readonly runnableScenarios: number;
  readonly standardStages: number;
}

export interface ReconcileResult {
  readonly proposals: DiscoverProposal[];
  readonly summary: ReconcileSummary;
}

/**
 * 路径归一：去 query/hash，去空段，参数名统一为 :param（跨源按同一页面匹配）。
 * 已核实 `frontend/src/router.tsx` 的 path 字面量不含 query（测试锁定据此）。
 * query 只出现在菜单与地图的视图键（如 `/clue?view=all`、`/workbench?step=2`），
 * 归一到基路径才能与路由同键。若 router 将来引入 query 路径，须改为保留 query，
 * 否则不同页面会被折叠成同键、漏报地图漂移。
 */
function canonicalPath(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? '';
  const segments = clean
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => (segment.startsWith(':') ? ':param' : segment));
  return `/${segments.join('/')}`;
}

function canonicalEndpoint(method: string, path: string): string {
  return `${method.toUpperCase()} ${canonicalPath(path)}`;
}

/** ack 键归一：`METHOD /path` 走 API 语义，其余按站内路径。 */
function canonicalAckKey(key: string): string {
  const methodMatch = /^([A-Za-z]+)\s+(.+)$/.exec(key.trim());
  if (methodMatch !== null) return canonicalEndpoint(methodMatch[1], methodMatch[2]);
  return canonicalPath(key.trim());
}

/** 「等权威」键归一：API 端点走 method+path，站内路径去 query，地图节点 id/scenario id 原样。 */
function pendingKeyOf(key: string): string {
  const methodMatch = /^([A-Za-z]+)\s+(.+)$/.exec(key.trim());
  if (methodMatch !== null) return canonicalEndpoint(methodMatch[1], methodMatch[2]);
  const trimmed = key.trim();
  return trimmed.startsWith('/') ? canonicalPath(trimmed) : trimmed;
}

/** 一条 UI 能力（router 或菜单）；同一路径只保留首个来源，router 优先。 */
interface UiCapability {
  readonly route: string;
  readonly source: 'router' | 'menu';
}

function uiCapabilities(input: ReconcileInput): UiCapability[] {
  const byRoute = new Map<string, UiCapability>();
  const add = (route: string, source: 'router' | 'menu'): void => {
    if (route === '/' || route === '/*') return;
    if (!byRoute.has(route)) byRoute.set(route, { route, source });
  };
  for (const route of input.uiRoutes) {
    if (route.fullPath === null || route.index) continue;
    add(canonicalPath(route.fullPath), 'router');
  }
  for (const entry of [...input.menu.primaries, ...input.menu.secondaries]) {
    add(canonicalPath(entry.path), 'menu');
  }
  return [...byRoute.values()];
}

/** scenario 的已知 action 去重后展开为端点模式。 */
function endpointsOf(usage: ScenarioUsage): EndpointPattern[] {
  const seen = new Set<string>();
  const endpoints: EndpointPattern[] = [];
  for (const action of usage.actions ?? []) {
    for (const endpoint of ACTION_ENDPOINTS[action] ?? []) {
      const key = canonicalEndpoint(endpoint.method, endpoint.path);
      if (seen.has(key)) continue;
      seen.add(key);
      endpoints.push(endpoint);
    }
  }
  return endpoints;
}

/** 四环对账：产出三类错位、反向漂移与 API 判据缺口的 issue 提案，并给出汇总计数。 */
export function reconcileCapabilities(input: ReconcileInput): ReconcileResult {
  const proposals: DiscoverProposal[] = [];
  const acks = input.acks ?? [];
  const nodeAcks = new Set(
    acks.filter((ack) => ack.keyType === 'feature-map-node').map((ack) => ack.key),
  );
  const routeAcks = new Set(
    acks.filter((ack) => ack.keyType === 'route').map((ack) => canonicalAckKey(ack.key)),
  );

  // 「等权威」只由 source-check 判定：待权威节点不进实现方向，也不计对账缺口。
  const sourceChecks = checkNodeSources(input.assertedNodes ?? []);
  const admitted = new Set(admittedNodeIds(sourceChecks));
  const pending = new Set(
    (input.assertedNodes ?? [])
      .filter((node) => !admitted.has(node.nodeId))
      .map((node) => pendingKeyOf(node.nodeId)),
  );
  const isPending = (key: string): boolean => pending.has(pendingKeyOf(key));

  const mapNodes = input.featureMap;
  const mapById = new Map(mapNodes.map((node) => [node.id, node]));
  const mapIds = new Set(mapById.keys());
  const mapPaths = new Set(
    mapNodes.flatMap((node) => (node.path === null ? [] : [canonicalPath(node.path)])),
  );
  const mappedPaths = new Set((input.register.mappedRoutes ?? []).map(canonicalPath));

  const runnable = input.scenarios.filter((usage) => usage.status === 'runnable');
  const referencedNodes = new Set(runnable.flatMap((usage) => usage.featureMapRefs ?? []));

  // 第一类错位 + 反向漂移：UI 路由/菜单有、地图无。
  const scope = input.reverseDriftScope ?? 'ui';
  const uiCaps = uiCapabilities(input);
  // UI 输入为空表示无数据，不等于能力消失；此时不判 runnable 的 UI 路由缺口。
  const hasUiData = uiCaps.length > 0;
  for (const capability of uiCaps) {
    if (mapPaths.has(capability.route)) continue;
    if (isPending(capability.route)) continue;
    if (routeAcks.has(capability.route)) continue;
    if (scope === 'ui' && mappedPaths.size > 0 && !mappedPaths.has(capability.route)) {
      proposals.push({
        kind: 'reverse-drift',
        route: capability.route,
        source: capability.source,
        labels: ['needs-triage'],
        reason: '产品已有此 UI 能力，标准链查无对应节点；请人裁决合法新增还是镀金，不自动补地图',
      });
      continue;
    }
    proposals.push({
      kind: 'map-drift',
      route: capability.route,
      source: capability.source,
      labels: ['enhancement'],
      reason: '产品已有此 UI 能力，Feature Map 无对应节点；地图漂移提案',
    });
  }

  // 第二类错位：地图节点有、runnable scenario 判据无。
  for (const node of mapNodes) {
    if (referencedNodes.has(node.id)) continue;
    if (isPending(node.id) || nodeAcks.has(node.id)) continue;
    proposals.push({
      kind: 'latent-stub',
      featureMapRef: node.id,
      ...(node.path === null ? {} : { route: node.path }),
      labels: ['enhancement'],
      reason: 'Feature Map 有此节点，但无任何 runnable scenario 引用；latent stub 提案',
    });
  }

  // 第三类错位：runnable 能力消失（地图节点没了、UI 路由/菜单没了或 action 端点没了）。
  const apiKeys = new Set(
    input.apiRoutes.map((route) => canonicalEndpoint(route.method, route.path)),
  );
  const calledKeys = new Set<string>();
  for (const usage of runnable) {
    const endpoints = endpointsOf(usage);
    for (const endpoint of endpoints) {
      const key = canonicalEndpoint(endpoint.method, endpoint.path);
      if (apiKeys.has(key)) calledKeys.add(key);
    }

    const refs = usage.featureMapRefs ?? [];
    for (const ref of refs) {
      if (isPending(ref) || nodeAcks.has(ref)) continue;
      const node = mapById.get(ref);
      if (node === undefined) {
        proposals.push({
          kind: 'runnable-regression',
          scenarioId: usage.scenarioId,
          featureMapRef: ref,
          labels: ['bug'],
          reason: 'runnable scenario 引用的 Feature Map 节点不存在；能力已消失，转红/降级提案',
        });
        continue;
      }
      if (!hasUiData || node.path === null) continue;
      const route = canonicalPath(node.path);
      if (uiCaps.some((capability) => capability.route === route)) continue;
      if (routeAcks.has(route)) continue;
      proposals.push({
        kind: 'runnable-regression',
        scenarioId: usage.scenarioId,
        featureMapRef: ref,
        route: node.path,
        labels: ['bug'],
        reason:
          'runnable scenario 引用的 Feature Map 节点仍在，但其 UI 路由/菜单已消失；能力假绿，转红/降级提案',
      });
    }

    for (const endpoint of endpoints) {
      const key = canonicalEndpoint(endpoint.method, endpoint.path);
      if (apiKeys.has(key) || isPending(key) || routeAcks.has(key)) continue;
      proposals.push({
        kind: 'runnable-regression',
        scenarioId: usage.scenarioId,
        ...(refs[0] === undefined ? {} : { featureMapRef: refs[0] }),
        endpoint: `${endpoint.method} ${endpoint.path}`,
        route: endpoint.path,
        labels: ['bug'],
        reason: 'runnable scenario 的 action 映射端点不在 API 能力清单；后端路由已消失，转红/降级提案',
      });
    }
  }

  // API 双向的第二向：标准链已登记端点却无 runnable scenario 调用。
  // 只对 register.mappedEndpoints 显式登记的端点提案；183 条全量 route→scenario
  // 缺覆盖不入提案（绝大多数为内部接口，全量产票会压垮信噪比，Q15）。
  const mappedEndpoints = new Set((input.register.mappedEndpoints ?? []).map(canonicalAckKey));
  const uncoveredEndpoints = new Set<string>();
  for (const route of input.apiRoutes) {
    const key = canonicalEndpoint(route.method, route.path);
    if (!mappedEndpoints.has(key) || calledKeys.has(key) || uncoveredEndpoints.has(key)) continue;
    if (isPending(key) || routeAcks.has(key)) continue;
    uncoveredEndpoints.add(key);
    proposals.push({
      kind: 'api-uncovered',
      endpoint: `${route.method} ${route.path}`,
      route: route.path,
      labels: ['enhancement'],
      reason: 'API 路由已在标准链登记，但无 runnable scenario 调用；判据缺口提案',
    });
  }

  // 反向漂移 scenario 轨：有实跑判据但标准链查无节点（仅在提供标准映射时判定）。
  if (scope === 'scenario' && mappedPaths.size > 0 && input.register.stages.length > 0) {
    for (const usage of runnable) {
      const refs = usage.featureMapRefs ?? [];
      if (refs.some((ref) => mapIds.has(ref))) continue;
      const endpoints = endpointsOf(usage);
      const covered =
        refs.some((ref) => mappedPaths.has(canonicalPath(ref))) ||
        endpoints.some((endpoint) => mappedPaths.has(canonicalPath(endpoint.path)));
      if (covered) continue;
      if (isPending(usage.scenarioId)) continue;
      proposals.push({
        kind: 'reverse-drift',
        scenarioId: usage.scenarioId,
        labels: ['needs-triage'],
        reason: 'runnable scenario 有实际判据，但标准链查无对应节点；请人裁决，不自动补地图',
      });
    }
  }

  return {
    proposals,
    summary: {
      apiRoutes: input.apiRoutes.length,
      apiRoutesCalled: calledKeys.size,
      uiRoutes: uiCaps.filter((capability) => capability.source === 'router').length,
      mapNodes: mapNodes.length,
      runnableScenarios: runnable.length,
      standardStages: input.register.stages.length,
    },
  };
}
