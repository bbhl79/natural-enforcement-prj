// 期限规则按规则键注册（#256 跨环节 D 第 8 条 Q21）。配置只装参数，不另写日历。

export const DEADLINE_RULE_VERSION = '2026-10-27';
export const DEFAULT_HANDLING_DAYS = 90;
export const DEFAULT_EXTENSION_CAP_DAYS = 30;
export const COMPLEX_CASE_REASON = '案情特别复杂';

export interface DeadlineRule {
  readonly key: string;
  readonly version: string;
  readonly dayCount: number;
  readonly dayBasis: 'calendar' | 'working';
  readonly consumption: 'continue' | 'restart';
  readonly partyFacing: boolean;
  /** 本轮可再延长的工作日。不自动加进到期日。 */
  readonly extensionAllowance: number | null;
  readonly basis: string;
}

export const DEADLINE_RULES: readonly DeadlineRule[] = [
  {
    key: 'case.handle',
    version: DEADLINE_RULE_VERSION,
    dayCount: DEFAULT_HANDLING_DAYS,
    dayBasis: 'calendar',
    consumption: 'continue',
    partyFacing: false,
    extensionAllowance: null,
    basis: '行政处罚法第60条；处罚办法第38条',
  },
  {
    key: 'legal-review.round',
    version: DEADLINE_RULE_VERSION,
    dayCount: 5,
    dayBasis: 'working',
    consumption: 'restart',
    partyFacing: false,
    extensionAllowance: 10,
    basis: '法制审核 5 个工作日，可延长 10 个工作日',
  },
  {
    key: 'hearing.apply',
    version: DEADLINE_RULE_VERSION,
    dayCount: 5,
    dayBasis: 'working',
    consumption: 'restart',
    partyFacing: true,
    extensionAllowance: null,
    basis: '听证申请期默认五个工作日',
  },
  {
    key: 'notice.statement',
    version: DEADLINE_RULE_VERSION,
    dayCount: 5,
    dayBasis: 'working',
    consumption: 'restart',
    partyFacing: true,
    extensionAllowance: null,
    basis: '陈述申辩期默认五个工作日（#272）',
  },
  {
    key: 'transfer.notice',
    version: DEADLINE_RULE_VERSION,
    dayCount: 3,
    dayBasis: 'working',
    consumption: 'restart',
    partyFacing: true,
    extensionAllowance: null,
    basis: '移送告知 3 个工作日',
  },
];

const BY_KEY = new Map(DEADLINE_RULES.map((rule) => [rule.key, rule]));

export function findDeadlineRule(key: string): DeadlineRule | null {
  return BY_KEY.get(key) ?? null;
}

export const CONSUMPTION_NAMES = {
  continue: '继续消耗',
  restart: '重新起算',
} as const;
