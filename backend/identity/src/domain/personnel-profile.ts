// 人员登记、列表与卡片（#105「人员与登录凭据」，#128）：操作码、岗位标记、登记规则、执法证情况。
// 执法证登记与执法资格判定（#105「执法证（#85）」，#133）：证件状态、登记规则、留痕前值、资格判定。
// 人员编辑与调岗（#129）：编辑操作码、编辑规则、编辑差异。

import { rejectedPasswordRules, type PasswordRuleCode } from './password-policy.ts';

export const PERSONNEL_PROFILE_READ_OPCODE = 'personnel.profile.read';
export const PERSONNEL_PROFILE_REGISTER_OPCODE = 'personnel.profile.register';
/** 执法证登记（#133）：只给系统管理。留痕动作词 cert.updated。 */
export const PERSONNEL_CERT_UPDATE_OPCODE = 'personnel.cert.update';
/** 编辑与调岗共用一个操作码（#105:216：调岗和改角色并入，只给系统管理；岗位标记的维护也用它）。 */
export const PERSONNEL_PROFILE_UPDATE_OPCODE = 'personnel.profile.update';
/** 停用、恢复、结束全部会话各自一个操作码（#105:216，#130），都只给系统管理。 */
export const PERSONNEL_PROFILE_DEACTIVATE_OPCODE = 'personnel.profile.deactivate';
export const PERSONNEL_PROFILE_RESTORE_OPCODE = 'personnel.profile.restore';
export const PERSONNEL_SESSIONS_END_OPCODE = 'personnel.sessions.end';

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

/** 编辑输入（#129）。工号、机构不在编辑范围；调岗另经 transferOrgUnitId 走调岗接口。 */
export interface UpdatePersonnelProfileInput {
  name: string;
  mobilePhone: string;
  roles: readonly string[];
  posts: readonly string[];
}

/** 编辑校验失败的规则码。不含口令策略（编辑不收口令），也不含工号与机构（两项不可改）。 */
export type UpdateRuleCode =
  | 'personnel-name-required'
  | 'personnel-name-too-long'
  | 'mobile-phone-required'
  | 'mobile-phone-invalid'
  | 'roles-required'
  | 'role-unknown'
  | 'post-unknown';

/** 去掉首尾空白、去重、只留名册内标记后的编辑输入。 */
export interface NormalizedUpdate {
  name: string;
  mobilePhone: string;
  roles: string[];
  posts: PersonnelPost[];
}

export function normalizeUpdate(input: UpdatePersonnelProfileInput): NormalizedUpdate {
  return {
    name: input.name.trim(),
    mobilePhone: input.mobilePhone.trim(),
    roles: [...new Set(input.roles.map((role) => role.trim()).filter((role) => role !== ''))],
    posts: [...new Set(input.posts)].filter(isPersonnelPost),
  };
}

/**
 * 不依赖库的编辑规则（#105:219）。角色是否认识要查库，由服务追加 role-unknown。
 * 至少保留一个角色（原型 P6:29「至少保留一个角色」）。
 */
export function updateRules(input: UpdatePersonnelProfileInput): UpdateRuleCode[] {
  const value = normalizeUpdate(input);
  const rules: UpdateRuleCode[] = [];
  if (value.name === '') rules.push('personnel-name-required');
  else if ([...value.name].length > PERSONNEL_NAME_MAX_LENGTH) rules.push('personnel-name-too-long');
  if (value.mobilePhone === '') rules.push('mobile-phone-required');
  else if (!MOBILE_PHONE.test(value.mobilePhone)) rules.push('mobile-phone-invalid');
  if (value.roles.length === 0) rules.push('roles-required');
  if (input.posts.some((post) => !isPersonnelPost(post))) rules.push('post-unknown');
  return rules;
}

/** 调岗目的地的库外规则码（#105:219：目的地不限数据范围，但必须是未停用机构）。 */
export type TransferRuleCode = 'org-unit-required';

export function transferRules(orgUnitId: string): TransferRuleCode[] {
  return orgUnitId.trim() === '' ? ['org-unit-required'] : [];
}

/**
 * 停用态人员禁止编辑与调岗（#130 定口径，PR #148 复核遗留①）。
 * 返回 409 invalid-state，reason 与留痕失败原因同词（#105 错误码表「409 可读原因」）。
 * 停用只挡改动作：卡片照旧能打开，恢复照旧能做。
 */
export const PERSONNEL_DEACTIVATED_REASON = 'personnel-deactivated';

/** 编辑已停用人员时给人看的一句原因。 */
export const DEACTIVATED_EDIT_MESSAGE = '这个人员已停用，不能编辑。请先恢复，再改姓名、手机号、角色或岗位标记。';

