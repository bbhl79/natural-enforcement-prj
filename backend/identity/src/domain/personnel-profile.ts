// 人员登记、列表与卡片（#105「人员与登录凭据」，#128）：操作码、岗位标记、登记规则、执法证情况。
// 执法证登记与执法资格判定（#105「执法证（#85）」，#133）：证件状态、登记规则、留痕前值、资格判定。

import { rejectedPasswordRules, type PasswordRuleCode } from './password-policy.ts';

export const PERSONNEL_PROFILE_READ_OPCODE = 'personnel.profile.read';
export const PERSONNEL_PROFILE_REGISTER_OPCODE = 'personnel.profile.register';
/** 执法证登记（#133）：只给系统管理。留痕动作词 cert.updated。 */
export const PERSONNEL_CERT_UPDATE_OPCODE = 'personnel.cert.update';

/**
 * 岗位标记（Lei Hu 2026-10-17 22:14，A1）。取值清单是代码常量，管理台不提供维护入口。
 * legal-review-lead 法制审核负责人；legal-affairs-leader 分管法制的局领导。
 * 岗位标记不是角色：不进允许行，不授予任何操作码，会话的操作码清单和授权都不读它。
 */
export const PERSONNEL_POSTS = ['legal-review-lead', 'legal-affairs-leader'] as const;
export type PersonnelPost = (typeof PERSONNEL_POSTS)[number];

export function isPersonnelPost(value: unknown): value is PersonnelPost {
  return typeof value === 'string' && (PERSONNEL_POSTS as readonly string[]).includes(value);
}

/** 工号、姓名的最长字数（工程定，#128）。 */
export const PERSONNEL_CODE_MAX_LENGTH = 32;
export const PERSONNEL_NAME_MAX_LENGTH = 100;

/** 执法证号最长字数（工程定，#128；证号格式由 #133 定稿前只限长度）。 */
export const CERT_NO_MAX_LENGTH = 64;

/** 手机号：11 位数字，以 1 开头（工程定，#128）。 */
const MOBILE_PHONE = /^1\d{10}$/;

/**
 * 登记校验失败的规则码（400 non-compliant，不写留痕）。口令策略的规则码另见 PasswordRuleCode。
 * 六项必填各有一个 *-required；口令为空只返回 password-required，不再列口令策略。
 */
export type PersonnelRuleCode =
  | 'personnel-code-required'
  | 'personnel-code-too-long'
  | 'personnel-name-required'
  | 'personnel-name-too-long'
  | 'org-unit-required'
  | 'mobile-phone-required'
  | 'mobile-phone-invalid'
  | 'password-required'
  | 'roles-required'
  | 'role-unknown'
  | 'post-unknown'
  | 'cert-no-required'
  | 'cert-no-too-long'
  | 'cert-expires-on-required'
  | 'cert-expires-on-invalid';

export type RegisterRuleCode = PersonnelRuleCode | PasswordRuleCode;

/** 登记输入（接口层已把非字符串取值换成空串或空数组）。 */
export interface RegisterPersonnelProfileInput {
  code: string;
  name: string;
  orgUnitId: string;
  mobilePhone: string;
  initialPassword: string;
  roles: readonly string[];
  posts: readonly string[];
  /** 执法证号、有效期至（YYYY-MM-DD），可留空；要填须两项都填（原型 P6:51）。 */
  certNo?: string;
  certExpiresOn?: string;
}

/** 去掉首尾空白、去重后的登记输入。口令原样保留。 */
export interface NormalizedRegistration {
  code: string;
  name: string;
  orgUnitId: string;
  mobilePhone: string;
  initialPassword: string;
  roles: string[];
  posts: PersonnelPost[];
  certNo: string;
  certExpiresOn: string;
}

export function normalizeRegistration(input: RegisterPersonnelProfileInput): NormalizedRegistration {
  return {
    code: input.code.trim(),
    name: input.name.trim(),
    orgUnitId: input.orgUnitId.trim(),
    mobilePhone: input.mobilePhone.trim(),
    initialPassword: input.initialPassword,
    roles: [...new Set(input.roles.map((role) => role.trim()).filter((role) => role !== ''))],
    posts: [...new Set(input.posts)].filter(isPersonnelPost),
    certNo: (input.certNo ?? '').trim(),
    certExpiresOn: (input.certExpiresOn ?? '').trim(),
  };
}

