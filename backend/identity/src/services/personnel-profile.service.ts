// 人员登记、列表与卡片（#105「人员与登录凭据」，#128）。
// 授权经 AccessControlService 按操作码判断：列表与卡片 personnel.profile.read，登记 personnel.profile.register，只给系统管理。
// 登记在调用方的交互式事务里执行：人员、名称版本、任职、人员—角色、岗位标记、留痕同成同败（#119）。
// 被拒时只抛错或返回结果，不在事务里写失败留痕：拒绝行交给调用方 rejected(...)，回滚后另起事务写入。
// 口令散列在事务之外计算：先 screenRegistration 判断能否登记，再散列，再 registerPersonnel。

import { Inject, Injectable } from '@nestjs/common';
import type { AuditAppend, AuditTrailPort } from '@natural-enforcement/audit';

import { AccessDeniedError } from '../domain/access.ts';
import type { ActorRef } from '../domain/actor.ts';
import {
  PERSONNEL_PROFILE_READ_OPCODE,
  PERSONNEL_PROFILE_REGISTER_OPCODE,
  PERSONNEL_PROFILE_UPDATE_OPCODE,
  certStatusOf,
  isEmptyDiff,
  normalizeRegistration,
  normalizeUpdate,
  parseCalendarDay,
  registrationRules,
  sortRoleNames,
  transferRules,
  updateDiff,
  updateRules,
  type CertStatus,
  type NormalizedRegistration,
  type PersonnelPost,
  type RegisterPersonnelProfileInput,
  type RegisterRuleCode,
  type TransferRuleCode,
  type UpdatePersonnelProfileInput,
  type UpdateRuleCode,
} from '../domain/personnel-profile.ts';
import { ROOT_GUARD_REASON, ROOT_GUARD_ROLE } from '../domain/root-guard.ts';
import { newUlid } from '../domain/ulid.ts';
import type {
  IdentityStore,
  IdentityTransaction,
  PersonnelAssignmentRow,
  PersonnelProfileRow,
} from '../persistence/identity-store.ts';
import { IDENTITY_STORE } from '../persistence/identity-store.ts';
import { AccessControlService, type AuthorizationDecision } from './access-control.service.ts';

/** 人员列表的一行。不含手机号和执法证号；执法证只给情况。 */
export interface PersonnelListItem {
  id: string;
  code: string;
  name: string;
  /** 当前任职机构；没有当前任职时为 null */
  orgUnitId: string | null;
  orgName: string | null;
  roles: string[];
  certStatus: CertStatus;
  deactivatedAt: Date | null;
}

/** 操作者数据范围内的人员（含已停用）和机构（筛选用，含已停用机构）。 */
export interface PersonnelList {
  rootId: string;
  orgUnits: Array<{ id: string; name: string; parentId: string | null; deactivatedAt: Date | null }>;
  personnel: PersonnelListItem[];
}

/** 人员卡片：带完整手机号（界面默认遮挡）和执法证号。 */
export interface PersonnelProfile {
  id: string;
  code: string;
  name: string;
  mobilePhone: string | null;
  orgUnitId: string | null;
  orgName: string | null;
  /** 当前机构的上级名（原型 P6:30「天河区分局石牌自然资源所」）；本机构是根机构、上级是根机构或没有当前任职时为 null。 */
  orgParentName: string | null;
  roles: string[];
  posts: PersonnelPost[];
  passwordChangedAt: Date | null;
  deactivatedAt: Date | null;
  cert: { no: string | null; expiresOn: Date | null; status: CertStatus };
}

export type ReadProfileResult =
  | { result: 'viewed'; profile: PersonnelProfile }
  | { result: 'not-found' };

export type ScreenRegistrationResult =
  | { result: 'ready'; value: NormalizedRegistration; roleIds: string[] }
  | { result: 'non-compliant'; rules: RegisterRuleCode[] }
  /** 目标机构已停用（409）。failure 是 personnel.registered 的失败留痕行，由调用方回滚后写入。 */
  | { result: 'invalid-state'; failure: AuditAppend };