/** 调岗已停用人员时给人看的一句原因。 */
export const DEACTIVATED_TRANSFER_MESSAGE = '这个人员已停用，不能调岗。请先恢复，恢复时可以同时选一个新的任职机构。';

/** 登记或修改已停用人员的执法证时给人看的一句原因（#158）。 */
export const DEACTIVATED_CERT_MESSAGE = '这个人员已停用，不能登记或修改执法证。请先恢复，再办理。';

/** 恢复的输入（#130，#105 故事 37、38）。原任职机构已停用时必须带新任职机构。 */
export interface RestorePersonnelProfileInput {
  initialPassword: string;
  /** 新任职机构。原任职机构已停用时必填；其余情况一并调岗到它。 */
  orgUnitId?: string;
}

/** 恢复的库外规则码：只有初始口令一项（工号、姓名、机构都不在恢复里改）。 */
export type RestoreRuleCode = 'password-required' | PasswordRuleCode;

/**
 * 恢复时新初始口令的规则（#105:227、ADR 0015）。口令历史比对留给口令历史票（#132）。
 * 口令为空只返回 password-required，不再列口令策略（同登记）。「不能包含本人工号」按对方的工号判断。
 */
export function restoreRules(input: RestorePersonnelProfileInput, personnelCode: string): RestoreRuleCode[] {
  if (input.initialPassword === '') return ['password-required'];
  return rejectedPasswordRules({ password: input.initialPassword, personnelCode });
}

/**
 * 恢复被拒（409 invalid-state）的原因与可读句（#105 故事 38、39，错误码表）。
 * not-deactivated 对方没有停用；org-unit-required 原任职机构已停用且没有带新任职机构；
 * org-unit-deactivated 所选新任职机构已停用。
 */
export type RestoreInvalidReason = 'not-deactivated' | 'org-unit-required' | 'org-unit-deactivated';

export const RESTORE_INVALID_MESSAGE: Record<RestoreInvalidReason, string> = {
  'not-deactivated': '这个人员没有停用，不需要恢复。',
  'org-unit-required': '原任职机构已停用，恢复时必须同时选一个在用的新任职机构。',
  'org-unit-deactivated': '所选机构已停用，请选择在用的机构。',
};

/** 对方当前态里编辑差异要用到的四项。 */
export interface PersonnelCurrentEdit {
  name: string;
  mobilePhone: string | null;
  roles: readonly string[];
  posts: readonly PersonnelPost[];
}

/**
 * 编辑差异（#105:219、:223）。差异全空 = 重复授予或摘除，返回 200 且不写留痕。
 * 角色与标记只列有变化的那几项：加 = 插入新行，摘 = 给旧行置失效时间。
 */
export interface PersonnelEditDiff {
  /** 新姓名；与现名相同时为空串 */
  name: string;
  /** 新手机号；与现号相同时为空串 */
  mobilePhone: string;
  rolesToGrant: string[];
  rolesToRevoke: string[];
  postsToGrant: PersonnelPost[];
  postsToRevoke: PersonnelPost[];
}

export function updateDiff(input: UpdatePersonnelProfileInput, current: PersonnelCurrentEdit): PersonnelEditDiff {
  const value = normalizeUpdate(input);
  const heldRoles = new Set(current.roles);
  const wantedRoles = new Set(value.roles);
  const heldPosts = new Set(current.posts);
  const wantedPosts = new Set(value.posts);
  return {
    name: value.name === current.name.trim() ? '' : value.name,
    mobilePhone: value.mobilePhone === (current.mobilePhone ?? '') ? '' : value.mobilePhone,
    rolesToGrant: sortRoleNames(value.roles.filter((role) => !heldRoles.has(role))),
    rolesToRevoke: sortRoleNames(current.roles.filter((role) => !wantedRoles.has(role))),
    postsToGrant: PERSONNEL_POSTS.filter((post) => wantedPosts.has(post) && !heldPosts.has(post)),
    postsToRevoke: PERSONNEL_POSTS.filter((post) => heldPosts.has(post) && !wantedPosts.has(post)),
  };
}

/** 差异是否为空：空即「重复授予或摘除」，返回 200 不写留痕。 */
export function isEmptyDiff(diff: PersonnelEditDiff): boolean {
  return diff.name === '' && diff.mobilePhone === ''
    && diff.rolesToGrant.length === 0 && diff.rolesToRevoke.length === 0
    && diff.postsToGrant.length === 0 && diff.postsToRevoke.length === 0;
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
