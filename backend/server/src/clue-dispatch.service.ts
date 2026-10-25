// 分派决定与两步分派（#214；规格 B/D 节、GLOSSARY）。
//
// 决定步：面状线索撞上未结案既有线索后进待分派决定，由录入人完成「派／不派」——
// 默认不派；存在未结案命中须点「已知晓」才能派（留痕含已知晓）；来源为群众举报及其
// 下级的只能派、不能选不派（400 complaint-must-dispatch）；全部对方已结案可直接派出，
// 但仍由人完成决定。决定「派」进待分派池，「不派」进 held。
//
// 两步分派：接收侧内勤派机构（clue.org.assign，首次分派／重新分派／指定管辖），
// 承办机构内勤再派主办／协办（clue.handler.assign）。重新分派换机构由原承办机构内勤
// 或上级内勤执行，理由必填、留痕、不经审批、不限次数；指定管辖之后下级不能再重新分派
// （409 designated-lock）。状态写动作带 expectedStatus，冲突 409 concurrent-change，
// 失败一方有失败留痕、业务行不变。

import { Inject, Injectable } from '@nestjs/common';

import {
  rejected,
  type AuditAppend,
  type AuditParties,
  type AuthzDeniedEntry,
  type ClueDispatchDecideFailedReason,
  type ClueHandlerAssignedFailedReason,
  type ClueOrgAssignedFailedReason,
} from '@natural-enforcement/audit';
import {
  CLUE_STORE,
  DECIDE_FROM_STATUS,
  ORG_ASSIGN_FROM_STATUSES,
  PEOPLE_ASSIGN_FROM_STATUS,
  decideDispatch,
  hasCaseByCasePlanningType,
  isOpenHit,
  type ClueDispatchContext,
  type ClueStore,
} from '@natural-enforcement/case';
import { findSourceCode, findSourceGroupCode } from '@natural-enforcement/geo-dict';
import {
  AccessControlService,
  IDENTITY_STORE,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type DenyReason,
  type IdentityStore,
} from '@natural-enforcement/identity';

import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';
import { ClueSuggestionService, type AreaSuggestionView } from './clue-suggestion.service.ts';
import type { DesignationRequestView } from './clue-designation.service.ts';

const DECIDE_OPCODE = 'clue.dispatch.decide';
const ORG_OPCODE = 'clue.org.assign';
const PEOPLE_OPCODE = 'clue.handler.assign';
const READ_OPCODE = 'clue.read';

/** 一个命中面对（决定步展示）。 */
export interface DispatchHitPair {
  readonly partId: string;
  readonly partIndex: number;
  readonly otherPartId: string;
  readonly selfRatio: number;
  readonly otherRatio: number;
  readonly intersectionArea: number;
}

/** 按对方线索分组的命中（多面命中折叠展示，规格 B「按对方线索分组」）。 */
export interface DispatchHitGroup {
  readonly otherClueId: string;
  readonly otherClueCode: string;
  readonly otherStatus: string;
  /** 对方未结案：派出前须已知晓。 */
  readonly open: boolean;
  readonly pairs: readonly DispatchHitPair[];
}

/** 分派视图（决定步、派机构、派承办人共用一个视图）。 */
export interface DispatchView {
  readonly result: 'dispatch-view';
  readonly clueId: string;
  readonly code: string;
  readonly status: string;
  readonly domain: string;
  readonly sourceCode: string;
  readonly sourceName: string;
  /** 来源为群众举报及其下级：只能派、不能选不派。 */
  readonly complaint: boolean;
  readonly dupComputedAt: string | null;
  readonly hitGroups: readonly DispatchHitGroup[];
  readonly assignment: {
    readonly orgUnitId: string;
    readonly orgName: string;
    readonly kind: string;
    readonly designate: boolean;
  } | null;
  readonly handlers: readonly { readonly personnelId: string; readonly code: string; readonly name: string; readonly role: string }[];
  /** 承办机构在职人员（派主办／协办的候选）。 */
  readonly candidates: readonly { readonly personnelId: string; readonly code: string; readonly name: string }[];
  readonly suggestion: AreaSuggestionView;
  /** 当前操作者能不能完成分派决定（录入人本人，且线索在待分派决定）。 */
  readonly mayDecide: boolean;
  /** 当前操作者能不能派机构（待分派池所属机构的内勤）。 */
  readonly mayAssignOrg: boolean;
  /** 当前操作者能不能重新分派／指定管辖（原承办机构内勤或上级内勤）。 */
  readonly mayReassignOrg: boolean;
  /** 当前操作者能不能派主办／协办（承办机构内勤）。 */
  readonly mayAssignPeople: boolean;
  /** 当前操作者能不能登记移送（池所属机构内勤／承办机构内勤；#216）。 */
  readonly mayTransfer: boolean;
  /** 进行中的指定管辖报请（无即 null；#215）。 */
  readonly designation: DesignationRequestView | null;
  /** 当前操作者能不能发起报请指定管辖（本级机构内勤、可报请状态、无待处理报请）。 */
  readonly mayRequestDesignation: boolean;
  /** 当前操作者能不能处理报请（受理机构内勤；designate=true 指定或驳回）。 */
  readonly mayReviewDesignation: boolean;
  /** 报请期间的指定锁是否拦当前操作者（受理机构子树内、非受理机构本人）。 */
  readonly designationLocked: boolean;
  /** 初步涉嫌违法类型编码列表（#207 P7）。 */
  readonly typeCodes: readonly string[];
  /** 是否存在需个案判断的规划类项（#207 P7）。 */
  readonly hasCaseByCasePlanningType: boolean;
}

