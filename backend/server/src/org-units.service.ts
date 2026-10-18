import { Inject, Injectable } from '@nestjs/common';
import { rejected } from '@natural-enforcement/audit';
import {
  OrgUnitService,
  isAccessDenied,
  type ActorRef,
  type DenyReason,
  type OrgTreeUnit,
  type OrgUnitLevel,
  type OrgUnitRuleCode,
} from '@natural-enforcement/identity';

import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

type Denial = { status: 403; body: { reason: DenyReason } };
type NonCompliant = { status: 400; body: { result: 'non-compliant'; rules: OrgUnitRuleCode[] } };

/** 机构树上的一个节点（接口形状）。names 按版本升序；to 为空 = 现用名称。 */
export interface OrgUnitView {
  id: string;
  code: string;
  name: string;
  level: OrgUnitLevel;
  parentId: string | null;
  deactivatedAt: string | null;
  activePersonnel: number;
  names: Array<{ name: string; from: string; to: string | null }>;
}

export type OrgTreeOutcome =
  | { status: 200; body: { result: 'listed'; rootId: string; orgUnits: OrgUnitView[] } }
  | Denial;

export type RegisterOutcome =
  | { status: 200; body: { result: 'registered'; orgUnit: { id: string; code: string; name: string; level: OrgUnitLevel; parentId: string | null } } }
  | NonCompliant
  | { status: 409; body: { result: 'invalid-state' } }
  | Denial;

export type RenameOutcome =
  | { status: 200; body: { result: 'renamed' | 'unchanged'; orgUnit: { id: string; name: string } } }
  | NonCompliant
  | Denial;

function toView(unit: OrgTreeUnit): OrgUnitView {
  return {
    id: unit.id,
    code: unit.code,
    name: unit.name,
    level: unit.level,
    parentId: unit.parentId,
    deactivatedAt: unit.deactivatedAt?.toISOString() ?? null,
    activePersonnel: unit.activePersonnel,
    names: unit.names.map((version, index) => ({
      name: version.name,
      from: version.createdAt.toISOString(),
      to: unit.names[index + 1]?.createdAt.toISOString() ?? null,
    })),
  };
}

/**
 * 管理台机构树（#123）：查看、新建下级、改名。
 * 写动作在一个交互式事务里完成，业务行与留痕同成同败（#119）；
 * 被拒绝的动作经 rejected(...) 回滚，拒绝留痕在回滚后另起事务写入。
 */
@Injectable()
export class OrgUnitsService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly orgUnits: OrgUnitService,
  ) {}

  async tree(actor: ActorRef): Promise<OrgTreeOutcome> {
    try {
      const tree = await this.orgUnits.readTree(actor);
      return { status: 200, body: { result: 'listed', rootId: tree.rootId, orgUnits: tree.units.map(toView) } };
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
  }

  async register(
    actor: ActorRef,
    input: { parentId: string | null; name: string; level: string },
    sourceIp: string | null,
  ): Promise<RegisterOutcome> {
    return this.uow.run<RegisterOutcome>(async (tx) => {
      try {
        const outcome = await this.orgUnits.registerOrgUnit(actor, input, tx, tx.audit, sourceIp);
        if (outcome.result === 'non-compliant') {
          return { status: 400, body: { result: 'non-compliant', rules: outcome.rules } };
        }
        if (outcome.result === 'invalid-state') {
          return rejected<RegisterOutcome>({ status: 409, body: { result: 'invalid-state' } }, outcome.failure);
        }
        const { id, code, name, level, parentId } = outcome.orgUnit;
        return { status: 200, body: { result: 'registered', orgUnit: { id, code, name, level, parentId } } };
      } catch (error) {
        if (!isAccessDenied(error)) throw error;
        const denial: Denial = { status: 403, body: { reason: error.reason } };
        return error.denial ? rejected<RegisterOutcome>(denial, error.denial) : denial;
      }
    });
  }

  async rename(actor: ActorRef, orgUnitId: string, name: string, sourceIp: string | null): Promise<RenameOutcome> {
    return this.uow.run<RenameOutcome>(async (tx) => {
      try {
        const outcome = await this.orgUnits.renameOrgUnit(actor, orgUnitId, name, tx, tx.audit, sourceIp);
        if (outcome.result === 'non-compliant') {
          return { status: 400, body: { result: 'non-compliant', rules: outcome.rules } };
        }
        return {
          status: 200,
          body: { result: outcome.result, orgUnit: { id: outcome.orgUnit.id, name: outcome.orgUnit.name } },
        };
      } catch (error) {
        if (!isAccessDenied(error)) throw error;
        const denial: Denial = { status: 403, body: { reason: error.reason } };
        return error.denial ? rejected<RenameOutcome>(denial, error.denial) : denial;
      }
    });
  }
}
