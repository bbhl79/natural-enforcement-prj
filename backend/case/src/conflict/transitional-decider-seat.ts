// 过渡映射，待岗位模型能区分两级负责人后替换。
// 替换点只有 transitionalDeciderSeats。岗位模型能区分两级负责人之后，只改本函数。
// 调用方只提供人员事实，不另写席位判断。

/**
 * 当前用来识别决定人的角色。
 * #105 岗位不能表示承办机构负责人与自然资源主管部门负责人。
 * doc.approve 只授给这个角色。本映射不新增岗位，不改允许行。
 */
export const TRANSITIONAL_DECIDER_ROLE = '行政审批';

/** 算席位所需的人员事实。 */
export interface TransitionalDeciderFacts {
  readonly roles: readonly string[];
  readonly orgUnitId: string | null;
  readonly handlingOrgId: string;
  /** 承办机构到根的路径，含承办机构自身。 */
  readonly orgPathToRoot: readonly string[];
}

/** 两级席位。过渡映射下两级互斥。 */
export interface TransitionalDeciderSeats {
  readonly isHandlingOrgHead: boolean;
  readonly isCompetentAuthorityHead: boolean;
}

const NEITHER: TransitionalDeciderSeats = {
  isHandlingOrgHead: false,
  isCompetentAuthorityHead: false,
};

/**
 * 过渡映射，待岗位模型能区分两级负责人后替换。
 * 任职机构等于承办机构的行政审批，当作承办机构负责人。
 * 任职机构在承办机构上级路径上的行政审批，当作自然资源主管部门负责人。
 */
export function transitionalDeciderSeats(facts: TransitionalDeciderFacts): TransitionalDeciderSeats {
  if (facts.orgUnitId == null || !facts.roles.includes(TRANSITIONAL_DECIDER_ROLE)) return NEITHER;
  if (facts.orgUnitId === facts.handlingOrgId) {
    return { isHandlingOrgHead: true, isCompetentAuthorityHead: false };
  }
  return {
    isHandlingOrgHead: false,
    isCompetentAuthorityHead: facts.orgPathToRoot.includes(facts.orgUnitId),
  };
}