export type DispatchViewOutcome =
  | { readonly status: 200; readonly body: DispatchView }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } };

/** 分派决定结果。 */
export type DecideOutcome =
  | {
      readonly status: 200;
      readonly body: {
        readonly result: 'decided';
        readonly clueId: string;
        readonly code: string;
        readonly status: string;
      };
    }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] } }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | { readonly status: 409; readonly body: { readonly result: 'invalid-state' | 'concurrent-change'; readonly reason: string } };

/** 派机构结果。 */
export type AssignOrgOutcome =
  | {
      readonly status: 200;
      readonly body: {
        readonly result: 'org-assigned';
        readonly clueId: string;
        readonly code: string;
        readonly status: string;
        readonly orgUnitId: string;
        readonly orgName: string;
      };
    }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] } }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | { readonly status: 409; readonly body: { readonly result: 'invalid-state' | 'concurrent-change'; readonly reason: string } };

/** 派主办／协办结果。 */
export type AssignPeopleOutcome =
  | {
      readonly status: 200;
      readonly body: {
        readonly result: 'people-assigned';
        readonly clueId: string;
        readonly code: string;
        readonly status: string;
        readonly handlers: readonly { readonly personnelId: string; readonly role: string }[];
      };
    }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] } }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | { readonly status: 409; readonly body: { readonly result: 'invalid-state' | 'concurrent-change'; readonly reason: string } };

interface Rejection {
  readonly status: 400 | 409;
  readonly result: 'non-compliant' | 'invalid-state' | 'concurrent-change';
  readonly rules: readonly string[];
  readonly reason: string;
}

