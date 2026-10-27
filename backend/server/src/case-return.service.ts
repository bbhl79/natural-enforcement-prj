// 案件退回（#238）。判定在 case 包的纯函数里，这里只喂事实、落库、写留痕。
// 失败不改业务行。回流不改已有材料，也不改已有环节实例。

import { Inject, Injectable } from '@nestjs/common';
import { rejected, type CaseReturnedFailedReason } from '@natural-enforcement/audit';
import {
  CASE_STAGE_CODES,
  CASE_STORE,
  CASE_SUPERVISION_ROLE,
  checkDocumentEdit,
  planReturn,
  signatureReusable,
  type CaseStageCode,
  type CaseStore,
  type CaseView,
} from '@natural-enforcement/case';
import {
  AccessControlService,
  IDENTITY_STORE,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type IdentityStore,
} from '@natural-enforcement/identity';

import { CLOCK, type Clock } from './clock.ts';
import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { loadHandlerAvailability, loadReceiverCandidate, returnFailureDetail } from './return-facts.ts';
import { UNIT_OF_WORK, type TxScope, type UnitOfWork } from './unit-of-work.ts';

const REVIEW_OPCODE = 'doc.admin.review';
const APPROVE_OPCODE = 'doc.approve';
const DRAFT_OPCODE = 'doc.draft';

/** 改派不批（#279）：走 #238 退回，R10 继承 R9 取得「退回拟制中」这一点。 */
const REASSIGN_REJECT_REASON = 'R10';
const REASSIGN_REJECT_INHERITED = 'R9';

const FAIL_REASONS = new Set<string>([
  'missing-return-reason',
  'missing-return-note',
  'missing-return-target',
  'missing-receiver',
  'return-target-not-allowed',
  'transition-disabled',
  'external-return',
  'receiver-not-allowed',
  'signature-invalidated',
  'invalid-state',
  'concurrent-change',
]);

export interface CaseReturnInput {
  readonly reasonCode: string;
  readonly note: string;
  readonly targetKey: string;
  readonly receiverId: string;
  readonly inheritedCode: string | null;
  readonly defectiveStage: string | null;
  readonly earlierChainLevel: string | null;
}