/** YYYY-MM-DD 且是真实日历日时返回 UTC 午夜，否则 null。 */
export function parseCalendarDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

/**
 * 不依赖库的登记规则（必填、长度、格式、口令策略、岗位标记取值）。
 * 角色是否认识要查库，由服务追加 role-unknown。
 * 初始口令按口令策略校验，不比口令历史（ADR 0015：登记新人员还没有历史）。
 */
export function registrationRules(input: RegisterPersonnelProfileInput): RegisterRuleCode[] {
  const value = normalizeRegistration(input);
  const rules: RegisterRuleCode[] = [];
  if (value.code === '') rules.push('personnel-code-required');
  else if ([...value.code].length > PERSONNEL_CODE_MAX_LENGTH) rules.push('personnel-code-too-long');
  if (value.name === '') rules.push('personnel-name-required');
  else if ([...value.name].length > PERSONNEL_NAME_MAX_LENGTH) rules.push('personnel-name-too-long');
  if (value.orgUnitId === '') rules.push('org-unit-required');
  if (value.mobilePhone === '') rules.push('mobile-phone-required');
  else if (!MOBILE_PHONE.test(value.mobilePhone)) rules.push('mobile-phone-invalid');
  if (value.roles.length === 0) rules.push('roles-required');
  if (input.posts.some((post) => !isPersonnelPost(post))) rules.push('post-unknown');
  if (value.certNo === '' && value.certExpiresOn !== '') rules.push('cert-no-required');
  else if ([...value.certNo].length > CERT_NO_MAX_LENGTH) rules.push('cert-no-too-long');
  if (value.certNo !== '' && value.certExpiresOn === '') rules.push('cert-expires-on-required');
  else if (value.certExpiresOn !== '' && !parseCalendarDay(value.certExpiresOn)) rules.push('cert-expires-on-invalid');
  if (value.initialPassword === '') rules.push('password-required');
  else rules.push(...rejectedPasswordRules({ password: value.initialPassword, personnelCode: value.code }));
  return rules;
}

/**
 * 执法证情况（列表与卡片显示用）。证号不出列表。
 * none 未登记；valid 有效；expiring 30 天内到期；expired 已过期；invalid 证件状态为「失效」（#133）。
 * 证件状态只存「有效」「失效」两项，临期和已过期按有效期推导（Lei Hu 7-3）。
 * 有效期按北京时间日界，等于今天仍有效。
 */
export type CertStatus = 'none' | 'valid' | 'expiring' | 'expired' | 'invalid';

/**
 * 证件状态（入库列 enforcement_cert_status，#133）。只取两项：valid 有效、invalid 失效。
 * 库层 NOT NULL + CHECK 兜底；不认识的取值在适配器里报错，不静默放过。
 */
export const CERT_RECORD_STATUSES = ['valid', 'invalid'] as const;
export type CertRecordStatus = (typeof CERT_RECORD_STATUSES)[number];

export function isCertRecordStatus(value: unknown): value is CertRecordStatus {
  return typeof value === 'string' && (CERT_RECORD_STATUSES as readonly string[]).includes(value);
}

export const CERT_EXPIRING_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 北京时间日期格式器，模块级复用（名单逐人调用 certStatusOf）。 */
const SHANGHAI_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function shanghaiDay(now: Date): number {
  return Date.parse(`${SHANGHAI_DAY.format(now)}T00:00:00.000Z`);
}

/** expiresOn 是日历日（UTC 午夜）。 */
export function certStatusOf(
  certNo: string | null,
  expiresOn: Date | null,
  recordStatus: CertRecordStatus,
  now: Date,
): CertStatus {
  if (!certNo?.trim() || !expiresOn) return 'none';
  // 证件状态为「失效」时一律失效，不再按有效期推导（#133，Lei Hu 7-3）。
  if (recordStatus !== 'valid') return 'invalid';
  const expiry = Date.UTC(expiresOn.getUTCFullYear(), expiresOn.getUTCMonth(), expiresOn.getUTCDate());
  const today = shanghaiDay(now);
  if (expiry < today) return 'expired';
  if (expiry - today <= CERT_EXPIRING_DAYS * DAY_MS) return 'expiring';
  return 'valid';
}

