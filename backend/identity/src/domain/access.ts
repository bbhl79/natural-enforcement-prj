// 四类动作 × 角色许可矩阵（#52）：读/改/导出/审批的后端定案。
// 安全边界在后端成立——菜单可见只是便利，不构成许可；
// 每次动作都重新校验身份、权限、数据范围（AccessControlService.authorize）。

/** 四类受控动作（#52）：读 / 改 / 导出 / 审批 */
export const ACCESS_ACTIONS = ['read', 'modify', 'export', 'approve'] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

/** 人员角色（本切片最小形态：只读查看 / 经办 / 主管；后续切片经矩阵修订扩展） */
export const PERSONNEL_ROLES = ['viewer', 'clerk', 'supervisor'] as const;
export type PersonnelRole = (typeof PERSONNEL_ROLES)[number];

/** 角色 × 动作许可矩阵：viewer 只读，clerk 无审批权，supervisor 全四动作 */
export const ROLE_ACTION_MATRIX: Record<PersonnelRole, readonly AccessAction[]> = {
  viewer: ['read'],
  clerk: ['read', 'modify', 'export'],
  supervisor: ['read', 'modify', 'export', 'approve'],
};

export function isPersonnelRole(value: string): value is PersonnelRole {
  return (PERSONNEL_ROLES as readonly string[]).includes(value);
}

/** 拒绝原因码：E2 红绿对照的区分载体——「校验拒绝」必带明确 reason，
 * 「校验缺失」则是不抛 AccessDeniedError（放行或裸异常），二者外部可区分 */
export type DenyReason =
  | 'identity-unknown'
  | 'not-authenticated'
  | 'identity-deactivated'
  | 'permission-denied'
  | 'scope-denied';

export class AccessDeniedError extends Error {
  readonly reason: DenyReason;

  constructor(reason: DenyReason, detail: string) {
    super(`${reason}: ${detail}`);
    this.name = 'AccessDeniedError';
    this.reason = reason;
  }
}

/** 判定是否为「校验拒绝」（E2 断言统一入口） */
export function isAccessDenied(error: unknown): error is AccessDeniedError {
  return error instanceof AccessDeniedError;
}