export type RegisterPersonnelProfileResult =
  | { result: 'registered'; personnel: { id: string; code: string; name: string; orgUnitId: string } }
  | { result: 'non-compliant'; rules: RegisterRuleCode[] }
  | { result: 'invalid-state'; failure: AuditAppend }
  /** 工号或手机号已被占用（409）。conflict 指明是哪一项，供界面落到对应字段；failure 同上。 */
  | { result: 'already-exists'; conflict: 'personnel-code' | 'mobile-phone'; failure: AuditAppend };

/**
 * 编辑的结果（#129）。updated 涵盖「什么都没改」：重复授予或摘除返回 200，不写留痕（#105:219、:223）。
 * root-guard = 违反根机构守卫（409 invalid-state，ADR 0014），failure 是 personnel.role-revoked 的失败留痕行。
 */
export type UpdatePersonnelProfileResult =
  | { result: 'updated' }
  | { result: 'not-found' }
  | { result: 'non-compliant'; rules: UpdateRuleCode[] }
  | { result: 'already-exists'; conflict: 'mobile-phone'; failure: AuditAppend }
  | { result: 'root-guard'; failure: AuditAppend };

/**
 * 调岗的结果（#129）。unchanged = 目的地就是对方当前任职机构，返回 200，不写行、不写留痕。
 * invalid-state = 目的地已停用（409）；root-guard = 调出根机构违反守卫（409，ADR 0014）。
 */
export type TransferPersonnelProfileResult =
  | { result: 'transferred'; orgUnitId: string }
  | { result: 'unchanged' }
  | { result: 'not-found' }
  | { result: 'non-compliant'; rules: TransferRuleCode[] }
  | { result: 'invalid-state'; failure: AuditAppend }
  | { result: 'root-guard'; failure: AuditAppend };

/** 调岗目的地：全树未停用的机构，按树的先序（#105:219 目的地不限数据范围）。 */
export interface TransferDestination {
  id: string;
  name: string;
  parentId: string | null;
}

export type TransferDestinationsResult =
  | { result: 'listed'; orgUnits: TransferDestination[] }
  | { result: 'not-found' };

function raiseDenied(decision: Extract<AuthorizationDecision, { allowed: false }>): never {
  throw new AccessDeniedError(decision.reason, decision.detail, decision.denial);
}

/** 编辑与调岗的前置结果（#129）：对方当前态、当前任职、数据范围锚点、操作者工号。 */
interface EditTarget {
  profile: PersonnelProfileRow;
  current: PersonnelAssignmentRow | null;
  /** 数据范围锚点：对方当前任职机构；没有当前任职时视同根机构（A10 口径）。 */
  anchor: string;
  actorCode: string | null;
}

@Injectable()
export class PersonnelProfileService {
  constructor(
    @Inject(IDENTITY_STORE) private readonly store: IdentityStore,
    private readonly access: AccessControlService,
  ) {}

