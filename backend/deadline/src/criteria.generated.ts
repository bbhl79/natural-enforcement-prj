// 生成文件，勿手工改。底稿：docs/research/criteria/。
// 用途：L1 合法合规判据的机器形态，供反向校验测试读取期望值。

/** 一条法规判据。 */
export interface LegalCriterion {
  readonly id: string;
  readonly document: string;
  readonly article: string;
  readonly interpretation: '直译' | '推导' | '裁量';
  readonly expected: Readonly<Record<string, unknown>> | null;
  readonly consumers: readonly string[];
  readonly status: 'active' | 'objected' | 'superseded';
}

/** 一条业务决策登记。 */
export interface BusinessDecision {
  readonly id: string;
  readonly subject: string;
  readonly consumer: string;
  readonly source: string;
  readonly reason: string;
  readonly risk: string;
  readonly expected: Readonly<Record<string, unknown>> | null;
}

/** 本模块消费的法规判据，按编号升序。 */
export const LEGAL_CRITERIA: readonly LegalCriterion[] = [
  { id: "CRIT-DL-001", document: "doc_042", article: "第六十条", interpretation: "直译", expected: {"ruleKey":"case.handle","dayCount":90,"dayBasis":"calendar"}, consumers: ["backend/deadline/src/rules.ts#case.handle"], status: "active" },
  { id: "CRIT-DL-002", document: "doc_061", article: "第三十八条第一款", interpretation: "直译", expected: {"extensionCapDays":30,"complexException":"案情特别复杂"}, consumers: ["backend/deadline/src/rules.ts#DEFAULT_EXTENSION_CAP_DAYS","backend/deadline/src/extension.ts#checkExtension"], status: "active" },
  { id: "CRIT-DL-004", document: "doc_042", article: "第六十四条（一）、第八十五条", interpretation: "推导", expected: {"ruleKey":"hearing.apply","dayCount":5,"dayBasis":"working"}, consumers: ["backend/deadline/src/rules.ts#hearing.apply"], status: "active" },
  { id: "CRIT-DL-004A", document: "doc_042", article: "第六十四条（一）", interpretation: "直译", expected: {"period":"五日"}, consumers: [], status: "active" },
  { id: "CRIT-DL-004B", document: "doc_042", article: "第八十五条", interpretation: "直译", expected: {"scope":"二日、三日、五日、七日","unit":"工作日"}, consumers: [], status: "active" },
  { id: "CRIT-DL-005", document: "doc_002", article: "8.2", interpretation: "直译", expected: {"ruleKey":"notice.statement","dayCount":5,"dayBasis":"working"}, consumers: ["backend/deadline/src/rules.ts#notice.statement"], status: "active" },
  { id: "CRIT-DL-006", document: "doc_002", article: "11.1.2（2）", interpretation: "直译", expected: {"ruleKey":"criminal-transfer.decision","dayCount":3,"dayBasis":"working"}, consumers: ["backend/deadline/src/rules.ts#criminal-transfer.decision"], status: "active" },
  { id: "CRIT-DL-007", document: "doc_081", article: "第九条", interpretation: "直译", expected: {"ruleKey":"criminal-decision.review","dayCount":3,"dayBasis":"calendar"}, consumers: ["backend/deadline/src/rules.ts#criminal-decision.review"], status: "active" },
  { id: "CRIT-DL-008", document: "doc_002", article: "8.5", interpretation: "直译", expected: {"ruleKey":"case.handle","dayCount":90,"extensionCapDays":30}, consumers: ["backend/deadline/src/rules.ts#case.handle"], status: "active" },
];

/** 全部业务决策登记，按编号升序。 */
export const BUSINESS_DECISIONS: readonly BusinessDecision[] = [
  { id: "DEC-001", subject: "法审期限 5＋10 个工作日", consumer: "backend/deadline/src/rules.ts#legal-review.round", source: "广州市局程序条参照适用清单（#241/6431445240）", reason: "无公开法规给出该数值。清单把它列为本地程序要求，属委托方作业依据，单源。", risk: "市局程序条修订时须同步代码；无法规判据可自动校验。", expected: {"ruleKey":"legal-review.round","dayCount":5,"dayBasis":"working","extensionAllowance":10} },
  { id: "DEC-002", subject: "移送告知 3 个工作日", consumer: "backend/deadline/src/rules.ts#transfer.notice", source: "代码既有值，出处待查证", reason: "仓库内未查到法规或委托方文件给出该数值。首批按裁量层登记，不冒充法规判据。", risk: "数值可能不符合广州实际要求。查证到出处后须改为判据项或补登出处。", expected: {"ruleKey":"transfer.notice","dayCount":3,"dayBasis":"working"} },
  { id: "DEC-003", subject: "必审清单第 5 项列举的处罚种类", consumer: "backend/case/src/legal-review/rules.ts#MANDATORY_REVIEW_PENALTY_CODES", source: "广州市局 2022-02-15 必审清单第 5 项", reason: "委托方内部文件，单源。条例与法律只给法制审核情形，不给具体罚种清单。", risk: "清单修订时须同步；不得据本项产出法规断言。", expected: {"penaltyCodes":["confiscate-mineral-products","confiscate-illegal-gains","confiscate-illegal-buildings","demolish-illegal-buildings","revoke-exploration-permit","revoke-mining-permit","revoke-geological-disaster-qualification","revoke-surveying-qualification"]} },
  { id: "DEC-004", subject: "涉刑移送自动触发法制审核", consumer: "backend/case/src/legal-review/rules.ts#MANDATORY_REVIEW_ITEMS", source: "广州市局 2022-02-15 必审清单", reason: "行政处罚法第五十八条与广州市依法行政条例第三十七条均未单列涉刑移送。它是清单六项之一，属委托方作业依据。", risk: "清单修订时须同步；不得据本项产出法规断言。", expected: {"reviewCode":"criminal-transfer"} },
];
