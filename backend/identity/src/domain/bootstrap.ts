// 生产引导命令（#105「生产引导命令（D5）」，#131）：输入规则、判定结果与差异。
// 判定只看两个不可变键：根机构编码（且必须是根）、首个系统管理人员的工号。
// 空库写入；两键都在为「已引导」，不写；两键不全（含库非空而两键都不在）拒绝，说明差在哪里。

import { ORG_UNIT_NAME_MAX_LENGTH } from './org-unit.ts';
import { rejectedPasswordRules, type PublicPasswordRuleCode } from './password-policy.ts';

/** 首个系统管理人员持有的角色（参照种子写入，GLOSSARY「角色」）。 */
export const BOOTSTRAP_ADMIN_ROLE = '系统管理';

/** 机构编码、工号最长字数（工程定，#131）。 */
export const BOOTSTRAP_CODE_MAX_LENGTH = 64;
/** 姓名最长字数（工程定，#131；与机构名称同为 100）。 */
export const BOOTSTRAP_NAME_MAX_LENGTH = ORG_UNIT_NAME_MAX_LENGTH;

/** 登录标识取本人手机号（GLOSSARY「登录标识」）。工程定：11 位数字，以 1 开头。 */
const MOBILE_PHONE = /^1[0-9]{10}$/;

/** 引导输入（口令除外，口令只从挂载文件读入）。 */
export interface BootstrapProfile {
  rootCode: string;
  rootName: string;
  adminCode: string;
  adminName: string;
  adminMobilePhone: string;
}

/** 输入不合规的规则码。口令只给规则码，不回显输入值。 */
export type BootstrapInputRule =
  | 'root-code-required'
  | 'root-code-too-long'
  | 'root-name-required'
  | 'root-name-too-long'
  | 'admin-code-required'
  | 'admin-code-too-long'
  | 'admin-name-required'
  | 'admin-name-too-long'
  | 'admin-mobile-invalid'
  | `password-${PublicPasswordRuleCode}`;

function lengthRules(
  value: string,
  max: number,
  required: BootstrapInputRule,
  tooLong: BootstrapInputRule,
): BootstrapInputRule[] {
  if (value === '') return [required];
  if ([...value].length > max) return [tooLong];
  return [];
}

/** 输入规则。调用方先去掉首尾空白。口令按口令策略校验（没有历史，不比历史）。 */
export function bootstrapInputRules(profile: BootstrapProfile, password: string): BootstrapInputRule[] {
  const rules: BootstrapInputRule[] = [
    ...lengthRules(profile.rootCode, BOOTSTRAP_CODE_MAX_LENGTH, 'root-code-required', 'root-code-too-long'),
    ...lengthRules(profile.rootName, BOOTSTRAP_NAME_MAX_LENGTH, 'root-name-required', 'root-name-too-long'),
    ...lengthRules(profile.adminCode, BOOTSTRAP_CODE_MAX_LENGTH, 'admin-code-required', 'admin-code-too-long'),
    ...lengthRules(profile.adminName, BOOTSTRAP_NAME_MAX_LENGTH, 'admin-name-required', 'admin-name-too-long'),
  ];
  if (!MOBILE_PHONE.test(profile.adminMobilePhone)) rules.push('admin-mobile-invalid');
  for (const rule of rejectedPasswordRules({ password, personnelCode: profile.adminCode })) {
    rules.push(`password-${rule}`);
  }
  return rules;
}

/** 两键不全时的一条差异。 */
export type BootstrapDifference =
  /** 根机构编码不存在。 */
  | { kind: 'root-missing'; rootCode: string }
  /** 该编码的机构存在，但有上级，不是根。 */
  | { kind: 'root-not-root'; rootCode: string }
  /** 首个系统管理人员的工号不存在。 */
  | { kind: 'admin-missing'; adminCode: string }
  /** 两键都不在，但库里已有机构或人员：不在残缺状态上叠加数据。 */
  | { kind: 'not-empty'; orgUnits: number; personnel: number };

export type BootstrapOutcome =
  | { result: 'bootstrapped'; rootOrgUnitId: string; adminPersonnelId: string }
  | { result: 'already-bootstrapped'; rootOrgUnitId: string; adminPersonnelId: string }
  | { result: 'incomplete'; differences: BootstrapDifference[] };

/** 判定时读到的现状。 */
export interface BootstrapSnapshot {
  root: { id: string; parentId: string | null } | null;
  admin: { id: string } | null;
  orgUnits: number;
  personnel: number;
}

/** 判定（纯函数）：返回 null 表示空库，可以写入。 */
export function judgeBootstrap(
  profile: Pick<BootstrapProfile, 'rootCode' | 'adminCode'>,
  snapshot: BootstrapSnapshot,
): Exclude<BootstrapOutcome, { result: 'bootstrapped' }> | null {
  const { root, admin } = snapshot;
  if (root && root.parentId === null && admin) {
    return { result: 'already-bootstrapped', rootOrgUnitId: root.id, adminPersonnelId: admin.id };
  }
  const differences: BootstrapDifference[] = [];
  if (!root) differences.push({ kind: 'root-missing', rootCode: profile.rootCode });
  else if (root.parentId !== null) differences.push({ kind: 'root-not-root', rootCode: profile.rootCode });
  if (!admin) differences.push({ kind: 'admin-missing', adminCode: profile.adminCode });
  if (!root && !admin) {
    if (snapshot.orgUnits === 0 && snapshot.personnel === 0) return null;
    differences.push({ kind: 'not-empty', orgUnits: snapshot.orgUnits, personnel: snapshot.personnel });
  }
  return { result: 'incomplete', differences };
}

/** 参照种子没有写入（缺未停用的「系统管理」角色）。按执行顺序，引导须在参照种子之后。 */
export class BootstrapPrerequisiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapPrerequisiteError';
  }
}
