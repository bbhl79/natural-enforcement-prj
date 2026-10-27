// 立案呈批审批链与批准副作用（#234）。
// 不往 backend/approval 放业务。T01／T02 批准副作用在同一交互式事务完成。
// R-8 定案 C：拟制草稿不拦当事人；提交与批准均拦。R-6：只做拟制人撤回呈批。

import { Inject, Injectable } from '@nestjs/common';
import {
  CASE_STORE,
  CLUE_STORE,
  FILING_DRAFT_TARGET,
  buildCaseOpening,
  canTakeFilingStep,
  checkFilingContent,
  checkFilingGuards,
  checkFilingParty,
  decideTransition,
  filingStatusAfter,
  generateClosureReminders,
  isFilingApprovalPending,
  planReturn,
  recordNoCaseFromFilingApproval,
  type CaseStore,
  type ClueStore,
  type FilingAdminReview,
  type FilingContent,
} from '@natural-enforcement/case';
import {
  rejected,
  type CaseFilingApprovedFailedReason,
  type CaseFilingDraftedFailedReason,
  type CaseFilingReturnedFailedReason,
  type CaseFilingReviewedFailedReason,
  type CaseFilingSubmittedFailedReason,
  type CaseFilingWithdrawnFailedReason,
  type ClueDispositionRecordedFailedReason,
} from '@natural-enforcement/audit';
import {
  AccessControlService,
  IDENTITY_STORE,
  hasEnforcementQualification,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type IdentityStore,
} from '@natural-enforcement/identity';

import { persistTransitionEffects } from './case-transition-write.ts';
import { CLOCK, type Clock } from './clock.ts';
import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { loadHandlerAvailability, loadReceiverCandidate } from './return-facts.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

/** 行政审核配置令牌（默认 one-level；IT 可覆写为 skip）。 */
export const FILING_ADMIN_REVIEW = Symbol('FILING_ADMIN_REVIEW');

const DRAFT_OPCODE = 'doc.draft';
const SUBMIT_OPCODE = 'doc.submit';
const REVIEW_OPCODE = 'doc.admin.review';
const APPROVE_OPCODE = 'doc.approve';
const READ_OPCODE = 'doc.read';

export type FilingHttpOutcome =
  | { readonly status: 200; readonly body: Record<string, unknown> }
  | { readonly status: 400; readonly body: Record<string, unknown> }
  | { readonly status: 403; readonly body: { readonly reason: string } }
  | {
      readonly status: 409;
      readonly body: {
        readonly result: string;
        readonly reason: string;
        readonly basis?: string | null;
        readonly outlet?: string;
      };
    }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } };

@Injectable()
export class CaseFilingService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILING_ADMIN_REVIEW) private readonly adminReview: FilingAdminReview,
    private readonly access: AccessControlService,
  ) {}

  /** 拟制或保存版本（草稿不拦当事人）。 */
  async saveDraft(
    actor: ActorRef,
    clueId: string,
    input: { readonly content: unknown },
  ): Promise<FilingHttpOutcome> {
    const context = await this.clues.readDispatchContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorCode = account?.code ?? null;
    const targetOrgId = context.assignment?.orgUnitId ?? context.enteredOrgId;
    const auth = await this.authorize(actor, DRAFT_OPCODE, targetOrgId, clueId);
    if (auth) return auth;

    if (!this.isCurrentHandler(actor.personnelId, context.handlers)) {
      return this.rejectDraft(actor, actorCode, targetOrgId, clueId, {
        status: 403,
        reason: 'permission-denied',
      });
    }
    if (context.status !== 'handler_assigned') {
      return this.rejectDraft(actor, actorCode, targetOrgId, clueId, {
        status: 409,
        result: 'invalid-state',
        reason: 'invalid-state',
      });
    }

    const checked = checkFilingContent(input.content);
    if (!checked.ok) {
      return this.rejectDraft(actor, actorCode, targetOrgId, clueId, {
        status: 400,
        result: 'non-compliant',
        reason: checked.rule,
        rules: [checked.rule],
      });
    }
    const content = checked.content;
    const open = await this.cases.readOpenFilingApproval(clueId);
    if (open && open.status !== 'drafting') {
      return this.rejectDraft(actor, actorCode, targetOrgId, clueId, {
        status: 409,
        result: 'invalid-state',
        reason: 'filing-approval-pending',
        outlet: '先撤回立案呈批',
      });
    }
    if (open && open.drafterId !== actor.personnelId) {
      return this.rejectDraft(actor, actorCode, targetOrgId, clueId, {
        status: 403,
        reason: 'permission-denied',
      });
    }

    const approvalId = open?.id ?? newUlid();
    const versionId = newUlid();
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const ok = await tx.cases.saveFilingDraft({
        approvalId,
        clueId,
        drafterId: actor.personnelId,
        isNew: open === null,
        expectedVersionNo: open?.currentVersionNo ?? 0,
        versionId,
        conclusion: content.conclusion,
        contentJson: JSON.stringify(content),
        at,
      });
      if (!ok) {
        return rejected<FilingHttpOutcome>(
          {
            status: 409,
            body: {
              result: open ? 'concurrent-change' : 'invalid-state',
              reason: open ? 'concurrent-change' : 'filing-approval-pending',
              outlet: open ? undefined : '先撤回立案呈批',
            },
          },
          {
            action: 'case.filing-drafted',
            outcome: 'failed',
            reason: (open ? 'concurrent-change' : 'filing-approval-pending') as CaseFilingDraftedFailedReason,
            ...this.parties(actor, actorCode, targetOrgId, clueId, DRAFT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.filing-drafted',
        ...this.parties(actor, actorCode, targetOrgId, clueId, DRAFT_OPCODE),
        detail: JSON.stringify({
          code: context.code,
          approvalId,
          conclusion: content.conclusion,
          versionNo: open ? open.currentVersionNo + 1 : 1,
        }),
      });
      return {
        status: 200,
        body: {
          result: 'filing-drafted',
          approvalId,
          clueId,
          status: 'drafting',
          versionNo: open ? open.currentVersionNo + 1 : 1,
          conclusion: content.conclusion,
        },
      };
    });
  }

  /** 提交：X30；立案结论另拦当事人（R-8 C）。 */
  async submit(actor: ActorRef, approvalId: string): Promise<FilingHttpOutcome> {
    const approval = await this.cases.readFilingApproval(approvalId);
    if (!approval) return { status: 404, body: { result: 'not-found' } };
    const context = await this.clues.readDispatchContext(approval.clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorCode = account?.code ?? null;
    const targetOrgId = context.assignment?.orgUnitId ?? context.enteredOrgId;
    const auth = await this.authorize(actor, SUBMIT_OPCODE, targetOrgId, approval.clueId);
    if (auth) return auth;
    if (!this.isCurrentHandler(actor.personnelId, context.handlers) || approval.drafterId !== actor.personnelId) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    if (!canTakeFilingStep('submit', approval.status as 'drafting')) {
      return this.rejectStep(actor, actorCode, targetOrgId, approval.clueId, 'case.filing-submitted', {
        status: 409,
        result: 'invalid-state',
        reason: 'invalid-state',
      });
    }
    const version = await this.cases.readFilingVersion(approvalId, approval.currentVersionNo);
    if (!version) {
      return this.rejectStep(actor, actorCode, targetOrgId, approval.clueId, 'case.filing-submitted', {
        status: 409,
        result: 'invalid-state',
        reason: 'invalid-state',
      });
    }
    let content: FilingContent;
    try {
      const parsed = checkFilingContent(JSON.parse(version.contentJson));
      if (!parsed.ok) {
        return this.rejectStep(actor, actorCode, targetOrgId, approval.clueId, 'case.filing-submitted', {
          status: 400,
          result: 'non-compliant',
          reason: parsed.rule,
          rules: [parsed.rule],
        });
      }
      content = parsed.content;
    } catch {
      return this.rejectStep(actor, actorCode, targetOrgId, approval.clueId, 'case.filing-submitted', {
        status: 400,
        result: 'non-compliant',
        reason: 'invalid-conclusion',
        rules: ['invalid-conclusion'],
      });
    }
    const partyHit = checkFilingParty({
      conclusion: content.conclusion,
      partyNames: content.conclusion === 'file' ? content.partyNames : [],
      subjectUnknown: context.subjectUnknown,
    });
    if (partyHit) {
      return this.rejectStep(actor, actorCode, targetOrgId, approval.clueId, 'case.filing-submitted', {
        status: 409,
        result: partyHit.reason,
        reason: partyHit.reason,
        basis: partyHit.basis,
        outlet: partyHit.outlet,
      });
    }

    const nextStatus = filingStatusAfter('submit', this.adminReview);
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const ok = await tx.cases.applyFilingStep({
        approvalId,
        expectedStatus: approval.status,
        nextStatus,
        adminReview: this.adminReview,
        stepId: newUlid(),
        step: 'submit',
        versionNo: approval.currentVersionNo,
        actorId: actor.personnelId,
        opinion: null,
        at,
      });
      if (!ok) {
        return rejected<FilingHttpOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'case.filing-submitted',
            outcome: 'failed',
            reason: 'concurrent-change' as CaseFilingSubmittedFailedReason,
            ...this.parties(actor, actorCode, targetOrgId, approval.clueId, SUBMIT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.filing-submitted',
        ...this.parties(actor, actorCode, targetOrgId, approval.clueId, SUBMIT_OPCODE),
        detail: JSON.stringify({
          code: context.code,
          approvalId,
          conclusion: content.conclusion,
          nextStatus,
          adminReview: this.adminReview,
        }),
      });
      return {
        status: 200,
        body: {
          result: 'filing-submitted',
          approvalId,
          clueId: approval.clueId,
          status: nextStatus,
          conclusion: content.conclusion,
        },
      };
    });
  }

  async review(
    actor: ActorRef,
    approvalId: string,
    input: { readonly opinion?: string | null },
  ): Promise<FilingHttpOutcome> {
    return this.advanceReviewOrApprove(actor, approvalId, 'review', REVIEW_OPCODE, input.opinion ?? null);
  }

  async approve(
    actor: ActorRef,
    approvalId: string,
    input: { readonly opinion?: string | null },
  ): Promise<FilingHttpOutcome> {
    const approval = await this.cases.readFilingApproval(approvalId);
    if (!approval) return { status: 404, body: { result: 'not-found' } };
    const context = await this.clues.readDispatchContext(approval.clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorCode = account?.code ?? null;
    const targetOrgId = context.assignment?.orgUnitId ?? context.enteredOrgId;
    const auth = await this.authorize(actor, APPROVE_OPCODE, targetOrgId, approval.clueId);
    if (auth) return auth;
    if (!canTakeFilingStep('approve', approval.status as 'pending_approval')) {
      return this.rejectStep(actor, actorCode, targetOrgId, approval.clueId, 'case.filing-approved', {
        status: 409,
        result: 'invalid-state',
        reason: 'invalid-state',
      });
    }
    const version = await this.cases.readFilingVersion(approvalId, approval.currentVersionNo);
    if (!version) {
      return this.rejectStep(actor, actorCode, targetOrgId, approval.clueId, 'case.filing-approved', {
        status: 409,
        result: 'invalid-state',
        reason: 'invalid-state',
      });
    }
    const parsed = checkFilingContent(JSON.parse(version.contentJson));
    if (!parsed.ok) {
      return this.rejectStep(actor, actorCode, targetOrgId, approval.clueId, 'case.filing-approved', {
        status: 400,
        result: 'non-compliant',
        reason: parsed.rule,
        rules: [parsed.rule],
      });
    }
    const content = parsed.content;
    const handlers = await this.handlerFacts(context.handlers);
    const guard = checkFilingGuards({
      conclusion: content.conclusion,
      clueStatus: context.status,
      handlers,
      partyNames: content.conclusion === 'file' ? content.partyNames : [],
      subjectUnknown: context.subjectUnknown,
    });
    if (guard) {
      return this.rejectStep(actor, actorCode, targetOrgId, approval.clueId, 'case.filing-approved', {
        status: 409,
        result: guard.reason,
        reason: guard.reason,
        basis: guard.basis,
        outlet: guard.outlet,
      });
    }

    const transitionId = content.conclusion === 'file' ? 'T01' : 'T02';
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId },
      subject: {
        caseId: null,
        mainStatus: null,
        stage: null,
        stageEntrySeq: null,
        suspended: false,
        markers: [],
        clueStatus: context.status,
        handlingOrgId: context.assignment?.orgUnitId ?? null,
        proposedHandlingOrgId: null,
        actorRoles: [],
        otherInFlightChains: 0,
        instances: [],
      },
    });
    if (!decision.ok) {
      return this.rejectStep(actor, actorCode, targetOrgId, approval.clueId, 'case.filing-approved', {
        status: 409,
        result: 'invalid-state',
        reason: 'invalid-state',
      });
    }
    const effects = decision.effects;

    const at = this.clock.now();
    const opinion = typeof input.opinion === 'string' ? input.opinion.trim() || null : null;
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyFilingStep({
        approvalId,
        expectedStatus: approval.status,
        nextStatus: 'approved',
        stepId: newUlid(),
        step: 'approve',
        versionNo: approval.currentVersionNo,
        actorId: actor.personnelId,
        opinion,
        at,
      });
      if (!stepped) {
        return rejected<FilingHttpOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'case.filing-approved',
            outcome: 'failed',
            reason: 'concurrent-change' as CaseFilingApprovedFailedReason,
            ...this.parties(actor, actorCode, targetOrgId, approval.clueId, APPROVE_OPCODE),
          },
        );
      }

      if (content.conclusion === 'no-case') {
        const landing = await recordNoCaseFromFilingApproval(tx.clues, {
          clueId: approval.clueId,
          expectedStatus: 'handler_assigned',
          filingApprovalRef: approvalId,
          reason: content.noCaseReason,
          recordedBy: actor.personnelId,
          recordedAt: at,
          newId: () => newUlid(),
        });
        if (!landing.ok) {
          const status =
            landing.reason === 'invalid-state' || landing.reason === 'concurrent-change' ? 409 : 400;
          return rejected<FilingHttpOutcome>(
            status === 400
              ? {
                  status: 400,
                  body: { result: 'non-compliant', reason: landing.reason, rules: landing.rules },
                }
              : { status: 409, body: { result: landing.reason, reason: landing.reason } },
            {
              action: 'clue.disposition-recorded',
              outcome: 'failed',
              reason: landing.reason as ClueDispositionRecordedFailedReason,
              ...this.parties(actor, actorCode, targetOrgId, approval.clueId, APPROVE_OPCODE),
            },
          );
        }
        const wrote = await persistTransitionEffects(tx.cases, {
          effects,
          caseId: null,
          clueId: approval.clueId,
          actorId: actor.personnelId,
          at,
          fromJson: JSON.stringify({ clueStatus: context.status }),
          toJson: JSON.stringify({ clueStatus: 'closed', transitionId: 'T02' }),
          newId: () => newUlid(),
        });
        if (!wrote) {
          return rejected<FilingHttpOutcome>(
            { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
            {
              action: 'case.filing-approved',
              outcome: 'failed',
              reason: 'concurrent-change' as CaseFilingApprovedFailedReason,
              ...this.parties(actor, actorCode, targetOrgId, approval.clueId, APPROVE_OPCODE),
            },
          );
        }
        await tx.audit.append({
          action: 'case.transitioned',
          ...this.parties(actor, actorCode, targetOrgId, approval.clueId, APPROVE_OPCODE),
          detail: JSON.stringify({ transitionId: 'T02', clueId: approval.clueId }),
        });
        await tx.audit.append({
          action: 'clue.disposition-recorded',
          ...this.parties(actor, actorCode, targetOrgId, approval.clueId, APPROVE_OPCODE),
          detail: JSON.stringify({
            code: context.code,
            disposition: 'no-case',
            filingApprovalRef: approvalId,
            reason: landing.reason,
            reminderCount: landing.reminderIds.length,
          }),
        });
        await tx.audit.append({
          action: 'case.filing-approved',
          ...this.parties(actor, actorCode, targetOrgId, approval.clueId, APPROVE_OPCODE),
          detail: JSON.stringify({
            code: context.code,
            approvalId,
            conclusion: 'no-case',
            reminderCount: landing.reminderIds.length,
          }),
        });
        return {
          status: 200,
          body: {
            result: 'filing-approved',
            approvalId,
            clueId: approval.clueId,
            conclusion: 'no-case',
            clueStatus: 'closed',
            reminderCount: landing.reminderIds.length,
          },
        };
      }

      // T01 立案
      const handlingOrgId = context.assignment?.orgUnitId;
      if (!handlingOrgId) {
        return rejected<FilingHttpOutcome>(
          { status: 409, body: { result: 'invalid-state', reason: 'invalid-state' } },
          {
            action: 'case.filing-approved',
            outcome: 'failed',
            reason: 'invalid-state' as CaseFilingApprovedFailedReason,
            ...this.parties(actor, actorCode, targetOrgId, approval.clueId, APPROVE_OPCODE),
          },
        );
      }
      const caseId = newUlid();
      const opening = buildCaseOpening({
        caseId,
        handlingOrgId,
        handlers: context.handlers.map((h) => ({ personnelId: h.personnelId, role: h.role })),
        partyNames: content.partyNames,
        sourceClueId: approval.clueId,
        filingApprovalId: approvalId,
        openedAt: at,
      });
      await tx.cases.insertCase(opening, actor.personnelId, () => newUlid());
      const filed = await tx.clues.markFiled({
        clueId: approval.clueId,
        expectedStatus: 'handler_assigned',
      });
      if (!filed) {
        return rejected<FilingHttpOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'case.filing-approved',
            outcome: 'failed',
            reason: 'concurrent-change' as CaseFilingApprovedFailedReason,
            ...this.parties(actor, actorCode, targetOrgId, approval.clueId, APPROVE_OPCODE),
          },
        );
      }
      const reminderIds = await generateClosureReminders(tx.clues, {
        closedClueId: approval.clueId,
        kind: 'case',
        createdAt: at,
        newId: () => newUlid(),
      });
      const wrote = await persistTransitionEffects(tx.cases, {
        effects,
        caseId,
        clueId: approval.clueId,
        actorId: actor.personnelId,
        at,
        fromJson: JSON.stringify({ clueStatus: context.status }),
        toJson: JSON.stringify({
          caseId,
          status: 'in_progress',
          stage: 'E02',
          stageEntrySeq: 1,
          transitionId: 'T01',
        }),
        newId: () => newUlid(),
      });
      if (!wrote) {
        return rejected<FilingHttpOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'case.filing-approved',
            outcome: 'failed',
            reason: 'concurrent-change' as CaseFilingApprovedFailedReason,
            ...this.parties(actor, actorCode, targetOrgId, approval.clueId, APPROVE_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.transitioned',
        ...this.parties(actor, actorCode, targetOrgId, approval.clueId, APPROVE_OPCODE),
        detail: JSON.stringify({ transitionId: 'T01', caseId, clueId: approval.clueId }),
      });
      await tx.audit.append({
        action: 'case.opened',
        ...this.parties(actor, actorCode, targetOrgId, approval.clueId, APPROVE_OPCODE),
        detail: JSON.stringify({
          code: context.code,
          caseId,
          approvalId,
          handlingOrgId,
          reminderCount: reminderIds.length,
        }),
      });
      await tx.audit.append({
        action: 'case.filing-approved',
        ...this.parties(actor, actorCode, targetOrgId, approval.clueId, APPROVE_OPCODE),
        detail: JSON.stringify({
          code: context.code,
          approvalId,
          conclusion: 'file',
          caseId,
          reminderCount: reminderIds.length,
        }),
      });
      return {
        status: 200,
        body: {
          result: 'filing-approved',
          approvalId,
          clueId: approval.clueId,
          conclusion: 'file',
          caseId,
          clueStatus: 'filed',
          reminderCount: reminderIds.length,
        },
      };
    });
  }

  async returnToDraft(
    actor: ActorRef,
    approvalId: string,
    input: {
      readonly reasonCode: string;
      readonly note: string;
      readonly receiverId: string;
      readonly inheritedCode: string | null;
    },
  ): Promise<FilingHttpOutcome> {
    const approval = await this.cases.readFilingApproval(approvalId);
    if (!approval) return { status: 404, body: { result: 'not-found' } };
    const context = await this.clues.readDispatchContext(approval.clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorCode = account?.code ?? null;
    const targetOrgId = context.assignment?.orgUnitId ?? context.enteredOrgId;
    const opcode = approval.status === 'pending_review' ? REVIEW_OPCODE : APPROVE_OPCODE;
    const auth = await this.authorize(actor, opcode, targetOrgId, approval.clueId);
    if (auth) return auth;
    if (!canTakeFilingStep('return', approval.status as 'pending_review' | 'pending_approval')) {
      return this.rejectStep(
        actor,
        actorCode,
        targetOrgId,
        approval.clueId,
        'case.filing-returned',
        { status: 409, result: 'invalid-state', reason: 'invalid-state' },
        opcode,
      );
    }
    const handlers = await loadHandlerAvailability(this.identity, targetOrgId, context.handlers);
    const receiverId = input.receiverId.trim();
    const receiver = receiverId
      ? await loadReceiverCandidate(this.identity, this.access, targetOrgId, receiverId, context.handlers)
      : null;
    const planned = planReturn({
      reasonCode: input.reasonCode,
      note: input.note,
      currentStage: 'filing',
      targetKey: FILING_DRAFT_TARGET,
      currentEntrySeq: null,
      inheritedCode: input.inheritedCode,
      defectiveStage: null,
      earlierChainLevels: [],
      instances: [],
      invalidatedInstanceIds: [],
      receiver,
      handlers,
    });
    if (!planned.ok) {
      return this.rejectStep(
        actor,
        actorCode,
        targetOrgId,
        approval.clueId,
        'case.filing-returned',
        {
          status: planned.httpStatus,
          result: planned.httpStatus === 400 ? 'non-compliant' : planned.reason,
          reason: planned.reason,
          ...(planned.httpStatus === 400 ? { rules: [planned.reason] } : { outlet: planned.outlet }),
        },
        opcode,
      );
    }
    const plan = planned.plan;
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const ok = await tx.cases.applyFilingStep({
        approvalId,
        expectedStatus: approval.status,
        nextStatus: 'drafting',
        stepId: newUlid(),
        step: 'return',
        versionNo: approval.currentVersionNo,
        actorId: actor.personnelId,
        opinion: plan.note,
        reasonCode: plan.reasonCode,
        returnTarget: plan.target.key,
        receiverId: plan.receiverId,
        at,
      });
      if (!ok) {
        return rejected<FilingHttpOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'case.filing-returned',
            outcome: 'failed',
            reason: 'concurrent-change' as CaseFilingReturnedFailedReason,
            ...this.parties(actor, actorCode, targetOrgId, approval.clueId, opcode),
          },
        );
      }
      await tx.audit.append({
        action: 'case.filing-returned',
        ...this.parties(actor, actorCode, targetOrgId, approval.clueId, opcode),
        detail: JSON.stringify({
          code: context.code,
          approvalId,
          fromStatus: approval.status,
          reasonCode: plan.reasonCode,
          target: plan.target.key,
          receiverId: plan.receiverId,
          n5: plan.n5,
        }),
      });
      return {
        status: 200,
        body: {
          result: 'filing-returned',
          approvalId,
          clueId: approval.clueId,
          status: 'drafting',
          clueStatus: context.status,
          reasonCode: plan.reasonCode,
          target: plan.target.key,
        },
      };
    });
  }

  async withdraw(
    actor: ActorRef,
    approvalId: string,
    input: { readonly opinion: string },
  ): Promise<FilingHttpOutcome> {
    const approval = await this.cases.readFilingApproval(approvalId);
    if (!approval) return { status: 404, body: { result: 'not-found' } };
    const context = await this.clues.readDispatchContext(approval.clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorCode = account?.code ?? null;
    const targetOrgId = context.assignment?.orgUnitId ?? context.enteredOrgId;
    const auth = await this.authorize(actor, SUBMIT_OPCODE, targetOrgId, approval.clueId);
    if (auth) return auth;
    if (!this.isCurrentHandler(actor.personnelId, context.handlers) || approval.drafterId !== actor.personnelId) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    if (!canTakeFilingStep('withdraw', approval.status as 'pending_review' | 'pending_approval')) {
      return this.rejectStep(actor, actorCode, targetOrgId, approval.clueId, 'case.filing-withdrawn', {
        status: 409,
        result: 'invalid-state',
        reason: 'invalid-state',
      });
    }
    const opinion = input.opinion.trim();
    if (opinion === '') {
      return this.rejectStep(actor, actorCode, targetOrgId, approval.clueId, 'case.filing-withdrawn', {
        status: 400,
        result: 'non-compliant',
        reason: 'missing-withdraw-reason',
        rules: ['missing-withdraw-reason'],
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const ok = await tx.cases.applyFilingStep({
        approvalId,
        expectedStatus: approval.status,
        nextStatus: 'drafting',
        stepId: newUlid(),
        step: 'withdraw',
        versionNo: approval.currentVersionNo,
        actorId: actor.personnelId,
        opinion,
        at,
      });
      if (!ok) {
        return rejected<FilingHttpOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'case.filing-withdrawn',
            outcome: 'failed',
            reason: 'concurrent-change' as CaseFilingWithdrawnFailedReason,
            ...this.parties(actor, actorCode, targetOrgId, approval.clueId, SUBMIT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.filing-withdrawn',
        ...this.parties(actor, actorCode, targetOrgId, approval.clueId, SUBMIT_OPCODE),
        detail: JSON.stringify({ code: context.code, approvalId, fromStatus: approval.status }),
      });
      return {
        status: 200,
        body: {
          result: 'filing-withdrawn',
          approvalId,
          clueId: approval.clueId,
          status: 'drafting',
          clueStatus: context.status,
        },
      };
    });
  }

  async readByClue(actor: ActorRef, clueId: string): Promise<FilingHttpOutcome> {
    const context = await this.clues.readDispatchContext(clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const targetOrgId = context.assignment?.orgUnitId ?? context.enteredOrgId;
    const auth = await this.authorize(actor, READ_OPCODE, targetOrgId, clueId);
    if (auth) return auth;
    const open = await this.cases.readOpenFilingApproval(clueId);
    if (!open) {
      return { status: 200, body: { result: 'filing-empty', clueId, approval: null } };
    }
    const version = await this.cases.readFilingVersion(open.id, open.currentVersionNo);
    const steps = await this.cases.listFilingSteps(open.id);
    return {
      status: 200,
      body: {
        result: 'filing-approval',
        clueId,
        approval: {
          id: open.id,
          status: open.status,
          adminReview: open.adminReview,
          currentVersionNo: open.currentVersionNo,
          drafterId: open.drafterId,
          conclusion: version?.conclusion ?? null,
          content: version ? JSON.parse(version.contentJson) : null,
          steps,
          pending: isFilingApprovalPending(open.status),
        },
      },
    };
  }

  async listTodos(actor: ActorRef): Promise<FilingHttpOutcome> {
    const account = await this.directory.findById(actor.personnelId);
    const roles = account?.roles ?? [];
    const statuses: string[] = [];
    if (roles.includes('行政审核')) statuses.push('pending_review');
    if (roles.includes('行政审批')) statuses.push('pending_approval');
    if (statuses.length === 0) {
      return { status: 200, body: { result: 'filing-todos', items: [] } };
    }
    // 数据范围：操作人所属机构及其可见范围由授权层保证；待办按线索承办机构过滤为操作人机构。
    const orgId = account?.orgUnitId;
    if (!orgId) return { status: 200, body: { result: 'filing-todos', items: [] } };
    const items = await this.cases.listFilingTodos(statuses, [orgId]);
    return { status: 200, body: { result: 'filing-todos', items } };
  }

  private async advanceReviewOrApprove(
    actor: ActorRef,
    approvalId: string,
    step: 'review',
    opcode: string,
    opinion: string | null,
  ): Promise<FilingHttpOutcome> {
    const approval = await this.cases.readFilingApproval(approvalId);
    if (!approval) return { status: 404, body: { result: 'not-found' } };
    const context = await this.clues.readDispatchContext(approval.clueId);
    if (!context) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorCode = account?.code ?? null;
    const targetOrgId = context.assignment?.orgUnitId ?? context.enteredOrgId;
    const auth = await this.authorize(actor, opcode, targetOrgId, approval.clueId);
    if (auth) return auth;
    if (!canTakeFilingStep(step, approval.status as 'pending_review')) {
      return this.rejectStep(actor, actorCode, targetOrgId, approval.clueId, 'case.filing-reviewed', {
        status: 409,
        result: 'invalid-state',
        reason: 'invalid-state',
      });
    }
    const adminReview = (approval.adminReview ?? this.adminReview) as FilingAdminReview;
    const nextStatus = filingStatusAfter(step, adminReview);
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const ok = await tx.cases.applyFilingStep({
        approvalId,
        expectedStatus: approval.status,
        nextStatus,
        stepId: newUlid(),
        step,
        versionNo: approval.currentVersionNo,
        actorId: actor.personnelId,
        opinion: opinion && opinion.trim() !== '' ? opinion.trim() : null,
        at,
      });
      if (!ok) {
        return rejected<FilingHttpOutcome>(
          { status: 409, body: { result: 'concurrent-change', reason: 'concurrent-change' } },
          {
            action: 'case.filing-reviewed',
            outcome: 'failed',
            reason: 'concurrent-change' as CaseFilingReviewedFailedReason,
            ...this.parties(actor, actorCode, targetOrgId, approval.clueId, opcode),
          },
        );
      }
      await tx.audit.append({
        action: 'case.filing-reviewed',
        ...this.parties(actor, actorCode, targetOrgId, approval.clueId, opcode),
        detail: JSON.stringify({ code: context.code, approvalId, nextStatus }),
      });
      return {
        status: 200,
        body: {
          result: 'filing-reviewed',
          approvalId,
          clueId: approval.clueId,
          status: nextStatus,
        },
      };
    });
  }

  private async handlerFacts(
    handlers: readonly { readonly personnelId: string; readonly role: string }[],
  ): Promise<Array<{ personnelId: string; role: string; qualified: boolean }>> {
    const now = this.clock.now();
    const facts = [];
    for (const handler of handlers) {
      const person = await this.identity.findPersonnelById(handler.personnelId);
      const qualified =
        person !== null &&
        hasEnforcementQualification(
          person.enforcementCertNo,
          person.enforcementCertExpiresOn,
          person.enforcementCertStatus,
          now,
        );
      facts.push({ personnelId: handler.personnelId, role: handler.role, qualified });
    }
    return facts;
  }

  private isCurrentHandler(
    personnelId: string,
    handlers: readonly { readonly personnelId: string; readonly role: string }[],
  ): boolean {
    return handlers.some((handler) => handler.personnelId === personnelId);
  }

  private async authorize(
    actor: ActorRef,
    opcode: string,
    targetOrgId: string,
    clueId: string,
  ): Promise<FilingHttpOutcome | null> {
    try {
      await this.access.authorize(actor, opcode, targetOrgId, {
        resourceType: 'clue',
        resourceId: clueId,
      });
      return null;
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      return { status: 403, body: { reason: error.reason } };
    }
  }

  private parties(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    opcode: string,
  ) {
    return {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      opcode,
      resourceType: 'clue' as const,
      resourceId: clueId,
    };
  }

  private async rejectDraft(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    fail: {
      status: 400 | 403 | 409;
      reason: string;
      result?: string;
      rules?: string[];
      outlet?: string;
      basis?: string | null;
    },
  ): Promise<FilingHttpOutcome> {
    if (fail.status === 403) {
      return { status: 403, body: { reason: fail.reason } };
    }
    const status = fail.status;
    const outcome: FilingHttpOutcome =
      status === 400
        ? {
            status: 400,
            body: {
              result: fail.result ?? fail.reason,
              reason: fail.reason,
              ...(fail.rules ? { rules: fail.rules } : {}),
            },
          }
        : {
            status: 409,
            body: {
              result: fail.result ?? fail.reason,
              reason: fail.reason,
              ...(fail.outlet ? { outlet: fail.outlet } : {}),
              ...(fail.basis !== undefined ? { basis: fail.basis } : {}),
            },
          };
    return this.uow.run(async () =>
      rejected<FilingHttpOutcome>(
        outcome,
        {
          action: 'case.filing-drafted',
          outcome: 'failed',
          reason: fail.reason as CaseFilingDraftedFailedReason,
          ...this.parties(actor, actorCode, orgUnitId, clueId, DRAFT_OPCODE),
        },
      ),
    );
  }

  private async rejectStep(
    actor: ActorRef,
    actorCode: string | null,
    orgUnitId: string,
    clueId: string,
    action:
      | 'case.filing-submitted'
      | 'case.filing-reviewed'
      | 'case.filing-approved'
      | 'case.filing-returned'
      | 'case.filing-withdrawn',
    fail: {
      status: 400 | 409;
      reason: string;
      result: string;
      rules?: string[];
      outlet?: string;
      basis?: string | null;
    },
    opcode: string = SUBMIT_OPCODE,
  ): Promise<FilingHttpOutcome> {
    const outcome: FilingHttpOutcome =
      fail.status === 400
        ? {
            status: 400,
            body: {
              result: fail.result,
              reason: fail.reason,
              ...(fail.rules ? { rules: fail.rules } : {}),
            },
          }
        : {
            status: 409,
            body: {
              result: fail.result,
              reason: fail.reason,
              ...(fail.outlet ? { outlet: fail.outlet } : {}),
              ...(fail.basis !== undefined ? { basis: fail.basis } : {}),
            },
          };
    return this.uow.run(async () =>
      rejected<FilingHttpOutcome>(
        outcome,
        {
          action,
          outcome: 'failed',
          reason: fail.reason as never,
          ...this.parties(actor, actorCode, orgUnitId, clueId, opcode),
        },
      ),
    );
  }
}
