// 管理台首页（P3）的数据与视图判定。
// 各入口的数字来自各自功能的查询：被锁人员（A10）、机构（#123，取机构树节点数）、今日留痕（#126）、
// 人员（#128，取数据范围内未停用的人数）。「需要留意的执法证」与有执法资格的人数按人员名单的证件情况算（#133）。

import { data } from 'react-router';

import { apiFetch, type ApiDispatch } from '../api';
import { sessionOpcodes, type SessionStore } from '../session';
import { ADMIN_HOME_OPCODES, hasAny, ORG_MAINTENANCE_OPCODE } from '../shell/menu';
import { certAttentionOf, qualifiedPersonnelCount, type CertAttentionKey, type PersonnelRow } from './personnel';

export interface AdminHomeSummary {
  /** 数据范围内的机构数 */
  orgUnits: number | null;
  /** 数据范围内的人员数 */
  personnel: number | null;
  /** 数据范围内的被锁人员数 */
  lockedPersonnel: number | null;
  /** 今日管理台留痕条数 */
  auditToday: number | null;
  /** 有执法资格的人数（#133）：证件状态为「有效」且在有效期内，临期也算 */
  certifiedPersonnel: number | null;
  /** 需要留意的执法证（#133，原型 P3:29）：临期、已过期、失效、未登记四种情况的人数 */
  certAttention: Record<CertAttentionKey, number> | null;
}

export const EMPTY_SUMMARY: AdminHomeSummary = {
  orgUnits: null,
  personnel: null,
  lockedPersonnel: null,
  auditToday: null,
  certifiedPersonnel: null,
  certAttention: null,
};

/** 维护类入口码。只有留痕入口、没有维护入口的是监督视角。 */
const MAINTENANCE_OPCODES = [ORG_MAINTENANCE_OPCODE, 'personnel.profile.read', 'personnel.locked.read'] as const;

export type AdminHomeView = 'admin' | 'supervise' | 'denied';

/** 按会话清单选首屏视角。只决定显示什么，不代替服务端授权。 */
export function adminHomeView(opcodes: readonly string[]): AdminHomeView {
  if (!hasAny(opcodes, ADMIN_HOME_OPCODES)) return 'denied';
  if (!hasAny(opcodes, MAINTENANCE_OPCODES)) return 'supervise';
  return 'admin';
}

/**
 * 上线首日条件未齐（P3 firstday）：只有一个机构、只有本人、没有人有执法资格。
 * 三个数字都已知时才判定；任一未知时不显示引导。
 */
export function firstDayPending(summary: AdminHomeSummary): boolean {
  return summary.orgUnits === 1 && summary.personnel === 1 && summary.certifiedPersonnel === 0;
}

export interface AdminTile {
  id: string;
  title: string;
  desc: string;
  path: string;
  opcode: string;
  count: (summary: AdminHomeSummary) => string | null;
}

function counted(value: number | null, unit: string, prefix = ''): string | null {
  return value === null ? null : `${prefix}${value} ${unit}`;
}

export const ADMIN_TILES: readonly AdminTile[] = [
  { id: 'org', title: '机构', desc: '建下级机构、改名、停用', path: '/admin/org-units', opcode: ORG_MAINTENANCE_OPCODE, count: (s) => counted(s.orgUnits, '个') },
  { id: 'person', title: '人员', desc: '建人员、分配角色、调岗、停用与恢复', path: '/admin/personnel', opcode: 'personnel.profile.read', count: (s) => counted(s.personnel, '人') },
  { id: 'locked', title: '被锁人员', desc: '连续输错口令被锁的人员', path: '/admin/locked-personnel', opcode: 'personnel.locked.read', count: (s) => counted(s.lockedPersonnel, '人') },
  { id: 'audit', title: '管理台留痕', desc: '查阅与导出维护记录', path: '/admin/audit', opcode: 'audit.admin.read', count: (s) => counted(s.auditToday, '条', '今日 ') },
];

/** 监督视角的留痕入口说明（P3 supervise）。 */
export const SUPERVISE_AUDIT_DESC = '谁在什么时候做了哪些维护，结果如何';

/** 取首页数字。接口 403：重新拉会话后显示无权限页；401 交给会话已结束页处理。 */
export async function loadAdminHomeSummary(dispatch: ApiDispatch, opcodes: readonly string[]): Promise<AdminHomeSummary> {
  const summary: AdminHomeSummary = { ...EMPTY_SUMMARY };
  if (opcodes.includes(ORG_MAINTENANCE_OPCODE) && opcodes.includes('org.tree.read')) {
    const response = await apiFetch(dispatch, '/api/org-units');
    if (response.status === 401) return summary;
    if (response.status === 403) throw data(null, { status: 403 });
    if (!response.ok) throw new Error(`机构数读取失败：HTTP ${response.status}`);
    const body = (await response.json()) as { orgUnits?: unknown };
    summary.orgUnits = Array.isArray(body.orgUnits) ? body.orgUnits.length : null;
  }
  if (opcodes.includes('personnel.profile.read')) {
    const response = await apiFetch(dispatch, '/api/admin/personnel');
    if (response.status === 401) return summary;
    if (response.status === 403) throw data(null, { status: 403 });
    if (!response.ok) throw new Error(`人员数读取失败：HTTP ${response.status}`);
    const body = (await response.json()) as { personnel?: PersonnelRow[] };
    const rows = Array.isArray(body.personnel) ? body.personnel : null;
    summary.personnel = rows ? rows.filter((row) => !row.deactivatedAt).length : null;
    // 执法证的数字来自同一次名单读取：名单交出证件情况，不交出证号（#105:231）。
    summary.certifiedPersonnel = rows ? qualifiedPersonnelCount(rows) : null;
    summary.certAttention = rows ? certAttentionOf(rows) : null;
  }
  if (opcodes.includes('personnel.locked.read')) {
    const response = await apiFetch(dispatch, '/api/admin/locked-personnel');
    if (response.status === 401) return summary;
    if (response.status === 403) throw data(null, { status: 403 });
    if (!response.ok) throw new Error(`被锁人员数读取失败：HTTP ${response.status}`);
    const body = (await response.json()) as { personnel?: unknown };
    summary.lockedPersonnel = Array.isArray(body.personnel) ? body.personnel.length : null;
  }
  if (opcodes.includes('audit.admin.read')) {
    // 只给条数、不交出行，服务端不写 audit.viewed（#126）
    const response = await apiFetch(dispatch, '/api/admin/audit/summary');
    if (response.status === 401) return summary;
    if (response.status === 403) throw data(null, { status: 403 });
    if (!response.ok) throw new Error(`今日留痕条数读取失败：HTTP ${response.status}`);
    const body = (await response.json()) as { today?: unknown };
    summary.auditToday = typeof body.today === 'number' ? body.today : null;
  }
  return summary;
}

/** loader 只取数，不做授权判断；数字异步到达，首屏先出骨架（P3 loading）。 */
export function adminHomeLoader(store: SessionStore) {
  return () => {
    const summary = sessionOpcodes(store).then((opcodes) => loadAdminHomeSummary(store.dispatch, opcodes));
    // 失败由页面的 Await 接住显示；先挂空处理，免得渲染前落定的拒绝被当成未处理。
    summary.catch(() => undefined);
    return { summary };
  };
}
