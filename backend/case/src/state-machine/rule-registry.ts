// #258／Q21：规则键注册表。判定留在代码里。这里只放带版本号的参数。
// 业务票的具体警告（X10、X22、X26 等）不在本票登记。
// #271：新旧比对的 Q31 警告登记为 CMP-01。它不是 X 编号，附录 A 未占号。

import type { GuardLevel, GuardResult } from './guard.ts';

/** Q31 施行日当天警告的规则键。 */
export const Q31_RULE_KEY = 'CMP-01';
/** Q31 警告原文（#42 关票第二节、#256 §6 第 4 条）。 */
export const Q31_WARNING_MESSAGE = '施行日当天批准，适用哪一版请法制部门确认';

/** 一期参数。级别、依据、文案、是否必填理由。阈值留空表示这条没有阈值。 */
export interface RuleParameter {
  readonly ruleKey: string;
  readonly version: string;
  readonly level: GuardLevel;
  readonly message: string;
  readonly citation: string | null;
  readonly reasonRequired: boolean;
}

/**
 * 已登记的规则参数。
 * X03 的判定在引擎。本表只提供确认留痕要用的版本和参数。
 */
export const RULE_PARAMETERS: readonly RuleParameter[] = [
  {
    ruleKey: 'X03',
    version: '1',
    level: 'warn',
    message: '待收尾状态下只能撤案或结案',
    citation: '规程 4.3.3(4)',
    reasonRequired: false,
  },
  {
    ruleKey: Q31_RULE_KEY,
    version: '1',
    level: 'warn',
    message: Q31_WARNING_MESSAGE,
    citation: null,
    reasonRequired: false,
  },
];

const BY_KEY = new Map(RULE_PARAMETERS.map((item) => [item.ruleKey, item]));

export function findRuleParameter(ruleKey: string): RuleParameter | null {
  return BY_KEY.get(ruleKey) ?? null;
}

export interface WarningItem {
  readonly level: 'warn' | 'hint';
  readonly code: string;
  readonly message: string;
  readonly citation: string | null;
  readonly ruleKey: string;
}

/** 命中项的规则键取代码本身。未登记的键仍原样返回，确认时再拒绝。 */
export function toWarning(item: GuardResult): WarningItem {
  return {
    level: item.level === 'hint' ? 'hint' : 'warn',
    code: item.code,
    message: item.message,
    citation: item.citation ?? null,
    ruleKey: item.code,
  };
}

export interface ConfirmedRuleRef {
  readonly ruleKey: string;
  readonly version: string;
}

export interface RuleConfirmation {
  readonly ruleKeys: readonly ConfirmedRuleRef[];
  readonly warnings: readonly WarningItem[];
}

export type ConfirmationGap =
  | { readonly kind: 'unknown'; readonly ruleKey: string }
  | { readonly kind: 'hold' }
  | { readonly kind: 'reason'; readonly ruleKey: string }
  | { readonly kind: 'ready' };

/** 确认键是否盖住全部 warn。未知键优先于「尚未确认」。hint 不进入 warnRuleKeys。 */
export function confirmationGap(input: {
  readonly warnRuleKeys: readonly string[];
  readonly confirmedRuleKeys: readonly string[];
  readonly confirmReasons: Readonly<Record<string, string>>;
  readonly registry?: readonly RuleParameter[];
}): ConfirmationGap {
  const registry = input.registry ?? RULE_PARAMETERS;
  const known = new Map(registry.map((item) => [item.ruleKey, item]));
  for (const ruleKey of input.confirmedRuleKeys) {
    if (!known.has(ruleKey)) return { kind: 'unknown', ruleKey };
  }
  const confirmed = new Set(input.confirmedRuleKeys);
  for (const ruleKey of input.warnRuleKeys) {
    if (!confirmed.has(ruleKey)) return { kind: 'hold' };
  }
  for (const ruleKey of input.warnRuleKeys) {
    const rule = known.get(ruleKey);
    if (!rule) return { kind: 'unknown', ruleKey };
    if (!rule.reasonRequired) continue;
    const reason = input.confirmReasons[ruleKey];
    if (typeof reason !== 'string' || reason.trim() === '') return { kind: 'reason', ruleKey };
  }
  return { kind: 'ready' };
}

/** 留痕只记已登记的 warn 键，同一键只记一次。版本取注册表。 */
export function ruleRefsFor(ruleKeys: readonly string[]): ConfirmedRuleRef[] {
  const seen = new Set<string>();
  const refs: ConfirmedRuleRef[] = [];
  for (const ruleKey of ruleKeys) {
    if (seen.has(ruleKey)) continue;
    seen.add(ruleKey);
    const rule = findRuleParameter(ruleKey);
    if (!rule) continue;
    refs.push({ ruleKey, version: rule.version });
  }
  return refs;
}
