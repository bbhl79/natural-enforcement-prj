// 疑似重复的领域规则（#212；规格 B「几何与疑似重复」、协议 D 节）。
//
// 纯规则：逐面命中判定、比对范围、命中分组、展示口径、决定步契约、对称脱敏口径。
// 装配（HTTP、空间读写、事务、留痕）在启动包与持久化适配器，本目录不碰它们。
//
// 术语一律用 GLOSSARY 的词：疑似重复、命中面对、占本线索／占对方、撤回不派、已知晓。

/**
 * 疑似重复的重合阈值（规格 B、USER LOCK 七项业务①）。
 * 逐面判定：交集占任一方的单面面积达到该值即该面对命中；整体合并不算。
 */
export const DUPLICATE_OVERLAP_THRESHOLD = 0.6;

/**
 * 退出比对的线索状态（规格 B）。已立案（filed）仍算未结案，继续参与比对。
 * 其余状态（待分派决定、待分派池、已派机构、已派承办人、暂缓）都参与比对。
 */
export const NOT_COMPARABLE_CLUE_STATUSES = ['closed', 'transferred_out'] as const;

/**
 * 可被打上疑似重复标记的对方线索状态（规格 B 对方状态条）。
 * 撞上对方只打标记，不改对方状态；结案与已移送的线索不参与比对，不在此表。
 */
export const MARKABLE_PEER_STATUSES = [
  'in_pool',
  'pending_decision',
  'org_assigned',
  'handler_assigned',
  'held',
  'filed',
] as const;

/** 一亩等于的平方米数（界面按亩换算交集面积）。 */
export const SQUARE_METERS_PER_MU = 2000 / 3;

/** 点状线索不做空间重合判定时的界面说明（规格 B）。 */
export const POINT_NO_OVERLAP_NOTICE = '点状线索不做空间重合判定，后续由人工核查判断。';

/** 举报类来源的大类编码（群众举报及其下级）。这类线索只能派，不能选不派。 */
export const COMPLAINT_SOURCE_GROUP_CODE = '3';

/** 举报类选「不派」的规则码（规格错误码表）。 */
export const RULE_COMPLAINT_MUST_DISPATCH = 'complaint-must-dispatch';

/** 有未结案命中却未「已知晓」的规则码（规格错误码表）。 */
export const RULE_ACK_REQUIRED = 'ack-required';

/** 几何形态：面状线索做空间重合判定，点状不做。 */
export type DuplicateSpatialKind = 'face' | 'point';

/** 线索主状态的中文说明（对方线索状态展示用）。 */
export const CLUE_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending_decision: '待分派决定',
  in_pool: '待分派',
  org_assigned: '已派机构',
  handler_assigned: '已派承办人',
  held: '暂缓',
  transferred_out: '已移送',
  closed: '已结案',
  filed: '已立案',
};

/** 处置类型的中文说明（历史关联的对方处置展示用）。 */
export const DISPOSITION_LABELS: Readonly<Record<string, string>> = {
  'no-case': '不予立案',
  'with-old': '随旧线索办结',
  transfer: '移送',
  other: '其他（行政处理事项，系统外办理）',
};

/** 一个线索的状态是否参与比对（规格 B）。 */
export function isComparableClueStatus(status: string): boolean {
  return !(NOT_COMPARABLE_CLUE_STATUSES as readonly string[]).includes(status);
}

/** 该状态的对方线索能否被打上疑似重复标记。 */
export function isMarkablePeerStatus(status: string): boolean {
  return (MARKABLE_PEER_STATUSES as readonly string[]).includes(status);
}

/**
 * 对方线索被新线索撞上后的主状态（规格 B 对方状态条）。
 * 只打疑似重复标记，不改对方状态：这里返回原值。
 * 对方在待分派决定时不因命中消失自动解除——解除属撤回不派（另票），本票不改状态。
 */
export function peerStatusAfterHit(status: string): string {
  return status;
}

/** 该几何形态是否做空间重合判定（规格 B：点状直接「不做空间重合判定」）。 */
export function doesSpatialOverlapJudgement(kind: DuplicateSpatialKind): boolean {
  return kind === 'face';
}

