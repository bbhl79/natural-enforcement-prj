// 报请指定管辖（#215；规格 D 节、GLOSSARY「指定管辖」）。
//
// 线索在待分派池（池所属机构内勤）、已派机构、已派承办人（承办机构内勤）时发现
// 不属本级管辖（包括应归平级机构的），由该内勤发起报请：理由必填、可选拟归属机构。
// 受理人＝报请方与拟归属机构的最近共同上级内勤；未选拟归属机构时为直接上级内勤。
// 报请事项进受理人的待办；受理人以 designate=true 指定承办机构（同时关闭报请，
// 由 clue-dispatch.service 在指定管辖成功的事务里关止），或驳回（理由必填）。
//
// 报请期间主状态不变，但受理链条的下级不能分派、重新分派（409 designation-pending，
// 判定在 clue-dispatch.service）；移送（#216）按同一口径接 readPendingDesignationRequest。
//
// 授权：报请与驳回都走 clue.designate.request 操作码（#207 协议 A 节操作码终稿，
// 名册只立这一个报请受理码；驳回是受理人对报请的处理，对象级校验限受理人本机构内勤）。

import { Inject, Injectable } from '@nestjs/common';

import {
  rejected,
  type AuditAppend,
  type AuditParties,
  type AuthzDeniedEntry,
  type ClueDesignateRejectedFailedReason,
  type ClueDesignateRequestedFailedReason,
} from '@natural-enforcement/audit';
import {
  CLUE_STORE,
  DESIGNATE_REQUEST_FROM_STATUSES,
  reviewerOrgCandidates,
  type ClueDispatchContext,
  type ClueStore,
} from '@natural-enforcement/case';
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

const REQUEST_OPCODE = 'clue.designate.request';

/** 待办里的一条报请事项。 */
export interface DesignationTodoItem {
  readonly requestId: string;
  readonly clueId: string;
  readonly clueCode: string;
  readonly requestingOrgId: string;
  readonly requestingOrgName: string;
  readonly proposedOrgId: string | null;
  readonly proposedOrgName: string | null;
  readonly reviewerOrgId: string;
  readonly reviewerOrgName: string;
  readonly reason: string;
  readonly createdAt: string;
}

/** 报请指定管辖的视图行（分派视图内嵌同形状）。 */
export interface DesignationRequestView {
  readonly requestId: string;
  readonly requestingOrgId: string;
  readonly requestingOrgName: string;
  readonly proposedOrgId: string | null;
  readonly proposedOrgName: string | null;
  readonly reviewerOrgId: string;
  readonly reviewerOrgName: string;
  readonly reason: string;
  readonly createdAt: string;
}

export type DesignateRequestOutcome =
  | {
      readonly status: 200;
      readonly body: {
        readonly result: 'designate-requested';
        readonly clueId: string;
        readonly code: string;
        readonly requestId: string;
        readonly reviewerOrgId: string;
      };
    }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] } }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | { readonly status: 409; readonly body: { readonly result: 'invalid-state' | 'concurrent-change'; readonly reason: string } };

export type DesignateRejectOutcome =
  | {
      readonly status: 200;
      readonly body: {
        readonly result: 'designate-rejected';
        readonly clueId: string;
        readonly code: string;
        readonly requestId: string;
      };
    }
  | { readonly status: 400; readonly body: { readonly result: 'non-compliant'; readonly rules: readonly string[] } }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | { readonly status: 409; readonly body: { readonly result: 'invalid-state' | 'concurrent-change'; readonly reason: string } };

export type DesignationTodoOutcome =
  | { readonly status: 200; readonly body: { readonly result: 'designation-todos'; readonly items: readonly DesignationTodoItem[] } }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason } };

interface Rejection {
  readonly status: 400 | 409;
  readonly result: 'non-compliant' | 'invalid-state' | 'concurrent-change';
  readonly rules: readonly string[];
  readonly reason: string;
}