  /**
   * 人员列表：操作者当前任职机构及其全部下级机构上的人员，含已停用人员，不分页。
   * 没有当前任职的人员视同挂在根机构，只有当前任职在根机构的操作者能看到（A10 口径）。
   * 被拒时写 authz.denied（自成事务）再抛 AccessDeniedError。列表不写成功留痕。
   */
  async listPersonnel(actor: ActorRef, now: Date): Promise<PersonnelList> {
    const anchor = await this.store.findCurrentAssignment(actor.personnelId);
    const rootId = anchor?.orgUnitId ?? '';
    await this.access.authorize(actor, PERSONNEL_PROFILE_READ_OPCODE, rootId, {
      resourceType: 'org-unit',
      resourceId: anchor?.orgUnitId ?? null,
    });
    const units = await this.store.listOrgUnitSubtree(rootId);
    const atTreeRoot = rootId !== '' && rootId === (await this.store.findRootOrgUnitId());
    const rows = await this.store.listPersonnelDirectory(units.map((unit) => unit.id), atTreeRoot);
    const nameOf = new Map(units.map((unit) => [unit.id, unit.name]));
    return {
      rootId,
      orgUnits: units.map(({ id, name, parentId, deactivatedAt }) => ({ id, name, parentId, deactivatedAt })),
      personnel: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        orgUnitId: row.currentOrgUnitId,
        orgName: row.currentOrgUnitId ? nameOf.get(row.currentOrgUnitId) ?? null : null,
        roles: sortRoleNames(row.roleNames),
        certStatus: certStatusOf(row.enforcementCertNo, row.enforcementCertExpiresOn, now),
        deactivatedAt: row.deactivatedAt,
      })),
    };
  }

  /**
   * 人员卡片：每次打开写一行 personnel.viewed（同一事务，写不成不返回数据）。
   * 数据范围锚点 = 对方当前任职机构；没有当前任职视同根机构。对方不存在返回 not-found，不写留痕。
   * 被拒抛 AccessDeniedError，denial 非空，由调用方回滚后写入。
   */
  async readProfile(
    actor: ActorRef,
    personnelId: string,
    tx: IdentityTransaction,
    audit: AuditTrailPort,
    sourceIp: string | null,
    now: Date,
  ): Promise<ReadProfileResult> {
    const target = await tx.store.findPersonnelProfile(personnelId);
    if (!target) return { result: 'not-found' };
    const current = await tx.store.findCurrentAssignment(target.id);
    const anchor = current?.orgUnitId ?? (await tx.store.findRootOrgUnitId()) ?? '';
    const decision = await this.access.check(actor, PERSONNEL_PROFILE_READ_OPCODE, anchor, {
      resourceType: 'personnel',
      resourceId: target.id,
    }, tx.store);
    if (!decision.allowed) raiseDenied(decision);

    const [org, roles, posts, viewer] = await Promise.all([
      current ? tx.store.findOrgUnitById(current.orgUnitId) : Promise.resolve(null),
      tx.store.listActiveRoleNames(target.id),
      tx.store.listActivePosts(target.id),
      tx.store.findPersonnelById(actor.personnelId),
    ]);
    const parent = org?.parentId ? await tx.store.findOrgUnitById(org.parentId) : null;
    // 上级是根机构时不拼上级名（原型 P6:69 分局一级只写「天河区分局」）。
    const orgParentName = parent?.parentId ? parent.name : null;
    await audit.append({
      action: 'personnel.viewed',
      actorId: actor.personnelId,
      actorCode: viewer?.code ?? null,
      subjectPersonnelId: target.id,
      subjectCode: target.code,
      orgUnitId: current?.orgUnitId ?? null,
      sourceIp,
      opcode: PERSONNEL_PROFILE_READ_OPCODE,
      resourceType: 'personnel',
      resourceId: target.id,
    });
    return {
      result: 'viewed',
      profile: {
        id: target.id,
        code: target.code,
        name: target.name,
        mobilePhone: target.mobilePhone,
        orgUnitId: current?.orgUnitId ?? null,
        orgName: org?.name ?? null,
        orgParentName,
        roles: sortRoleNames(roles),
        posts,
        passwordChangedAt: target.passwordChangedAt,
        deactivatedAt: target.deactivatedAt,
        cert: {
          no: target.enforcementCertNo,
          expiresOn: target.enforcementCertExpiresOn,
          status: certStatusOf(target.enforcementCertNo, target.enforcementCertExpiresOn, now),
        },
      },
    };
  }

  /**
   * 登记前的判断（不写库）。判定顺序：授权（越权 403）→ 校验（400，不写留痕）→ 目标机构状态（已停用 409）。
   * 机构没填时以操作者自己的任职机构过授权，再按 org-unit-required 返回 400。
   * 锁住目标机构（share）：与停用该机构串行，停用后不再接收新任职。
   */
  async screenRegistration(
    actor: ActorRef,
    input: RegisterPersonnelProfileInput,
    tx: IdentityTransaction,
    sourceIp: string | null = null,
  ): Promise<ScreenRegistrationResult> {
    const value = normalizeRegistration(input);
    const anchor = value.orgUnitId !== ''
      ? value.orgUnitId
      : (await tx.store.findCurrentAssignment(actor.personnelId))?.orgUnitId ?? '';
    const decision = await this.access.check(actor, PERSONNEL_PROFILE_REGISTER_OPCODE, anchor, {
      resourceType: 'org-unit',
      resourceId: value.orgUnitId === '' ? null : value.orgUnitId,
    }, tx.store);
    if (!decision.allowed) raiseDenied(decision);

    const rules = registrationRules(input);
    const roleIds = await tx.store.findActiveRoleIds(value.roles);
    if (value.roles.some((role) => !roleIds.has(role))) rules.push('role-unknown');
    if (rules.length > 0) return { result: 'non-compliant', rules };

    const org = await tx.store.lockOrgUnit(value.orgUnitId, 'share');
    if (!org) throw new Error(`机构 ${value.orgUnitId} 通过授权后读取失败`);
    if (org.deactivatedAt) {
      return {
        result: 'invalid-state',
        failure: {
          ...(await this.parties(actor, tx, sourceIp)),
          action: 'personnel.registered',
          outcome: 'failed',
          reason: 'org-unit-deactivated',
          orgUnitId: org.id,
          resourceType: 'org-unit',
          resourceId: org.id,
        },
      };
    }
    return { result: 'ready', value, roleIds: value.roles.map((role) => roleIds.get(role) as string) };
  }

  /**
   * 登记（#105 故事 28–31）。六项必填，初始口令过口令策略，口令修改时间留空（首登强制改密）。
   * 执法证可留空；填了就写人员行的证号和有效期（现有两列），留痕不写证号（#105:232）。证件状态列与 cert.updated 归 #133。
   * 写人员、v1 名称版本、首条任职、人员—角色、岗位标记，以及 personnel.registered 和每个标记一行 personnel.post-granted。
   * 工号或手机号重复返回 already-exists，由调用方回滚后写失败留痕。passwordHash 由调用方在事务外算好。
   */
  async registerPersonnel(
    actor: ActorRef,
    input: RegisterPersonnelProfileInput,
    passwordHash: string,
    tx: IdentityTransaction,
    audit: AuditTrailPort,
    sourceIp: string | null = null,
  ): Promise<RegisterPersonnelProfileResult> {
    const screened = await this.screenRegistration(actor, input, tx, sourceIp);
    if (screened.result !== 'ready') return screened;
    const { value, roleIds } = screened;
    const parties = await this.parties(actor, tx, sourceIp);

    const id = newUlid();
    const inserted = await tx.store.insertPersonnel({
      id,
      code: value.code,
      name: value.name,
      orgUnitId: value.orgUnitId,
      passwordHash,
      mobilePhone: value.mobilePhone,
      enforcementCertNo: value.certNo === '' ? null : value.certNo,
      enforcementCertExpiresOn: value.certExpiresOn === '' ? null : parseCalendarDay(value.certExpiresOn),
    });
    if (inserted.result === 'already-exists') {
      return {
        result: 'already-exists',
        conflict: inserted.conflict === 'mobile-phone' ? 'mobile-phone' : 'personnel-code',
        failure: {
          ...parties,
          action: 'personnel.registered',
          outcome: 'failed',
          reason: 'already-exists',
          orgUnitId: value.orgUnitId,
          resourceType: 'org-unit',
          resourceId: value.orgUnitId,
        },
      };
    }
    const now = new Date();
    await tx.store.insertPersonnelNameVersion({ id: newUlid(), personnelId: id, name: value.name, version: 1, createdAt: now });
    await tx.store.insertAssignment({ id: newUlid(), personnelId: id, orgUnitId: value.orgUnitId, startedAt: now, endedAt: null });
    for (const roleId of roleIds) {
      const granted = await tx.store.insertPersonnelRole({ id: newUlid(), personnelId: id, roleId });
      if (granted.result !== 'written') throw new Error(`新人员 ${id} 的角色重复写入`);
    }
    for (const post of value.posts) {
      const granted = await tx.store.insertPersonnelPost({ id: newUlid(), personnelId: id, post });
      if (granted.result !== 'written') throw new Error(`新人员 ${id} 的岗位标记重复写入`);
    }

    const subject = {
      ...parties,
      subjectPersonnelId: id,
      subjectCode: value.code,
      orgUnitId: value.orgUnitId,
      resourceType: 'personnel',
      resourceId: id,
    };
    await audit.append({ ...subject, action: 'personnel.registered' });
    for (const post of value.posts) {
      await audit.append({ ...subject, action: 'personnel.post-granted', nextValue: post });
    }
    return { result: 'registered', personnel: { id, code: value.code, name: value.name, orgUnitId: value.orgUnitId } };
  }

  private async parties(actor: ActorRef, tx: IdentityTransaction, sourceIp: string | null) {
    const actorCode = (await tx.store.findPersonnelById(actor.personnelId))?.code ?? null;
    return {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      sourceIp,
      opcode: PERSONNEL_PROFILE_REGISTER_OPCODE,
    };
  }

  /**
   * 编辑与调岗的公共前置（#129）：对方存在 → 按 personnel.profile.update 过授权。
   * 数据范围锚点 = 对方当前任职机构；没有当前任职视同根机构（A10 口径，#105:230）。
   * 对方不存在返回 null（404，不写留痕）；被拒抛 AccessDeniedError，denial 非空，由调用方回滚后写入。
   */
  private async authorizeTarget(
    actor: ActorRef,
    personnelId: string,
    tx: IdentityTransaction,
  ): Promise<EditTarget | null> {
    const profile = await tx.store.findPersonnelProfile(personnelId);
    if (!profile) return null;
    const current = await tx.store.findCurrentAssignment(profile.id);
    const anchor = current?.orgUnitId ?? (await tx.store.findRootOrgUnitId()) ?? '';
    const decision = await this.access.check(actor, PERSONNEL_PROFILE_UPDATE_OPCODE, anchor, {
      resourceType: 'personnel',
      resourceId: profile.id,
    }, tx.store);
    if (!decision.allowed) raiseDenied(decision);
    const actorRow = await tx.store.findPersonnelById(actor.personnelId);
    return { profile, current, anchor, actorCode: actorRow?.code ?? null };
  }

  /**
   * 守卫一（#105:225，G23）：不能给自己改角色、改岗位标记、调岗。
   * 对象就是本人，目标机构取对象机构（ADR 0011 修正）。姓名与手机号可以给自己改（原型 P6 selfEdit）。
   */
  private raiseSelfDenied(target: EditTarget, what: string): never {
    const anchored = target.anchor !== '';
    throw new AccessDeniedError('permission-denied', `人员 ${target.profile.code} 不能给自己${what}`, {
      action: 'authz.denied',
      outcome: 'failed',
      actorId: target.profile.id,
      actorCode: target.profile.code,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId: target.current?.orgUnitId ?? null,
      sourceIp: null,
      reason: 'permission-denied',
      opcode: PERSONNEL_PROFILE_UPDATE_OPCODE,
      resourceType: 'personnel',
      resourceId: target.profile.id,
      previousValue: null,
      targetOrgUnitId: anchored ? target.anchor : null,
      targetOrgUnitBasis: anchored ? 'object' : 'actor-fallback',
    });
  }

  /** 编辑各行的操作者一方（#129）。被作用人员由调用方补上。 */
  private editor(actor: ActorRef, target: EditTarget, sourceIp: string | null) {
    return {
      actorId: actor.personnelId,
      actorCode: target.actorCode,
      sourceIp,
      opcode: PERSONNEL_PROFILE_UPDATE_OPCODE,
      resourceType: 'personnel',
      resourceId: target.profile.id,
      subjectPersonnelId: target.profile.id,
      subjectCode: target.profile.code,
      // 机构写对方当时的任职机构（ADR 0011）；没有当前任职时为空，查阅视同根机构。
      orgUnitId: target.current?.orgUnitId ?? null,
    };
  }

  /**
   * 编辑（#105 故事 33、34、41，#129）。在调用方的交互式事务里执行，业务行与留痕同成同败（#119）。
   * 判定顺序：授权（越权 403）→ 校验（400，不写留痕）→ 差异为空（200，不写行、不写留痕）
   * → 守卫一（给自己改角色或岗位标记 403）→ 守卫二（摘除系统管理角色违反根机构守卫 409，ADR 0014）→ 写入。
   * 改名追加名称版本；改手机号只写 personnel.mobile-changed，前值留空；
   * 摘除角色给旧行置失效时间，授予插入新行；岗位标记同人员—角色。
   * 新角色在对方下一次请求时生效：身份上下文每次授权时读取（ADR 0003）。
   */
  async updateProfile(
    actor: ActorRef,
    personnelId: string,
    input: UpdatePersonnelProfileInput,
    tx: IdentityTransaction,
    audit: AuditTrailPort,
    sourceIp: string | null = null,
  ): Promise<UpdatePersonnelProfileResult> {
    const authorized = await this.authorizeTarget(actor, personnelId, tx);
    if (!authorized) return { result: 'not-found' };
    const value = normalizeUpdate(input);
    const rules = updateRules(input);
    const roleIds = await tx.store.findActiveRoleIds(value.roles);
    if (value.roles.some((role) => !roleIds.has(role))) rules.push('role-unknown');
    if (rules.length > 0) return { result: 'non-compliant', rules };

    const target = authorized;
    const [heldRoles, heldPosts] = await Promise.all([
      tx.store.listActivePersonnelRoles(target.profile.id),
      tx.store.listActivePersonnelPosts(target.profile.id),
    ]);
    const diff = updateDiff(input, {
      name: target.profile.name,
      mobilePhone: target.profile.mobilePhone,
      roles: heldRoles.map((row) => row.roleName),
      posts: heldPosts.map((row) => row.post),
    });
    // 重复授予或摘除、什么都没改：200，不写行、不写留痕（#105:219、:223）。
    if (isEmptyDiff(diff)) return { result: 'updated' };
    const touchesGrants = diff.rolesToGrant.length + diff.rolesToRevoke.length
      + diff.postsToGrant.length + diff.postsToRevoke.length > 0;
    if (touchesGrants && target.profile.id === actor.personnelId) {
      this.raiseSelfDenied(target, '改角色或岗位标记');
    }

    const parties = this.editor(actor, target, sourceIp);
    const revokesAdmin = diff.rolesToRevoke.includes(ROOT_GUARD_ROLE);
    const rootId = revokesAdmin ? await tx.store.findRootOrgUnitId() : null;
    if (rootId && target.current?.orgUnitId === rootId) {
      // 守卫二在事务级咨询锁内判断（ADR 0014）：两名系统管理并发互相摘除时只有一方成功。
      await tx.store.lockRootGuard();
      if (await tx.store.countRootGuardAdmins(rootId, target.profile.id) === 0) {
        return {
          result: 'root-guard',
          failure: {
            ...parties,
            action: 'personnel.role-revoked',
            outcome: 'failed',
            reason: ROOT_GUARD_REASON,
            nextValue: ROOT_GUARD_ROLE,
          },
        };
      }
    }

    const id = target.profile.id;
    const now = new Date();
    if (diff.name !== '') {
      const versions = await tx.store.listPersonnelNameVersions(id);
      await tx.store.insertPersonnelNameVersion({
        id: newUlid(),
        personnelId: id,
        name: diff.name,
        version: (versions.at(-1)?.version ?? 0) + 1,
        createdAt: now,
      });
      await tx.store.updatePersonnelCurrentName(id, diff.name);
    }
    if (diff.mobilePhone !== '') {
      const written = await tx.store.updatePersonnelMobilePhone(id, diff.mobilePhone);
      if (written.result !== 'written') {
        return {
          result: 'already-exists',
          conflict: 'mobile-phone',
          failure: { ...parties, action: 'personnel.mobile-changed', outcome: 'failed', reason: 'already-exists' },
        };
      }
    }
    for (const roleName of diff.rolesToRevoke) {
      const binding = heldRoles.find((row) => row.roleName === roleName);
      if (!binding) throw new Error(`人员 ${id} 的角色 ${roleName} 在差异与当前态之间消失`);
      await tx.store.deactivatePersonnelRole(binding.id, now);
    }
    for (const roleName of diff.rolesToGrant) {
      const granted = await tx.store.insertPersonnelRole({
        id: newUlid(),
        personnelId: id,
        roleId: roleIds.get(roleName) as string,
      });
      if (granted.result !== 'written') throw new Error(`人员 ${id} 的角色 ${roleName} 重复写入`);
    }
    for (const post of diff.postsToRevoke) {
      const binding = heldPosts.find((row) => row.post === post);
      if (!binding) throw new Error(`人员 ${id} 的岗位标记 ${post} 在差异与当前态之间消失`);
      await tx.store.deactivatePersonnelPost(binding.id, now);
    }
    for (const post of diff.postsToGrant) {
      const granted = await tx.store.insertPersonnelPost({ id: newUlid(), personnelId: id, post });
      if (granted.result !== 'written') throw new Error(`人员 ${id} 的岗位标记 ${post} 重复写入`);
    }

    if (diff.name !== '') {
      await audit.append({ ...parties, action: 'personnel.renamed', previousValue: target.profile.name });
    }
    if (diff.mobilePhone !== '') {
      // 前值留空（#105:219）：手机号不进留痕。
      await audit.append({ ...parties, action: 'personnel.mobile-changed' });
    }
    for (const roleName of diff.rolesToRevoke) {
      await audit.append({ ...parties, action: 'personnel.role-revoked', nextValue: roleName });
    }
    for (const roleName of diff.rolesToGrant) {
      await audit.append({ ...parties, action: 'personnel.role-granted', nextValue: roleName });
    }
    for (const post of diff.postsToRevoke) {
      await audit.append({ ...parties, action: 'personnel.post-revoked', nextValue: post });
    }
    for (const post of diff.postsToGrant) {
      await audit.append({ ...parties, action: 'personnel.post-granted', nextValue: post });
    }
    return { result: 'updated' };
  }

  /**
   * 调岗（#105 故事 35、41，#129）。在调用方的交互式事务里执行，业务行与留痕同成同败（#119）。
   * 判定顺序：授权（越权 403）→ 目的地必填（400，不写留痕）→ 守卫一（给自己调岗 403）
   * → 目的地就是当前任职机构（200，不写行、不写留痕）→ 目的地状态（已停用 409）
   * → 守卫二（调出根机构违反根机构守卫 409，ADR 0014）→ 写入。
   * 目的地不限数据范围，但必须是组织树上未停用的机构；树外的机构按越权拒绝（#105:343）。
   * 目的地先加 FOR SHARE 锁：与停用该机构串行，停用后不再接收新任职（同登记，#124）。
   * 留痕写 personnel.transferred，机构写原任职机构（授权锚点），前值写原机构名，后值写新机构名。
   */
  async transferProfile(
    actor: ActorRef,
    personnelId: string,
    orgUnitId: string,
    tx: IdentityTransaction,
    audit: AuditTrailPort,
    sourceIp: string | null = null,
  ): Promise<TransferPersonnelProfileResult> {
    const target = await this.authorizeTarget(actor, personnelId, tx);
    if (!target) return { result: 'not-found' };
    const rules = transferRules(orgUnitId);
    if (rules.length > 0) return { result: 'non-compliant', rules };
    if (target.profile.id === actor.personnelId) this.raiseSelfDenied(target, '调岗');
    const toId = orgUnitId.trim();
    if (target.current?.orgUnitId === toId) return { result: 'unchanged' };

    const dest = await tx.store.lockOrgUnit(toId, 'share');
    if (!dest) {
      const denied = await this.access.check(actor, PERSONNEL_PROFILE_UPDATE_OPCODE, toId, {
        resourceType: 'org-unit',
        resourceId: toId,
      }, tx.store);
      if (!denied.allowed) raiseDenied(denied);
      throw new Error(`机构 ${toId} 通过授权后读取失败`);
    }
    const parties = this.editor(actor, target, sourceIp);
    if (dest.deactivatedAt) {
      return {
        result: 'invalid-state',
        failure: {
          ...parties,
          action: 'personnel.transferred',
          outcome: 'failed',
          reason: 'org-unit-deactivated',
          nextValue: dest.name,
        },
      };
    }
    const fromId = target.current?.orgUnitId ?? null;
    const rootId = await tx.store.findRootOrgUnitId();
    // 只有「根机构任职 + 系统管理角色」的人员受守卫二约束（ADR 0014）。
    const holdsAdminRole = (await tx.store.listActiveRoleNames(target.profile.id)).includes(ROOT_GUARD_ROLE);
    if (rootId && fromId === rootId && holdsAdminRole) {
      // 守卫二在事务级咨询锁内判断（ADR 0014）：并发互相调出根机构时只有一方成功。
      await tx.store.lockRootGuard();
      if (await tx.store.countRootGuardAdmins(rootId, target.profile.id) === 0) {
        return {
          result: 'root-guard',
          failure: {
            ...parties,
            action: 'personnel.transferred',
            outcome: 'failed',
            reason: ROOT_GUARD_REASON,
            nextValue: dest.name,
          },
        };
      }
    }

    const id = target.profile.id;
    const now = new Date();
    if (target.current) {
      await tx.store.transferAssignment({
        closedAssignmentId: target.current.id,
        endedAt: now,
        personnelId: id,
        toOrgUnitId: dest.id,
        next: { id: newUlid(), personnelId: id, orgUnitId: dest.id, startedAt: now, endedAt: null },
      });
    } else {
      // 没有当前任职的人员：建立首条任职并同步当前归属（#105:230）。
      await tx.store.insertAssignment({ id: newUlid(), personnelId: id, orgUnitId: dest.id, startedAt: now, endedAt: null });
      await tx.store.updatePersonnelOrgUnit(id, dest.id);
    }
    const from = fromId ? await tx.store.findOrgUnitById(fromId) : null;
    await audit.append({
      ...parties,
      action: 'personnel.transferred',
      previousValue: from?.name ?? null,
      nextValue: dest.name,
    });
    return { result: 'transferred', orgUnitId: dest.id };
  }

  /**
   * 调岗目的地清单（#129）：全树未停用的机构，按建立时间与主键升序。
   * 目的地不限数据范围（#105:219），所以这里返回整棵树，而不是操作者的子树。
   * 按 personnel.profile.update 授权，锚点是对方当前任职机构。读取不写留痕。
   */
  async listTransferDestinations(
    actor: ActorRef,
    personnelId: string,
    tx: IdentityTransaction,
  ): Promise<TransferDestinationsResult> {
    const target = await this.authorizeTarget(actor, personnelId, tx);
    if (!target) return { result: 'not-found' };
    const rootId = await tx.store.findRootOrgUnitId();
    const units = rootId ? await tx.store.listOrgUnitSubtree(rootId) : [];
    return {
      result: 'listed',
      orgUnits: units
        .filter((unit) => !unit.deactivatedAt)
        .map(({ id, name, parentId }) => ({ id, name, parentId })),
    };
  }
}
