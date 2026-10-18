// 管理台人员（P5 列表、P6 卡片与新建，#128；编辑与调岗，#129；执法证登记与「需要留意的执法证」统计，#133）的数据与纯函数。
// 列表放在 GET /api/admin/personnel，不含手机号和执法证号；卡片 GET /api/admin/personnel/:id 每次打开都留痕；
// 登记 POST /api/admin/personnel；编辑 POST /api/admin/personnel/:id/edit；调岗 POST /api/admin/personnel/:id/transfer；
// 调岗目的地 GET /api/admin/personnel/:id/transfer-destinations（全树未停用机构，不限数据范围）；
// 执法证登记 POST /api/admin/personnel/:id/cert。
// 是否有权由服务端决定，前端按会话清单只决定显示什么。

import { data } from 'react-router';

import { apiFetch, type ApiDispatch } from '../api';
import { PASSWORD_RULE_TEXT } from '../login/loginSlice';
import { sessionOpcodes, type SessionStore } from '../session';
import type { OrgTreeData, OrgUnit } from './orgTree';

export const PERSONNEL_READ = 'personnel.profile.read';
export const PERSONNEL_REGISTER = 'personnel.profile.register';
/** 执法证登记（#133）：只给系统管理。 */
export const PERSONNEL_CERT_UPDATE = 'personnel.cert.update';
export const PERSONNEL_UPDATE = 'personnel.profile.update';
/** 停用、恢复、结束全部会话（#130）：三个码都只给系统管理。 */
export const PERSONNEL_DEACTIVATE = 'personnel.profile.deactivate';
export const PERSONNEL_RESTORE = 'personnel.profile.restore';
export const PERSONNEL_SESSIONS_END = 'personnel.sessions.end';
export const AUDIT_READ = 'audit.admin.read';

/** 七个角色（ADR 0009），按原型 P6 的顺序。 */
export const ROLES = ['内勤', '经办', '法制审核', '行政审核', '行政审批', '监督', '系统管理'] as const;

/** 岗位标记（#105 A1）：取值固定两项，代码常量。不是角色，不授予任何操作码。 */
export const POSTS = ['legal-review-lead', 'legal-affairs-leader'] as const;
export type PersonnelPost = (typeof POSTS)[number];
export const POST_LABEL: Record<PersonnelPost, string> = {
  'legal-review-lead': '法制审核负责人',
  'legal-affairs-leader': '分管法制的局领导',
};

/**
 * 执法证情况（#133）。none 未登记；valid 有效；expiring 30 天内到期；expired 已过期；invalid 证件状态为「失效」。
 * 库里只存「有效」「失效」两项，临期与已过期按有效期推导（服务端算好后交下来）。
 */
export type CertStatus = 'none' | 'valid' | 'expiring' | 'expired' | 'invalid';
export const CERT_TAG: Record<CertStatus, { label: string; tone: string }> = {
  valid: { label: '有效', tone: '' },
  none: { label: '未登记', tone: 'gray' },
  expiring: { label: '30 天内到期', tone: 'amber' },
  expired: { label: '已过期', tone: 'red' },
  invalid: { label: '失效', tone: 'red' },
};

/** 卡片「证件状态」一行（#133）：只写「有效」「失效」，未登记时写破折号（原型 P6:15）。 */
export function certRecordLabel(status: CertStatus): string {
  if (status === 'none') return '—';
  return status === 'invalid' ? '失效' : '有效';
}

export interface PersonnelRow {
  id: string;
  code: string;
  name: string;
  orgUnitId: string | null;
  orgName: string | null;
  roles: string[];
  certStatus: CertStatus;
  deactivatedAt: string | null;
}

export interface ScopeOrgUnit {
  id: string;
  name: string;
  parentId: string | null;
  deactivatedAt: string | null;
}

export interface PersonnelList {
  /** 操作者当前任职机构（数据范围的根） */
  rootId: string;
  orgUnits: ScopeOrgUnit[];
  personnel: PersonnelRow[];
}

export interface PersonnelCard {
  id: string;
  code: string;
  name: string;
  mobilePhone: string | null;
  orgUnitId: string | null;
  orgName: string | null;
  /** 当前机构的上级名；本机构是根机构、上级是根机构或没有当前任职时为 null */
  orgParentName: string | null;
  /** 当前任职机构已停用（#130）：恢复时必须同时选一个新的任职机构（原型 P6-restoreNewOrg）。 */
  orgDeactivated: boolean;
  roles: string[];
  posts: PersonnelPost[];
  passwordChangedAt: string | null;
  deactivatedAt: string | null;
  cert: { no: string | null; expiresOn: string | null; status: CertStatus };
}