@Injectable()
export class ClueDispatchService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly access: AccessControlService,
    private readonly suggestion: ClueSuggestionService,
  ) {}

  /** 分派视图：决定步、派机构、派承办人共用一个取数口。 */
  async readView(actor: ActorRef, clueId: string): Promise<DispatchViewOutcome> {
    const context = await this.clues.readDispatchContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    try {
      await this.access.authorize(actor, READ_OPCODE, context.enteredOrgId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    const account = await this.directory.findById(actor.personnelId);
    const suggestion = await this.suggestion.buildFor(context);
    const pendingDesignation = await this.clues.readPendingDesignationRequest(clueId);
    const designation = await this.designationView(pendingDesignation);
    const affordance = await this.affordances(actor, account, context, designation);
    return { status: 200, body: await this.buildView(context, suggestion, affordance, designation) };
  }

  /** 分派决定（录入人本人；默认不派／已知晓／举报必派）。 */
  async decide(
    actor: ActorRef,
    clueId: string,
    input: {
      readonly decision: string;
      readonly acknowledged: boolean;
      readonly expectedStatus: string;
      readonly conflictResolution?: string;
      readonly conflictBasis?: string;
    },
  ): Promise<DecideOutcome> {
    const context = await this.clues.readDispatchContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    const action = input.decision === 'hold' ? 'clue.held' : 'clue.dispatched';

    // 授权第一层：操作码。拒绝时 authorize 自己写 authz.denied 留痕。
    try {
      await this.access.authorize(actor, DECIDE_OPCODE, context.enteredOrgId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    // 授权第二层：对象级（录入人本人完成决定）。
    if (context.registeredBy !== actor.personnelId) {
      await this.deny(actor, account?.code ?? null, actorOrgId, DECIDE_OPCODE, clueId, context.enteredOrgId);
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    const decision = input.decision === 'dispatch' || input.decision === 'hold' ? input.decision : null;
    if (decision === null) {
      return this.reject(actor, account?.code ?? null, actorOrgId, clueId, action, {
        status: 400,
        result: 'non-compliant',
        rules: ['decision-invalid'],
        reason: 'invalid-form',
      });
    }
    const guard = this.stateGuard(context.status, input.expectedStatus, [DECIDE_FROM_STATUS]);
    if (guard) {
      return this.reject(actor, account?.code ?? null, actorOrgId, clueId, action, guard);
    }

    // 规则：默认不派／已知晓／举报必派（来源大类 3 = 群众举报及其下级）。
    const complaint = findSourceGroupCode(context.sourceCode) === '3';
    const openHitCount = context.hits.filter((hit) => isOpenHit(hit.otherStatus)).length;
    const decided = decideDispatch({
      complaint,
      openHitCount,
      decision,
      acknowledged: input.acknowledged,
    });
    if (!decided.ok) {
      return this.reject(actor, account?.code ?? null, actorOrgId, clueId, action, {
        status: 400,
        result: 'non-compliant',
        rules: [decided.rule],
        reason: decided.rule,
      });
    }

    // P7：个案判断 8 项在派时必须选方向和填依据。
    if (decision === 'dispatch' && hasCaseByCasePlanningType(context.typeCodes)) {
      const resolution = input.conflictResolution;
      const basis = (input.conflictBasis ?? '').trim();
      if (resolution !== 'handle-in-system' && resolution !== 'transfer-outside') {
        return this.reject(actor, account?.code ?? null, actorOrgId, clueId, action, {
          status: 400,
          result: 'non-compliant',
          rules: ['missing-conflict-resolution'],
          reason: 'invalid-form',
        });
      }
      if (basis === '') {
        return this.reject(actor, account?.code ?? null, actorOrgId, clueId, action, {
          status: 400,
          result: 'non-compliant',
          rules: ['missing-conflict-basis'],
          reason: 'invalid-form',
        });
      }
    }

    const caseByCaseDetail =
      decision === 'dispatch' && hasCaseByCasePlanningType(context.typeCodes)
        ? {
            conflictResolution: input.conflictResolution,
            conflictBasis: (input.conflictBasis ?? '').trim(),
          }
        : null;

    // 决定与成功留痕同成同败；并发冲突回滚后另起事务写失败留痕。
    return this.uow.run(async (tx) => {
      const applied = await tx.clues.applyDecision({
        clueId,
        expectedStatus: input.expectedStatus,
        nextStatus: decided.nextStatus,
      });
      if (!applied) {
        return rejected<DecideOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          this.decideEntry(action, this.parties(actor, account?.code ?? null, actorOrgId, clueId, DECIDE_OPCODE), {
            outcome: 'failed',
            reason: 'concurrent-change',
          }),
        );
      }
      await tx.audit.append(
        this.decideEntry(action, this.parties(actor, account?.code ?? null, actorOrgId, clueId, DECIDE_OPCODE), {
          detail: JSON.stringify({
            code: context.code,
            beforeStatus: context.status,
            afterStatus: decided.nextStatus,
            acknowledged: decision === 'dispatch' ? input.acknowledged : false,
            ...(caseByCaseDetail ? { conflictResolution: caseByCaseDetail.conflictResolution, conflictBasis: caseByCaseDetail.conflictBasis } : {}),
          }),
        }),
      );
      return {
        status: 200,
        body: { result: 'decided' as const, clueId, code: context.code, status: decided.nextStatus },
      };
    });
  }

  /** 派机构（首次分派、重新分派、指定管辖；理由必填、留痕、不限次数）。 */
  async assignOrg(
    actor: ActorRef,
    clueId: string,
    input: {
      readonly orgUnitId: string;
      readonly expectedStatus: string;
      readonly reason: string;
      readonly designate: boolean;
    },
  ): Promise<AssignOrgOutcome> {
    const context = await this.clues.readDispatchContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    const actorCode = account?.code ?? null;
    const orgUnitId = input.orgUnitId.trim();
    if (orgUnitId === '') {
      return this.rejectOrg(actor, actorCode, actorOrgId, clueId, {
        status: 400,
        result: 'non-compliant',
        rules: ['org-unit-required'],
        reason: 'invalid-form',
      });
    }
    const target = await this.identity.findOrgUnitById(orgUnitId);
    if (!target) return { status: 404, body: { result: 'not-found' } };

    // 授权第一层：操作码 + 目标机构在数据范围内（只能指向数据范围内的机构）。
    try {
      await this.access.authorize(actor, ORG_OPCODE, orgUnitId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    const guard = this.stateGuard(context.status, input.expectedStatus, [...ORG_ASSIGN_FROM_STATUSES]);
    if (guard) {
      return this.rejectOrg(actor, actorCode, actorOrgId, clueId, guard);
    }
    // 报请期间的指定锁（#215）：受理机构子树内的下级此时不能分派、重新分派或指定。
    const pendingGuard = await this.designationPendingGuard(actorOrgId, clueId);
    if (pendingGuard) {
      return this.rejectOrg(actor, actorCode, actorOrgId, clueId, pendingGuard);
    }
    if (target.deactivatedAt !== null) {
      return this.rejectOrg(actor, actorCode, actorOrgId, clueId, {
        status: 409,
        result: 'invalid-state',
        rules: [],
        reason: 'org-unit-deactivated',
      });
    }

    const reassigning =
      context.status === 'org_assigned' || context.status === 'handler_assigned';
    const reason = input.reason.trim();
    let kind: 'initial' | 'reassign' | 'designate' = reassigning ? 'reassign' : 'initial';

    if (input.designate) {
      // 指定管辖：上级内勤以 designate=true 指定下级机构承办（首次分派或重新分派时都可执行）。
      const path = await this.identity.findOrgUnitPathToRoot(orgUnitId);
      const isSuperior = path.includes(actorOrgId) && actorOrgId !== orgUnitId && actorOrgId !== '';
      if (!isSuperior) {
        return this.rejectOrg(actor, actorCode, actorOrgId, clueId, {
          status: 400,
          result: 'non-compliant',
          rules: ['designate-requires-superior'],
          reason: 'invalid-form',
        });
      }
      kind = 'designate';
      if (reassigning && context.assignment) {
        // 重新分派理由必填。
        if (reason === '') {
          return this.rejectOrg(actor, actorCode, actorOrgId, clueId, {
            status: 400,
            result: 'non-compliant',
            rules: ['missing-reassign-reason'],
            reason: 'missing-reassign-reason',
          });
        }
        // 指定管辖锁：指定之后仅指定者或其上级可再调整，下级返回 409 designated-lock。
        if (
          context.assignment.designate &&
          context.assignment.assignedByOrgId !== null &&
          !(await this.access.check(actor, ORG_OPCODE, context.assignment.assignedByOrgId)).allowed
        ) {
          return this.rejectOrg(actor, actorCode, actorOrgId, clueId, {
            status: 409,
            result: 'invalid-state',
            rules: [],
            reason: 'designated-lock',
          });
        }
      }
    } else if (reassigning && context.assignment) {
      // 重新分派理由必填。
      if (reason === '') {
        return this.rejectOrg(actor, actorCode, actorOrgId, clueId, {
          status: 400,
          result: 'non-compliant',
          rules: ['missing-reassign-reason'],
          reason: 'missing-reassign-reason',
        });
      }
      // 指定管辖锁：指定之后仅指定者或其上级可再调整，下级返回 409 designated-lock。
      if (
        context.assignment.designate &&
        context.assignment.assignedByOrgId !== null &&
        !(await this.access.check(actor, ORG_OPCODE, context.assignment.assignedByOrgId)).allowed
      ) {
        return this.rejectOrg(actor, actorCode, actorOrgId, clueId, {
          status: 409,
          result: 'invalid-state',
          rules: [],
          reason: 'designated-lock',
        });
      }
      // 对象级：原承办机构内勤或上级内勤。
      const clerkHere =
        (account?.roles ?? []).includes('内勤') &&
        account?.orgUnitId === context.assignment.orgUnitId;
      const superior = (
        await this.access.check(actor, ORG_OPCODE, context.assignment.orgUnitId)
      ).allowed;
      if (!clerkHere && !superior) {
        await this.deny(actor, actorCode, actorOrgId, ORG_OPCODE, clueId, context.assignment.orgUnitId);
        return { status: 403, body: { reason: 'permission-denied' } };
      }
    } else {
      // 首次分派：待分派池所属机构的内勤。
      const clerkHere =
        (account?.roles ?? []).includes('内勤') && account?.orgUnitId === context.enteredOrgId;
      if (!clerkHere) {
        await this.deny(actor, actorCode, actorOrgId, ORG_OPCODE, clueId, context.enteredOrgId);
        return { status: 403, body: { reason: 'permission-denied' } };
      }
    }

    // 分派事实与成功留痕同成同败；并发冲突回滚后另起事务写失败留痕。
    return this.uow.run(async (tx) => {
      const applied = await tx.clues.assignOrg({
        clueId,
        expectedStatus: input.expectedStatus,
        assignmentId: newUlid(),
        orgUnitId,
        kind,
        designate: kind === 'designate',
        assignedBy: actor.personnelId,
        assignedByOrgId: actorOrgId,
        reason: kind === 'initial' ? null : reason,
        assignedAt: new Date(),
      });
      if (!applied) {
        return rejected<AssignOrgOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'clue.org-assigned',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(actor, actorCode, actorOrgId, clueId, ORG_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'clue.org-assigned',
        ...this.parties(actor, actorCode, actorOrgId, clueId, ORG_OPCODE),
        detail: JSON.stringify({
          code: context.code,
          previousOrgId: context.assignment?.orgUnitId ?? null,
          orgUnitId,
          kind,
          designate: kind === 'designate',
        }),
      });
      // 受理人以 designate=true 指定承办机构：同时关闭进行中的报请（#215）。
      if (kind === 'designate') {
        await tx.clues.closePendingDesignationRequests({
          clueId,
          status: 'approved',
          decidedBy: actor.personnelId,
          decisionReason: null,
          decidedAt: new Date(),
        });
      }
      return {
        status: 200,
        body: {
          result: 'org-assigned' as const,
          clueId,
          code: context.code,
          status: 'org_assigned',
          orgUnitId,
          orgName: target.name,
        },
      };
    });
  }

  /** 派主办／协办（承办机构内勤；状态由已派机构进已派承办人）。 */
  async assignPeople(
    actor: ActorRef,
    clueId: string,
    input: {
      readonly mainId: string;
      readonly assistIds: readonly string[];
      readonly expectedStatus: string;
    },
  ): Promise<AssignPeopleOutcome> {
    const context = await this.clues.readDispatchContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    const actorCode = account?.code ?? null;
    const assignment = context.assignment;

    // 授权第一层：操作码 + 承办机构在数据范围内。
    try {
      await this.access.authorize(actor, PEOPLE_OPCODE, assignment?.orgUnitId ?? context.enteredOrgId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    if (!assignment) {
      return { status: 409, body: { result: 'invalid-state', reason: 'invalid-state' } };
    }
    // 对象级：承办机构内勤。
    const clerkHere =
      (account?.roles ?? []).includes('内勤') && account?.orgUnitId === assignment.orgUnitId;
    if (!clerkHere) {
      await this.deny(actor, actorCode, actorOrgId, PEOPLE_OPCODE, clueId, assignment.orgUnitId);
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    const guard = this.stateGuard(context.status, input.expectedStatus, [PEOPLE_ASSIGN_FROM_STATUS]);
    if (guard) {
      return this.rejectPeople(actor, actorCode, actorOrgId, clueId, guard);
    }
    // 报请期间的指定锁（#215）：承办机构在受理机构子树内时同样拦派主办／协办。
    const pendingGuard = await this.designationPendingGuard(actorOrgId, clueId);
    if (pendingGuard) {
      return this.rejectPeople(actor, actorCode, actorOrgId, clueId, pendingGuard);
    }
    const mainId = input.mainId.trim();
    if (mainId === '') {
      return this.rejectPeople(actor, actorCode, actorOrgId, clueId, {
        status: 400,
        result: 'non-compliant',
        rules: ['handler-main-required'],
        reason: 'missing-required-items',
      });
    }
    const assistIds = [...new Set(input.assistIds.map((id) => id.trim()).filter((id) => id !== '' && id !== mainId))];
    const wanted = [
      { personnelId: mainId, role: 'main' as const },
      ...assistIds.map((personnelId) => ({ personnelId, role: 'assist' as const })),
    ];
    // 对象级校验：承办人须在职且当前任职在承办机构。
    for (const handler of wanted) {
      const person = await this.identity.findPersonnelById(handler.personnelId);
      const posting = person ? await this.identity.findCurrentAssignment(handler.personnelId) : null;
      if (!person || person.deactivatedAt !== null || !posting || posting.orgUnitId !== assignment.orgUnitId) {
        return this.rejectPeople(actor, actorCode, actorOrgId, clueId, {
          status: 400,
          result: 'non-compliant',
          rules: ['assignee-not-qualified'],
          reason: 'assignee-not-qualified',
        });
      }
    }

    // 承办人行与成功留痕同成同败；并发冲突回滚后另起事务写失败留痕。
    const handlers = wanted.map((handler) => ({ id: newUlid(), ...handler }));
    return this.uow.run(async (tx) => {
      const applied = await tx.clues.assignPeople({
        clueId,
        expectedStatus: input.expectedStatus,
        handlers,
        assignedAt: new Date(),
      });
      if (!applied) {
        return rejected<AssignPeopleOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'clue.handler-assigned',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(actor, actorCode, actorOrgId, clueId, PEOPLE_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'clue.handler-assigned',
        ...this.parties(actor, actorCode, actorOrgId, clueId, PEOPLE_OPCODE),
        detail: JSON.stringify({
          code: context.code,
          before: context.handlers.map((handler) => ({
            personnelId: handler.personnelId,
            role: handler.role,
          })),
          after: handlers.map((handler) => ({
            personnelId: handler.personnelId,
            role: handler.role,
          })),
        }),
      });
      return {
        status: 200,
        body: {
          result: 'people-assigned' as const,
          clueId,
          code: context.code,
          status: 'handler_assigned',
          handlers: handlers.map((handler) => ({
            personnelId: handler.personnelId,
            role: handler.role,
          })),
        },
      };
    });
  }

  /** 状态守卫：expectedStatus 不符即并发冲突；状态不在允许集合即 invalid-state。 */
  private stateGuard(
    actual: string,
    expected: string,
    allowed: readonly string[],
  ): Rejection | null {
    if (actual !== expected) {
      return { status: 409, result: 'concurrent-change', rules: [], reason: 'concurrent-change' };
    }
    if (!allowed.includes(actual)) {
      return { status: 409, result: 'invalid-state', rules: [], reason: 'invalid-state' };
    }
    return null;
  }

  /**
   * 报请期间的指定锁（#215，规格 D）：有待处理报请时，受理机构子树内（含报请方）、
   * 非受理机构本人的操作者不能分派、重新分派或指定，返回 409 designation-pending。
   * 受理人本人与更高上级不受此锁；移送（#216）按同一口径接本判定。
   */
  private async designationPendingGuard(actorOrgId: string, clueId: string): Promise<Rejection | null> {
    const pending = await this.clues.readPendingDesignationRequest(clueId);
    if (pending === null || pending.reviewerOrgId === null) return null;
    if (actorOrgId === '' || actorOrgId === pending.reviewerOrgId) return null;
    const subtree = await this.identity.listOrgUnitSubtreeIds(pending.reviewerOrgId);
    if (!subtree.includes(actorOrgId)) return null;
    return { status: 409, result: 'invalid-state', rules: [], reason: 'designation-pending' };
  }

  /** 当前操作者的分派办理权限（界面 affordance；服务端每次都照校验）。 */
  private async affordances(
    actor: ActorRef,
    account: { readonly orgUnitId: string | null; readonly roles: readonly string[] } | null,
    context: ClueDispatchContext,
    designation: DesignationRequestView | null,
  ): Promise<{
    mayDecide: boolean;
    mayAssignOrg: boolean;
    mayReassignOrg: boolean;
    mayAssignPeople: boolean;
    mayTransfer: boolean;
    mayRequestDesignation: boolean;
    mayReviewDesignation: boolean;
    designationLocked: boolean;
  }> {
    const roles = account?.roles ?? [];
    const actorOrg = account?.orgUnitId ?? null;
    const mayDecide = context.registeredBy === actor.personnelId && context.status === DECIDE_FROM_STATUS;
    const mayAssignOrg =
      context.status === 'in_pool' &&
      roles.includes('内勤') &&
      actorOrg !== null &&
      actorOrg === context.enteredOrgId;
    let mayReassignOrg = false;
    if (
      (context.status === 'org_assigned' || context.status === 'handler_assigned') &&
      context.assignment &&
      roles.includes('内勤')
    ) {
      const clerkHere = actorOrg === context.assignment.orgUnitId;
      const superior = (
        await this.access.check(actor, ORG_OPCODE, context.assignment.orgUnitId)
      ).allowed;
      mayReassignOrg = clerkHere || superior;
    }
    const mayAssignPeople =
      context.status === PEOPLE_ASSIGN_FROM_STATUS &&
      context.assignment !== null &&
      roles.includes('内勤') &&
      actorOrg !== null &&
      actorOrg === context.assignment.orgUnitId;
    // 移送（#216）：待分派池取池所属机构内勤，已派机构／已派承办人取承办机构内勤。
    const transferOrgId = context.assignment?.orgUnitId ?? context.enteredOrgId;
    const mayTransfer =
      (context.status === 'in_pool' ||
        context.status === 'org_assigned' ||
        context.status === 'handler_assigned') &&
      roles.includes('内勤') &&
      actorOrg !== null &&
      actorOrg === transferOrgId;
    // 报请指定管辖（#215）：本级机构内勤、可报请状态、无待处理报请时可发起；
    // 受理机构内勤可处理；受理机构子树内的其他人被报请期间的指定锁拦下。
    const owningOrg =
      context.status === 'in_pool'
        ? context.enteredOrgId
        : (context.assignment?.orgUnitId ?? context.enteredOrgId);
    const mayRequestDesignation =
      designation === null &&
      roles.includes('内勤') &&
      actorOrg !== null &&
      actorOrg === owningOrg &&
      (ORG_ASSIGN_FROM_STATUSES as readonly string[]).includes(context.status);
    const mayReviewDesignation =
      designation !== null &&
      roles.includes('内勤') &&
      actorOrg !== null &&
      actorOrg === designation.reviewerOrgId;
    const designationLocked = await this.designationLockedFor(actorOrg, designation);
    return {
      mayDecide,
      mayAssignOrg,
      mayReassignOrg,
      mayAssignPeople,
      mayTransfer,
      mayRequestDesignation,
      mayReviewDesignation,
      designationLocked,
    };
  }

  /** 报请期间的指定锁：受理机构子树内（含报请方）、非受理机构本人的操作者被拦。 */
  private async designationLockedFor(
    actorOrg: string | null,
    designation: DesignationRequestView | null,
  ): Promise<boolean> {
    if (designation === null || actorOrg === null || actorOrg === '') return false;
    if (actorOrg === designation.reviewerOrgId) return false;
    const subtree = await this.identity.listOrgUnitSubtreeIds(designation.reviewerOrgId);
    return subtree.includes(actorOrg);
  }

  /** 组装进行中的报请视图（无即 null）。 */
  private async designationView(
    row: Awaited<ReturnType<ClueStore['readPendingDesignationRequest']>>,
  ): Promise<DesignationRequestView | null> {
    if (row === null || row.reviewerOrgId === null) return null;
    const requesting = await this.identity.findOrgUnitById(row.requestingOrgId);
    const proposed = row.proposedOrgId === null ? null : await this.identity.findOrgUnitById(row.proposedOrgId);
    const reviewer = await this.identity.findOrgUnitById(row.reviewerOrgId);
    return {
      requestId: row.id,
      requestingOrgId: row.requestingOrgId,
      requestingOrgName: requesting?.name ?? '',
      proposedOrgId: row.proposedOrgId,
      proposedOrgName: proposed?.name ?? null,
      reviewerOrgId: row.reviewerOrgId,
      reviewerOrgName: reviewer?.name ?? '',
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 组装分派视图。 */
  private async buildView(
    context: ClueDispatchContext,
    suggestion: AreaSuggestionView,
    affordance: {
      mayDecide: boolean;
      mayAssignOrg: boolean;
      mayReassignOrg: boolean;
      mayAssignPeople: boolean;
      mayTransfer: boolean;
      mayRequestDesignation: boolean;
      mayReviewDesignation: boolean;
      designationLocked: boolean;
    },
    designation: DesignationRequestView | null,
  ): Promise<DispatchView> {
    const groups = new Map<string, DispatchHitGroup & { pairs: DispatchHitPair[] }>();
    for (const hit of context.hits) {
      const group = groups.get(hit.otherClueId) ?? {
        otherClueId: hit.otherClueId,
        otherClueCode: hit.otherClueCode,
        otherStatus: hit.otherStatus,
        open: isOpenHit(hit.otherStatus),
        pairs: [],
      };
      group.pairs.push({
        partId: hit.partId,
        partIndex: hit.partIndex,
        otherPartId: hit.otherPartId,
        selfRatio: hit.selfRatio,
        otherRatio: hit.otherRatio,
        intersectionArea: hit.intersectionArea,
      });
      groups.set(hit.otherClueId, group);
    }
    const assignmentOrg = context.assignment
      ? await this.identity.findOrgUnitById(context.assignment.orgUnitId)
      : null;
    const handlers: {
      personnelId: string;
      code: string;
      name: string;
      role: string;
    }[] = [];
    for (const handler of context.handlers) {
      const person = await this.identity.findPersonnelById(handler.personnelId);
      handlers.push({
        personnelId: handler.personnelId,
        code: person?.code ?? '',
        name: person?.name ?? '',
        role: handler.role,
      });
    }
    const candidates = context.assignment
      ? (
          await this.identity.listActivePersonnelOfOrgUnit(context.assignment.orgUnitId)
        ).map((person) => ({ personnelId: person.id, code: person.code, name: person.name }))
      : [];
    return {
      result: 'dispatch-view',
      clueId: context.clueId,
      code: context.code,
      status: context.status,
      domain: context.domain,
      sourceCode: context.sourceCode,
      sourceName: findSourceCode(context.sourceCode)?.name ?? context.sourceCode,
      complaint: findSourceGroupCode(context.sourceCode) === '3',
      dupComputedAt: context.dupComputedAt?.toISOString() ?? null,
      hitGroups: [...groups.values()],
      assignment:
        context.assignment && assignmentOrg
          ? {
              orgUnitId: context.assignment.orgUnitId,
              orgName: assignmentOrg.name,
              kind: context.assignment.kind,
              designate: context.assignment.designate,
            }
          : null,
      handlers,
      candidates,
      suggestion,
      mayDecide: affordance.mayDecide,
      mayAssignOrg: affordance.mayAssignOrg,
      mayReassignOrg: affordance.mayReassignOrg,
      mayAssignPeople: affordance.mayAssignPeople,
      mayTransfer: affordance.mayTransfer,
      designation,
      mayRequestDesignation: affordance.mayRequestDesignation,
      mayReviewDesignation: affordance.mayReviewDesignation,
      designationLocked: affordance.designationLocked,
        typeCodes: context.typeCodes,
        hasCaseByCasePlanningType: hasCaseByCasePlanningType(context.typeCodes),
    };
  }

  /** 对象级拒绝：403 并写 authz.denied 留痕（回滚后另起事务写，#119 口径）。 */
  private async deny(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    opcode: string,
    clueId: string,
    targetOrgUnitId: string,
  ): Promise<void> {
    const denial: AuthzDeniedEntry = {
      action: 'authz.denied',
      outcome: 'failed',
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      reason: 'permission-denied',
      opcode,
      resourceType: 'clue',
      resourceId: clueId,
      previousValue: null,
      targetOrgUnitId,
      targetOrgUnitBasis: 'object',
    };
    await this.uow.run(async () =>
      rejected<DecideOutcome>({ status: 403, body: { reason: 'permission-denied' } }, denial),
    );
  }

  /** 决定步拒绝类留痕：回滚后另起事务写入。 */
  private async reject(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    action: 'clue.dispatched' | 'clue.held',
    rejection: Rejection,
  ): Promise<DecideOutcome> {
    const outcome: DecideOutcome =
      rejection.status === 400
        ? { status: 400, body: { result: 'non-compliant', rules: rejection.rules } }
        : {
            status: 409,
            body: {
              result: rejection.result as 'invalid-state' | 'concurrent-change',
              reason: rejection.reason,
            },
          };
    await this.uow.run(async () =>
      rejected<DecideOutcome>(
        outcome,
        this.decideEntry(action, this.parties(actor, actorCode, orgUnitId, clueId, DECIDE_OPCODE), {
          outcome: 'failed',
          reason: rejection.reason as ClueDispatchDecideFailedReason,
        }),
      ),
    );
    return outcome;
  }

  /** 派机构拒绝类留痕：回滚后另起事务写入。 */
  private async rejectOrg(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    rejection: Rejection,
  ): Promise<AssignOrgOutcome> {
    const outcome: AssignOrgOutcome =
      rejection.status === 400
        ? { status: 400, body: { result: 'non-compliant', rules: rejection.rules } }
        : {
            status: 409,
            body: {
              result: rejection.result as 'invalid-state' | 'concurrent-change',
              reason: rejection.reason,
            },
          };
    await this.uow.run(async () =>
      rejected<AssignOrgOutcome>(outcome, {
        action: 'clue.org-assigned',
        outcome: 'failed',
        reason: rejection.reason as ClueOrgAssignedFailedReason,
        ...this.parties(actor, actorCode, orgUnitId, clueId, ORG_OPCODE),
      }),
    );
    return outcome;
  }

  /** 派承办人拒绝类留痕：回滚后另起事务写入。 */
  private async rejectPeople(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    rejection: Rejection,
  ): Promise<AssignPeopleOutcome> {
    const outcome: AssignPeopleOutcome =
      rejection.status === 400
        ? { status: 400, body: { result: 'non-compliant', rules: rejection.rules } }
        : {
            status: 409,
            body: {
              result: rejection.result as 'invalid-state' | 'concurrent-change',
              reason: rejection.reason,
            },
          };
    await this.uow.run(async () =>
      rejected<AssignPeopleOutcome>(outcome, {
        action: 'clue.handler-assigned',
        outcome: 'failed',
        reason: rejection.reason as ClueHandlerAssignedFailedReason,
        ...this.parties(actor, actorCode, orgUnitId, clueId, PEOPLE_OPCODE),
      }),
    );
    return outcome;
  }

  /** 决定步留痕行：动作词分两个判别成员，按动作词定型返回。 */
  private decideEntry(
    action: 'clue.dispatched' | 'clue.held',
    parties: AuditParties,
    extra: {
      readonly outcome?: 'failed';
      readonly reason?: ClueDispatchDecideFailedReason;
      readonly detail?: string;
    },
  ): AuditAppend {
    if (action === 'clue.dispatched') {
      return extra.outcome === 'failed'
        ? {
            action: 'clue.dispatched',
            outcome: 'failed',
            reason: extra.reason ?? 'invalid-state',
            ...parties,
          }
        : { action: 'clue.dispatched', ...parties, detail: extra.detail ?? null };
    }
    return extra.outcome === 'failed'
      ? { action: 'clue.held', outcome: 'failed', reason: extra.reason ?? 'invalid-state', ...parties }
      : { action: 'clue.held', ...parties, detail: extra.detail ?? null };
  }

  /** 留痕的当事人列。 */
  private parties(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    opcode: string,
  ): AuditParties {
    return {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      opcode,
      resourceType: 'clue',
      resourceId: clueId,
    };
  }
}
