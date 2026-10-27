// 人员层利害关系与回避（#237）。纯规则，不依赖 Nest 与存储。
//
// 状态只追加：同一声明链的最新一行才是当前状态。
// 「声明」与「生效」进入 activeConflicts，并暂停签出。
// 「驳回」之后该链不再处于活动状态，签出权恢复。
//
// 决定人两级（规程 2.7，票面原文）：
// - 承办人员本人申请，且被申请人不是承办机构负责人：承办机构负责人决定；
// - 当事人申请，或被申请人是承办机构负责人：自然资源主管部门负责人决定。
// 他人勾选票面未单列决定人。不涉及承办机构负责人时，与本人申请同级；
// 涉及承办机构负责人时，走主管部门负责人。
// 谁算哪一级，由调用方按 #71／#105 现有数据喂布尔事实。本文件不把角色名写死。

/** 来源：本人申请 | 当事人申请 | 他人勾选。 */
export const CONFLICT_SOURCES = ['self', 'party', 'other'] as const;
export type ConflictSource = (typeof CONFLICT_SOURCES)[number];

/** 状态：声明 | 生效 | 驳回。 */
export const CONFLICT_STATUSES = ['declared', 'effective', 'rejected'] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

/** activeConflicts 计入的状态。驳回不在此列。 */
export const ACTIVE_CONFLICT_STATUSES = ['declared', 'effective'] as const;
export type ActiveConflictStatus = (typeof ACTIVE_CONFLICT_STATUSES)[number];

/** 回避决定结论：回避 | 驳回。 */
export const DECISION_CONCLUSIONS = ['recuse', 'reject'] as const;
export type DecisionConclusion = (typeof DECISION_CONCLUSIONS)[number];

/** 签出类型：审理意见 | 法审意见 | 决定。 */
export const SIGN_KINDS = ['trial-opinion', 'legal-opinion', 'decision'] as const;
export type SignKind = (typeof SIGN_KINDS)[number];

/** 决定人席位。调用方把人员映射成席位后再交给本函数。 */
export const DECIDER_SEATS = ['handling-org-head', 'competent-authority-head'] as const;
export type DeciderSeat = (typeof DECIDER_SEATS)[number];

/** 调查继续登记的种类：笔录 | 违法记录。回避声明不拦截这两类。 */
export const INVESTIGATION_KINDS = ['transcript', 'violation'] as const;
export type InvestigationKind = (typeof INVESTIGATION_KINDS)[number];

/** 签出被拒的留痕文案（票面原文）。声明与生效命中共用这一句。 */
export const SIGN_REFUSED_MESSAGE = '声明期间签出被拒';
/** 签出被拒的出路（票面原文）。 */
export const SIGN_REFUSED_OUTLET = '等待回避决定';

export const CONFLICT_SOURCE_NAMES: Readonly<Record<ConflictSource, string>> = {
  self: '本人申请',
  party: '当事人申请',
  other: '他人勾选',
};

export const CONFLICT_STATUS_NAMES: Readonly<Record<ConflictStatus, string>> = {
  declared: '声明',
  effective: '生效',
  rejected: '驳回',
};

export const DECISION_CONCLUSION_NAMES: Readonly<Record<DecisionConclusion, string>> = {
  recuse: '回避',
  reject: '驳回',
};

export const SIGN_KIND_NAMES: Readonly<Record<SignKind, string>> = {
  'trial-opinion': '审理意见',
  'legal-opinion': '法审意见',
  decision: '决定',
};

export const INVESTIGATION_KIND_NAMES: Readonly<Record<InvestigationKind, string>> = {
  transcript: '笔录',
  violation: '违法记录',
};

/** 一条只追加的利害关系事件。 */
export interface ConflictEventFact {
  readonly id: string;
  readonly lineageId: string;
  readonly caseId: string;
  readonly personId: string;
  readonly source: string;
  readonly reason: string;
  readonly status: string;
  /** 同一声明链内的序号。越大越新。时间相同也按它分先后。 */
  readonly seq: number;
  readonly createdAt: Date;
}

