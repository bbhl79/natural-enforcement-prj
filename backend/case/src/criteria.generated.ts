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
}

/** 本模块消费的法规判据，按编号升序。 */
export const LEGAL_CRITERIA: readonly LegalCriterion[] = [
  { id: "CRIT-DL-003", document: "doc_061", article: "第三十八条第二款", interpretation: "直译", expected: {"transferBasisArticle":"第三十八条第二款","excludedPeriods":"鉴定、听证、公告、邮递在途等时间不计入；涉嫌犯罪移送的，等待公安机关、检察机关作出决定的时间不计入"}, consumers: ["backend/case/src/transfer/rules.ts#TRANSFER_CLOCK_BASIS"], status: "active" },
  { id: "CRIT-LR-001", document: "doc_042", article: "第五十八条", interpretation: "直译", expected: {"grounds":{"（一）涉及重大公共利益的":["major-public-interest"],"（二）直接关系当事人或者第三人重大权益，经过听证程序的":["hearing-held","hearing-entered"],"（三）案件情况疑难复杂、涉及多个法律关系的":["complex-multiple-relations"],"（四）法律、法规规定应当进行法制审核的其他情形":["law-requires"]}}, consumers: ["backend/case/src/legal-review/rules.ts#MANDATORY_REVIEW_ITEMS"], status: "active" },
  { id: "CRIT-LR-002", document: "doc_082", article: "第三十七条", interpretation: "直译", expected: {"grounds":{"（一）涉及重大公共利益的":["major-public-interest"],"（二）可能造成重大社会影响或者引发社会风险的":["major-social-impact"],"（三）直接关系行政相对人或者第三人重大权益的":["material-rights"],"（四）经过听证程序作出的":["hearing-held","hearing-entered"],"（五）案件情况疑难复杂、涉及多个法律关系的":["complex-multiple-relations"],"（六）国家、省、市规定的其他情形":["law-requires"]}}, consumers: ["backend/case/src/legal-review/rules.ts#MANDATORY_REVIEW_ITEMS"], status: "active" },
  { id: "CRIT-LR-003", document: "doc_042", article: "第五十七条第二款", interpretation: "直译", expected: {"collectiveCode":"complex-or-major"}, consumers: ["backend/case/src/legal-review/rules.ts#COLLECTIVE_DISCUSSION_CRITERIA"], status: "active" },
  { id: "CRIT-LR-004", document: "doc_002", article: "7.1", interpretation: "直译", expected: {"collectiveCode":"complex-or-major"}, consumers: ["backend/case/src/legal-review/rules.ts#COLLECTIVE_DISCUSSION_CRITERIA"], status: "active" },
  { id: "CRIT-LR-005", document: "doc_025", article: "第十二条（一）", interpretation: "直译", expected: {"collectiveCode":"mixed-lenient-severe"}, consumers: ["backend/case/src/legal-review/rules.ts#COLLECTIVE_DISCUSSION_CRITERIA"], status: "active" },
  { id: "CRIT-LR-006", document: "doc_025", article: "第十二条（二）", interpretation: "直译", expected: {"collectiveCode":"not-in-benchmark"}, consumers: ["backend/case/src/legal-review/rules.ts#COLLECTIVE_DISCUSSION_CRITERIA"], status: "active" },
  { id: "CRIT-LR-007", document: "doc_025", article: "第十二条（三）", interpretation: "直译", expected: {"collectiveCode":"no-illegal-gains"}, consumers: ["backend/case/src/legal-review/rules.ts#COLLECTIVE_DISCUSSION_CRITERIA"], status: "active" },
  { id: "CRIT-LR-008", document: "doc_025", article: "第十二条（四）", interpretation: "直译", expected: {"collectiveCode":"other-collective"}, consumers: ["backend/case/src/legal-review/rules.ts#COLLECTIVE_DISCUSSION_CRITERIA"], status: "active" },
];

/** 全部业务决策登记，按编号升序。 */
export const BUSINESS_DECISIONS: readonly BusinessDecision[] = [
  { id: "DEC-001", subject: "法审期限 5＋10 个工作日", consumer: "backend/deadline/src/rules.ts#legal-review.round", source: "广州市局程序条参照适用清单（#241/6431445240）", reason: "无公开法规给出该数值。清单把它列为本地程序要求，属委托方作业依据，单源。", risk: "市局程序条修订时须同步代码；无法规判据可自动校验。" },
  { id: "DEC-002", subject: "移送告知 3 个工作日", consumer: "backend/deadline/src/rules.ts#transfer.notice", source: "代码既有值，出处待查证", reason: "仓库内未查到法规或委托方文件给出该数值。首批按裁量层登记，不冒充法规判据。", risk: "数值可能不符合广州实际要求。查证到出处后须改为判据项或补登出处。" },
  { id: "DEC-003", subject: "必审清单第 5 项列举的处罚种类", consumer: "backend/case/src/legal-review/rules.ts#MANDATORY_REVIEW_PENALTY_CODES", source: "广州市局 2022-02-15 必审清单第 5 项", reason: "委托方内部文件，单源。条例与法律只给法制审核情形，不给具体罚种清单。", risk: "清单修订时须同步；不得据本项产出法规断言。" },
  { id: "DEC-004", subject: "涉刑移送自动触发法制审核", consumer: "backend/case/src/legal-review/rules.ts#MANDATORY_REVIEW_ITEMS", source: "广州市局 2022-02-15 必审清单", reason: "行政处罚法第五十八条与广州市依法行政条例第三十七条均未单列涉刑移送。它是清单六项之一，属委托方作业依据。", risk: "清单修订时须同步；不得据本项产出法规断言。" },
];
