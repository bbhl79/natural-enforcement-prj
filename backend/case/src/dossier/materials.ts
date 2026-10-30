// 卷宗必需材料（#243 G4／Q25）：按案件发生过的事件推导，不逐案勾选。
// 底稿是规程 13.1 的 21 项。本文件是带版本的代码常量，#244 结案检查点读同一份、同一版本。
// 每案必有 (1)(2)(4)(19)；走到审理、决定的加 (5)(6)(7)(9)；
// 移送管辖、终止调查结案可豁免这四项（G4 P4-A）；豁免项每项依据必填，空依据不豁免。
// 送达事项（20）按 Q27 接受回证，或公告送达的原因经过记录加公告材料（规程 9.6）。
// 退回后失效分支的材料标「非当前」，不算入当前卷宗。

import { stageIndex } from '../state-machine/catalog.ts';

export interface DossierMaterialDefinition {
  readonly code: number;
  readonly name: string;
}

/** 规程 13.1 的 21 项归档材料。顺序即清单顺序。 */
export const DOSSIER_MATERIALS: readonly DossierMaterialDefinition[] = [
  { code: 1, name: '封面、目录' },
  { code: 2, name: '案件来源材料' },
  { code: 3, name: '责令停止违法行为通知书、责令改正违法行为通知书' },
  { code: 4, name: '立案（不予立案）呈批表' },
  { code: 5, name: '证据材料' },
  { code: 6, name: '调查报告' },
  { code: 7, name: '审理记录' },
  { code: 8, name: '重大执法决定法制审核意见' },
  { code: 9, name: '案件处理决定呈批表' },
  { code: 10, name: '行政处罚告知书' },
  { code: 11, name: '当事人陈述申辩材料、复核意见书' },
  { code: 12, name: '行政处罚听证告知书、听证通知书、听证笔录等' },
  { code: 13, name: '行政处罚决定书或者行政处理决定' },
  { code: 14, name: '党纪政务处分决定、问题线索移送书、刑事判决书、涉嫌犯罪案件移送书、案件管辖移送书' },
  { code: 15, name: '履行处罚决定催告书' },
  { code: 16, name: '强制执行申请书、申请送达情况记录' },
  { code: 17, name: '行政处罚决定执行记录、罚没收据、缴纳相关费用收据、暂缓或分期缴纳罚款的审批材料、吊销许可证件公告、非法财物移交书、非法财物清单、撤销批准文件的决定及相关材料' },
  { code: 18, name: '行政复议决定书、人民法院裁判文书副本' },
  { code: 19, name: '案件结案呈批表' },
  { code: 20, name: '有关法律文书送达回证' },
  { code: 21, name: '其他需要归档的材料' },
];

export const DOSSIER_MATERIALS_RULE_ID = 'cfg.rule.dossier-materials.v1';
export const DOSSIER_MATERIALS_VERSION = '2026-10-30';
export const DOSSIER_MATERIALS_BASIS = '自然资源违法行为立案查处工作规程（试行）13.1；#32 Q25 定案（2026-10-27 13:18）';

/** 每案必有。 */
export const DOSSIER_ALWAYS_REQUIRED_ITEMS = [1, 2, 4, 19] as const;

/** 走到审理、决定的案件追加。 */
export const DOSSIER_REVIEW_REQUIRED_ITEMS = [5, 6, 7, 9] as const;

/** 送达事项的材料项。Q27 的「A 或 B」落在这一项的证据上。 */
export const DOSSIER_DELIVERY_ITEM = 20;

const MATERIAL_NAMES = new Map(DOSSIER_MATERIALS.map((item) => [item.code, item.name]));

export function dossierMaterialName(code: number): string | null {
  return MATERIAL_NAMES.get(code) ?? null;
}

export function isDossierMaterialCode(value: number): boolean {
  return MATERIAL_NAMES.has(value);
}

export interface DossierExemption {
  readonly itemCode: number;
  /** 必填。写不出依据的项不豁免。 */
  readonly basis: string;
}

export const DOSSIER_EXEMPTIONS_RULE_ID = 'cfg.rule.dossier-exemptions.v1';
export const DOSSIER_EXEMPTIONS_VERSION = '2026-10-30';

