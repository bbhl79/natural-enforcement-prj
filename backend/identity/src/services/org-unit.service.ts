// 机构服务（#52、#123）：机构树查看、新建下级、名称版本化改名、失效。
// 授权经 AccessControlService 按操作码判断。只失效不删除（本服务不存在任何删除路径，库层触发器为第二道兜底）。
// 新建下级与改名在调用方的交互式事务里执行，业务行与留痕同成同败（#119）。
// 被拒时只抛错或返回结果，不在事务里写失败留痕：拒绝行交给调用方 rejected(...)，回滚后另起事务写入。

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { AuditAppend, AuditTrailPort } from '@natural-enforcement/audit';

import { AccessDeniedError } from '../domain/access.ts';
import type { ActorRef } from '../domain/actor.ts';
import { NO_OPEN_ITEMS, OPEN_ITEMS_COUNTER, type OpenItems, type OpenItemsCounter } from '../domain/open-items.ts';
import {
  ORG_TREE_READ_OPCODE,
  ORG_UNIT_DEACTIVATE_OPCODE,
  ORG_UNIT_REGISTER_OPCODE,
  ORG_UNIT_RENAME_OPCODE,
  childLevelOf,
  isOrgUnitLevel,
  orgUnitNameRules,
  type OrgUnitRuleCode,
} from '../domain/org-unit.ts';
import { newUlid } from '../domain/ulid.ts';
import type {
  IdentityTransaction,
  OrgUnitNameVersionRow,
  OrgUnitRow,
} from '../persistence/identity-store.ts';
import { IDENTITY_STORE, type IdentityStore } from '../persistence/identity-store.ts';
import { AccessControlService, type AuthorizationDecision } from './access-control.service.ts';

export interface RegisterOrgUnitInput {
  /** null = 新建根机构，一律拒绝 */
  parentId: string | null;
  name: string;
  /** 层级：city / district / station。新建下级时必填，不由树深度推导。 */
  level: string;
}

export type RegisterOrgUnitResult =
  | { result: 'registered'; orgUnit: OrgUnitRow }
  | { result: 'non-compliant'; rules: OrgUnitRuleCode[] }
  /** 上级已停用（409）。failure 是 org.unit.registered 的失败留痕行，由调用方回滚后写入。 */
  | { result: 'invalid-state'; failure: AuditAppend };

export type RenameOrgUnitResult =
  | { result: 'renamed'; orgUnit: OrgUnitRow }
  /** 新名称与现名称相同：不追加版本，不写留痕。 */
  | { result: 'unchanged'; orgUnit: OrgUnitRow }
  | { result: 'non-compliant'; rules: OrgUnitRuleCode[] };

/** 停用被拒的那一条前提（判定顺序中的第一条）及给人看的条数。 */
export type DeactivationBlocker =
  | { reason: 'org-unit-root' }
  | { reason: 'org-has-active-children'; children: number }
  | { reason: 'org-has-assignments'; assignments: number }
  | { reason: 'org-has-open-items'; openItems: OpenItems };

export type DeactivateOrgUnitResult =
  | { result: 'deactivated'; orgUnit: OrgUnitRow }
  /** 已停用：不写行，不改首次停用时间，不写留痕。 */
  | { result: 'unchanged'; orgUnit: OrgUnitRow }
  /** 409。failure 是 org.unit.deactivated 的失败留痕行，由调用方回滚后写入。 */
  | { result: 'invalid-state'; blocker: DeactivationBlocker; failure: AuditAppend };

/** 机构树上的一个节点：当前态、全部名称版本（版本号升序）和在职人员数。 */
export interface OrgTreeUnit extends OrgUnitRow {
  names: OrgUnitNameVersionRow[];
  activePersonnel: number;
}

/** 操作者数据范围内的整棵子树。rootId = 操作者的当前任职机构。含已停用节点，不分页。 */
export interface OrgTree {
  rootId: string;
  units: OrgTreeUnit[];
}

function raiseDenied(decision: Extract<AuthorizationDecision, { allowed: false }>): never {
  throw new AccessDeniedError(decision.reason, decision.detail, decision.denial);
}

@Injectable()
export class OrgUnitService {
  constructor(
    @Inject(IDENTITY_STORE) private readonly store: IdentityStore,
    private readonly access: AccessControlService,
    /** 接缝③：承办中事项计数。未绑定时用恒为 0 的实现。 */
    @Optional() @Inject(OPEN_ITEMS_COUNTER) private readonly openItems: OpenItemsCounter = NO_OPEN_ITEMS,
  ) {}

