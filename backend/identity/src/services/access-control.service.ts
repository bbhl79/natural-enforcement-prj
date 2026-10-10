// 四类动作统一强校验闸（#52）：身份 → 权限 → 数据范围，每次动作重新校验。
// 身份 = 人员存在 + 已认证 + 未失效；权限 = 角色 × 动作矩阵（ROLE_ACTION_MATRIX）；
// 数据范围 = 目标机构在「当前任职机构」的子树内（祖先链含当前任职机构即放行）。
// 全部拒绝统一抛 AccessDeniedError 且带 reason 码——「校验拒绝」与「校验缺失」
//（不抛错直接放行/裸异常）在 E2 红绿对照中外部可区分。

import { Inject, Injectable } from '@nestjs/common';

import {
  AccessDeniedError,
  isPersonnelRole,
  ROLE_ACTION_MATRIX,
  type AccessAction,
} from '../domain/access.ts';
import type { ActorRef } from '../domain/actor.ts';
import type { PersonnelRow } from '../persistence/identity-store.ts';
import { IDENTITY_STORE, type IdentityStore } from '../persistence/identity-store.ts';

@Injectable()
export class AccessControlService {
  constructor(
    @Inject(IDENTITY_STORE) private readonly store: IdentityStore,
  ) {}

  /**
   * 对一次读/改/导出/审批动作重新校验；通过则返回生效的人员行，否则抛 AccessDeniedError。
   * @param targetOrgUnitId 动作所涉数据的归属机构（数据范围判定锚点）
   */
  async authorize(
    actor: ActorRef,
    action: AccessAction,
    targetOrgUnitId: string,
  ): Promise<PersonnelRow> {
    const personnel = await this.store.findPersonnelById(actor.personnelId);
    if (!personnel) {
      throw new AccessDeniedError('identity-unknown', `人员 ${actor.personnelId} 不存在`);
    }
    if (!actor.authenticated) {
      throw new AccessDeniedError('not-authenticated', `人员 ${personnel.code} 未认证`);
    }
    if (personnel.deactivatedAt) {
      throw new AccessDeniedError('identity-deactivated', `人员 ${personnel.code} 已失效`);
    }
    if (!isPersonnelRole(personnel.role) || !ROLE_ACTION_MATRIX[personnel.role].includes(action)) {
      throw new AccessDeniedError(
        'permission-denied',
        `角色 ${personnel.role} 不含动作 ${action}（菜单可见不构成许可）`,
      );
    }
    const current = await this.store.findCurrentAssignment(personnel.id);
    if (!current) {
      throw new AccessDeniedError('scope-denied', `人员 ${personnel.code} 无生效任职，数据范围为空`);
    }
    const path = await this.store.findOrgUnitPathToRoot(targetOrgUnitId);
    if (!path.includes(current.orgUnitId)) {
      throw new AccessDeniedError(
        'scope-denied',
        `机构 ${targetOrgUnitId} 不在人员 ${personnel.code} 的数据范围（当前任职机构 ${current.orgUnitId}）内`,
      );
    }
    return personnel;
  }

  /** 人员的当前任职机构（数据范围锚点）；无生效任职按越权处理 */
  async currentOrgOf(personnelId: string): Promise<string> {
    const current = await this.store.findCurrentAssignment(personnelId);
    if (!current) {
      throw new AccessDeniedError('scope-denied', `人员 ${personnelId} 无生效任职`);
    }
    return current.orgUnitId;
  }
}
