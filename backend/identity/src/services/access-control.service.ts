// 按操作码授权（#96）：身份 → 权限 → 数据范围。每次调用重新读取当前值。
// 通用授权不因执法资格拒绝。资格事实放进身份上下文，执法证号不进入上下文。
// 改变主状态的操作码不采用监督角色贡献的允许行。
// 每次拒绝经留痕设施包追加一行 authz.denied。
// 拒绝行按对象所属机构归属（#105；ADR 0011 修正）：目标机构解析得出记 object，
// 解析不出（如对象不存在）取操作者当时任职机构，记 actor-fallback。

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  OPCODES,
  SUPERVISION_ROLE,
  opcodeRequirements,
} from '@natural-enforcement/shield';
import {
  AUDIT_ACTION_AUTHZ_DENIED,
  AUDIT_TRAIL_PORT,
  type AuditTrailPort,
  type AuditTargetOrgBasis,
  type AuthzDeniedEntry,
  type AuthzDenyReason,
} from '@natural-enforcement/audit';

import {
  AccessDeniedError,
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

/**
 * 一次授权判断的结果（#119）。拒绝时带上应写的 authz.denied 留痕行，由调用方决定何时写。
 * 交互式事务里用 check：拒绝行交给 rejected(...)，在业务事务回滚后另起事务写入。
 */
export type AuthorizationDecision =
  | { readonly allowed: true; readonly context: IdentityContext }
  | {
    readonly allowed: false;
    readonly reason: AuthzDenyReason;
    readonly detail: string;
    readonly denial: AuthzDeniedEntry;
  };

/** 拒绝行的目标机构及来源（#119 修正，ADR 0011）。 */
type DenialTarget = {
  targetOrgUnitId: string | null;
  targetOrgUnitBasis: AuditTargetOrgBasis;
};

type DenialInput = {
  actorId: string | null;
  actorCode: string | null;
  /** 操作者当时任职机构。照记，不用来套范围。 */
  orgUnitId: string | null;
  opcode: string;
  resource?: AuthorizationResource;
  target: DenialTarget;
};

/** 对象机构解析不出时，取操作者当时任职机构并标明。 */
function actorFallback(actorOrgId: string | null): DenialTarget {
  return { targetOrgUnitId: actorOrgId, targetOrgUnitBasis: 'actor-fallback' };
}

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
   * 按操作码重新判断。通过则交出身份上下文。
   * 拒绝时先追加一行 authz.denied（经 AUDIT_TRAIL_PORT，自成事务），再抛 AccessDeniedError。
   * @param targetOrgUnitId 动作所涉数据的归属机构
   */
  async authorize(
    actor: ActorRef,
    opcode: string,
    targetOrgUnitId: string,
    resource?: AuthorizationResource,
  ): Promise<IdentityContext> {
    const decision = await this.check(actor, opcode, targetOrgUnitId, resource);
    if (decision.allowed) return decision.context;
    return this.raise(decision);
  }

  /**
   * 与 authorize 同一套判断，但不写留痕、不抛错（#119）。
   * 拒绝时交出 authz.denied 留痕行，由调用方在业务事务回滚后写入。
   * 在交互式事务里传入事务内的 store（如 tx.store），读取复用事务连接，不再向连接池另取连接。
   */
  async check(
    actor: ActorRef,
    opcode: string,
    targetOrgUnitId: string,
    resource?: AuthorizationResource,
    store: IdentityStore = this.store,
  ): Promise<AuthorizationDecision> {
    let targetPath: readonly string[] | undefined;
    const pathOfTarget = async (): Promise<readonly string[]> => {
      targetPath ??= targetOrgUnitId ? await store.findOrgUnitPathToRoot(targetOrgUnitId) : [];
      return targetPath;
    };
    // 目标机构在组织树里找得到才算对象机构；否则按操作者机构兜底。
    const targetOf = async (actorOrgId: string | null): Promise<DenialTarget> =>
      (await pathOfTarget()).length > 0
        ? { targetOrgUnitId, targetOrgUnitBasis: 'object' }
        : actorFallback(actorOrgId);
    const personnel = await store.findPersonnelById(actor.personnelId);
    if (!personnel) {
      return denied('identity-unknown', `人员 ${actor.personnelId} 不存在`, {
        actorId: null,
        actorCode: null,
        orgUnitId: null,
        opcode,
        resource,
        target: await targetOf(null),
      });
    }
    const assignment = await store.findCurrentAssignment(personnel.id);
    const actorOrgId = assignment?.orgUnitId ?? null;
    if (!actor.authenticated) {
      return denied('not-authenticated', `人员 ${personnel.code} 未认证`, {
        actorId: personnel.id,
        actorCode: personnel.code,
        orgUnitId: actorOrgId,
        opcode,
        resource,
        target: await targetOf(actorOrgId),
      });
    }
    if (personnel.deactivatedAt) {
      return denied('identity-deactivated', `人员 ${personnel.code} 已失效`, {
        actorId: personnel.id,
        actorCode: personnel.code,
        orgUnitId: actorOrgId,
        opcode,
        resource,
        target: await targetOf(actorOrgId),
      });
    }
    const granting = opcodeRequirements(opcode)
      ? effectiveGrantingRoles(opcode, await store.listGrantingRoleNames(personnel.id, opcode))
      : [];
    if (granting.length === 0) {
      return denied(
        'permission-denied',
        `人员 ${personnel.code} 不能执行操作码 ${opcode}`,
        {
          actorId: personnel.id,
          actorCode: personnel.code,
          orgUnitId: actorOrgId,
          opcode,
          resource,
          target: await targetOf(actorOrgId),
        },
      );
    }
    if (!assignment) {
      return denied('scope-denied', `人员 ${personnel.code} 无生效任职，数据范围为空`, {
        actorId: personnel.id,
        actorCode: personnel.code,
        orgUnitId: null,
        opcode,
        resource,
        target: await targetOf(null),
      });
    }
    const path = await pathOfTarget();
    if (!path.includes(assignment.orgUnitId)) {
      return denied(
        'scope-denied',
        `机构 ${targetOrgUnitId} 不在人员 ${personnel.code} 的数据范围（当前任职机构 ${assignment.orgUnitId}）内`,
        {
          actorId: personnel.id,
          actorCode: personnel.code,
          orgUnitId: assignment.orgUnitId,
          opcode,
          resource,
          target: await targetOf(assignment.orgUnitId),
        },
      );
    }
    const roles = [...(await store.listActiveRoleNames(personnel.id))].sort((a, b) =>
      a.localeCompare(b, 'zh-CN'),
    );
    return {
      allowed: true,
      context: {
        personnelId: personnel.id,
        orgUnitId: assignment.orgUnitId,
        roles,
        hasEnforcementQualification: hasEnforcementQualification(personnel, this.clock.now()),
      },
    };
  }

  /**
   * 本人允许的操作码清单（#105 菜单来源）。一个码在清单里，当且仅当本人对自己任职机构
   * 执行该码能通过 authorize：人员存在且未停用、有生效任职、有能放行的角色。
   * 有效条件与 authorize 共用（effectiveGrantingRoles）。不返回数据范围，不写留痕。
   * 顺序同名册。
   */
  async listPermittedOpcodes(personnelId: string): Promise<string[]> {
    const personnel = await this.store.findPersonnelById(personnelId);
    if (!personnel || personnel.deactivatedAt) return [];
    if (!(await this.store.findCurrentAssignment(personnel.id))) return [];
    const rolesByOpcode = new Map<string, string[]>();
    for (const grant of await this.store.listGrantedOpcodes(personnel.id)) {
      const names = rolesByOpcode.get(grant.opcode) ?? [];
      names.push(grant.roleName);
      rolesByOpcode.set(grant.opcode, names);
    }
    return OPCODES.filter(
      (opcode) => effectiveGrantingRoles(opcode, rolesByOpcode.get(opcode) ?? []).length > 0,
    );
  }

  /** 某人员当前数据范围内的机构。没有当前任职时返回空集。 */
  async listDataScopeOrgUnitIds(personnelId: string): Promise<string[]> {
    const current = await this.store.findCurrentAssignment(personnelId);
    if (!current) return [];
    return this.store.listOrgUnitSubtreeIds(current.orgUnitId);
  }

  /**
   * 新建根机构（#123）：先走完身份与权限校验（锚点 = 操作者自己的当前任职机构），
   * 再以数据范围拒绝。新根不落在任何任职子树内；根机构只经引导或种子通道建立。
   * 只判断，不写留痕。拒绝行交给调用方在业务事务回滚后写入。store 同 check。
   */
  async checkRootRegistration(
    actor: ActorRef,
    opcode: string,
    store: IdentityStore = this.store,
  ): Promise<Extract<AuthorizationDecision, { allowed: false }>> {
    const anchor = await store.findCurrentAssignment(actor.personnelId);
    const decision = await this.check(actor, opcode, anchor?.orgUnitId ?? '', undefined, store);
    if (!decision.allowed) return decision;
    const personnel = await store.findPersonnelById(decision.context.personnelId);
    return denied(
      'scope-denied',
      '新建根机构不在任何任职子树内；根机构只经引导或种子通道建立',
      {
        actorId: decision.context.personnelId,
        actorCode: personnel?.code ?? null,
        orgUnitId: decision.context.orgUnitId,
        opcode,
        // 新根机构还不存在，对象机构解析不出（#119 修正）。
        target: actorFallback(decision.context.orgUnitId),
      },
    );
  }

  /** 人员的当前任职机构（数据范围锚点）；无生效任职按越权处理。store 同 check。 */
  async currentOrgOf(personnelId: string, store: IdentityStore = this.store): Promise<string> {
    const current = await store.findCurrentAssignment(personnelId);
    if (!current) {
      throw new AccessDeniedError('scope-denied', `人员 ${personnelId} 无生效任职`);
    }
    return current.orgUnitId;
  }

  private async raise(decision: Extract<AuthorizationDecision, { allowed: false }>): Promise<never> {
    await this.audit.append(decision.denial);
    throw new AccessDeniedError(decision.reason, decision.detail);
  }
}

function denied(
  reason: AuthzDenyReason,
  detail: string,
  input: DenialInput,
): Extract<AuthorizationDecision, { allowed: false }> {
  return {
    allowed: false,
    reason,
    detail,
    denial: {
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
      targetOrgUnitId: input.target.targetOrgUnitId,
      targetOrgUnitBasis: input.target.targetOrgUnitBasis,
    },
  };
}

/**
 * 能放行该操作码的角色。名册外的码没有。改变主状态的码不采用监督角色贡献的允许行。
 * authorize 与 listPermittedOpcodes 共用这一条，保证菜单清单与授权等价。
 */
function effectiveGrantingRoles(opcode: string, grantingRoleNames: readonly string[]): string[] {
  const rule = opcodeRequirements(opcode);
  if (!rule) return [];
  if (rule.changesPrimaryState) return grantingRoleNames.filter((name) => name !== SUPERVISION_ROLE);
  return [...grantingRoleNames];
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