// ---------- 列表筛选 ----------

export type CertFilter = 'all' | 'attention' | CertStatus;
export const CERT_FILTER_LABEL: Record<CertFilter, string> = {
  all: '执法证：全部',
  attention: '需处理（过期、失效、未登记、临期）',
  valid: '有效',
  expiring: '30 天内到期',
  expired: '已过期',
  invalid: '失效',
  none: '未登记',
};
export const CERT_FILTERS: readonly CertFilter[] = ['all', 'attention', 'valid', 'expiring', 'expired', 'invalid', 'none'];

export interface PersonnelFilter {
  keyword: string;
  /** '' = 全部机构（含下级） */
  orgUnitId: string;
  /** '' = 全部角色 */
  role: string;
  cert: CertFilter;
  includeDeactivated: boolean;
}

export const DEFAULT_FILTER: PersonnelFilter = { keyword: '', orgUnitId: '', role: '', cert: 'all', includeDeactivated: true };

/** 筛选写在地址栏里：q、org、role、cert、off=0。 */
export function filterFromSearch(search: URLSearchParams): PersonnelFilter {
  const cert = search.get('cert') ?? 'all';
  return {
    keyword: search.get('q') ?? '',
    orgUnitId: search.get('org') ?? '',
    role: search.get('role') ?? '',
    cert: (CERT_FILTERS as readonly string[]).includes(cert) ? cert as CertFilter : 'all',
    includeDeactivated: search.get('off') !== '0',
  };
}

export function searchFromFilter(filter: PersonnelFilter): URLSearchParams {
  const search = new URLSearchParams();
  if (filter.keyword) search.set('q', filter.keyword);
  if (filter.orgUnitId) search.set('org', filter.orgUnitId);
  if (filter.role) search.set('role', filter.role);
  if (filter.cert !== 'all') search.set('cert', filter.cert);
  if (!filter.includeDeactivated) search.set('off', '0');
  return search;
}

export function isFiltered(filter: PersonnelFilter): boolean {
  return searchFromFilter(filter).toString() !== '';
}

// ---------- 分页（原型 P5:37「第 1 页」） ----------

/** 每页人数（工程定）。名单接口一次返回全部，分页与筛选都在前端做。 */
export const PAGE_SIZE = 20;

/** 页码写在地址栏 page=N（从 1 起）；改筛选时回到第 1 页。 */
export function pageFromSearch(search: URLSearchParams): number {
  const page = Number(search.get('page') ?? '1');
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

export function searchWithPage(search: URLSearchParams, page: number): URLSearchParams {
  const next = new URLSearchParams(search);
  if (page <= 1) next.delete('page');
  else next.set('page', String(page));
  return next;
}

/** 取第 page 页；页码超出时落到最后一页。 */
export function paginate<T>(rows: readonly T[], page: number): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), page: current, pages };
}

/** 名单头部的提示：有机构、角色、证件筛选时写筛选（多页时另加页码），否则写已停用人数与页码。 */
export function listHint(filterText: string | null, off: number, page: number, pages: number): string {
  const pageText = `第 ${page} 页`;
  if (filterText) return pages > 1 ? `${filterText} · ${pageText}` : filterText;
  return [off > 0 ? `其中 ${off} 人已停用` : null, pageText].filter(Boolean).join(' · ');
}

