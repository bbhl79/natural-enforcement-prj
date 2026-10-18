// 人员登记、列表与卡片（#105「人员与登录凭据」，#128）：操作码、岗位标记、登记规则、执法证情况。

import { rejectedPasswordRules, type PasswordRuleCode } from './password-policy.ts';

export const PERSONNEL_PROFILE_READ_OPCODE = 'personnel.profile.read';
export const PERSONNEL_PROFILE_REGISTER_OPCODE = 'personnel.profile.register';

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
 * none 未登记；valid 有效；expiring 30 天内到期；expired 已过期。
 * 「失效」需要证件状态列，随执法证票（#133）补。有效期按北京时间日界，等于今天仍有效。
 */
export type CertStatus = 'none' | 'valid' | 'expiring' | 'expired';

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
export function certStatusOf(certNo: string | null, expiresOn: Date | null, now: Date): CertStatus {
  if (!certNo?.trim() || !expiresOn) return 'none';
  const expiry = Date.UTC(expiresOn.getUTCFullYear(), expiresOn.getUTCMonth(), expiresOn.getUTCDate());
  const today = shanghaiDay(now);
  if (expiry < today) return 'expired';
  if (expiry - today <= CERT_EXPIRING_DAYS * DAY_MS) return 'expiring';
  return 'valid';
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
