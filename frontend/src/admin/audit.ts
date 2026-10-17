// 管理台留痕（P8，#126）的数据与文案。查阅与导出都走服务端 POST 接口（服务端每次都写留痕）；
// 显示文字由服务端生成，页面与导出文件逐格同源。筛选条件放在地址栏查询串里，loader 按查询串取数。

import { data, type LoaderFunctionArgs } from 'react-router';

import { apiFetch, type ApiDispatch } from '../api';
import { sessionOpcodes, type SessionStore } from '../session';

export const AUDIT_READ = 'audit.admin.read';
export const AUDIT_EXPORT = 'audit.admin.export';

/** 与服务端 @natural-enforcement/audit 的 AUDIT_CATEGORIES 同值。 */
export type AuditCategory =
  | 'auth-session'
  | 'personnel-view'
  | 'personnel-maintenance'
  | 'org-maintenance'
  | 'unlock-reset'
  | 'cert'
  | 'export';
export type AuditOutcome = 'succeeded' | 'failed';

/** 操作类别下拉（原型 v0.4 CATS 顺序）。空值即「全部操作」。 */
export const CATEGORY_OPTIONS: ReadonlyArray<{ value: AuditCategory | ''; label: string }> = [
  { value: '', label: '全部操作' },
  { value: 'auth-session', label: '认证与会话' },
  { value: 'personnel-view', label: '人员查阅' },
  { value: 'personnel-maintenance', label: '人员维护' },
  { value: 'org-maintenance', label: '机构维护' },
  { value: 'unlock-reset', label: '解锁与重设口令' },
  { value: 'cert', label: '执法证' },
  { value: 'export', label: '导出' },
];

/** 列表标题右侧的类别说明（原型 login、view 两态，逐字）。 */
export const CATEGORY_HINTS: Partial<Record<AuditCategory, string>> = {
  'auth-session': '操作类别：认证与会话（含登录的成功与失败、被锁定、结束会话）',
  'personnel-view': '操作类别：人员查阅（打开人员详情）',
};

export const OUTCOME_OPTIONS: ReadonlyArray<{ value: AuditOutcome | ''; label: string }> = [
  { value: '', label: '结果：全部' },
  { value: 'succeeded', label: '结果：成功' },
  { value: 'failed', label: '结果：失败或被拒绝' },
];

/** 筛选不合规时的说明，按服务端规则码。 */
export const RULE_MESSAGES: Readonly<Record<string, string>> = {
  'invalid-filter':
    '筛选条件填写不对：时间范围请按「2026-10-16 至 2026-10-17」的样子填写，起日不晚于止日；操作人工号不超过 64 个字。',
};

export interface AuditFilter {
  from: string;
  to: string;
  category: AuditCategory | null;
  actorCode: string | null;
  outcome: AuditOutcome | null;
}

/** 服务端给出的一行（显示文字已排好）。 */
export interface AuditRow {
  id: string;
  action: string;
  time: string;
  actorCode: string;
  operation: string;
  object: string;
  /** 没有所属机构时为「无所属机构」，anchored 为 false */
  orgName: string;
  anchored: boolean;
  result: string;
  tone: 'ok' | 'gray' | 'red';
}

export interface AuditScope {
  orgUnitId: string;
  orgName: string;
  /** 范围根是根机构，含没有所属机构的行 */
  includesUnanchored: boolean;
}

export type AuditListResult =
  | { kind: 'listed'; scope: AuditScope; total: number; rows: AuditRow[] }
  | { kind: 'non-compliant'; rules: string[] }
  /** 会话清单里没有查阅码：不调接口，页面显示无权限卡片 */
  | { kind: 'no-permission' }
  | { kind: 'ended' };

export interface AuditLoaderData {
  filter: AuditFilter;
  list: Promise<AuditListResult>;
}

