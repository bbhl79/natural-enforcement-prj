// 缺件判定（#211；ADR 0018）。
//
// 判定规则只有一条来源：要件声明（`RequirementItem`）。前端渲染与服务端判定读同一份声明。
// 分层口径（GLOSSARY「缺件后果」）：
// - 公共层与来源层的阻断项缺失 → 阻断登记。类型层不阻断登记。
// - 类型层登记期缺件 = 必填 ∧ 时机为「录入时」∧ 未填。时机为「核查前补齐」的项到期日在核查，
//   不在登记期算缺件；它们随要件快照留档，核查时另算。
//
// 条件项：声明里的 condition 是中文说明，本模块按来源编码求值（来源大类 + 具体编码）。
// 声明侧目前只有两条条件项（巡查记录号、专项批次号），条件表在本文件显式列出，
// 声明新增条件项时同步补一行——不留「猜条件」的口子。

import type { RequirementItem } from '../requirements/types.ts';
import type { ClueFormValues, ClueGap, ClueGapAssessment, ClueLayer } from './types.ts';

/**
 * 条件项的来源编码表。
 * clue.patrol_no：来源选 16 日常巡查时必填。
 * clue.campaign_no：来源选 13 专项排查及其三级时必填（该项后果是警告，不阻断登记）。
 */
export const CONDITIONAL_ITEM_SOURCE_CODES: Readonly<Record<string, readonly string[]>> = {
  'clue.patrol_no': ['16'],
  'clue.campaign_no': ['13', '1301', '1302', '1303', '1304', '1305'],
};

/** 缺件判定输入。 */
export interface GapAssessmentInput {
  /** 叠加后的要件项（公共 + 来源 + 类型）。 */
  readonly items: readonly RequirementItem[];
  /** 表单取值（要件键 → 文本）。 */
  readonly values: ClueFormValues;
  /** 线索来源编码（具体编码，不是大类编码）。 */
  readonly sourceCode: string;
  /** 当事人不明：独立标记，不拦登记与分派；命中时主体名称一栏视为已填「无法确定」。 */
  readonly subjectUnknown: boolean;
  /** 由文件满足的要件键（位置由几何来源文件满足、随附材料由附件满足）。 */
  readonly fileSatisfiedKeys?: readonly string[];
}

/** 条件项在给定来源下是否成立。声明里没有 condition 的项恒成立。 */
export function itemApplies(item: RequirementItem, sourceCode: string): boolean {
  if (item.condition === undefined) return true;
  const codes = CONDITIONAL_ITEM_SOURCE_CODES[item.key];
  if (codes === undefined) return false;
  return codes.includes(sourceCode);
}

/** 要件层。类型层要件键以 `type.` 开头。 */
export function layerOf(item: RequirementItem): ClueLayer {
  return item.key.startsWith('type.') ? 'type' : 'public';
}

function isFilled(item: RequirementItem, input: GapAssessmentInput): boolean {
  if ((input.fileSatisfiedKeys ?? []).includes(item.key)) return true;
  // 当事人不明：主体名称一栏的「无法确定」是独立取值，不算缺件。
  if (input.subjectUnknown && item.key.endsWith('.subject_name')) return true;
  const value = input.values[item.key];
  return typeof value === 'string' && value.trim() !== '';
}

function toGap(item: RequirementItem, layer: ClueLayer): ClueGap {
  return {
    key: item.key,
    label: item.label,
    layer,
    required: item.required,
    timing: item.timing,
    consequence: item.consequence,
  };
}

/**
 * 判定缺件。
 * 阻断集合 = 公共层与来源层后果为阻断的项，未填且条件成立。
 * 类型层缺件集合 = 类型层必填、时机为「录入时」、未填的项。
 */
export function assessGaps(input: GapAssessmentInput): ClueGapAssessment {
  const blocking: ClueGap[] = [];
  const typeGaps: ClueGap[] = [];
  for (const item of input.items) {
    if (!item.required) continue;
    if (!itemApplies(item, input.sourceCode)) continue;
    if (isFilled(item, input)) continue;
    const layer = layerOf(item);
    if (layer === 'type') {
      if (item.timing === '录入时') typeGaps.push(toGap(item, layer));
      continue;
    }
    if (item.consequence === '阻断') blocking.push(toGap(item, layer));
  }
  return { blocking, typeGaps };
}

/** 缺件键集合。留痕与响应体用。 */
export function gapKeys(gaps: readonly ClueGap[]): string[] {
  return gaps.map((gap) => gap.key);
}