  /**
   * 机构树（#123）：不带根节点参数，固定返回操作者数据范围内的子树。
   * 被拒时写 authz.denied（自成事务）再抛 AccessDeniedError。查看不写成功留痕。
   */
  async readTree(actor: ActorRef): Promise<OrgTree> {
    const anchor = await this.store.findCurrentAssignment(actor.personnelId);
    const rootId = anchor?.orgUnitId ?? '';
    await this.access.authorize(actor, ORG_TREE_READ_OPCODE, rootId, {
      resourceType: 'org-unit',
      resourceId: anchor?.orgUnitId ?? null,
    });
    const rows = await this.store.listOrgUnitSubtree(rootId);
    const ids = rows.map((row) => row.id);
    const [versions, counts] = await Promise.all([
      this.store.listOrgUnitNameVersionsOf(ids),
      this.store.countActivePersonnelByOrgUnit(ids),
    ]);
    const namesOf = new Map<string, OrgUnitNameVersionRow[]>();
    for (const version of versions) {
      const list = namesOf.get(version.orgUnitId) ?? [];
      list.push(version);
      namesOf.set(version.orgUnitId, list);
    }
    return {
      rootId,
      units: rows.map((row) => ({
        ...row,
        names: (namesOf.get(row.id) ?? []).sort((a, b) => a.version - b.version),
        activePersonnel: counts.get(row.id) ?? 0,
      })),
    };
  }

  /**
   * 新建下级（#123）。判定顺序：授权（越权 403）→ 名称与层级（400，不写留痕）→ 上级状态（已停用 409）。
   * 新建根机构一律按 scope-denied 拒绝。机构编码由系统生成（ORG- 加主键）。
   * 被拒抛 AccessDeniedError，denial 非空，由调用方回滚后写入。
   */
  async registerOrgUnit(
    actor: ActorRef,
    input: RegisterOrgUnitInput,
    tx: IdentityTransaction,
    audit: AuditTrailPort,
    sourceIp: string | null = null,
  ): Promise<RegisterOrgUnitResult> {
    if (input.parentId === null) {
      raiseDenied(await this.access.checkRootRegistration(actor, ORG_UNIT_REGISTER_OPCODE, tx.store));
    }
    const parentId = input.parentId;
    const resource = { resourceType: 'org-unit', resourceId: parentId };
    const decision = await this.access.check(actor, ORG_UNIT_REGISTER_OPCODE, parentId, resource, tx.store);
    if (!decision.allowed) raiseDenied(decision);
    // 锁住上级：与停用上级（锁同一行）串行，停用后不再接收新下级。
    const parent = await tx.store.lockOrgUnit(parentId, 'share');
    if (!parent) throw new Error(`机构 ${parentId} 通过授权后读取失败`);

    const name = input.name.trim();
    const rules = orgUnitNameRules(name);
    if (!isOrgUnitLevel(input.level) || childLevelOf(parent.level) !== input.level) {
      rules.push('org-level-mismatch');
    }
    if (rules.length > 0) return { result: 'non-compliant', rules };

    const actorCode = (await tx.store.findPersonnelById(actor.personnelId))?.code ?? null;
    const parties = {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      sourceIp,
      opcode: ORG_UNIT_REGISTER_OPCODE,
      resourceType: 'org-unit',
    };
    if (parent.deactivatedAt) {
      return {
        result: 'invalid-state',
        failure: {
          ...parties,
          action: 'org.unit.registered',
          outcome: 'failed',
          reason: 'org-unit-deactivated',
          orgUnitId: parent.id,
          resourceId: parent.id,
        },
      };
    }

    const id = newUlid();
    const level = input.level as OrgUnitRow['level'];
    await tx.store.insertOrgUnit({ id, code: `ORG-${id}`, name, level, parentId });
    await tx.store.insertOrgUnitNameVersion({
      id: newUlid(),
      orgUnitId: id,
      name,
      version: 1,
      createdAt: new Date(),
    });
    await audit.append({ ...parties, action: 'org.unit.registered', orgUnitId: id, resourceId: id });
    const created = await tx.store.findOrgUnitById(id);
    if (!created) throw new Error(`机构 ${id} 写入后读取失败`);
    return { result: 'registered', orgUnit: created };
  }

