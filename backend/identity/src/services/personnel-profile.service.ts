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
  certStatusOf,
  normalizeRegistration,
  parseCalendarDay,
  registrationRules,
  sortRoleNames,
  type CertStatus,
  type NormalizedRegistration,
  type PersonnelPost,
  type RegisterPersonnelProfileInput,
  type RegisterRuleCode,
} from '../domain/personnel-profile.ts';
import { newUlid } from '../domain/ulid.ts';
import type { IdentityStore, IdentityTransaction } from '../persistence/identity-store.ts';
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

function raiseDenied(decision: Extract<AuthorizationDecision, { allowed: false }>): never {
  throw new AccessDeniedError(decision.reason, decision.detail, decision.denial);
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
        certStatus: certStatusOf(row.enforcementCertNo, row.enforcementCertExpiresOn, row.enforcementCertStatus, now),
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
          status: certStatusOf(
            target.enforcementCertNo,
            target.enforcementCertExpiresOn,
            target.enforcementCertStatus,
            now,
          ),
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
   * 执法证可留空；填了就写人员行的证号和有效期，证件状态取库默认的「有效」（#133），留痕不写证号（#105:232）。
   * 执法证的变更与证件状态维护在 PersonnelCertService（#133）。
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
}
