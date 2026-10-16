// 按操作码授权（#96）：身份 → 权限 → 数据范围。每次调用重新读取当前值。
// 通用授权不因执法资格拒绝。资格事实放进身份上下文，执法证号不进入上下文。
// 改变主状态的操作码不采用监督角色贡献的允许行。
// 每次拒绝经留痕设施包追加一行 authz.denied。

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  SUPERVISION_ROLE,
  opcodeRequirements,
} from '@natural-enforcement/shield';
import {
  AUDIT_ACTION_AUTHZ_DENIED,
  AUDIT_TRAIL_PORT,
  type AuditTrailPort,
  type AuthzDenyReason,
} from '@natural-enforcement/audit';

import {
  AccessDeniedError,
  IDENTITY_MAINTENANCE_OPCODE,
  type AuthorizationResource,
  type IdentityContext,
} from '../domain/access.ts';
import type { ActorRef } from '../domain/actor.ts';
import type { PersonnelRow } from '../persistence/identity-store.ts';
import { IDENTITY_STORE, type IdentityStore } from '../persistence/identity-store.ts';

export interface AuthorizationClock {
  now(): Date;
}

const SHANGHAI = 'Asia/Shanghai';

@Injectable()
export class AccessControlService {
  private readonly clock: AuthorizationClock;

  constructor(
    @Inject(IDENTITY_STORE) private readonly store: IdentityStore,
    @Inject(AUDIT_TRAIL_PORT) private readonly audit: AuditTrailPort,
    @Optional() clock?: AuthorizationClock,
  ) {
    this.clock = clock ?? { now: () => new Date() };
  }

  /**
   * 按操作码重新判断。通过则交出身份上下文，否则抛 AccessDeniedError。
   * @param targetOrgUnitId 动作所涉数据的归属机构
   */
  async authorize(
    actor: ActorRef,
    opcode: string,
    targetOrgUnitId: string,
    resource?: AuthorizationResource,
  ): Promise<IdentityContext> {
    const personnel = await this.store.findPersonnelById(actor.personnelId);
    if (!personnel) {
      return this.deny('identity-unknown', `人员 ${actor.personnelId} 不存在`, {
        actorId: null,
        actorCode: null,
        orgUnitId: null,
        opcode,
        resource,
      });
    }
    const assignment = await this.store.findCurrentAssignment(personnel.id);
    const actorOrgId = assignment?.orgUnitId ?? null;
    if (!actor.authenticated) {
      return this.deny('not-authenticated', `人员 ${personnel.code} 未认证`, {
        actorId: personnel.id,
        actorCode: personnel.code,
        orgUnitId: actorOrgId,
        opcode,
        resource,
      });
    }
    if (personnel.deactivatedAt) {
      return this.deny('identity-deactivated', `人员 ${personnel.code} 已失效`, {
        actorId: personnel.id,
        actorCode: personnel.code,
        orgUnitId: actorOrgId,
        opcode,
        resource,
      });
    }
    const rule = opcodeRequirements(opcode);
    let granting = rule ? await this.store.listGrantingRoleNames(personnel.id, opcode) : [];
    if (rule?.changesPrimaryState) {
      granting = granting.filter((name) => name !== SUPERVISION_ROLE);
    }
    if (!rule || granting.length === 0) {
      return this.deny(
        'permission-denied',
        `人员 ${personnel.code} 不能执行操作码 ${opcode}`,
        {
          actorId: personnel.id,
          actorCode: personnel.code,
          orgUnitId: actorOrgId,
          opcode,
          resource,
        },
      );
    }
    if (!assignment) {
      return this.deny('scope-denied', `人员 ${personnel.code} 无生效任职，数据范围为空`, {
        actorId: personnel.id,
        actorCode: personnel.code,
        orgUnitId: null,
        opcode,
        resource,
      });
    }
    const path = await this.store.findOrgUnitPathToRoot(targetOrgUnitId);
    if (!path.includes(assignment.orgUnitId)) {
      return this.deny(
        'scope-denied',
        `机构 ${targetOrgUnitId} 不在人员 ${personnel.code} 的数据范围（当前任职机构 ${assignment.orgUnitId}）内`,
        {
          actorId: personnel.id,
          actorCode: personnel.code,
          orgUnitId: assignment.orgUnitId,
          opcode,
          resource,
        },
      );
    }
    const roles = [...(await this.store.listActiveRoleNames(personnel.id))].sort((a, b) =>
      a.localeCompare(b, 'zh-CN'),
    );
    return {
      personnelId: personnel.id,
      orgUnitId: assignment.orgUnitId,
      roles,
      hasEnforcementQualification: hasEnforcementQualification(personnel, this.clock.now()),
    };
  }