export function isConflictSource(value: string): value is ConflictSource {
  return (CONFLICT_SOURCES as readonly string[]).includes(value);
}

export function isConflictStatus(value: string): value is ConflictStatus {
  return (CONFLICT_STATUSES as readonly string[]).includes(value);
}

export function isActiveConflictStatus(value: string): value is ActiveConflictStatus {
  return (ACTIVE_CONFLICT_STATUSES as readonly string[]).includes(value);
}

export function isDecisionConclusion(value: string): value is DecisionConclusion {
  return (DECISION_CONCLUSIONS as readonly string[]).includes(value);
}

export function isSignKind(value: string): value is SignKind {
  return (SIGN_KINDS as readonly string[]).includes(value);
}

export function isInvestigationKind(value: string): value is InvestigationKind {
  return (INVESTIGATION_KINDS as readonly string[]).includes(value);
}

/** 回避结论写成下一条状态。 */
export function statusAfterDecision(conclusion: DecisionConclusion): ConflictStatus {
  return conclusion === 'recuse' ? 'effective' : 'rejected';
}

function later(left: ConflictEventFact, right: ConflictEventFact): ConflictEventFact {
  if (left.seq !== right.seq) return left.seq > right.seq ? left : right;
  const delta = left.createdAt.getTime() - right.createdAt.getTime();
  if (delta !== 0) return delta > 0 ? left : right;
  return left.id > right.id ? left : right;
}

/** 每条声明链只留时间上最新的一行。 */
export function latestConflictEvents(events: readonly ConflictEventFact[]): ConflictEventFact[] {
  const latest = new Map<string, ConflictEventFact>();
  for (const event of events) {
    const previous = latest.get(event.lineageId);
    latest.set(event.lineageId, previous ? later(previous, event) : event);
  }
  return [...latest.values()].sort((left, right) => {
    const delta = left.createdAt.getTime() - right.createdAt.getTime();
    if (delta !== 0) return delta;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

/**
 * 该人在本案的活动记录：声明链最新状态为「声明」或「生效」。
 * personId 省略时返回本案全部活动记录。
 */
export function activeConflicts(
  events: readonly ConflictEventFact[],
  personId?: string,
): ConflictEventFact[] {
  return latestConflictEvents(events).filter((event) => {
    if (!isActiveConflictStatus(event.status)) return false;
    return personId === undefined || event.personId === personId;
  });
}

/** 审理、法审、决定签出：活动记录命中即暂停。 */
export function signingPaused(events: readonly ConflictEventFact[], personId: string): boolean {
  return activeConflicts(events, personId).length > 0;
}

/** 法审接收人候选：去掉有声明或生效记录的人，保持原顺序。 */
export function excludeConflictedCandidates(
  personIds: readonly string[],
  events: readonly ConflictEventFact[],
): string[] {
  const blocked = new Set(activeConflicts(events).map((event) => event.personId));
  return personIds.filter((personId) => !blocked.has(personId));
}

/** 本条声明应当由哪一级决定人作出。 */
export function requiredDeciderSeat(input: {
  readonly source: ConflictSource;
  readonly subjectIsHandlingOrgHead: boolean;
}): DeciderSeat {
  if (input.source === 'party' || input.subjectIsHandlingOrgHead) return 'competent-authority-head';
  return 'handling-org-head';
}

/**
 * 决定人席位是否与申请方式匹配。
 * 须由主管部门负责人决定时，承办机构负责人作出决定不算匹配。
 */
export function deciderSeatMatches(input: {
  readonly source: ConflictSource;
  readonly subjectIsHandlingOrgHead: boolean;
  readonly deciderIsHandlingOrgHead: boolean;
  readonly deciderIsCompetentAuthorityHead: boolean;
}): boolean {
  const required = requiredDeciderSeat(input);
  if (required === 'handling-org-head') return input.deciderIsHandlingOrgHead;
  return input.deciderIsCompetentAuthorityHead && !input.deciderIsHandlingOrgHead;
}