/** 某时刻在北京时间的日历日。 */
export function shanghaiDate(at: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

/** 默认时间范围：昨天至今天（北京时间），与服务端默认一致。 */
export function defaultRange(now: number = Date.now()): { from: string; to: string } {
  return { from: shanghaiDate(now - 24 * 60 * 60 * 1000), to: shanghaiDate(now) };
}

export function rangeText(filter: Pick<AuditFilter, 'from' | 'to'>): string {
  return filter.to === UNPARSED ? filter.from : `${filter.from} 至 ${filter.to}`;
}

const RANGE = /^\s*(\S+)\s*至\s*(\S+)\s*$/;
/** 时间范围拆不开时的止日占位：不是日期，服务端一定判不合规（空串会被当成默认的今天）。 */
const UNPARSED = '?';

function oneOf<T extends string>(value: string | null, allowed: ReadonlyArray<{ value: T | '' }>): T | null {
  if (!value) return null;
  return (allowed.find((option) => option.value === value)?.value || null) as T | null;
}

/**
 * 地址栏查询串 → 筛选条件。时间范围的格式交服务端校验，这里只拆开两端；
 * 拆不开时原样作起日、止日放占位，服务端判不合规。类别与结果只认下拉里的值。
 */
export function filterFromSearch(search: URLSearchParams, now: number = Date.now()): AuditFilter {
  const range = search.get('range');
  let { from, to } = defaultRange(now);
  if (range !== null && range.trim() !== '') {
    const matched = RANGE.exec(range);
    from = matched ? matched[1]! : range.trim();
    to = matched ? matched[2]! : UNPARSED;
  }
  return {
    from,
    to,
    category: oneOf(search.get('category'), CATEGORY_OPTIONS),
    actorCode: search.get('actor')?.trim() || null,
    outcome: oneOf(search.get('outcome'), OUTCOME_OPTIONS),
  };
}

/** 导出文件名（与服务端同规则），用于确认框；下载时以响应头为准。 */
export function exportFilename(filter: Pick<AuditFilter, 'from' | 'to'>): string {
  return `管理台留痕_${filter.from.replaceAll('-', '')}-${filter.to.replaceAll('-', '')}.xlsx`;
}

/** 确认框里「筛选」一栏的文字。 */
export function filterSummary(filter: AuditFilter): string {
  const parts = [CATEGORY_OPTIONS.find((option) => option.value === (filter.category ?? ''))?.label ?? '全部操作'];
  if (filter.actorCode) parts.push(`操作人工号 ${filter.actorCode}`);
  if (filter.outcome) parts.push(OUTCOME_OPTIONS.find((option) => option.value === filter.outcome)?.label ?? '');
  return parts.join('；');
}

function requestBody(filter: AuditFilter): string {
  return JSON.stringify({
    from: filter.from,
    to: filter.to,
    category: filter.category,
    actorCode: filter.actorCode,
    outcome: filter.outcome,
  });
}

function post(dispatch: ApiDispatch, path: string, body: string): Promise<Response> {
  return apiFetch(dispatch, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

async function rulesOf(response: Response): Promise<string[]> {
  const body = (await response.json().catch(() => ({}))) as { rules?: unknown };
  return Array.isArray(body.rules) ? body.rules.map(String) : [];
}

/** 查阅。服务端每查一次写一行 audit.viewed。403 交给壳内无权限页；401 交给会话已结束页。 */
export async function loadAuditList(dispatch: ApiDispatch, filter: AuditFilter): Promise<AuditListResult> {
  const response = await post(dispatch, '/api/admin/audit/query', requestBody(filter));
  if (response.status === 401) return { kind: 'ended' };
  if (response.status === 403) throw data(null, { status: 403 });
  if (response.status === 400) return { kind: 'non-compliant', rules: await rulesOf(response) };
  if (!response.ok) throw new Error(`留痕读取失败：HTTP ${response.status}`);
  const body = (await response.json()) as { scope: AuditScope; total: number; rows: AuditRow[] };
  return { kind: 'listed', scope: body.scope, total: body.total, rows: body.rows };
}

export type AuditExportResult =
  | { kind: 'exported'; count: number; filename: string; file: Blob }
  | { kind: 'non-compliant'; rules: string[] }
  | { kind: 'denied' }
  | { kind: 'ended' }
  | { kind: 'failed' };

/** 从 content-disposition 取 UTF-8 文件名；取不到时用按规则拼出的名字。 */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  const matched = header ? /filename\*=UTF-8''([^;]+)/i.exec(header) : null;
  if (!matched) return fallback;
  try {
    return decodeURIComponent(matched[1]!);
  } catch {
    return fallback;
  }
}

/** 导出。服务端写一行 audit.exported（带条数），返回表格文件。 */
export async function exportAudit(dispatch: ApiDispatch, filter: AuditFilter): Promise<AuditExportResult> {
  let response: Response;
  try {
    response = await post(dispatch, '/api/admin/audit/export', requestBody(filter));
  } catch {
    return { kind: 'failed' };
  }
  if (response.status === 401) return { kind: 'ended' };
  if (response.status === 403) return { kind: 'denied' };
  if (response.status === 400) return { kind: 'non-compliant', rules: await rulesOf(response) };
  if (!response.ok) return { kind: 'failed' };
  let file: Blob;
  try {
    file = await response.blob();
  } catch {
    // 响应头到了、文件内容传到一半断开
    return { kind: 'failed' };
  }
  const counted = Number(response.headers.get('x-item-count'));
  return {
    kind: 'exported',
    count: Number.isInteger(counted) && counted >= 0 ? counted : 0,
    filename: filenameFromDisposition(response.headers.get('content-disposition'), exportFilename(filter)),
    file,
  };
}

/**
 * loader 只取数，不做授权判断；列表异步到达，首屏先出骨架（P8 loading）。
 * 会话清单没有查阅码时不调接口（免得每次打开都多一行 authz.denied），由页面显示无权限卡片。
 */
export function auditLoader(store: SessionStore) {
  return ({ request }: LoaderFunctionArgs): AuditLoaderData => {
    const filter = filterFromSearch(new URL(request.url).searchParams);
    const list = sessionOpcodes(store).then((opcodes): Promise<AuditListResult> | AuditListResult => (
      opcodes.includes(AUDIT_READ) ? loadAuditList(store.dispatch, filter) : { kind: 'no-permission' }
    ));
    // 失败由页面的 Await 接住显示；先挂空处理，免得渲染前落定的拒绝被当成未处理。
    list.catch(() => undefined);
    return { filter, list };
  };
}