/** 机构及其全部下级的 id。 */
export function subtreeIds(units: readonly ScopeOrgUnit[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const unit of units) {
      if (unit.parentId && ids.has(unit.parentId) && !ids.has(unit.id)) {
        ids.add(unit.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** 「需处理」= 已过期、失效、未登记、临期（顺序同筛选项文案，原型 P5:27）。 */
const NEEDS_ATTENTION: readonly CertStatus[] = ['expired', 'invalid', 'none', 'expiring'];

/** 首页「需要留意的执法证」统计（#133，原型 P3:29）：临期、已过期、失效、未登记四行。 */
export const CERT_ATTENTION_ROWS = ['expiring', 'expired', 'invalid', 'none'] as const;
export type CertAttentionKey = (typeof CERT_ATTENTION_ROWS)[number];
export const CERT_ATTENTION_LABEL: Record<CertAttentionKey, string> = {
  expiring: '30 天内到期',
  expired: '已过期',
  invalid: '失效',
  none: '未登记',
};

/** 按人员行统计四种需要留意的情况。已停用的人不计。 */
export function certAttentionOf(rows: readonly PersonnelRow[]): Record<CertAttentionKey, number> {
  const counts: Record<CertAttentionKey, number> = { expiring: 0, expired: 0, invalid: 0, none: 0 };
  for (const row of rows) {
    if (row.deactivatedAt) continue;
    if (row.certStatus in counts) counts[row.certStatus as CertAttentionKey] += 1;
  }
  return counts;
}

/** 有执法资格的人数（#133）：情况为有效或临期，即证件状态是「有效」且还在有效期内。 */
export function qualifiedPersonnelCount(rows: readonly PersonnelRow[]): number {
  return rows.filter((row) => !row.deactivatedAt && (row.certStatus === 'valid' || row.certStatus === 'expiring')).length;
}

export function filterPersonnel(list: PersonnelList, filter: PersonnelFilter): PersonnelRow[] {
  const keyword = filter.keyword.trim().toLowerCase();
  const orgIds = filter.orgUnitId ? subtreeIds(list.orgUnits, filter.orgUnitId) : null;
  return list.personnel.filter((row) => {
    if (!filter.includeDeactivated && row.deactivatedAt) return false;
    if (keyword && !row.code.toLowerCase().includes(keyword) && !row.name.toLowerCase().includes(keyword)) return false;
    if (orgIds && !(row.orgUnitId && orgIds.has(row.orgUnitId))) return false;
    if (filter.role && !row.roles.includes(filter.role)) return false;
    if (filter.cert === 'attention' && !NEEDS_ATTENTION.includes(row.certStatus)) return false;
    if (filter.cert !== 'all' && filter.cert !== 'attention' && row.certStatus !== filter.cert) return false;
    return true;
  });
}

/** 「筛选：龙洞自然资源所 · 经办 · 执法证需处理」；没有机构、角色、证件筛选时为 null。 */
export function filterHint(list: PersonnelList, filter: PersonnelFilter): string | null {
  const parts: string[] = [];
  if (filter.orgUnitId) parts.push(list.orgUnits.find((unit) => unit.id === filter.orgUnitId)?.name ?? '所选机构');
  if (filter.role) parts.push(filter.role);
  if (filter.cert === 'attention') parts.push('执法证需处理');
  else if (filter.cert !== 'all') parts.push(`执法证${CERT_FILTER_LABEL[filter.cert]}`);
  return parts.length > 0 ? `筛选：${parts.join(' · ')}` : null;
}

/** 机构按树的先序排列（筛选下拉、登记时选机构）。 */
export function orgUnitsInTreeOrder<T extends { id: string; parentId: string | null }>(units: readonly T[], rootId: string): T[] {
  const byParent = new Map<string, T[]>();
  for (const unit of units) {
    if (!unit.parentId) continue;
    byParent.set(unit.parentId, [...(byParent.get(unit.parentId) ?? []), unit]);
  }
  const root = units.find((unit) => unit.id === rootId);
  if (!root) return [];
  const out: T[] = [];
  const walk = (unit: T) => {
    out.push(unit);
    for (const child of byParent.get(unit.id) ?? []) walk(child);
  };
  walk(root);
  return out;
}

// ---------- 卡片 ----------

/** 手机号默认遮挡中间四位：138****5521。 */
export function maskPhone(phone: string | null): string {
  if (!phone) return '—';
  if (phone.length < 8) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

const DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const DAY_MS = 24 * 60 * 60 * 1000;

/** 北京时间的日期（YYYY-MM-DD）。 */
export function shanghaiDay(at: Date): string {
  return DATE.format(at);
}

/**
 * 「当前机构」带上级名，原型 P6:30「天河区分局石牌自然资源所」；上级是根机构时只写本名（原型 P6:69「天河区分局」）。
 * 机构已停用时补「（已停用）」（原型 P6-restoreNewOrg「五山自然资源所（已停用）」）。
 */
export function orgText(card: Pick<PersonnelCard, 'orgName' | 'orgParentName'> & { orgDeactivated?: boolean }): string {
  if (!card.orgName) return '—';
  return `${card.orgParentName ?? ''}${card.orgName}${card.orgDeactivated ? '（已停用）' : ''}`;
}

export function passwordText(card: PersonnelCard): string {
  if (card.deactivatedAt) return '—';
  if (!card.passwordChangedAt) return '尚未改过初始口令';
  return `已改过初始口令（${shanghaiDay(new Date(card.passwordChangedAt))}）`;
}

/** 执法证一段的说明句，文案取自原型 P6。「失效」不在 v0.4（#105「后续」），文案按同一段口径写。 */
export function certNote(cert: PersonnelCard['cert'], now: Date): { tone: string; text: string } {
  if (cert.status === 'none' || !cert.expiresOn) {
    return { tone: 'amber', text: '尚未登记执法证。可以登录和查看材料，但不能启动核查、不能立案、不能担任主办人或协办人。' };
  }
  if (cert.status === 'invalid') {
    return {
      tone: 'danger',
      text: '证件状态为失效。可以登录和查看材料，但不能启动核查、不能立案、不能担任主办人或协办人。核对证件后请改回有效，或登记换发的新证。',
    };
  }
  if (cert.status === 'expired') {
    return {
      tone: 'danger',
      text: `已于 ${cert.expiresOn} 过期。可以登录和查看材料，但不能启动核查、不能立案、不能担任主办人或协办人。换发后请登记新证。`,
    };
  }
  if (cert.status === 'expiring') {
    const days = Math.round((Date.parse(`${cert.expiresOn}T00:00:00Z`) - Date.parse(`${shanghaiDay(now)}T00:00:00Z`)) / DAY_MS);
    return { tone: 'amber', text: `还有 ${days} 天到期。到期后将不能启动核查、立案，请提醒本人按期换发。` };
  }
  return { tone: 'gray', text: '可以启动核查、立案，可以担任主办人或协办人。' };
}

// ---------- 登记 ----------

export interface RegisterInput {
  code: string;
  name: string;
  orgUnitId: string;
  mobilePhone: string;
  initialPassword: string;
  roles: string[];
  posts: PersonnelPost[];
  /** 执法证号、有效期至（YYYY-MM-DD），可留空（原型 P6:51） */
  certNo: string;
  certExpiresOn: string;
}

export type RegisterField =
  | 'code' | 'name' | 'orgUnitId' | 'mobilePhone' | 'initialPassword' | 'roles' | 'posts' | 'certNo' | 'certExpiresOn';

/** 字段规则码 → 字段与提示。口令策略的规则码另在右侧「初始口令要求」里标红。 */
export const FIELD_RULES: Record<string, { field: RegisterField; text: string }> = {
  'personnel-code-required': { field: 'code', text: '请填写工号' },
  'personnel-code-too-long': { field: 'code', text: '工号不能超过 32 个字符' },
  'personnel-name-required': { field: 'name', text: '请填写姓名' },
  'personnel-name-too-long': { field: 'name', text: '姓名不能超过 100 个字' },
  'org-unit-required': { field: 'orgUnitId', text: '请选择任职机构' },
  'mobile-phone-required': { field: 'mobilePhone', text: '请填写手机号' },
  'mobile-phone-invalid': { field: 'mobilePhone', text: '手机号应为以 1 开头的 11 位数字' },
  'password-required': { field: 'initialPassword', text: '请填写初始口令' },
  'roles-required': { field: 'roles', text: '请至少选一个角色' },
  'role-unknown': { field: 'roles', text: '所选角色不在可选范围内，请刷新页面后重选' },
  'post-unknown': { field: 'posts', text: '所选岗位标记不在可选范围内，请刷新页面后重选' },
  'cert-no-required': { field: 'certNo', text: '填了有效期，请同时填写执法证号' },
  'cert-no-too-long': { field: 'certNo', text: '执法证号不能超过 64 个字符' },
  'cert-expires-on-required': { field: 'certExpiresOn', text: '填了执法证号，请同时填写有效期' },
  'cert-expires-on-invalid': { field: 'certExpiresOn', text: '请按「年-月-日」填写有效的日期，如 2027-06-30' },
};

/** 右侧「初始口令要求」七条，顺序与文案同改口令页。 */
export const PASSWORD_RULES = ['too-short', 'too-long', 'insufficient-classes', 'sequential', 'repeated', 'common', 'contains-code'] as const;
export const PASSWORD_RULE_LABEL: Record<string, string> = PASSWORD_RULE_TEXT;

export const DUPLICATE_TEXT: Record<'personnel-code' | 'mobile-phone', { field: RegisterField; text: string }> = {
  'mobile-phone': { field: 'mobilePhone', text: '这个手机号已被其他人员使用，请核对' },
  'personnel-code': { field: 'code', text: '这个工号已被其他人员使用，请核对' },
};

export type RegisterResult =
  | { ok: true; id: string; name: string }
  | {
    ok: false;
    /** 字段 → 提示 */
    fields: Partial<Record<RegisterField, string>>;
    /** 没满足的口令策略规则码 */
    passwordRules: string[];
    /** 整页提示（越权、网络失败等）；null = 只有字段提示 */
    message: string | null;
  };

/** 网络或服务失败：定稿句（原型 assets/shell.js:62，同 #123 orgTree.ts）。 */
const FAILED = '网络或服务暂时不可用，请稍后重试。问题持续时请联系本单位的系统管理人员。';

/** 「还有 3 处需要修改」按字段计；口令策略未满足算口令一处。 */
export function problemCount(result: Extract<RegisterResult, { ok: false }>): number {
  const fields = new Set(Object.keys(result.fields));
  if (result.passwordRules.length > 0) fields.add('initialPassword');
  return fields.size;
}

export async function registerPersonnel(dispatch: ApiDispatch, input: RegisterInput): Promise<RegisterResult> {
  let response: Response;
  try {
    response = await apiFetch(dispatch, '/api/admin/personnel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, fields: {}, passwordRules: [], message: FAILED };
  }
  if (response.status === 401) return { ok: false, fields: {}, passwordRules: [], message: null };
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) {
    const personnel = (json.personnel ?? {}) as { id?: string; name?: string };
    return { ok: true, id: String(personnel.id ?? ''), name: String(personnel.name ?? input.name) };
  }
  if (response.status === 400 && Array.isArray(json.rules)) {
    const fields: Partial<Record<RegisterField, string>> = {};
    const passwordRules: string[] = [];
    for (const rule of json.rules as string[]) {
      const known = FIELD_RULES[rule];
      if (known) fields[known.field] ??= known.text;
      else if (rule in PASSWORD_RULE_LABEL) passwordRules.push(rule);
    }
    return { ok: false, fields, passwordRules, message: null };
  }
  if (response.status === 409 && json.result === 'already-exists') {
    const duplicate = DUPLICATE_TEXT[json.conflict === 'mobile-phone' ? 'mobile-phone' : 'personnel-code'];
    return { ok: false, fields: { [duplicate.field]: duplicate.text }, passwordRules: [], message: null };
  }
  if (response.status === 409) {
    return { ok: false, fields: { orgUnitId: '所选机构已停用，请选择在用的机构' }, passwordRules: [], message: null };
  }
  if (response.status === 403) {
    return { ok: false, fields: {}, passwordRules: [], message: '你没有权限执行这个操作，或所选机构不在你的范围内。' };
  }
  return { ok: false, fields: {}, passwordRules: [], message: FAILED };
}

// ---------- 执法证登记（#133） ----------

/** 证件状态只有两项（Lei Hu 7-3）。临期与已过期不入库，按有效期推导。 */
export const CERT_RECORD_STATUSES = ['valid', 'invalid'] as const;
export type CertRecordStatus = (typeof CERT_RECORD_STATUSES)[number];
export const CERT_RECORD_STATUS_LABEL: Record<CertRecordStatus, string> = { valid: '有效', invalid: '失效' };

export interface CertUpdateInput {
  certNo: string;
  /** 有效期至（YYYY-MM-DD） */
  certExpiresOn: string;
  certStatus: CertRecordStatus;
}

export type CertUpdateField = 'certNo' | 'certExpiresOn' | 'certStatus';

/**
 * 打开执法证表单时的初值：照卡片上的当前值起表（原型 P6:21 的表单带当前值）。
 * 未登记时证号和有效期为空，证件状态默认「有效」。
 */
export function certEditFrom(card: Pick<PersonnelCard, 'cert'>): CertUpdateInput {
  return {
    certNo: card.cert.no?.trim() ?? '',
    certExpiresOn: card.cert.expiresOn ?? '',
    certStatus: card.cert.status === 'invalid' ? 'invalid' : 'valid',
  };
}

/** 执法证表单的规则码 → 字段与提示。三项都必填，文案与新建人员页的「可留空」不同。 */
export const CERT_FIELD_RULES: Record<string, { field: CertUpdateField; text: string }> = {
  'cert-no-required': { field: 'certNo', text: '请填写执法证号' },
  'cert-no-too-long': { field: 'certNo', text: '执法证号不能超过 64 个字符' },
  'cert-expires-on-required': { field: 'certExpiresOn', text: '请填写有效期至' },
  'cert-expires-on-invalid': { field: 'certExpiresOn', text: '请按「年-月-日」填写有效的日期，如 2027-06-30' },
  'cert-status-unknown': { field: 'certStatus', text: '请选择证件状态：有效或失效' },
};

export type CertUpdateResult =
  | { ok: true }
  | { ok: false; fields: Partial<Record<CertUpdateField, string>>; message: string | null };

/** 「还有 N 处需要修改」按字段计（原型 P6:45 的口径）。 */
export function certProblemCount(result: Extract<CertUpdateResult, { ok: false }>): number {
  return new Set(Object.keys(result.fields)).size;
}

/**
 * 登记执法证（POST /api/admin/personnel/:id/cert）。
 * 返回体不回显证号；保存成功后由调用方重取卡片。401 交给会话已结束页处理，这里只回空提示。
 */
export async function updateCert(
  dispatch: ApiDispatch,
  personnelId: string,
  input: CertUpdateInput,
): Promise<CertUpdateResult> {
  let response: Response;
  try {
    response = await apiFetch(dispatch, `/api/admin/personnel/${encodeURIComponent(personnelId)}/cert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, fields: {}, message: FAILED };
  }
  if (response.status === 401) return { ok: false, fields: {}, message: null };
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return { ok: true };
  if (response.status === 400 && Array.isArray(json.rules)) {
    const fields: Partial<Record<CertUpdateField, string>> = {};
    for (const rule of json.rules as string[]) {
      const known = CERT_FIELD_RULES[rule];
      if (known) fields[known.field] ??= known.text;
    }
    return { ok: false, fields, message: null };
  }
  if (response.status === 404) {
    return { ok: false, fields: {}, message: '没有找到这个人员。请回到人员名单重新进入。' };
  }
  if (response.status === 403) {
    return { ok: false, fields: {}, message: DENIED_TARGET };
  }
  return { ok: false, fields: {}, message: FAILED };
}

// ---------- 编辑（#129，P6 edit / selfEdit） ----------

export interface EditInput {
  name: string;
  mobilePhone: string;
  roles: string[];
  posts: PersonnelPost[];
}

export type EditField = 'name' | 'mobilePhone' | 'roles' | 'posts';

/** 编辑表单初值：取卡片当前态。工号与机构不可改，不在表单里。 */
export function editInputFromCard(card: PersonnelCard): EditInput {
  return { name: card.name, mobilePhone: card.mobilePhone ?? '', roles: [...card.roles], posts: [...card.posts] };
}

/** 越权或对象不在范围（编辑与调岗共用一句）。不露原因码。 */
export const DENIED_TARGET = '你没有权限执行这个操作，或这个人员不在你的范围内。';

export type EditResult =
  | { ok: true }
  | { ok: false; fields: Partial<Record<EditField, string>>; message: string | null };

const EDIT_FIELDS: readonly string[] = ['name', 'mobilePhone', 'roles', 'posts'];

export async function updatePersonnel(dispatch: ApiDispatch, id: string, input: EditInput): Promise<EditResult> {
  let response: Response;
  try {
    response = await apiFetch(dispatch, `/api/admin/personnel/${encodeURIComponent(id)}/edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, fields: {}, message: FAILED };
  }
  if (response.status === 401) return { ok: false, fields: {}, message: null };
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return { ok: true };
  if (response.status === 400 && Array.isArray(json.rules)) {
    const fields: Partial<Record<EditField, string>> = {};
    for (const rule of json.rules as string[]) {
      const known = FIELD_RULES[rule];
      if (known && EDIT_FIELDS.includes(known.field)) fields[known.field as EditField] ??= known.text;
    }
    return { ok: false, fields, message: null };
  }
  if (response.status === 409 && json.result === 'already-exists') {
    return { ok: false, fields: { mobilePhone: DUPLICATE_TEXT['mobile-phone'].text }, message: null };
  }
  // 409 invalid-state：根机构守卫等，服务端给一句可读原因，直接显示（不露原因码）。
  if (response.status === 409 && typeof json.message === 'string' && json.message !== '') {
    return { ok: false, fields: {}, message: json.message };
  }
  if (response.status === 403) return { ok: false, fields: {}, message: DENIED_TARGET };
  return { ok: false, fields: {}, message: FAILED };
}

// ---------- 调岗（#129，P6 transfer） ----------

export interface TransferDestination {
  id: string;
  name: string;
  parentId: string | null;
}

export type TransferResult =
  | { ok: true }
  | { ok: false; fields: { orgUnitId?: string }; message: string | null };

export async function transferPersonnel(dispatch: ApiDispatch, id: string, orgUnitId: string): Promise<TransferResult> {
  let response: Response;
  try {
    response = await apiFetch(dispatch, `/api/admin/personnel/${encodeURIComponent(id)}/transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgUnitId }),
    });
  } catch {
    return { ok: false, fields: {}, message: FAILED };
  }
  if (response.status === 401) return { ok: false, fields: {}, message: null };
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return { ok: true };
  if (response.status === 400) return { ok: false, fields: { orgUnitId: '请选择调入机构' }, message: null };
  if (response.status === 409 && typeof json.message === 'string' && json.message !== '') {
    return { ok: false, fields: {}, message: json.message };
  }
  if (response.status === 409) {
    return { ok: false, fields: { orgUnitId: '所选机构已停用，请选择在用的机构' }, message: null };
  }
  if (response.status === 403) return { ok: false, fields: {}, message: DENIED_TARGET };
  return { ok: false, fields: {}, message: FAILED };
}

/** 取调岗目的地：全树未停用的机构，按树的先序。失败为 null（弹窗里显示重试提示）。 */
export async function loadTransferDestinations(dispatch: ApiDispatch, id: string): Promise<TransferDestination[] | null> {
  let response: Response;
  try {
    response = await apiFetch(dispatch, `/api/admin/personnel/${encodeURIComponent(id)}/transfer-destinations`);
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body = (await response.json().catch(() => ({}))) as { orgUnits?: TransferDestination[] };
  const units = Array.isArray(body.orgUnits) ? body.orgUnits : [];
  return destinationsInTreeOrder(units);
}

/** 目的地按树的先序；根节点取没有上级的那一个。 */
export function destinationsInTreeOrder(units: readonly TransferDestination[]): TransferDestination[] {
  const root = units.find((unit) => unit.parentId === null || !units.some((other) => other.id === unit.parentId));
  if (!root) return [...units];
  return orgUnitsInTreeOrder(units, root.id);
}

// ---------- 停用、恢复、结束全部会话（#130，P6 危险操作区） ----------

/** 危险操作区三个动作的结果。message 是整页或弹窗里给人看的一句，不露操作码与原因码。 */
export type DangerResult = { ok: true } | { ok: false; message: string | null };

/** 409 与 403 的公共映射：服务端给的可读原因直接用，其余按定稿句兜底。 */
function dangerFailure(response: Response, json: Record<string, unknown>): DangerResult {
  if (response.status === 401) return { ok: false, message: null };
  if (response.status === 409 && typeof json.message === 'string' && json.message !== '') {
    return { ok: false, message: json.message };
  }
  if (response.status === 403) return { ok: false, message: DENIED_TARGET };
  return { ok: false, message: FAILED };
}

async function dangerPost(dispatch: ApiDispatch, path: string, body: unknown = {}): Promise<DangerResult> {
  let response: Response;
  try {
    response = await apiFetch(dispatch, path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: FAILED };
  }
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return { ok: true };
  return dangerFailure(response, json);
}

/** 停用：对方的全部会话在下一次操作时结束。重复停用同样成功。 */
export function deactivatePersonnel(dispatch: ApiDispatch, id: string): Promise<DangerResult> {
  return dangerPost(dispatch, `/api/admin/personnel/${encodeURIComponent(id)}/deactivate`);
}

/** 结束全部会话（含「记住我」），不改口令。 */
export function endPersonnelSessions(dispatch: ApiDispatch, id: string): Promise<DangerResult> {
  return dangerPost(dispatch, `/api/admin/personnel/${encodeURIComponent(id)}/end-sessions`);
}

export interface RestoreInput {
  initialPassword: string;
  /** 新任职机构。原任职机构已停用时必填。 */
  orgUnitId: string;
}

export type RestoreResult =
  | { ok: true; orgUnitId: string | null }
  | {
    ok: false;
    fields: Partial<Record<'initialPassword' | 'orgUnitId', string>>;
    /** 没满足的口令策略规则码 */
    passwordRules: string[];
    message: string | null;
  };

/**
 * 恢复：重设初始口令、解除锁定、结束残余会话和「记住我」由服务端在同一事务里做完。
 * 原任职机构已停用时必须同时带一个数据范围内在用的新任职机构，恢复与调岗一并完成。
 * 口令历史比对留给口令历史票（#132）。
 */
export async function restorePersonnel(dispatch: ApiDispatch, id: string, input: RestoreInput): Promise<RestoreResult> {
  let response: Response;
  try {
    response = await apiFetch(dispatch, `/api/admin/personnel/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, fields: {}, passwordRules: [], message: FAILED };
  }
  if (response.status === 401) return { ok: false, fields: {}, passwordRules: [], message: null };
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) {
    const orgUnitId = typeof json.orgUnitId === 'string' ? json.orgUnitId : null;
    return { ok: true, orgUnitId };
  }
  if (response.status === 400 && Array.isArray(json.rules)) {
    const fields: Partial<Record<'initialPassword', string>> = {};
    const passwordRules: string[] = [];
    for (const rule of json.rules as string[]) {
      if (rule === 'password-required') fields.initialPassword ??= FIELD_RULES['password-required'].text;
      else if (rule in PASSWORD_RULE_LABEL) passwordRules.push(rule);
    }
    return { ok: false, fields, passwordRules, message: null };
  }
  const failure = dangerFailure(response, json);
  if ('message' in failure) {
    return { ok: false, fields: {}, passwordRules: [], message: failure.message };
  }
  return { ok: false, fields: {}, passwordRules: [], message: FAILED };
}

/**
 * 恢复时选新任职机构：数据范围内在用的机构，按树的先序（原型 P6-restoreNewOrg）。
 * 与登记同源（/api/org-units 只回数据范围子树）；读取失败回 null，弹窗里提示关闭后重试，
 * 不像登记那样抛错——弹窗已打开，失败只影响弹窗内部。
 */
export async function loadRestoreOrgUnits(dispatch: ApiDispatch): Promise<OrgUnit[] | null> {
  try {
    return await loadRegisterOrgUnits(dispatch);
  } catch {
    return null;
  }
}

/** 结束全部会话成功后的结果横幅：文案取弹窗里的后果句（原型 P6-endsessions）。 */
export const SESSIONS_ENDED_NOTICE = '对方的全部会话和全部「记住我」，会在下一次操作时结束。';

// ---------- 取数 ----------

/** 取列表。403：重新拉会话（apiFetch）后显示无权限卡片；401 交给会话已结束页处理。 */
export async function loadPersonnelList(dispatch: ApiDispatch): Promise<PersonnelList | null> {
  const response = await apiFetch(dispatch, '/api/admin/personnel');
  if (response.status === 401) return null;
  if (response.status === 403) throw data(null, { status: 403 });
  if (!response.ok) throw new Error(`人员名单读取失败：HTTP ${response.status}`);
  const body = (await response.json()) as Partial<PersonnelList>;
  return {
    rootId: body.rootId ?? '',
    orgUnits: Array.isArray(body.orgUnits) ? body.orgUnits : [],
    personnel: Array.isArray(body.personnel) ? body.personnel : [],
  };
}

/** 取卡片（每次打开服务端都留痕）。404 交给「没有找到这个人员」。 */
export async function loadPersonnelCard(dispatch: ApiDispatch, id: string): Promise<PersonnelCard | null> {
  const response = await apiFetch(dispatch, `/api/admin/personnel/${encodeURIComponent(id)}`);
  if (response.status === 401) return null;
  if (response.status === 403) throw data(null, { status: 403 });
  if (response.status === 404) throw data(null, { status: 404 });
  if (!response.ok) throw new Error(`人员详情读取失败：HTTP ${response.status}`);
  return ((await response.json()) as { personnel: PersonnelCard }).personnel;
}

/** 登记页选机构：取机构树里未停用的节点，按树的先序。 */
export async function loadRegisterOrgUnits(dispatch: ApiDispatch): Promise<OrgUnit[] | null> {
  const response = await apiFetch(dispatch, '/api/org-units');
  if (response.status === 401) return null;
  if (response.status === 403) throw data(null, { status: 403 });
  if (!response.ok) throw new Error(`机构读取失败：HTTP ${response.status}`);
  const tree = (await response.json()) as OrgTreeData;
  const units = Array.isArray(tree.orgUnits) ? tree.orgUnits : [];
  return orgUnitsInTreeOrder(units.filter((unit) => !unit.deactivatedAt), tree.rootId);
}

/** loader 只取数，不做授权判断；没有对应码时不发请求，页面显示无权限卡片。 */
/**
 * 名单页的重验证：只改了查询参数（筛选）时不重取名单，筛选在前端完成。
 * 进入页面、提交写操作、显式刷新（地址不变的 revalidate）照常取数。
 */
export function shouldRevalidatePersonnelList({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: {
  currentUrl: URL;
  nextUrl: URL;
  formMethod?: string;
  defaultShouldRevalidate: boolean;
}): boolean {
  const onlySearchChanged = !formMethod
    && currentUrl.pathname === nextUrl.pathname
    && currentUrl.search !== nextUrl.search;
  return onlySearchChanged ? false : defaultShouldRevalidate;
}

export function personnelListLoader(store: SessionStore) {
  return () => {
    const list = sessionOpcodes(store).then((opcodes) =>
      (opcodes.includes(PERSONNEL_READ) ? loadPersonnelList(store.dispatch) : null));
    return { list };
  };
}

export function personnelCardLoader(store: SessionStore) {
  return ({ params }: { params: { id?: string } }) => {
    const id = params.id ?? '';
    const card = sessionOpcodes(store).then((opcodes) =>
      (opcodes.includes(PERSONNEL_READ) ? loadPersonnelCard(store.dispatch, id) : null));
    return { card };
  };
}

export function personnelCreateLoader(store: SessionStore) {
  return () => {
    const orgUnits = sessionOpcodes(store).then((opcodes) =>
      (opcodes.includes(PERSONNEL_REGISTER) && opcodes.includes('org.tree.read') ? loadRegisterOrgUnits(store.dispatch) : []));
    return { orgUnits };
  };
}
