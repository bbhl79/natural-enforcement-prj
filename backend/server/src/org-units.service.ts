import { Inject, Injectable } from '@nestjs/common';
import { rejected } from '@natural-enforcement/audit';
import {
  OrgUnitService,
  isAccessDenied,
  type ActorRef,
  type DeactivationBlocker,
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

export type DeactivateOutcome =
  | { status: 200; body: { result: 'deactivated' | 'unchanged'; orgUnit: { id: string; deactivatedAt: string } } }
  | {
    status: 409;
    body:
      | { result: 'invalid-state'; message: string }
      | { result: 'invalid-state'; reason: 'org-has-open-items'; openItems: { clues: number; cases: number }; message: string };
  }
  | Denial;

/**
 * 停用被拒的可读原因（#105「409 可读原因」：码＋一句原因，用词遵守 GLOSSARY）。
 * 未办结一句照 #105「未办结前提怎么落」原文。只有未办结在返回体里另带 reason（#105 错误码表）。
 */
export function deactivationRefusal(blocker: DeactivationBlocker): Extract<DeactivateOutcome, { status: 409 }>['body'] {
  switch (blocker.reason) {
    case 'org-unit-root':
      return { result: 'invalid-state', message: '根机构不能停用。' };
    case 'org-has-active-children':
      return {
        result: 'invalid-state',
        message: `本机构还有 ${blocker.children} 个未停用的下级机构，请先停用下级机构，再停用本机构。`,
      };
    case 'org-has-assignments':
      return {
        result: 'invalid-state',
        message: `本机构还有 ${blocker.assignments} 条生效任职（含已停用人员未结束的任职），请先把人员调岗到其他机构，再停用本机构。`,
      };
    case 'org-has-open-items': {
      const { clues, cases } = blocker.openItems;
      return {
        result: 'invalid-state',
        reason: 'org-has-open-items',
        openItems: { clues, cases },
        message: `本机构还有 ${clues + cases} 条未办结的线索或案件（线索 ${clues} 条、案件 ${cases} 条），全部办结后才能停用。`,
      };
    }
  }
}

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

  async deactivate(actor: ActorRef, orgUnitId: string, sourceIp: string | null): Promise<DeactivateOutcome> {
    return this.uow.run<DeactivateOutcome>(async (tx) => {
      try {
        const outcome = await this.orgUnits.deactivateOrgUnit(actor, orgUnitId, tx, tx.audit, sourceIp);
        if (outcome.result === 'invalid-state') {
          return rejected<DeactivateOutcome>({ status: 409, body: deactivationRefusal(outcome.blocker) }, outcome.failure);
        }
        return {
          status: 200,
          body: {
            result: outcome.result,
            orgUnit: { id: outcome.orgUnit.id, deactivatedAt: (outcome.orgUnit.deactivatedAt as Date).toISOString() },
          },
        };
      } catch (error) {
        if (!isAccessDenied(error)) throw error;
        // 越权一律 403，响应只带拒绝原因，不暴露任何条数（#105）。
        const denial: Denial = { status: 403, body: { reason: error.reason } };
        return error.denial ? rejected<DeactivateOutcome>(denial, error.denial) : denial;
      }
    });
  }
}
