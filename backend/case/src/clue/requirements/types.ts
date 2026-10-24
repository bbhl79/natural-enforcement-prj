// 录入要件声明的类型（ADR 0018）。
// 录入要件是「一条线索按其线索来源与法域，在录入时应当呈现的那些项」。
// 它是一份代码里的声明式常量：前端渲染表单与服务端判定缺件读同一份声明。
// 六个属性：呈现、必填性、必填时机、缺件后果、依据、要件键（#24 决议第二节）。

/** 必填时机三值（#192 决议：统一取「录入时」）。 */
export const REQUIREMENT_TIMINGS = ['录入时', '核查前补齐', '只提示'] as const;
export type RequirementTiming = (typeof REQUIREMENT_TIMINGS)[number];

/** 缺件后果三值（GLOSSARY「缺件后果」）。 */
export const REQUIREMENT_CONSEQUENCES = ['阻断', '警告', '提示'] as const;
export type RequirementConsequence = (typeof REQUIREMENT_CONSEQUENCES)[number];

/** 依据引用（ADR 0019）：文件编号 + 条号，指向文件表。 */
export interface BasisReference {
  /** 文件编号，形如 doc_001。 */
  readonly document: string;
  /** 条号，形如「第 79 条」「3.2.3.1(11)」「附录 A 一（一）」。 */
  readonly article: string;
}

/** 一个要件项。 */
export interface RequirementItem {
  /** 要件键。公共层与来源层是 clue.*，类型层是 type.<类型编码>.<字段>（ADR 0020）。 */
  readonly key: string;
  /** 项名。界面显示中文要件名（#207 协议 E 节）。 */
  readonly label: string;
  /** 呈现：显示在哪一组。取值必须属于所在层的封闭分组清单（#199 决议）。 */
  readonly group: string;
  /** 必填性：只决定缺件判定是否检查该项（#198 决议）。 */
  readonly required: boolean;
  /** 必填时机。 */
  readonly timing: RequirementTiming;
  /** 缺件后果。 */
  readonly consequence: RequirementConsequence;
  /** 条件说明。条件必填项写明条件（#181 草案的写法）。 */
  readonly condition?: string;
  /** 依据引用。 */
  readonly basis: readonly BasisReference[];
  /** 依据栏里解析不出文件编号的原文（如「实务」「契约 §3.7」）。 */
  readonly basisNote?: string;
}

/** 类型层要件项。与公共层、来源层同一形状，只是键的形态不同。 */
export type TypeLayerItem = RequirementItem;

/** 法域（一条线索一个法域；#24 决议第十节）。 */
export const DOMAINS = ['land', 'mineral', 'survey', 'planning'] as const;
export type Domain = (typeof DOMAINS)[number];

/** 公共层的封闭分组清单（#199 决议第三节）。 */
export const PUBLIC_GROUPS = ['线索基本信息', '材料与标签'] as const;

/** 类型层的封闭分组清单（#199 决议第一节：全法域共用一套固定分组，共五栏）。 */
export const TYPE_GROUPS = ['违法主体', '涉案对象', '违法事实', '许可资质与审批', '程序环节'] as const;

/** 来源层的封闭分组清单：栏名取来源大类名（#199 决议第四节）。 */
export const SOURCE_GROUPS = ['主动发现', '上级交办', '部门移送', '群众举报', '舆情监测'] as const;
