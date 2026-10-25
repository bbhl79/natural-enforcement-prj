// 规划类违法类型的分派指导（#207 P7）。
// 附录 D 三分：体系内 9／个案判断 8／纯外 0（本期空清单）。
// #207 不硬编码清单，本映射由已定稿的归属表生成，配置承载。
//
// 体系内 9：走系统内办理或报请指定管辖／移送上级，不走移送系统外。
// 个案判断 8：一期在分派界面标「主体冲突待定」，人工选方向并留痕依据。
// 纯外 0：本期空。

import { DISPATCH_GUIDANCE } from '@natural-enforcement/geo-dict';

/** 分派指导分类。 */
export type DispatchGuidance = 'system-internal' | 'case-by-case' | 'external';

/**
 * 规划类违法类型编码 → 分派指导映射。
 * 由 tools/generate-clue-reference-data.mjs 从 docs/research/planning-dispatch-guidance.md 生成。
 */
export const PLANNING_DISPATCH_GUIDANCE: Readonly<Record<string, DispatchGuidance>> =
  Object.fromEntries(
    DISPATCH_GUIDANCE.map((row) => [row.typeCode, row.guidance as DispatchGuidance]),
  );

/**
 * 给定违法类型编码列表，判断是否存在需个案判断的规划类项。
 * 存在即应在分派界面展示「主体冲突待定」警告与方向选择。
 */
export function hasCaseByCasePlanningType(typeCodes: readonly string[]): boolean {
  return typeCodes.some((code) => PLANNING_DISPATCH_GUIDANCE[code] === 'case-by-case');
}

/** 分派方向：人工选择后的出口。 */
export type ConflictResolution = 'handle-in-system' | 'transfer-outside';

export const CONFLICT_RESOLUTION_LABELS: Readonly<Record<ConflictResolution, string>> = {
  'handle-in-system': '本系统办理',
  'transfer-outside': '移送系统外',
};