/** 移送管辖、终止调查结案可豁免的四项。 */
export const DOSSIER_EXEMPTIONS: readonly DossierExemption[] = [
  {
    itemCode: 5,
    basis: '规程 13.1；#32 G4 定案：移送管辖、终止调查结案的案件不要求证据材料（2026-10-27 13:11）',
  },
  {
    itemCode: 6,
    basis: '规程 13.1；#32 G4 定案：移送管辖、终止调查结案的案件不要求调查报告（2026-10-27 13:11）',
  },
  {
    itemCode: 7,
    basis: '规程 13.1；#32 G4 定案：移送管辖、终止调查结案的案件不要求审理记录（2026-10-27 13:11）',
  },
  {
    itemCode: 9,
    basis: '规程 13.1；#32 G4 定案：移送管辖、终止调查结案的案件不要求处理决定呈批表（2026-10-27 13:11）',
  },
];

/** 依据为空的项不豁免。 */
export function effectiveExemptions(
  entries: readonly DossierExemption[] = DOSSIER_EXEMPTIONS,
): readonly DossierExemption[] {
  return entries.filter((entry) => entry.basis.trim() !== '');
}

export interface DossierRequirementInput {
  /** 进入过 E04 或更后的环节。 */
  readonly reachedReview: boolean;
  /** 进入过 E10 或更后的环节（送达事件发生过）。 */
  readonly reachedDelivery: boolean;
  /** 终止调查后结案（T07）。 */
  readonly terminationClosed: boolean;
  /** 本案有管辖移送记载。 */
  readonly jurisdictionTransfer: boolean;
  readonly exemptions?: readonly DossierExemption[];
}

export interface DossierRequirement {
  readonly requiredItems: readonly number[];
  readonly exemptItems: readonly number[];
  readonly deliveryRequired: boolean;
}

/** 按事件推导本案的必需材料项。 */
export function requiredDossierItems(input: DossierRequirementInput): DossierRequirement {
  const exemptApplies = input.terminationClosed || input.jurisdictionTransfer;
  const exempt = exemptApplies
    ? effectiveExemptions(input.exemptions)
        .map((entry) => entry.itemCode)
        .filter((code) => (DOSSIER_REVIEW_REQUIRED_ITEMS as readonly number[]).includes(code))
    : [];
  const required = new Set<number>(DOSSIER_ALWAYS_REQUIRED_ITEMS);
  if (input.reachedReview) {
    for (const code of DOSSIER_REVIEW_REQUIRED_ITEMS) {
      if (!exempt.includes(code)) required.add(code);
    }
  }
  if (input.reachedDelivery) required.add(DOSSIER_DELIVERY_ITEM);
  return {
    requiredItems: [...required].sort((left, right) => left - right),
    exemptItems: input.reachedReview ? [...new Set(exempt)].sort((left, right) => left - right) : [],
    deliveryRequired: input.reachedDelivery,
  };
}

/** 从环节实例取事件。只认已登记的环节编码。 */
export function dossierEventsOf(stages: readonly string[]): {
  readonly reachedReview: boolean;
  readonly reachedDelivery: boolean;
} {
  const reviewIndex = stageIndex('E04');
  const deliveryIndex = stageIndex('E10');
  let reachedReview = false;
  let reachedDelivery = false;
  for (const stage of stages) {
    const index = stageIndex(stage);
    if (index < 0) continue;
    if (index >= reviewIndex) reachedReview = true;
    if (index >= deliveryIndex) reachedDelivery = true;
  }
  return { reachedReview, reachedDelivery };
}

/** 失效实例的键。材料登记在失效实例上即「非当前」。 */
export function dossierInstanceKey(stage: string, entrySeq: number): string {
  return `${stage}:${entrySeq}`;
}

export type DeliveryEvidence =
  | { readonly kind: 'receipt' }
  | {
      readonly kind: 'announcement';
      readonly reasonRecord: string;
      readonly announcementMaterials: readonly string[];
    };

export const DELIVERY_EVIDENCE_KINDS = ['receipt', 'announcement'] as const;