  /**
   * 改名（#123）：追加名称版本（append-only）并更新当前名，previousValue 写旧名。
   * 判定顺序：授权（越权 403）→ 名称（400，不写留痕）→ 与现名称相同时不变。
   */
  async renameOrgUnit(
    actor: ActorRef,
    orgUnitId: string,
    newName: string,
    tx: IdentityTransaction,
    audit: AuditTrailPort,
    sourceIp: string | null = null,
  ): Promise<RenameOrgUnitResult> {
    const resource = { resourceType: 'org-unit', resourceId: orgUnitId };
    const decision = await this.access.check(actor, ORG_UNIT_RENAME_OPCODE, orgUnitId, resource, tx.store);
    if (!decision.allowed) raiseDenied(decision);
    // 锁住本机构：同一机构的两次改名串行，版本号不撞。
    const current = await tx.store.lockOrgUnit(orgUnitId, 'update');
    if (!current) throw new Error(`机构 ${orgUnitId} 通过授权后读取失败`);

    const name = newName.trim();
    const rules = orgUnitNameRules(name);
    if (rules.length > 0) return { result: 'non-compliant', rules };
    if (name === current.name) return { result: 'unchanged', orgUnit: current };

    const versions = await tx.store.listOrgUnitNameVersions(orgUnitId);
    const nextVersion = (versions.at(-1)?.version ?? 0) + 1;
    await tx.store.insertOrgUnitNameVersion({
      id: newUlid(),
      orgUnitId,
      name,
      version: nextVersion,
      createdAt: new Date(),
    });
    await tx.store.updateOrgUnitCurrentName(orgUnitId, name);
    const actorCode = (await tx.store.findPersonnelById(actor.personnelId))?.code ?? null;
    await audit.append({
      action: 'org.unit.renamed',
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp,
      opcode: ORG_UNIT_RENAME_OPCODE,
      resourceType: 'org-unit',
      resourceId: orgUnitId,
      previousValue: current.name,
    });
    return { result: 'renamed', orgUnit: { ...current, name } };
  }

  /**
   * 停用机构（#124，#105「停用（D4）」）。在调用方的交互式事务里执行，业务行与留痕同成同败。
   * 判定顺序：授权（越权 403，不暴露任何条数）→ 已停用（200 unchanged，不写行、不改首次停用时间、不写留痕）
   * → 根机构 → 未停用下级 → 生效任职 → 未办结事项，只返回第一条（409 invalid-state）。
   * 本机构行先加 FOR UPDATE：与在它下面新建下级（锁上级 FOR SHARE）串行，不会留下「已停用机构下有新下级」。
   * 被拒时不在事务里写失败留痕：failure 交给调用方 rejected(...)，回滚后另起事务写入。
   */
  async deactivateOrgUnit(
    actor: ActorRef,
    orgUnitId: string,
    tx: IdentityTransaction,
    audit: AuditTrailPort,
    sourceIp: string | null = null,
  ): Promise<DeactivateOrgUnitResult> {
    const resource = { resourceType: 'org-unit', resourceId: orgUnitId };
    const decision = await this.access.check(actor, ORG_UNIT_DEACTIVATE_OPCODE, orgUnitId, resource, tx.store);
    if (!decision.allowed) raiseDenied(decision);
    const current = await tx.store.lockOrgUnit(orgUnitId, 'update');
    if (!current) throw new Error(`机构 ${orgUnitId} 通过授权后读取失败`);
    if (current.deactivatedAt) return { result: 'unchanged', orgUnit: current };

    const actorCode = (await tx.store.findPersonnelById(actor.personnelId))?.code ?? null;
    const parties = {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp,
      opcode: ORG_UNIT_DEACTIVATE_OPCODE,
      resourceType: 'org-unit',
      resourceId: orgUnitId,
    };
    const refuse = (blocker: DeactivationBlocker): DeactivateOrgUnitResult => ({
      result: 'invalid-state',
      blocker,
      failure: { ...parties, action: 'org.unit.deactivated', outcome: 'failed', reason: blocker.reason },
    });

    if (current.parentId === null) return refuse({ reason: 'org-unit-root' });
    const children = await tx.store.countActiveChildOrgUnits(orgUnitId);
    if (children > 0) return refuse({ reason: 'org-has-active-children', children });
    const assignments = await tx.store.countOpenAssignmentsOfOrgUnit(orgUnitId);
    if (assignments > 0) return refuse({ reason: 'org-has-assignments', assignments });
    const openItems = await this.openItems.countOpenItems(orgUnitId, tx);
    if (openItems.clues + openItems.cases > 0) {
      return refuse({ reason: 'org-has-open-items', openItems: { clues: openItems.clues, cases: openItems.cases } });
    }

    const deactivatedAt = new Date();
    await tx.store.deactivateOrgUnit(orgUnitId, deactivatedAt);
    await audit.append({ ...parties, action: 'org.unit.deactivated' });
    return { result: 'deactivated', orgUnit: { ...current, deactivatedAt } };
  }

}
