import type { AuditParties } from '@natural-enforcement/audit';

/** 登录编排读到的人员。口令散列不经过这里，认证器自己取。 */
export interface LoginAccount {
  id: string;
  code: string;
  name: string;
  passwordChangedAt: Date | null;
  orgUnitId: string | null;
  orgName: string | null;
  roles: string[];
}

export interface LoginDirectory {
  findByMobile(mobile: string): Promise<LoginAccount | null>;
  findById(id: string): Promise<LoginAccount | null>;
}

export const LOGIN_DIRECTORY = Symbol('LOGIN_DIRECTORY');

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