/** 一个面对的三个面积（平方米，geography 面积）。 */
export interface FacePairAreas {
  /** 本线索该面的面积。 */
  readonly selfArea: number;
  /** 对方该面的面积。 */
  readonly otherArea: number;
  /** 交集面积。 */
  readonly intersectionArea: number;
}

/** 逐面对的双方面重合度（比例＝交集面积 ÷ 各自单面面积）。 */
export interface FacePairRatios {
  /** 占本线索该面的比例（0..1）。 */
  readonly selfRatio: number;
  /** 占对方该面的比例（0..1）。 */
  readonly otherRatio: number;
}

/** 由三处面积算出双方面比例。面积为 0 时比例记 0。 */
export function facePairRatios(areas: FacePairAreas): FacePairRatios {
  return {
    selfRatio: areas.selfArea > 0 ? areas.intersectionArea / areas.selfArea : 0,
    otherRatio: areas.otherArea > 0 ? areas.intersectionArea / areas.otherArea : 0,
  };
}

/**
 * 该面对是否命中：任一方达到阈值即命中。
 * 对单个面对，这与「交集 ÷ 两面中较小面积 ≥ 阈值」等价。
 */
export function isFacePairHit(ratios: FacePairRatios): boolean {
  return (
    ratios.selfRatio >= DUPLICATE_OVERLAP_THRESHOLD ||
    ratios.otherRatio >= DUPLICATE_OVERLAP_THRESHOLD
  );
}

/** 达标的一方：决定界面上哪一侧加粗。 */
export type FacePairBoldSide = 'self' | 'other' | 'both';

/** 达标方。 */
export function facePairBoldSide(ratios: FacePairRatios): FacePairBoldSide {
  const selfHit = ratios.selfRatio >= DUPLICATE_OVERLAP_THRESHOLD;
  const otherHit = ratios.otherRatio >= DUPLICATE_OVERLAP_THRESHOLD;
  if (selfHit && otherHit) return 'both';
  return selfHit ? 'self' : 'other';
}

