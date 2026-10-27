// #258／Q21：规则键注册表。判定留在代码里。这里只放带版本号的参数。
// 业务票的具体警告（X10、X22、X26 等）不在本票登记。

import type { GuardLevel, GuardResult } from './guard.ts';

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
  // #257：立案呈批缺件的警告项。逐项缺件写进 warnings 的 message，确认键共用一个。
  {
    ruleKey: 'FILING-GAP',
    version: '1',
    level: 'warn',
    message: '线索要件缺件',
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
