// 机构树（P4，#123）的数据与纯函数。树查询放在 /api/org-units，业务侧选承办机构复用同一接口，只取未停用节点。
// 新建下级、改名、停用放在 /api/admin/org-units。是否有权由服务端决定，前端按会话清单只决定显示什么。

import { data } from 'react-router';

import { apiFetch, type ApiDispatch } from '../api';
import { sessionOpcodes, type SessionStore } from '../session';

export type OrgUnitLevel = 'city' | 'district' | 'station';

export const LEVEL_LABEL: Record<OrgUnitLevel, string> = { city: '市', district: '区', station: '所' };
export const LEVELS: readonly OrgUnitLevel[] = ['city', 'district', 'station'];

export interface OrgUnitName {
  name: string;
  /** 开始使用的时刻（ISO） */
  from: string;
  /** 停止使用的时刻（ISO）；null = 现用名称 */
  to: string | null;
}

export interface OrgUnit {
  id: string;
  code: string;
  name: string;
  level: OrgUnitLevel;
  parentId: string | null;
  deactivatedAt: string | null;
  activePersonnel: number;
  names: OrgUnitName[];
}

export interface OrgTreeData {
  /** 操作者的当前任职机构，即树根 */
  rootId: string;
  orgUnits: OrgUnit[];
}

export interface OrgTreeNode {
  unit: OrgUnit;
  children: OrgTreeNode[];
}

/** 上级之下唯一允许新建的层级：市下只能建区，区下只能建所，所下不能再建。 */
export function childLevelOf(level: OrgUnitLevel): OrgUnitLevel | null {
  if (level === 'city') return 'district';
  if (level === 'district') return 'station';
  return null;
}

/** 按 parentId 组装成树，下级保持接口返回的顺序（建立先后）。根缺失时为 null。 */
export function buildTree(tree: OrgTreeData, showDeactivated = true): OrgTreeNode | null {
  const byParent = new Map<string, OrgUnit[]>();
  for (const unit of tree.orgUnits) {
    if (!unit.parentId) continue;
    const list = byParent.get(unit.parentId) ?? [];
    list.push(unit);
    byParent.set(unit.parentId, list);
  }
  const root = tree.orgUnits.find((unit) => unit.id === tree.rootId);
  if (!root) return null;
  const grow = (unit: OrgUnit): OrgTreeNode => ({
    unit,
    children: (byParent.get(unit.id) ?? [])
      .filter((child) => showDeactivated || !child.deactivatedAt)
      .map(grow),
  });
  return grow(root);
}