/** 比例显示：保留 1 位小数。 */
export function formatRatio(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** 界面口径：占本线索 x.x%／占对方 y.y%。 */
export function formatFacePairLabel(ratios: FacePairRatios): string {
  return `占本线索 ${formatRatio(ratios.selfRatio)}／占对方 ${formatRatio(ratios.otherRatio)}`;
}

/** 平方米换算成亩（1 亩 = 2000/3 平方米）。 */
export function squareMetersToMu(squareMeters: number): number {
  return squareMeters / SQUARE_METERS_PER_MU;
}

/** 一个命中面对（双方面 ID、双方比例与交集面积）。 */
export interface FacePair {
  readonly partId: string;
  readonly partIndex: number;
  readonly otherClueId: string;
  readonly otherClueCode: string;
  readonly otherPartId: string;
  readonly otherPartIndex: number;
  readonly selfRatio: number;
  readonly otherRatio: number;
  readonly intersectionArea: number;
}

/** 按对方线索分组后的一个条目：对方线索编号与其全部命中面对。 */
export interface DuplicateGroup {
  readonly otherClueId: string;
  readonly otherClueCode: string;
  readonly faces: readonly FacePair[];
}

/**
 * 按对方线索分组（规格 B：界面按对方线索分组折叠）。
 * 组内按本线索面序号排，组间按对方线索编号排。
 */
export function groupFacesByOtherClue(faces: readonly FacePair[]): DuplicateGroup[] {
  const byOther = new Map<string, FacePair[]>();
  for (const face of faces) {
    const bucket = byOther.get(face.otherClueId);
    if (bucket === undefined) byOther.set(face.otherClueId, [face]);
    else bucket.push(face);
  }
  return [...byOther.entries()]
    .map(([otherClueId, bucket]) => {
      const sorted = [...bucket].sort(
        (left, right) => left.partIndex - right.partIndex || left.otherPartIndex - right.otherPartIndex,
      );
      const first = sorted[0] as FacePair;
      return { otherClueId, otherClueCode: first.otherClueCode, faces: sorted };
    })
    .sort((left, right) => left.otherClueCode.localeCompare(right.otherClueCode));
}

/** 决定步的输入：来源大类与当前命中集。 */
export interface DuplicateDecisionInput {
  /** 来源大类编码（1／5／22／3／21）。取不到时传 null。 */
  readonly sourceGroupCode: string | null;
  /** 当前命中集（对方线索编号与其主状态）。 */
  readonly hits: readonly { readonly otherClueCode: string; readonly otherStatus: string }[];
}

/** 决定步的领域契约（#212 落数据契约与规则，接口接线留 #214）。 */
export interface DuplicateDecisionContract {
  /** 是否经决定步（有命中才经）。 */
  readonly requiresDecision: boolean;
  /** 是否只能派、不能选不派（举报类来源）。 */
  readonly mustDispatch: boolean;
  /** 是否可选不派。 */
  readonly allowHold: boolean;
  /** 默认是否不派。 */
  readonly defaultHold: boolean;
  /** 是否必须先「已知晓」（有未结案命中才要）。 */
  readonly requireAcknowledge: boolean;
  /** 举报类来源的规则码（其余为空）。 */
  readonly ruleCodes: readonly string[];
}

/**
 * 决定步的领域规则（规格 B、GLOSSARY「疑似重复」）：
 * - 有命中才经决定步；无命中直接进待分派池。
 * - 举报类来源只能派，不能选不派；仍展示重合信息。
 * - 有未结案命中时须「已知晓」；全部对方已结案时可直接派出，仍由人完成决定。
 * - 非举报类有命中时默认不派。
 */
export function duplicateDecisionContract(
  input: DuplicateDecisionInput,
): DuplicateDecisionContract {
  const hasHits = input.hits.length > 0;
  const complaint = input.sourceGroupCode === COMPLAINT_SOURCE_GROUP_CODE;
  const hasOpenHit = input.hits.some((hit) => isComparableClueStatus(hit.otherStatus));
  return {
    requiresDecision: hasHits,
    mustDispatch: complaint,
    allowHold: hasHits && !complaint,
    defaultHold: hasHits && !complaint,
    requireAcknowledge: hasHits && hasOpenHit,
    ruleCodes: complaint ? [RULE_COMPLAINT_MUST_DISPATCH] : [],
  };
}

/** 登记时间只到月（匿名对称保护下的显示口径）。 */
export function formatRegisteredAtMonth(value: Date): string {
  const year = value.getUTCFullYear();
  const month = `${value.getUTCMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
}

/** 登记时间完整到日（未受匿名对称保护时的显示口径）。 */
export function formatRegisteredAtDay(value: Date): string {
  const month = formatRegisteredAtMonth(value);
  return `${month}-${`${value.getUTCDate()}`.padStart(2, '0')}`;
}

/**
 * 位置只到区（匿名对称保护下的显示口径）。
 * 从位置文本里取到第一个区县级字样为止；取不到时不给位置。
 */
export function limitedLocation(locationText: string | null): string | null {
  if (locationText === null) return null;
  const trimmed = locationText.trim();
  const matched = /^(.{0,20}?[区县])/.exec(trimmed);
  return matched === null ? null : matched[1];
}

/** 反映人姓名的脱敏显示（对称脱敏）。 */
export function maskReporterName(name: string | null): string | null {
  if (name === null || name.trim() === '') return null;
  return `${name.trim().slice(0, 1)}*`;
}

/** 反映人联系方式的脱敏显示（对称脱敏）。 */
export function maskReporterContact(contact: string | null): string | null {
  if (contact === null || contact.trim() === '') return null;
  const digits = contact.replace(/\D/g, '');
  if (digits.length >= 7) return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
  return '*******';
}

/** 涉匿名线索的显示口径：反映人身份与联系方式按权限对称脱敏。 */
export const ANONYMOUS_REPORTER_DISPLAY = '匿名 [对称脱敏受控]';
