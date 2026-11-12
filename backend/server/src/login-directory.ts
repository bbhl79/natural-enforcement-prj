// 用途：登录目录端口与留痕当事人构造，供登录编排和业务服务读取人员、机构与锁定状态。
// 调用方：backend/server/src/auth.service.ts，以及各业务服务经令牌 LOGIN_DIRECTORY 注入。
// 边界：口令散列不经过这里，认证器自行读取；实现由 backend/server/src/persistence.module.ts 装配。
//
import type { AuditParties } from '@natural-enforcement/audit';

/** 登录编排读到的人员。口令散列不经过这里，认证器自己取。 */
export interface LoginAccount {
  id: string;
  code: string;
  name: string;
  passwordChangedAt: Date | null;
  deactivatedAt: Date | null;
  failureCount: number;
  failureWindowStartedAt: Date | null;
  lockedUntil: Date | null;
  orgUnitId: string | null;
  orgName: string | null;
  roles: string[];
}

/** 一次口令失败之后要写回的计数。锁定到期时间只在达到 5 次时有值。 */
export interface FailureSnapshot {
  count: number;
  windowStartedAt: Date | null;
  lockedUntil: Date | null;
}

/** 锁定尚未到期的人员。机构取当前任职；没有当前任职时机构为空。 */
export interface LockedPersonnel {
  id: string;
  code: string;
  name: string;
  orgUnitId: string | null;
  orgName: string | null;
  lockedUntil: Date;
}

/** 登录目录端口：按手机号或 id 读人员，记录口令失败与锁定，查询组织根。 */
export interface LoginDirectory {
  findByMobile(mobile: string): Promise<LoginAccount | null>;
  findById(id: string): Promise<LoginAccount | null>;
  saveFailure(id: string, snapshot: FailureSnapshot): Promise<void>;
  clearFailure(id: string): Promise<void>;
  /** 锁定到期时间晚于 now 的人员。 */
  listLocked(now: Date): Promise<LockedPersonnel[]>;
  /** 该机构是组织树的根。 */
  isRootOrg(orgUnitId: string): Promise<boolean>;
  /** 组织树的根机构。没有根时返回空。 */
  rootOrgId(): Promise<string | null>;
}

/** 注入令牌：登录目录端口的实现，装配在 backend/server/src/persistence.module.ts。 */
export const LOGIN_DIRECTORY = Symbol('LOGIN_DIRECTORY');

/** 已登录人员的留痕当事人列：操作者与对象都是本人；口令失败等已有账号的场景用它。 */
export function partiesOf(account: LoginAccount, sourceIp: string | null): AuditParties {
  return {
    actorId: account.id,
    actorCode: account.code,
    subjectPersonnelId: account.id,
    subjectCode: account.code,
    orgUnitId: account.orgUnitId,
    sourceIp,
  };
}

/** 无主体留痕的当事人列：操作者与对象都为空，只带来源 IP；手机号查无此人等场景用它。 */
export function emptyParties(sourceIp: string | null): AuditParties {
  return {
    actorId: null,
    actorCode: null,
    subjectPersonnelId: null,
    subjectCode: null,
    orgUnitId: null,
    sourceIp,
  };
}
