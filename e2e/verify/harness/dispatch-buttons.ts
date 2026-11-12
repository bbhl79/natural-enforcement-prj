// 用途：定义分派视图按钮开关的唯一名单，供运行器矩阵核对与发现器推导共用。
// 分派视图按钮开关名单：单一来源。runner 核对矩阵与 discoverer 推导未核开关共用。
// 与 fixtures/scenarios/schema.md matrix、RUN-CONTRACT.md 一致；增减开关只改这里。

/** read-dispatch-buttons 矩阵核对的四个按钮开关。 */
export const BUTTON_FLAGS = ['mayDecide', 'mayAssignOrg', 'mayAssignPeople', 'mayReassignOrg'] as const;