function evidenceText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function materialNames(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const names: string[] = [];
  for (const item of value) {
    const name = evidenceText(item);
    if (name !== '') names.push(name);
  }
  return names;
}

/**
 * Q27：送达事项接受「A 或 B」。
 * A＝送达回证；B＝公告送达的原因经过记录＋公告材料（规程 9.6）。B 缺任一部分都不成立。
 */
export function readDeliveryEvidence(raw: unknown): DeliveryEvidence | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const kind = evidenceText(body.kind);
  if (kind === 'receipt') return { kind };
  if (kind !== 'announcement') return null;
  const reasonRecord = evidenceText(body.reasonRecord);
  const announcementMaterials = materialNames(body.announcementMaterials);
  if (reasonRecord === '' || announcementMaterials === null || announcementMaterials.length === 0) return null;
  return { kind, reasonRecord, announcementMaterials };
}

export function deliveryEvidenceSatisfied(raw: unknown): boolean {
  return readDeliveryEvidence(raw) !== null;
}

export interface DossierMaterialFact {
  readonly itemCode: number;
  /** 材料登记在当前环节实例上。 */
  readonly current: boolean;
  /** 仅送达项使用。 */
  readonly evidenceJson: string | null;
}

export interface DossierChecklistRow {
  readonly itemCode: number;
  readonly itemName: string;
  readonly required: boolean;
  readonly exempt: boolean;
  readonly present: boolean;
  readonly current: boolean;
  readonly missing: boolean;
}

export type DossierConclusion = 'complete' | 'approved-missing';

export const DOSSIER_CONCLUSION_NAMES: Readonly<Record<DossierConclusion, string>> = {
  complete: '完整',
  'approved-missing': '经批准缺项',
};

export interface DossierCompletenessInput {
  readonly requirement: DossierRequirement;
  readonly materials: readonly DossierMaterialFact[];
  readonly receiptsComplete: boolean;
  readonly missingReason: string | null;
}

export interface DossierCompleteness {
  readonly checklist: readonly DossierChecklistRow[];
  readonly missingItems: readonly number[];
  /** 移送回证是否缺失。 */
  readonly receiptDeficient: boolean;
  /** 缺件或回证缺失，需要写理由。 */
  readonly reasonRequired: boolean;
  /** 需理由而没有理由。 */
  readonly blocked: boolean;
  /** 不阻断时的结论。 */
  readonly conclusion: DossierConclusion | null;
}

function evidenceOk(fact: DossierMaterialFact): boolean {
  if (fact.itemCode !== DOSSIER_DELIVERY_ITEM) return true;
  return deliveryEvidenceSatisfied(parseEvidence(fact.evidenceJson));
}

function parseEvidence(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** 比对必需项与已入卷材料，给出清单、缺件与结论。 */
export function evaluateDossierCompleteness(input: DossierCompletenessInput): DossierCompleteness {
  const required = new Set(input.requirement.requiredItems);
  const exempt = new Set(input.requirement.exemptItems);
  const checklist: DossierChecklistRow[] = [];
  const missing: number[] = [];
  for (const item of DOSSIER_MATERIALS) {
    const rows = input.materials.filter((fact) => fact.itemCode === item.code);
    const currentRows = rows.filter((fact) => fact.current);
    const present = currentRows.some((fact) => evidenceOk(fact));
    const isRequired = required.has(item.code);
    const isMissing = isRequired && !present;
    if (isMissing) missing.push(item.code);
    checklist.push({
      itemCode: item.code,
      itemName: item.name,
      required: isRequired,
      exempt: exempt.has(item.code),
      present,
      current: currentRows.length > 0,
      missing: isMissing,
    });
  }
  const receiptDeficient = !input.receiptsComplete;
  const reasonRequired = missing.length > 0 || receiptDeficient;
  const reason = input.missingReason?.trim() ?? '';
  return {
    checklist,
    missingItems: missing,
    receiptDeficient,
    reasonRequired,
    blocked: reasonRequired && reason === '',
    conclusion: reasonRequired ? 'approved-missing' : 'complete',
  };
}