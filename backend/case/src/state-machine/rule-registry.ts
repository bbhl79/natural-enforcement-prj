// #258／Q21：规则键注册表。判定留在代码里。这里只放带版本号的参数。
// 业务票的具体警告（X10、X22、X26 等）不在本票登记。
// #271：新旧比对的 Q31 警告登记为 CMP-01。它不是 X 编号，附录 A 未占号。

import type { GuardLevel, GuardResult } from './guard.ts';

/** Q31 施行日当天警告的规则键。 */
export const Q31_RULE_KEY = 'CMP-01';
/** Q31 警告原文（#42 关票第二节、#256 §6 第 4 条）。 */
export const Q31_WARNING_MESSAGE = '施行日当天批准，适用哪一版请法制部门确认';

/** X22 签出警告的规则键与原文（#240；normative，警告不阻断）。 */
export const X22_RULE_KEY = 'X22';
export const X22_MESSAGE = '本案承办人员签出审理意见';

/** X26 告知批准路径的规则键与原文（#272；normative，警告不阻断）。 */
export const X26_RULE_KEY = 'X26';
export const X26_MESSAGE = '命中必审但未经告知前法审就批准告知书';

/** 较大数额提示的规则键（#272；hint，不阻断、不要求确认）。 */
export const HEARING_AMOUNT_RULE_KEY = 'NOTICE-LARGE-AMOUNT';

/** 审理人与法审人为同一人的警告（#269；normative，不阻断，Q23 下理由选填）。 */
export const LEGAL_SAME_PERSON_RULE_KEY = 'LEGAL-SAME-PERSON';
export const LEGAL_SAME_PERSON_MESSAGE = '审理人与法审人为同一人';

/** 法审人员法律职业资格未登记的提示（#269；hint，不阻断、不要求确认）。 */
export const LEGAL_QUALIFICATION_RULE_KEY = 'LEGAL-QUALIFICATION';

/**
 * 调查审理职能分离（#240 R-03）。独立规则，不占 X 号。
 * 被指定人为本案主办或协办（含已换下的）时警告，理由必填，确认入审计。
 */
export const REVIEW_SEPARATION_RULE_KEY = 'REVIEW-SEPARATION';
export const REVIEW_SEPARATION_MESSAGE = '被指定人为本案主办或协办';

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
  // #270：X10 处罚决定未送达就执行记载或结案。normative→警告，两段式确认后继续。
  {
    ruleKey: 'X10',
    version: '1',
    level: 'warn',
    message: '处罚决定未送达就执行记载或结案',
    citation: '规程第 9 章',
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
  {
    ruleKey: Q31_RULE_KEY,
    version: '1',
    level: 'warn',
    message: Q31_WARNING_MESSAGE,
    citation: null,
    reasonRequired: false,
  },
  // #240：X22 签出警告。normative→警告，不升阻断（#240/6443344977）。
  {
    ruleKey: X22_RULE_KEY,
    version: '1',
    level: 'warn',
    message: X22_MESSAGE,
    citation: '规程 5.1',
    reasonRequired: false,
  },
  // #240：调查审理职能分离。独立规则，不占 X 号；理由必填。
  {
    ruleKey: REVIEW_SEPARATION_RULE_KEY,
    version: '1',
    level: 'warn',
    message: REVIEW_SEPARATION_MESSAGE,
    citation: null,
    reasonRequired: true,
  },
  // #272：X26 告知批准路径。normative→警告，不升阻断（#256 跨环节 A 第 4 条）。
  {
    ruleKey: X26_RULE_KEY,
    version: '1',
    level: 'warn',
    message: X26_MESSAGE,
    citation: '规程7.1／8.2；设计加严，非规定要求',
    reasonRequired: false,
  },
  // #272：较大数额提示。hint 不要求确认、不阻断。
  {
    ruleKey: HEARING_AMOUNT_RULE_KEY,
    version: '1',
    level: 'hint',
    message: '罚款额、没收等价值或二者相加达较大数额标准，提示按应听证情形处理',
    citation: '粤府令第294号第7条',
    reasonRequired: false,
  },
  // #269：审理人与法审人为同一人。警告不阻断，确认后留痕；理由选填。
  {
    ruleKey: LEGAL_SAME_PERSON_RULE_KEY,
    version: '1',
    level: 'warn',
    message: LEGAL_SAME_PERSON_MESSAGE,
    citation: '省办法第6条第2款',
    reasonRequired: false,
  },
  // #269：法律职业资格未登记。hint 不要求确认、不阻断。
  {
    ruleKey: LEGAL_QUALIFICATION_RULE_KEY,
    version: '1',
    level: 'hint',
    message: '法审人员法律职业资格未登记',
    citation: '行政处罚法第58条第2款',
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