@Injectable()
export class ClueDesignationService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly access: AccessControlService,
  ) {}

  /** 报请指定管辖（池所属机构内勤／承办机构内勤；理由必填、可选拟归属机构）。 */
  async request(
    actor: ActorRef,
    clueId: string,
    input: { readonly reason: string; readonly proposedOrgId: string | null },
  ): Promise<DesignateRequestOutcome> {
    const context = await this.clues.readDispatchContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    const actorCode = account?.code ?? null;
    const requestingOrgId = this.owningOrgOf(context);

    // 授权第一层：操作码（报请受理同一个名册码；对象级限本机构内勤）。
    try {
      await this.access.authorize(actor, REQUEST_OPCODE, requestingOrgId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    // 授权第二层：对象级（本级机构的内勤发起；in_pool＝池所属机构，其余＝承办机构）。
    if (!(account?.roles ?? []).includes('内勤') || actorOrgId === '' || actorOrgId !== requestingOrgId) {
      await this.deny(actor, actorCode, actorOrgId, clueId, requestingOrgId);
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    if (!(DESIGNATE_REQUEST_FROM_STATUSES as readonly string[]).includes(context.status)) {
      return this.rejectRequest(actor, actorCode, actorOrgId, clueId, {
        status: 409,
        result: 'invalid-state',
        rules: [],
        reason: 'invalid-state',
      });
    }
    const reason = input.reason.trim();
    if (reason === '') {
      return this.rejectRequest(actor, actorCode, actorOrgId, clueId, {
        status: 400,
        result: 'non-compliant',
        rules: ['missing-designate-reason'],
        reason: 'missing-designate-reason',
      });
    }
    let proposedOrgId = input.proposedOrgId?.trim() ? input.proposedOrgId.trim() : null;
    if (proposedOrgId !== null) {
      const proposed = await this.identity.findOrgUnitById(proposedOrgId);
      if (!proposed) return { status: 404, body: { result: 'not-found' } };
      if (proposed.deactivatedAt !== null) {
        return this.rejectRequest(actor, actorCode, actorOrgId, clueId, {
          status: 409,
          result: 'invalid-state',
          rules: [],
          reason: 'org-unit-deactivated',
        });
      }
    } else {
      proposedOrgId = null;
    }
    // 已有待处理报请：报请期间的锁同样拦发起方重复报请。
    if (await this.clues.readPendingDesignationRequest(clueId) !== null) {
      return this.rejectRequest(actor, actorCode, actorOrgId, clueId, {
        status: 409,
        result: 'invalid-state',
        rules: [],
        reason: 'designation-pending',
      });
    }
    // 受理机构：候选链自最近向更远排列，落定有内勤的最近一级。
    const reviewerOrgId = await this.resolveReviewerOrg(requestingOrgId, proposedOrgId);
    if (reviewerOrgId === null) {
      return this.rejectRequest(actor, actorCode, actorOrgId, clueId, {
        status: 409,
        result: 'invalid-state',
        rules: [],
        reason: 'invalid-state',
      });
    }

    // 报请行与成功留痕同成同败；并发同报请被部分唯一索引挡下后另起事务写失败留痕。
    const requestId = newUlid();
    return this.uow.run(async (tx) => {
      const inserted = await tx.clues.insertDesignationRequest({
        id: requestId,
        clueId,
        requestingOrgId,
        proposedOrgId,
        reviewerOrgId,
        reason,
        createdAt: new Date(),
      });
      if (inserted !== 'inserted') {
        return rejected<DesignateRequestOutcome>(
          { status: 409, body: { result: 'invalid-state', reason: 'designation-pending' } },
          this.requestEntry(this.parties(actor, actorCode, actorOrgId, clueId), {
            outcome: 'failed',
            reason: 'designation-pending',
          }),
        );
      }
      await tx.audit.append(
        this.requestEntry(this.parties(actor, actorCode, actorOrgId, clueId), {
          detail: JSON.stringify({
            code: context.code,
            requestingOrgId,
            proposedOrgId,
            reviewerOrgId,
          }),
        }),
      );
      return {
        status: 200,
        body: {
          result: 'designate-requested' as const,
          clueId,
          code: context.code,
          requestId,
          reviewerOrgId,
        },
      };
    });
  }

  /** 驳回报请（受理人；理由必填）。驳回后线索恢复正常办理。 */
  async reject(
    actor: ActorRef,
    clueId: string,
    input: { readonly reason: string },
  ): Promise<DesignateRejectOutcome> {
    const context = await this.clues.readDispatchContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    const actorCode = account?.code ?? null;
    const pending = await this.clues.readPendingDesignationRequest(clueId);
    if (!pending || pending.reviewerOrgId === null) {
      return this.rejectReject(actor, actorCode, actorOrgId, clueId, {
        status: 409,
        result: 'invalid-state',
        rules: [],
        reason: 'invalid-state',
      });
    }

    // 授权第一层：操作码（目标机构＝受理机构，在受理人本机构子树内）。
    try {
      await this.access.authorize(actor, REQUEST_OPCODE, pending.reviewerOrgId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    // 授权第二层：对象级（受理机构的内勤）。
    if (!(account?.roles ?? []).includes('内勤') || actorOrgId === '' || actorOrgId !== pending.reviewerOrgId) {
      await this.deny(actor, actorCode, actorOrgId, clueId, pending.reviewerOrgId);
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    const reason = input.reason.trim();
    if (reason === '') {
      return this.rejectReject(actor, actorCode, actorOrgId, clueId, {
        status: 400,
        result: 'non-compliant',
        rules: ['missing-reject-reason'],
        reason: 'missing-reject-reason',
      });
    }

    // 关止报请行与成功留痕同成同败；并发处理冲突时这一笔不生效，另起事务写失败留痕。
    return this.uow.run(async (tx) => {
      const closed = await tx.clues.closePendingDesignationRequests({
        clueId,
        status: 'rejected',
        decidedBy: actor.personnelId,
        decisionReason: reason,
        decidedAt: new Date(),
      });
      if (closed === 0) {
        return rejected<DesignateRejectOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          this.rejectEntry(this.parties(actor, actorCode, actorOrgId, clueId), {
            outcome: 'failed',
            reason: 'concurrent-change',
          }),
        );
      }
      await tx.audit.append(
        this.rejectEntry(this.parties(actor, actorCode, actorOrgId, clueId), {
          detail: JSON.stringify({
            code: context.code,
            requestId: pending.id,
            requestingOrgId: pending.requestingOrgId,
            reviewerOrgId: pending.reviewerOrgId,
          }),
        }),
      );
      return {
        status: 200,
        body: {
          result: 'designate-rejected' as const,
          clueId,
          code: context.code,
          requestId: pending.id,
        },
      };
    });
  }

  /** 受理人待办：待处理报请里受理机构为本人机构的（本人须持报请受理操作码的内勤）。 */
  async listPendingTodos(actor: ActorRef): Promise<DesignationTodoOutcome> {
    const account = await this.directory.findById(actor.personnelId);
    const actorOrgId = account?.orgUnitId ?? '';
    if (actorOrgId === '') return { status: 403, body: { reason: 'permission-denied' } };
    try {
      await this.access.authorize(actor, REQUEST_OPCODE, actorOrgId, { resourceType: 'clue' });
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
    const rows = (await this.clues.listPendingDesignationRequests()).filter(
      (row) => row.reviewerOrgId === actorOrgId,
    );
    const items: DesignationTodoItem[] = [];
    for (const row of rows) {
      const clue = await this.clues.readDispatchContext(row.clueId);
      const requesting = await this.identity.findOrgUnitById(row.requestingOrgId);
      const proposed = row.proposedOrgId === null ? null : await this.identity.findOrgUnitById(row.proposedOrgId);
      const reviewer = row.reviewerOrgId === null ? null : await this.identity.findOrgUnitById(row.reviewerOrgId);
      items.push({
        requestId: row.id,
        clueId: row.clueId,
        clueCode: clue?.code ?? '',
        requestingOrgId: row.requestingOrgId,
        requestingOrgName: requesting?.name ?? '',
        proposedOrgId: row.proposedOrgId,
        proposedOrgName: proposed?.name ?? null,
        reviewerOrgId: row.reviewerOrgId ?? '',
        reviewerOrgName: reviewer?.name ?? '',
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      });
    }
    return { status: 200, body: { result: 'designation-todos', items } };
  }

  /** 线索本级机构：待分派池取登记机构，已派机构／已派承办人取当前承办机构。 */
  private owningOrgOf(context: ClueDispatchContext): string {
    if (context.status === 'in_pool') return context.enteredOrgId;
    return context.assignment?.orgUnitId ?? context.enteredOrgId;
  }

  /** 受理机构：候选链自最近向更远，落定有在职内勤的最近一级；没有可受理上级即 null。 */
  private async resolveReviewerOrg(
    requestingOrgId: string,
    proposedOrgId: string | null,
  ): Promise<string | null> {
    const requestingPath = await this.identity.findOrgUnitPathToRoot(requestingOrgId);
    const proposedPath = proposedOrgId === null ? null : await this.identity.findOrgUnitPathToRoot(proposedOrgId);
    const candidates = reviewerOrgCandidates({ requestingOrgId, requestingPath, proposedPath });
    for (const orgUnitId of candidates) {
      if (await this.hasActiveClerk(orgUnitId)) return orgUnitId;
    }
    return null;
  }

  /** 该机构是否有在职内勤。 */
  private async hasActiveClerk(orgUnitId: string): Promise<boolean> {
    const personnel = await this.identity.listActivePersonnelOfOrgUnit(orgUnitId);
    for (const person of personnel) {
      const roles = await this.identity.listActiveRoleNames(person.id);
      if (roles.includes('内勤')) return true;
    }
    return false;
  }

  /** 对象级拒绝：403 并写 authz.denied 留痕（回滚后另起事务写，#119 口径）。 */
  private async deny(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
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
      opcode: REQUEST_OPCODE,
      resourceType: 'clue',
      resourceId: clueId,
      previousValue: null,
      targetOrgUnitId,
      targetOrgUnitBasis: 'object',
    };
    await this.uow.run(async () =>
      rejected<DesignateRequestOutcome>({ status: 403, body: { reason: 'permission-denied' } }, denial),
    );
  }

  /** 报请拒绝类留痕：回滚后另起事务写入。 */
  private async rejectRequest(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    rejection: Rejection,
  ): Promise<DesignateRequestOutcome> {
    const outcome = this.outcomeOf<DesignateRequestOutcome>(rejection);
    await this.uow.run(async () =>
      rejected<DesignateRequestOutcome>(
        outcome,
        this.requestEntry(this.parties(actor, actorCode, orgUnitId, clueId), {
          outcome: 'failed',
          reason: rejection.reason as ClueDesignateRequestedFailedReason,
        }),
      ),
    );
    return outcome;
  }

  /** 驳回拒绝类留痕：回滚后另起事务写入。 */
  private async rejectReject(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    rejection: Rejection,
  ): Promise<DesignateRejectOutcome> {
    const outcome = this.outcomeOf<DesignateRejectOutcome>(rejection);
    await this.uow.run(async () =>
      rejected<DesignateRejectOutcome>(
        outcome,
        this.rejectEntry(this.parties(actor, actorCode, orgUnitId, clueId), {
          outcome: 'failed',
          reason: rejection.reason as ClueDesignateRejectedFailedReason,
        }),
      ),
    );
    return outcome;
  }

  private outcomeOf<T extends DesignateRequestOutcome | DesignateRejectOutcome>(rejection: Rejection): T {
    return (
      rejection.status === 400
        ? { status: 400, body: { result: 'non-compliant', rules: rejection.rules } }
        : {
            status: 409,
            body: {
              result: rejection.result as 'invalid-state' | 'concurrent-change',
              reason: rejection.reason,
            },
          }
    ) as T;
  }

  /** 报请留痕行。 */
  private requestEntry(
    parties: AuditParties,
    extra: {
      readonly outcome?: 'failed';
      readonly reason?: ClueDesignateRequestedFailedReason;
      readonly detail?: string;
    },
  ): AuditAppend {
    return extra.outcome === 'failed'
      ? { action: 'clue.designate-requested', outcome: 'failed', reason: extra.reason ?? 'invalid-state', ...parties }
      : { action: 'clue.designate-requested', ...parties, detail: extra.detail ?? null };
  }

  /** 驳回留痕行。 */
  private rejectEntry(
    parties: AuditParties,
    extra: {
      readonly outcome?: 'failed';
      readonly reason?: ClueDesignateRejectedFailedReason;
      readonly detail?: string;
    },
  ): AuditAppend {
    return extra.outcome === 'failed'
      ? { action: 'clue.designate-rejected', outcome: 'failed', reason: extra.reason ?? 'invalid-state', ...parties }
      : { action: 'clue.designate-rejected', ...parties, detail: extra.detail ?? null };
  }

  /** 留痕的当事人列。 */
  private parties(actor: ActorRef, actorCode: string | null, orgUnitId: string, clueId: string): AuditParties {
    return {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      opcode: REQUEST_OPCODE,
      resourceType: 'clue',
      resourceId: clueId,
    };
  }
}