/** 当前看得见的节点，按树上从上到下的顺序；折叠起来的节点不展开它的下级（根节点始终展开）。 */
export function visibleOrder(root: OrgTreeNode, collapsed: ReadonlySet<string>): string[] {
  const order: string[] = [];
  const walk = (node: OrgTreeNode, depth: number) => {
    order.push(node.unit.id);
    if (depth > 0 && collapsed.has(node.unit.id)) return;
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(root, 0);
  return order;
}

export type TreeKeyAction = { kind: 'select'; id: string } | { kind: 'toggle'; id: string } | null;

/**
 * 树的键盘操作（WAI-ARIA treeview 的常用键）：上下键移到上一个、下一个看得见的节点；Home、End 到首尾；
 * 右键展开折叠的节点，已展开时移到第一个下级；左键折叠展开的节点，否则移到上级；回车、空格选中当前节点。
 */
export function treeKeyAction(
  key: string,
  order: readonly string[],
  current: string,
  node: { parentId: string | null; hasChildren: boolean; open: boolean; collapsible: boolean },
): TreeKeyAction {
  const at = order.indexOf(current);
  if (at < 0) return null;
  const select = (id: string | undefined): TreeKeyAction => (id === undefined ? null : { kind: 'select', id });
  switch (key) {
    case 'ArrowDown':
      return select(order[at + 1]);
    case 'ArrowUp':
      return select(order[at - 1]);
    case 'Home':
      return select(order[0]);
    case 'End':
      return select(order[order.length - 1]);
    case 'ArrowRight':
      if (!node.hasChildren) return null;
      return node.open ? select(order[at + 1]) : { kind: 'toggle', id: current };
    case 'ArrowLeft':
      if (node.hasChildren && node.open && node.collapsible) return { kind: 'toggle', id: current };
      return node.parentId !== null && order.includes(node.parentId) ? select(node.parentId) : null;
    case 'Enter':
    case ' ':
      return { kind: 'select', id: current };
    default:
      return null;
  }
}

export function childrenOf(tree: OrgTreeData, id: string): OrgUnit[] {
  return tree.orgUnits.filter((unit) => unit.parentId === id);
}

/** 「11 个机构，2 个已停用」；没有已停用时只写总数。 */
export function treeCountHint(tree: OrgTreeData): string {
  const total = tree.orgUnits.length;
  const off = tree.orgUnits.filter((unit) => unit.deactivatedAt).length;
  return off > 0 ? `${total} 个机构，${off} 个已停用` : `${total} 个机构`;
}

/** 「3 个（其中 1 个已停用）」；没有下级时为「无」。 */
export function childCountText(tree: OrgTreeData, id: string): string {
  const children = childrenOf(tree, id);
  if (children.length === 0) return '无';
  const off = children.filter((unit) => unit.deactivatedAt).length;
  return off > 0 ? `${children.length} 个（其中 ${off} 个已停用）` : `${children.length} 个`;
}

/**
 * P4「只有根」：树根是根机构（没有上级），并且没有任何下级（SCREENS.md:48，P4-org-tree.html:31-33）。
 * 区分局、所的人员看到的子树即使只有一个节点，也不是这个状态：区下只能建所（#105:182），不该提示先建区分局。
 */
export function onlyRootOrgUnit(tree: OrgTreeData): boolean {
  const root = tree.orgUnits.find((unit) => unit.id === tree.rootId);
  if (!root || root.parentId !== null) return false;
  return !tree.orgUnits.some((unit) => unit.parentId === root.id);
}

/** 业务侧选承办机构：只取未停用节点（#105 故事 26）。 */
export function activeOrgUnits(tree: OrgTreeData): OrgUnit[] {
  return tree.orgUnits.filter((unit) => !unit.deactivatedAt);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });

/** 北京时间的日期（YYYY-MM-DD）。 */
export function dayOf(iso: string): string {
  return DATE.format(new Date(iso));
}

/** 名称使用期间，新名在前：「2019-03-01 至今」「2015-06-01 至 2019-02-28」（止于下一名称开始的前一天，不早于开始日）。 */
export function namePeriods(names: readonly OrgUnitName[]): Array<{ name: string; period: string }> {
  return [...names].reverse().map((item) => {
    const start = dayOf(item.from);
    if (!item.to) return { name: item.name, period: `${start} 至今` };
    const lastDay = dayOf(new Date(Date.parse(item.to) - DAY_MS).toISOString());
    return { name: item.name, period: `${start} 至 ${lastDay < start ? start : lastDay}` };
  });
}

/** 详情里的历史名称：不含现名，新名在前，「2019-03-01 前使用」。 */
export function formerNames(names: readonly OrgUnitName[]): Array<{ name: string; until: string }> {
  return names
    .filter((item) => item.to)
    .reverse()
    .map((item) => ({ name: item.name, until: `${dayOf(item.to as string)} 前使用` }));
}

export type OrgRuleCode = 'org-level-mismatch' | 'org-name-required' | 'org-name-too-long';

export const RULE_TEXT: Record<OrgRuleCode, string> = {
  'org-name-required': '请填写机构名称。',
  'org-name-too-long': '机构名称不能超过 100 个字。',
  'org-level-mismatch': '层级不符：市下只能建区，区下只能建所，所下不能再建下级机构。',
};

export type OrgWriteResult =
  | { ok: true; id: string }
  | { ok: false; rules: OrgRuleCode[]; message: string | null };

// 定稿句，取自原型 assets/shell.js:62（PR #142 界面验收必须改 3）。
const FAILED = '网络或服务暂时不可用，请稍后重试。问题持续时请联系本单位的系统管理人员。';

