// 用途：登记全部期限规则（规则键、天数、日历日或工作日口径等参数），并按规则键查找。
// 调用方：本包 anchor.ts 经 findDeadlineRule 取规则，extension.ts 取延长常量；
// backend/server/src/deadline.service.ts 用 CONSUMPTION_NAMES；integration/notice-hearing.test.ts 用 DEADLINE_RULE_VERSION。
// 边界：只登记参数，不含计算。规则的业务含义以飞书权威文档与项目负责人为准，本文件不解释。
// 依据：GLOSSARY.md 词条「期限规则」；各规则的出处文字写在其 basis 字段。
// 期限规则按规则键注册（#256 跨环节 D 第 8 条 Q21）。配置只装参数，不另写日历。

// 规则登记表的版本号，填入每条规则的 version，随期限行落库为 ruleVersion。integration/notice-hearing.test.ts 导入它做断言。
// integration/case-deadline.test.ts 与 integration/case-legal-review.test.ts 持有同一值的字面量，改版本须同步。
export const DEADLINE_RULE_VERSION = '2026-10-27';
// case.handle 规则的 dayCount 取值。取值的出处见该规则的 basis 字段，此处不复述。当前无外部调用方。
export const DEFAULT_HANDLING_DAYS = 90;
// checkExtension 的默认上限参数 cap。延长天数大于它且理由不含 COMPLEX_CASE_REASON 时被拒绝。当前无外部调用方。
export const DEFAULT_EXTENSION_CAP_DAYS = 30;
// checkExtension 在延长理由里做子串匹配的关键词，命中则 complex 为 true，允许天数超过 cap。
export const COMPLEX_CASE_REASON = '案情特别复杂';

/**
 * 一条期限规则的登记参数。key 是规则键，version 是规则版本，dayCount 与 dayBasis 决定怎么数（日历日或工作日）。
 * consumption 取 continue 或 restart，中文名见 CONSUMPTION_NAMES，本包不据此分支。
 * partyFacing 随期限行存下，换日历修订时由 planRevision 据此判断是否只许推后。basis 是出处文字，只登记，不参与计算。
 * 调用方：backend/server/src/case-notice.service.ts 引用该类型。
 */
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

/**
 * 全部期限规则的登记表。天数、口径等取值以本表为准，本注释不复述。
 * 当前无外部调用方直接读本数组，外部经 findDeadlineRule 取用。
 * 规则键在 backend/case/src/transfer/rules.ts 与 backend/server/src 的多个服务里另写了字面量或常量，改键须全仓检索。
 */
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
  {
    key: 'criminal-transfer.decision',
    version: DEADLINE_RULE_VERSION,
    dayCount: 3,
    dayBasis: 'working',
    consumption: 'restart',
    partyFacing: false,
    extensionAllowance: null,
    basis: '涉刑移送审批三个工作日（规程11.1.2(2)）',
  },
  {
    key: 'criminal-decision.review',
    version: DEADLINE_RULE_VERSION,
    dayCount: 3,
    dayBasis: 'calendar',
    consumption: 'restart',
    partyFacing: false,
    extensionAllowance: null,
    basis: '接到不予立案通知之日起三日只警告（国务院令第310号第9条）',
  },
];

const BY_KEY = new Map(DEADLINE_RULES.map((rule) => [rule.key, rule]));

/**
 * 按规则键取期限规则。键未登记返回 null，不抛错。键区分大小写，不去空白。
 * 调用方：本包 anchor.ts 的 planAnchor；当前无外部调用方。
 */
export function findDeadlineRule(key: string): DeadlineRule | null {
  return BY_KEY.get(key) ?? null;
}

/**
 * DeadlineRule.consumption 两个取值对应的中文名。backend/server/src/deadline.service.ts 把它作为 consumptionName 放进接口响应，
 * frontend/src/case/DeadlinePanel.tsx 直接显示。integration/case-deadline.test.ts 与 frontend/src/case/deadline.test.tsx 以字面量断言这些文案，改文案须同步。
 */
export const CONSUMPTION_NAMES = {
  continue: '继续消耗',
  restart: '重新起算',
} as const;
