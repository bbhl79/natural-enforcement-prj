// 规划类违法类型的分派指导（#207 P7）。
// 附录 D 三分：体系内 9／个案判断 8／纯外 0（本期空清单）。
// #207 不硬编码清单，本映射由已定稿的归属表生成，配置承载。
//
// 体系内 9：走系统内办理或报请指定管辖／移送上级，不走移送系统外。
// 个案判断 8：一期在分派界面标「主体冲突待定」，人工选方向并留痕依据。
// 纯外 0：本期空。

/** 分派指导分类。 */
export type DispatchGuidance = 'system-internal' | 'case-by-case' | 'external';

/**
 * 规划类违法类型编码 → 分派指导映射。
 * 体系内 9：一（三）＋ 三（一）～三（八）
 * 个案判断 8：一（一）（二）＋ 二（一）～二（六）
 * 纯外 0：本期空
 */
export const PLANNING_DISPATCH_GUIDANCE: Readonly<Record<string, DispatchGuidance>> = {
  // ---- 体系内 9（走系统内办理或报请指定管辖） ----
  'planning_completion_data_unreported': 'system-internal', // 一（三）
  'planning_compiler_beyond_qualification': 'system-internal', // 三（一）
  'planning_compiler_without_qualification': 'system-internal', // 三（二）
  'planning_compiler_fraud_practice': 'system-internal', // 三（三）
  'planning_compiler_condition_lapsed': 'system-internal', // 三（四）
  'planning_compiler_false_application': 'system-internal', // 三（五）
  'planning_compiler_improper_obtain': 'system-internal', // 三（六）
  'planning_compiler_certificate_transfer': 'system-internal', // 三（七）
  'planning_compiler_credit_record': 'system-internal', // 三（八）

  // ---- 个案判断 8（一期人工出口「主体冲突待定」） ----
  'planning_build_without_permit': 'case-by-case', // 一（一）
  'planning_temporary_build': 'case-by-case', // 一（二）
  'planning_heritage_approval_duty': 'case-by-case', // 二（一）
  'planning_heritage_prohibited_activity': 'case-by-case', // 二（二）
  'planning_heritage_building_deface': 'case-by-case', // 二（三）
  'planning_heritage_destructive_impact': 'case-by-case', // 二（四）
  'planning_heritage_building_damage': 'case-by-case', // 二（五）
  'planning_heritage_signboard': 'case-by-case', // 二（六）
};

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