const REGISTER_CONFLICT = '上级机构已停用，不能在它下面新建机构。';

async function write(
  dispatch: ApiDispatch,
  url: string,
  body: unknown,
  idOf: (json: Record<string, unknown>) => string,
  conflict: (json: Record<string, unknown>) => string = () => REGISTER_CONFLICT,
): Promise<OrgWriteResult> {
  let response: Response;
  try {
    response = await apiFetch(dispatch, url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, rules: [], message: FAILED };
  }
  if (response.status === 401) return { ok: false, rules: [], message: null };
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return { ok: true, id: idOf(json) };
  if (response.status === 400 && Array.isArray(json.rules)) {
    return { ok: false, rules: json.rules.filter((rule): rule is OrgRuleCode => rule in RULE_TEXT), message: null };
  }
  if (response.status === 409) return { ok: false, rules: [], message: conflict(json) };
  if (response.status === 403) return { ok: false, rules: [], message: '你没有权限执行这个操作，或这个机构不在你的范围内。' };
  return { ok: false, rules: [], message: FAILED };
}

export function registerOrgUnit(
  dispatch: ApiDispatch,
  input: { parentId: string; name: string; level: OrgUnitLevel },
): Promise<OrgWriteResult> {
  return write(dispatch, '/api/admin/org-units', input, (json) => String((json.orgUnit as { id?: string } | undefined)?.id ?? ''));
}

export function renameOrgUnit(dispatch: ApiDispatch, id: string, name: string): Promise<OrgWriteResult> {
  return write(dispatch, `/api/admin/org-units/${encodeURIComponent(id)}/rename`, { name }, () => id);
}

/** 停用前在前端能核对的条件（按树数据）：在职人员、未停用的下级。服务端还会核对生效任职与未办结事项。 */
export type DeactivationBlocker =
  | { kind: 'personnel'; count: number }
  | { kind: 'children'; names: string[] };

export function deactivationBlockers(tree: OrgTreeData, unit: OrgUnit): DeactivationBlocker[] {
  const blockers: DeactivationBlocker[] = [];
  if (unit.activePersonnel > 0) blockers.push({ kind: 'personnel', count: unit.activePersonnel });
  const active = childrenOf(tree, unit.id).filter((child) => !child.deactivatedAt);
  if (active.length > 0) blockers.push({ kind: 'children', names: active.map((child) => child.name) });
  return blockers;
}

const DEACTIVATE_CONFLICT = '这个机构暂时不能停用，请刷新后查看原因。';

/** 停用。409 显示服务端给的可读原因（根机构、下级、生效任职、未办结的线索或案件）。 */
export function deactivateOrgUnit(dispatch: ApiDispatch, id: string): Promise<OrgWriteResult> {
  return write(
    dispatch,
    `/api/admin/org-units/${encodeURIComponent(id)}/deactivate`,
    {},
    () => id,
    (json) => (typeof json.message === 'string' && json.message ? json.message : DEACTIVATE_CONFLICT),
  );
}

/** 取树。403：重新拉会话（apiFetch）后显示无权限卡片；401 交给会话已结束页处理。 */
export async function loadOrgTree(dispatch: ApiDispatch): Promise<OrgTreeData | null> {
  const response = await apiFetch(dispatch, '/api/org-units');
  if (response.status === 401) return null;
  if (response.status === 403) throw data(null, { status: 403 });
  if (!response.ok) throw new Error(`机构树读取失败：HTTP ${response.status}`);
  const body = (await response.json()) as { rootId?: string; orgUnits?: OrgUnit[] };
  return { rootId: body.rootId ?? '', orgUnits: Array.isArray(body.orgUnits) ? body.orgUnits : [] };
}

/** loader 只取数，不做授权判断；没有树读码时不发请求，页面显示无权限卡片。 */
export function orgTreeLoader(store: SessionStore) {
  return () => {
    const tree = sessionOpcodes(store).then((opcodes) =>
      (opcodes.includes('org.tree.read') ? loadOrgTree(store.dispatch) : null));
    return { tree };
  };
}
