// 授权拒绝原因（#52，#96 不新增取值）。
// 「校验拒绝」= 抛 AccessDeniedError 且 reason 精确命中。
// 「校验缺失」= 放行或裸异常。二者外部可区分。

/** 机构与人员维护还没有进入名册的操作码。这些命令先用系统管理已持有的这一条过闸。 */
export const IDENTITY_MAINTENANCE_OPCODE = 'authz.binding.submit';

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

/** 一次授权通过后交出的身份上下文。不含执法证号。 */
export interface IdentityContext {
  readonly personnelId: string;
  readonly orgUnitId: string;
  readonly roles: readonly string[];
  readonly hasEnforcementQualification: boolean;
}

/** 可选资源。拒绝留痕记下种类和标识。 */
export interface AuthorizationResource {
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
}