export type CaseReturnHttpOutcome =
  | { readonly status: 200; readonly body: Record<string, unknown> }
  | { readonly status: 400; readonly body: Record<string, unknown> }
  | { readonly status: 403; readonly body: { readonly reason: string } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | { readonly status: 409; readonly body: Record<string, unknown> };

@Injectable()
export class CaseReturnService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly access: AccessControlService,
  ) {}

  async returnCase(actor: ActorRef, caseId: string, input: CaseReturnInput): Promise<CaseReturnHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorCode = account?.code ?? null;
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    if (roles.length > 0 && roles.every((role) => role === CASE_SUPERVISION_ROLE)) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    const opcode = roles.includes('行政审批') ? APPROVE_OPCODE : REVIEW_OPCODE;
    const denied = await this.authorize(actor, opcode, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };

    const handlers = await loadHandlerAvailability(this.identity, view.handlingOrgId, view.handlers);
    const receiverId = input.receiverId.trim();
    const receiver = receiverId
      ? await loadReceiverCandidate(this.identity, this.access, view.handlingOrgId, receiverId, view.handlers)
      : null;
    const stage = asStage(view.currentStage);
    const planned = planReturn({
      reasonCode: input.reasonCode,
      note: input.note,
      currentStage: stage,
      targetKey: input.targetKey.trim() || null,
      currentEntrySeq: view.stageEntrySeq,
      inheritedCode: input.inheritedCode,
      defectiveStage: asStage(input.defectiveStage),
      earlierChainLevels: input.earlierChainLevel && input.earlierChainLevel.trim() !== '' ? [input.earlierChainLevel.trim()] : [],
      instances: view.instances.map((row) => ({ id: row.id, stage: row.stage, entrySeq: row.entrySeq })),
      invalidatedInstanceIds: view.instances.filter((row) => row.invalidated).map((row) => row.id),
      receiver,
      handlers,
    });
    if (!planned.ok) {
      return this.fail(
        actor,
        actorCode,
        view.handlingOrgId,
        caseId,
        opcode,
        {
          status: planned.httpStatus,
          reason: planned.reason,
          message: planned.message,
          outlet: planned.outlet,
        },
        returnFailureDetail(input.reasonCode, input.targetKey, input.inheritedCode),
      );
    }
    const plan = planned.plan;
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const current = await tx.cases.readCaseView(caseId);
      if (!current || current.currentStage !== view.currentStage || current.stageEntrySeq !== view.stageEntrySeq) {
        return rejected<CaseReturnHttpOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'case.returned',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(actor, actorCode, view.handlingOrgId, caseId, opcode),
          },
        );
      }
      const opinionId = newUlid();
      const returnId = newUlid();
      await tx.cases.appendApprovalOpinion({
        id: opinionId,
        caseId,
        reasonCode: plan.reasonCode,
        note: plan.note,
        targetKey: plan.target.key,
        actorId: actor.personnelId,
        createdAt: at,
      });
      await tx.cases.appendCaseReturn({
        id: returnId,
        caseId,
        opinionId,
        reasonCode: plan.reasonCode,
        inheritedCode: plan.inheritedCode,
        targetKey: plan.target.key,
        receiverId: plan.receiverId,
        reflow: plan.target.kind === 'stage',
        n5: plan.n5,
        entrySeqBefore: current.stageEntrySeq,
        entrySeqAfter: plan.nextEntrySeq,
        exitCode: plan.exit,
        rehearingRequired: plan.rehearingRequired,
        revokeNotice: plan.revokeNotice,
        actorId: actor.personnelId,
        createdAt: at,
      });
      if (plan.pointer && plan.nextEntrySeq !== null && plan.target.kind === 'stage') {
        const inserted = await tx.cases.appendStageInstance({
          id: newUlid(),
          caseId,
          stage: plan.target.stage,
          entrySeq: plan.nextEntrySeq,
          status: 'drafting',
          enteredAt: at,
          enteredBy: actor.personnelId,
          transitionCode: 'return',
        });
        const moved = inserted
          && (await tx.cases.advanceCasePointer({
            caseId,
            expectedStage: current.currentStage,
            expectedSeq: current.stageEntrySeq,
            stage: plan.pointer.stage,
            stageEntrySeq: plan.pointer.entrySeq,
            status: current.status,
            suspended: current.suspended,
          }));
        if (!moved) {
          return rejected<CaseReturnHttpOutcome>(
            { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
            {
              action: 'case.returned',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(actor, actorCode, view.handlingOrgId, caseId, opcode),
            },
          );
        }
      }
      for (const instanceId of plan.invalidateInstanceIds) {
        await tx.cases.appendStageInvalidation({
          id: newUlid(),
          caseId,
          instanceId,
          returnId,
          createdAt: at,
        });
      }
      if (plan.target.kind === 'stage') {
        const signed = currentInstanceInvalidationIds(current, plan.invalidateInstanceIds);
        for (const instanceId of signed) {
          await tx.cases.appendStageInvalidation({
            id: newUlid(),
            caseId,
            instanceId,
            returnId,
            createdAt: at,
          });
        }
        const settled = await this.closeExternalChains(tx, {
          caseId,
          actorId: actor.personnelId,
          note: plan.note,
          at,
        });
        if (!settled) {
          return rejected<CaseReturnHttpOutcome>(
            { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
            {
              action: 'case.returned',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(actor, actorCode, view.handlingOrgId, caseId, opcode),
            },
          );
        }
      }
      await tx.audit.append({
        action: 'case.returned',
        ...this.parties(actor, actorCode, view.handlingOrgId, caseId, opcode),
        detail: JSON.stringify({
          reasonCode: plan.reasonCode,
          target: plan.target.key,
          receiverId: plan.receiverId,
          n5: plan.n5,
          exit: plan.exit,
        }),
      });
      return {
        status: 200,
        body: {
          result: 'returned',
          caseId,
          reasonCode: plan.reasonCode,
          target: plan.target.key,
          reflow: plan.target.kind === 'stage',
          entrySeq: plan.nextEntrySeq ?? current.stageEntrySeq,
          exit: plan.exit,
          rehearingRequired: plan.rehearingRequired,
          noticeValidity: plan.noticeValidity,
          receiverId: plan.receiverId,
          n5: plan.n5,
        },
      };
    });
  }

  /**
   * 改派不批（#279）：走 #238 退回，接收人＝发起人，原因 R10 须写明，退回点＝拟制中。
   * 同一事务内关闭审批链、回写改派记录（置已退回）、写退回记录并作废当前环节已签。
   */
  async rejectReassignment(
    actor: ActorRef,
    caseId: string,
    reassignmentId: string,
    input: { readonly opinion: string },
  ): Promise<CaseReturnHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorCode = account?.code ?? null;
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    if (roles.length > 0 && roles.every((role) => role === CASE_SUPERVISION_ROLE)) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    const opcode = roles.includes('行政审批') ? APPROVE_OPCODE : REVIEW_OPCODE;
    const denied = await this.authorize(actor, opcode, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };

    const row = await this.cases.readReassignment(reassignmentId);
    if (!row || row.caseId !== caseId) return { status: 404, body: { result: 'not-found' } };
    if (row.status !== 'pending_approval') {
      return this.fail(actor, actorCode, view.handlingOrgId, caseId, opcode, {
        status: 409,
        reason: 'invalid-state',
        message: '改派呈批不在待批准',
        outlet: '已办结的改派呈批不能退回',
      });
    }

    const stage = asStage(view.currentStage);
    const handlers = await loadHandlerAvailability(this.identity, view.handlingOrgId, view.handlers);
    const receiver = await loadReceiverCandidate(
      this.identity,
      this.access,
      view.handlingOrgId,
      row.requestedBy,
      view.handlers,
    );
    const planned = planReturn({
      reasonCode: REASSIGN_REJECT_REASON,
      note: input.opinion,
      currentStage: stage,
      targetKey: stage ? `drafting:${stage}` : '',
      currentEntrySeq: view.stageEntrySeq,
      inheritedCode: REASSIGN_REJECT_INHERITED,
      defectiveStage: null,
      earlierChainLevels: [],
      instances: view.instances.map((item) => ({ id: item.id, stage: item.stage, entrySeq: item.entrySeq })),
      invalidatedInstanceIds: view.instances.filter((item) => item.invalidated).map((item) => item.id),
      receiver,
      handlers,
    });
    if (!planned.ok) {
      return this.fail(
        actor,
        actorCode,
        view.handlingOrgId,
        caseId,
        opcode,
        {
          status: planned.httpStatus,
          reason: planned.reason,
          message: planned.message,
          outlet: planned.outlet,
        },
        returnFailureDetail(REASSIGN_REJECT_REASON, stage ? `drafting:${stage}` : '', REASSIGN_REJECT_INHERITED),
      );
    }
    const plan = planned.plan;
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const current = await tx.cases.readCaseView(caseId);
      if (!current || current.currentStage !== view.currentStage || current.stageEntrySeq !== view.stageEntrySeq) {
        return rejected<CaseReturnHttpOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'case.returned',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(actor, actorCode, view.handlingOrgId, caseId, opcode),
          },
        );
      }
      const opinionId = newUlid();
      const returnId = newUlid();
      await tx.cases.appendApprovalOpinion({
        id: opinionId,
        caseId,
        reasonCode: plan.reasonCode,
        note: plan.note,
        targetKey: plan.target.key,
        actorId: actor.personnelId,
        createdAt: at,
      });
      await tx.cases.appendCaseReturn({
        id: returnId,
        caseId,
        opinionId,
        reasonCode: plan.reasonCode,
        inheritedCode: plan.inheritedCode,
        targetKey: plan.target.key,
        receiverId: plan.receiverId,
        reflow: false,
        n5: plan.n5,
        entrySeqBefore: current.stageEntrySeq,
        entrySeqAfter: null,
        exitCode: null,
        rehearingRequired: false,
        revokeNotice: false,
        actorId: actor.personnelId,
        createdAt: at,
      });
      for (const instanceId of currentInstanceInvalidationIds(current, [])) {
        await tx.cases.appendStageInvalidation({
          id: newUlid(),
          caseId,
          instanceId,
          returnId,
          createdAt: at,
        });
      }
      const settled = await this.settleReassignChain(tx, {
        caseId,
        reassignmentId,
        chainId: row.approvalChainId,
        actorId: actor.personnelId,
        note: plan.note,
        at,
      });
      if (!settled) {
        return rejected<CaseReturnHttpOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'case.returned',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(actor, actorCode, view.handlingOrgId, caseId, opcode),
          },
        );
      }
      await tx.audit.append({
        action: 'case.returned',
        ...this.parties(actor, actorCode, view.handlingOrgId, caseId, opcode),
        detail: JSON.stringify({
          reassignmentId,
          reasonCode: plan.reasonCode,
          target: plan.target.key,
          receiverId: plan.receiverId,
          n5: plan.n5,
        }),
      });
      return {
        status: 200,
        body: {
          result: 'reassignment-returned',
          caseId,
          reassignmentId,
          status: 'returned',
          reasonCode: plan.reasonCode,
          target: plan.target.key,
          receiverId: plan.receiverId,
          n5: plan.n5,
        },
      };
    });
  }

  /** 链外退回（#279）：关闭全部在途链，回写呈批记录。任一条件不成立返回 false，由调用方回滚。 */
  private async closeExternalChains(
    tx: TxScope,
    input: { readonly caseId: string; readonly actorId: string; readonly note: string; readonly at: Date },
  ): Promise<boolean> {
    const chains = await tx.cases.listInFlightApprovalChains(input.caseId);
    if (chains.length === 0) return true;
    const reassignments = await tx.cases.listReassignments(input.caseId);
    for (const chain of chains) {
      const reset = await tx.cases.returnProcedureApprovalsByChain({
        chainId: chain.id,
        actorId: input.actorId,
        opinion: input.note,
        at: input.at,
        newId: () => newUlid(),
      });
      if (!reset) return false;
      for (const row of reassignments) {
        if (row.status !== 'pending_approval' || row.approvalChainId !== chain.id) continue;
        const settled = await tx.cases.settleReassignment({
          id: row.id,
          caseId: input.caseId,
          toStatus: 'returned',
        });
        if (!settled) return false;
      }
      const closed = await tx.cases.closeApprovalChain(chain.id);
      if (!closed) return false;
    }
    return true;
  }

  /** 改派不批的收尾（#279）：回写呈批记录并关闭该条链。 */
  private async settleReassignChain(
    tx: TxScope,
    input: {
      readonly caseId: string;
      readonly reassignmentId: string;
      readonly chainId: string | null;
      readonly actorId: string;
      readonly note: string;
      readonly at: Date;
    },
  ): Promise<boolean> {
    if (input.chainId) {
      const reset = await tx.cases.returnProcedureApprovalsByChain({
        chainId: input.chainId,
        actorId: input.actorId,
        opinion: input.note,
        at: input.at,
        newId: () => newUlid(),
      });
      if (!reset) return false;
    }
    const settled = await tx.cases.settleReassignment({
      id: input.reassignmentId,
      caseId: input.caseId,
      toStatus: 'returned',
    });
    if (!settled) return false;
    if (input.chainId) {
      const closed = await tx.cases.closeApprovalChain(input.chainId);
      if (!closed) return false;
    }
    return true;
  }

  async reuseSignature(actor: ActorRef, caseId: string, signatureId: string): Promise<CaseReturnHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorCode = account?.code ?? null;
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    if (roles.length > 0 && roles.every((role) => role === CASE_SUPERVISION_ROLE)) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    const opcode = roles.includes('行政审批') ? APPROVE_OPCODE : REVIEW_OPCODE;
    const denied = await this.authorize(actor, opcode, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };
    const signature = await this.cases.readStageSignature(signatureId);
    if (!signature || signature.caseId !== caseId) return { status: 404, body: { result: 'not-found' } };
    const invalidated = view.instances.filter((row) => row.invalidated).map((row) => row.id);
    if (signatureReusable(signature.instanceId, invalidated)) {
      return { status: 200, body: { result: 'signature-reusable', signatureId } };
    }
    return this.fail(actor, actorCode, view.handlingOrgId, caseId, opcode, {
      status: 409,
      reason: 'signature-invalidated',
      message: '旧签字不能用于新一轮审批',
      outlet: '重新签署',
    });
  }

  /** 文书拟制尚未启用。非承办人的内勤先返回 403 clerk-cannot-edit。 */
  async draftDocument(actor: ActorRef, caseId: string): Promise<CaseReturnHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    const edit = checkDocumentEdit({
      roles,
      isCaseHandler: view.handlers.some((handler) => handler.personnelId === actor.personnelId),
    });
    if (!edit.ok && edit.reason === 'clerk-cannot-edit') {
      return { status: 403, body: { reason: 'clerk-cannot-edit' } };
    }
    const denied = await this.authorize(actor, DRAFT_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };
    if (!edit.ok) return { status: 403, body: { reason: edit.reason } };
    return {
      status: 409,
      body: {
        result: 'transition-disabled',
        reason: 'transition-disabled',
        message: '文书拟制尚未启用',
        outlet: '等文书票启用后再拟制',
      },
    };
  }

  private async fail(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    caseId: string,
    opcode: string,
    fail: { readonly status: 400 | 409; readonly reason: string; readonly message: string; readonly outlet: string },
    detail?: string,
  ): Promise<CaseReturnHttpOutcome> {
    const reason = (FAIL_REASONS.has(fail.reason) ? fail.reason : 'invalid-state') as CaseReturnedFailedReason;
    const outcome: CaseReturnHttpOutcome =
      fail.status === 400
        ? { status: 400, body: { result: 'non-compliant', reason: fail.reason, message: fail.message } }
        : { status: 409, body: { result: fail.reason, reason: fail.reason, message: fail.message, outlet: fail.outlet } };
    return this.uow.run(async () =>
      rejected(outcome, {
        action: 'case.returned',
        outcome: 'failed',
        reason,
        ...this.parties(actor, actorCode, orgUnitId, caseId, opcode),
        ...(detail ? { detail } : {}),
      }),
    );
  }

  private async authorize(actor: ActorRef, opcode: string, targetOrgId: string, caseId: string): Promise<string | null> {
    try {
      await this.access.authorize(actor, opcode, targetOrgId, { resourceType: 'case', resourceId: caseId });
      return null;
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return error.reason;
    }
  }

  private parties(actor: ActorRef, actorCode: string | null, orgUnitId: string, caseId: string, opcode: string) {
    return {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      opcode,
      resourceType: 'case' as const,
      resourceId: caseId,
    };
  }
}

function asStage(value: string | null): CaseStageCode | null {
  if (!value) return null;
  return (CASE_STAGE_CODES as readonly string[]).includes(value) ? (value as CaseStageCode) : null;
}

/**
 * 链外退回作废当前环节已签（#279）。返回需要额外失效的实例：当前环节实例，
 * 已失效或已在本计划内的不重复列入。
 */
function currentInstanceInvalidationIds(view: CaseView, planned: readonly string[]): readonly string[] {
  const row = view.instances.find((item) => item.stage === view.currentStage && item.entrySeq === view.stageEntrySeq);
  if (!row || row.invalidated || planned.includes(row.id)) return [];
  return [row.id];
}
