// 报请指定管辖的领域规则（#215；规格 D 节、GLOSSARY「指定管辖」）。
//
// 纯规则、不依赖 Nest 与存储：受理人（最近共同上级）的候选链在这里由两条
// 机构根链算出来，接口层只负责取链、筛「有内勤的最近一级」并把判别联合映射成 HTTP。
//
// 机构根链形态（identity 的 findOrgUnitPathToRoot）：自根向叶排列，末位是机构自身。

/** 报请指定管辖允许的来源状态（规格 D：待分派池、已派机构、已派承办人）。 */
export const DESIGNATE_REQUEST_FROM_STATUSES = ['in_pool', 'org_assigned', 'handler_assigned'] as const;

/** 报请与驳回的校验规则码（400 non-compliant 的 rules 列取值）。 */
export const CLUE_DESIGNATE_RULE_CODES = [
  /** 报请理由必填。 */
  'missing-designate-reason',
  /** 拟归属机构已停用。 */
  'org-unit-deactivated',
  /** 驳回理由必填。 */
  'missing-reject-reason',
] as const;

/** 报请指定管辖被拒（outcome=failed）的原因（规格 G）。 */
export const CLUE_DESIGNATE_REQUESTED_FAILED_REASONS = [
  'missing-designate-reason',
  'org-unit-deactivated',
  'invalid-state',
  'designation-pending',
  'concurrent-change',
] as const;
export type ClueDesignateRequestedFailedReason =
  (typeof CLUE_DESIGNATE_REQUESTED_FAILED_REASONS)[number];

/** 驳回指定管辖报请被拒（outcome=failed）的原因（规格 G）。 */
export const CLUE_DESIGNATE_REJECTED_FAILED_REASONS = [
  'missing-reject-reason',
  'invalid-state',
  'concurrent-change',
] as const;
export type ClueDesignateRejectedFailedReason =
  (typeof CLUE_DESIGNATE_REJECTED_FAILED_REASONS)[number];

/**
 * 受理机构候选链（规格 D：受理人＝报请方与拟归属机构的最近共同上级内勤）。
 *
 * - 有拟归属机构：取两条根链的公共前缀（自根向叶的公共祖先链），排除报请机构自身，
 *   自最近向更远排列。报请机构是拟归属机构祖先的，公共前缀含报请机构自身，同样排除——
 *   受理人必须是报请方的上级，不能是报请方自己。
 * - 未选拟归属机构：受理人为直接上级内勤，候选链即报请机构的祖先链（不含自身），
 *   自最近向更远排列。
 *
 * 候选链只是机构链；「有内勤的最近一级」由接口层逐环节查人员后落定（见服务）。
 */
export function reviewerOrgCandidates(input: {
  readonly requestingOrgId: string;
  /** 报请机构的根链（自根向叶，末位为报请机构自身）。 */
  readonly requestingPath: readonly string[];
  /** 拟归属机构的根链；未选拟归属机构时为 null。 */
  readonly proposedPath: readonly string[] | null;
}): readonly string[] {
  const { requestingOrgId, requestingPath, proposedPath } = input;
  let common: readonly string[];
  if (proposedPath === null) {
    common = requestingPath;
  } else {
    const shared: string[] = [];
    const length = Math.min(requestingPath.length, proposedPath.length);
    for (let index = 0; index < length; index += 1) {
      if (requestingPath[index] !== proposedPath[index]) break;
      shared.push(requestingPath[index] as string);
    }
    common = shared;
  }
  return common
    .filter((orgUnitId) => orgUnitId !== requestingOrgId)
    .reverse();
}
