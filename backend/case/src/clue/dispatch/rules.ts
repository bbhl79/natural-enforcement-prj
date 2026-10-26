// 分派决定与两步分派的领域规则（#214；规格 A/B/D 节、GLOSSARY）。
//
// 纯规则、不依赖 Nest 与存储：决定步的「默认不派／已知晓／举报必派」、
// 两步分派的状态门槛都在这里判，接口层只负责把事实喂进来、把判别联合映射成 HTTP。

/** 分派决定与分派的校验规则码（400 non-compliant 的 rules 列取值）。 */
export const CLUE_DISPATCH_RULE_CODES = [
  /** 来源为群众举报及其下级的线索只能派、不能选不派。 */
  'complaint-must-dispatch',
  /** 存在未结案的疑似重复命中，派出前须点「已知晓」。 */
  'ack-required',
  /** 重新分派与指定管辖的理由必填。 */
  'missing-reassign-reason',
  /** 目标机构必填。 */
  'org-unit-required',
  /** 目标机构已停用。 */
  'org-unit-deactivated',
  /** 主办承办人必填。 */
  'handler-main-required',
  /** 承办人已停用或不属于承办机构。 */
  'assignee-not-qualified',
] as const;

/** 退出疑似重复比对的线索状态：结案与已移送；已立案（filed）仍算未结案。 */
export const DUP_TERMINAL_STATUSES = ['closed', 'transferred_out'] as const;

/** 分派决定步的线索状态。 */
export const DECIDE_FROM_STATUS = 'pending_decision';

/** 派机构允许的来源状态：待分派池（首次分派）、已派机构与已派承办人（重新分派）。 */
export const ORG_ASSIGN_FROM_STATUSES = ['in_pool', 'org_assigned', 'handler_assigned'] as const;

/** 派主办／协办允许的来源状态。 */
export const PEOPLE_ASSIGN_FROM_STATUS = 'org_assigned';

/** 已分派状态：派机构在这两种状态下是重新分派或指定管辖。 */
const ASSIGNED_STATUSES: readonly string[] = ['org_assigned', 'handler_assigned'];

/**
 * 派机构的去向（#228）。成功时 orgUnitId 是要写入的承办机构；reassign 只携带当前承办机构，
 * 所以重新分派不可能写出 previousOrgId ≠ orgUnitId 的成功记录。
 */
export type OrgAssignPlan =
  | { readonly ok: true; readonly kind: 'initial' | 'reassign' | 'designate'; readonly orgUnitId: string }
  | { readonly ok: false; readonly reason: 'designation-required'; readonly nextAction: 'clue.designate.request' };

/**
 * 派机构分流（#228；GLOSSARY「重新分派」「指定管辖」）。
 *
 * - designate=true：指定管辖，含上级主动指定与处理报请。
 * - 待分派池：首次分派。
 * - 已分派且 designate=false：只能留在当前承办机构；目标是另一机构的拒绝 designation-required，
 *   出路是报请指定管辖（clue.designate.request）。
 */
export function planOrgAssign(input: {
  readonly status: string;
  readonly currentOrgId: string | null;
  readonly targetOrgId: string;
  readonly designate: boolean;
}): OrgAssignPlan {
  if (input.designate) return { ok: true, kind: 'designate', orgUnitId: input.targetOrgId };
  if (!ASSIGNED_STATUSES.includes(input.status)) {
    return { ok: true, kind: 'initial', orgUnitId: input.targetOrgId };
  }
  if (input.currentOrgId === null || input.currentOrgId !== input.targetOrgId) {
    return { ok: false, reason: 'designation-required', nextAction: 'clue.designate.request' };
  }
  return { ok: true, kind: 'reassign', orgUnitId: input.currentOrgId };
}

/** 决定步结果。 */
export type DecideOutcome =
  | { readonly ok: true; readonly nextStatus: 'in_pool' | 'held' }
  | { readonly ok: false; readonly rule: 'complaint-must-dispatch' | 'ack-required' };

/**
 * 分派决定（规格 B、GLOSSARY「疑似重复」）。
 *
 * - 默认不派：决定「不派」进入 held（不派）。
 * - 已知晓：存在未结案命中时，须 acknowledged 才能派；留痕含已知晓。
 * - 举报必派：来源大类 3（群众举报及其下级）只能派、不能选不派，重合信息仍展示。
 * - 全部对方已结案（openHitCount = 0）时可直接派出，但仍由人完成决定。
 */
export function decideDispatch(input: {
  readonly complaint: boolean;
  readonly openHitCount: number;
  readonly decision: 'dispatch' | 'hold';
  readonly acknowledged: boolean;
}): DecideOutcome {
  if (input.decision === 'hold') {
    if (input.complaint) return { ok: false, rule: 'complaint-must-dispatch' };
    return { ok: true, nextStatus: 'held' };
  }
  if (input.complaint) return { ok: true, nextStatus: 'in_pool' };
  if (input.openHitCount > 0 && !input.acknowledged) return { ok: false, rule: 'ack-required' };
  return { ok: true, nextStatus: 'in_pool' };
}

/** 命中是否未结案（决定步只把未结案命中算作「须已知晓」）。 */
export function isOpenHit(otherStatus: string): boolean {
  return !(DUP_TERMINAL_STATUSES as readonly string[]).includes(otherStatus);
}