/**
 * 执法资格判定（#133 fail-closed）：证件状态为「有效」且在有效期内才算有执法资格。
 * 证号为空、有效期为空、状态不是「有效」、有效期早于北京时间的今天，都没有资格。
 * 有效期等于今天仍有资格：到期当天仍有效，次日零点起失效（#105 故事 57）。
 * 通用授权不因资格拒绝；资格事实放在身份上下文，由业务层判断（#64）。
 */
export function hasEnforcementQualification(
  certNo: string | null,
  expiresOn: Date | null,
  recordStatus: CertRecordStatus,
  now: Date,
): boolean {
  if (!certNo?.trim() || !expiresOn) return false;
  if (recordStatus !== 'valid') return false;
  const expiry = Date.UTC(expiresOn.getUTCFullYear(), expiresOn.getUTCMonth(), expiresOn.getUTCDate());
  return expiry >= shanghaiDay(now);
}

/** 执法证登记输入（接口层已把非字符串取值换成空串）。三项都必填（原型 P6:21）。 */
export interface UpdateCertInput {
  certNo: string;
  /** 有效期至（YYYY-MM-DD） */
  certExpiresOn: string;
  /** 证件状态：valid 有效、invalid 失效 */
  certStatus: string;
}

/**
 * 执法证登记的规则码（400 non-compliant，不写留痕）。
 * 前四条与登记人员共用同一批字面（#128），第五条是证件状态取值不认识。
 */
export type CertRuleCode =
  | 'cert-no-required'
  | 'cert-no-too-long'
  | 'cert-expires-on-required'
  | 'cert-expires-on-invalid'
  | 'cert-status-unknown';

/** 规则全过时的登记取值；任一规则不过时为 null。 */
export interface NormalizedCertUpdate {
  certNo: string;
  certExpiresOn: Date;
  certStatus: CertRecordStatus;
}

/** 执法证登记的校验规则（纯函数，不查库）。 */
export function certUpdateRules(input: UpdateCertInput): CertRuleCode[] {
  const certNo = input.certNo.trim();
  const expiresOn = input.certExpiresOn.trim();
  const rules: CertRuleCode[] = [];
  if (certNo === '') rules.push('cert-no-required');
  else if ([...certNo].length > CERT_NO_MAX_LENGTH) rules.push('cert-no-too-long');
  if (expiresOn === '') rules.push('cert-expires-on-required');
  else if (!parseCalendarDay(expiresOn)) rules.push('cert-expires-on-invalid');
  if (!isCertRecordStatus(input.certStatus)) rules.push('cert-status-unknown');
  return rules;
}

export function normalizeCertUpdate(input: UpdateCertInput): NormalizedCertUpdate | null {
  if (certUpdateRules(input).length > 0) return null;
  const certExpiresOn = parseCalendarDay(input.certExpiresOn.trim());
  if (!certExpiresOn || !isCertRecordStatus(input.certStatus)) return null;
  return { certNo: input.certNo.trim(), certExpiresOn, certStatus: input.certStatus };
}

/**
 * 留痕前值（#133）：只写旧有效期和旧状态，不写证号（#105:232、ADR 0011）。
 * 格式 `expiresOn=YYYY-MM-DD;status=valid|invalid`。没有旧证（未登记）时前值为空。
 */
export function certPreviousValue(expiresOn: Date | null, recordStatus: CertRecordStatus): string | null {
  if (!expiresOn) return null;
  const day = expiresOn.toISOString().slice(0, 10);
  return `expiresOn=${day};status=${recordStatus}`;
}

/** 七个角色（GLOSSARY「角色」、ADR 0009）的显示顺序。列表和卡片按这个顺序列角色。 */
export const ROLE_ORDER = ['内勤', '经办', '法制审核', '行政审核', '行政审批', '监督', '系统管理'] as const;

export function sortRoleNames(names: readonly string[]): string[] {
  const rank = (name: string): number => {
    const index = (ROLE_ORDER as readonly string[]).indexOf(name);
    return index < 0 ? ROLE_ORDER.length : index;
  };
  return [...new Set(names)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'zh-CN'));
}