  /** 某人员当前数据范围内的机构。没有当前任职时返回空集。 */
  async listDataScopeOrgUnitIds(personnelId: string): Promise<string[]> {
    const current = await this.store.findCurrentAssignment(personnelId);
    if (!current) return [];
    return this.store.listOrgUnitSubtreeIds(current.orgUnitId);
  }

  /**
   * 新建根机构：先走完身份与权限校验（锚点 = 操作者自己的当前任职机构），
   * 再以数据范围拒绝。新根不落在任何任职子树内；根机构只经种子通道建立。
   */
  async rejectRootRegistration(actor: ActorRef): Promise<never> {
    const context = await this.authorize(
      actor,
      IDENTITY_MAINTENANCE_OPCODE,
      await this.currentOrgOf(actor.personnelId),
    );
    const personnel = await this.store.findPersonnelById(context.personnelId);
    return this.deny(
      'scope-denied',
      '新建根机构不在任何任职子树内；根机构只经种子通道建立',
      {
        actorId: context.personnelId,
        actorCode: personnel?.code ?? null,
        orgUnitId: context.orgUnitId,
        opcode: IDENTITY_MAINTENANCE_OPCODE,
      },
    );
  }

  /** 人员的当前任职机构（数据范围锚点）；无生效任职按越权处理 */
  async currentOrgOf(personnelId: string): Promise<string> {
    const current = await this.store.findCurrentAssignment(personnelId);
    if (!current) {
      throw new AccessDeniedError('scope-denied', `人员 ${personnelId} 无生效任职`);
    }
    return current.orgUnitId;
  }

  private async deny(
    reason: AuthzDenyReason,
    detail: string,
    input: {
      actorId: string | null;
      actorCode: string | null;
      orgUnitId: string | null;
      opcode: string;
      resource?: AuthorizationResource;
    },
  ): Promise<never> {
    await this.audit.append({
      action: AUDIT_ACTION_AUTHZ_DENIED,
      outcome: 'failed',
      actorId: input.actorId,
      actorCode: input.actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId: input.orgUnitId,
      sourceIp: null,
      reason,
      opcode: input.opcode,
      resourceType: input.resource?.resourceType ?? null,
      resourceId: input.resource?.resourceId ?? null,
      previousValue: null,
    });
    throw new AccessDeniedError(reason, detail);
  }
}

/** 证号为空，或有效期早于 Asia/Shanghai 的今天，即没有执法资格。有效期等于今天仍有效。 */
function hasEnforcementQualification(personnel: PersonnelRow, now: Date): boolean {
  const certNo = personnel.enforcementCertNo?.trim() ?? '';
  if (!certNo || !personnel.enforcementCertExpiresOn) return false;
  const today = shanghaiCalendarDate(now);
  const expiry = expiryCalendarDate(personnel.enforcementCertExpiresOn);
  return expiry >= today;
}

function shanghaiCalendarDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function expiryCalendarDate(expiresOn: Date): string {
  const year = expiresOn.getUTCFullYear();
  const month = String(expiresOn.getUTCMonth() + 1).padStart(2, '0');
  const day = String(expiresOn.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
