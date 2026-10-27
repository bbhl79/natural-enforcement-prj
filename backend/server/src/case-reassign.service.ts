// 改派呈批（#239，T33）与回避后材料效力认定。
// 判定在 case 包的纯函数里，这里只喂事实、落库、写留痕。
// 发起用 case.reassign.submit，批准用 doc.approve；批准前名单不变。
// 效力认定过渡复用 doc.draft 的授权，不新增操作码。不另设呈批。
// 承办机构不随改派改变（X13）。

import { Inject, Injectable } from '@nestjs/common';
import {
  rejected,
  type AuditAppend,
  type CaseMaterialEffectivityFailedReason,
  type CaseReassignmentApprovedFailedReason,
  type CaseReassignmentSubmittedFailedReason,
  type CaseReassignmentWithdrawnFailedReason,
} from '@natural-enforcement/audit';
import {
  CASE_STORE,
  MATERIAL_EFFECTIVENESS_NAMES,
  REASSIGN_REASON_NAMES,
  bothHandlersUnavailable,
  checkRecusalReference,
  checkReassignProposal,
  decideTransition,
  isMaterialEffectivenessConclusion,
  isReassignReasonCode,
  invalidMaterialIds,
  latestEffectivenessByMaterial,
  latestConflictEvents,
  reassignInitiator,
  type CaseReassignmentRow,
  type CaseStore,
  type CaseView,
  type ConflictDecisionFact,
  type ConflictEventFact,
  type HandlerCandidateFacts,
  type HandlerRole,
  type MaterialEffectivenessFact,
  type PersonConflictEventRow,
  type ReassignProposalIssue,
  type TransitionDecision,
  type TransitionSubject,
} from '@natural-enforcement/case';
import {
  AccessControlService,
  IDENTITY_STORE,
  hasEnforcementQualification,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type IdentityStore,
} from '@natural-enforcement/identity';

import { CLOCK, type Clock } from './clock.ts';
import { appendRuleConfirmation, ruleKeyBody, warningBody } from './case-rule-confirmation.ts';
import { persistTransitionEffects } from './case-transition-write.ts';
import { loadHandlerAvailability } from './return-facts.ts';
import { LOGIN_DIRECTORY, type LoginAccount, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const SUBMIT_OPCODE = 'case.reassign.submit';
const APPROVE_OPCODE = 'doc.approve';
/** 效力认定的过渡操作码。正式码随 #230 回写后再议。 */
const EFFECTIVITY_OPCODE = 'doc.draft';
const READ_OPCODE = 'case.read';

/** 批准时复校失败的出口（#279）：只能退回或撤回后重新发起。 */
const APPROVE_RESTART_MESSAGE = '请退回或撤回后重新发起';

/** 回避改派被退回后挂在案件上的提示（#279）。重新发起后消失。 */
const RECUSAL_REASSIGN_NOTICE = '须重新发起回避改派';

const STRUCTURE_KINDS = new Set(['main', 'assist']);

export type CaseReassignHttpOutcome =
  | { readonly status: 200; readonly body: Record<string, unknown> }
  | { readonly status: 400; readonly body: Record<string, unknown> }
  | { readonly status: 403; readonly body: { readonly reason: string } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | { readonly status: 409; readonly body: Record<string, unknown> };

interface ProposedSnapshot {
  readonly mainId: string;
  readonly assistIds: readonly string[];
  readonly currentHandlers: readonly NamedHandler[];
  readonly handlers: readonly NamedHandler[];
}

interface NamedHandler {
  readonly personnelId: string;
  readonly role: string;
}

interface ReassignFailure {
  readonly status: 400 | 403 | 409;
  readonly reason: string;
  readonly message: string;
  /** 阻断依据（X14 等）。可空。 */
  readonly basis?: string | null;
}

export interface ReassignSubmitInput {
  readonly mainId: string;
  readonly assistIds: readonly string[];
  readonly reasonCode: string;
  readonly note: string;
  readonly conflictLineageId: string | null;
}

@Injectable()
export class CaseReassignService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly access: AccessControlService,
  ) {}

  /** 发起改派呈批。批准前名单不变。 */
  async submit(actor: ActorRef, caseId: string, input: ReassignSubmitInput): Promise<CaseReassignHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    const denied = await this.authorize(actor, SUBMIT_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };

    const handlers = await loadHandlerAvailability(this.identity, view.handlingOrgId, view.handlers);
    const assignment = await this.identity.findCurrentAssignment(actor.personnelId);
    const initiator = reassignInitiator({
      actorIsHandler: view.handlers.some((row) => row.personnelId === actor.personnelId),
      actorRoles: roles,
      actorOrgId: assignment?.orgUnitId ?? null,
      handlingOrgId: view.handlingOrgId,
      bothHandlersUnavailable: bothHandlersUnavailable(handlers),
    });
    if (!initiator) {
      return this.failSubmit(actor, account, view.handlingOrgId, caseId, {
        status: 403,
        reason: 'not-handler-or-clerk',
        message: '发起人须是主办、协办，或两人都停用或调离时的承办机构内勤',
      });
    }

    const reasonCode = input.reasonCode.trim();
    if (!isReassignReasonCode(reasonCode)) {
      return this.failSubmit(actor, account, view.handlingOrgId, caseId, {
        status: 400,
        reason: 'missing-reason',
        message: '改派原因必填，取值：调岗、离职、回避、其他',
      });
    }
    const note = input.note.trim();
    if (reasonCode === 'other' && note === '') {
      return this.failSubmit(actor, account, view.handlingOrgId, caseId, {
        status: 400,
        reason: 'missing-reason-note',
        message: '改派原因为其他时，须写明说明',
      });
    }

    const lineageId = input.conflictLineageId?.trim() ?? '';
    const conflictFact = reasonCode === 'recusal' ? await this.loadConflictDecision(caseId, lineageId) : null;
    const conflictIssue = checkRecusalReference({
      reasonCode,
      lineageId: lineageId === '' ? null : lineageId,
      decision: conflictFact,
      approverId: null,
    });
    if (conflictIssue) {
      return this.failSubmit(actor, account, view.handlingOrgId, caseId, {
        status: 409,
        reason: conflictIssue,
        message: this.conflictMessage(conflictIssue),
      });
    }

    const mainId = input.mainId.trim();
    const assistIds = input.assistIds.map((id) => id.trim()).filter((id) => id !== '');
    if (mainId === '') {
      return this.failSubmit(actor, account, view.handlingOrgId, caseId, {
        status: 400,
        reason: 'invalid-proposal',
        message: '改派须指定一名主办',
      });
    }
    const candidates = await this.candidateFacts(view.handlingOrgId, mainId, assistIds);
    const proposalIssue = checkReassignProposal(candidates);
    if (proposalIssue) return this.failProposal(actor, account, view, caseId, 'submit', proposalIssue);

    const other = await this.cases.countInFlightApprovals(caseId);
    const decision = decideTransition({
      operation: { kind: 'open-approval-chain', chainKind: 'reassign' },
      subject: this.subjectOf(view, roles, other),
    });
    if (!decision.ok) return this.settleSubmit(actor, account, view, decision);

    const at = this.clock.now();
    const reassignmentId = newUlid();
    const chainId = newUlid();
    const proposed: ProposedSnapshot = {
      mainId,
      assistIds,
      currentHandlers: view.handlers.map((row) => ({ personnelId: row.personnelId, role: row.role })),
      handlers: candidates.map((row) => ({ personnelId: row.personnelId, role: row.role })),
    };
    return this.uow.run(async (tx) => {
      const opened = await tx.cases.openApprovalChain({
        id: chainId,
        caseId,
        kind: 'reassign',
        openedBy: actor.personnelId,
        openedAt: at,
      });
      if (!opened) {
        return rejected<CaseReassignHttpOutcome>(
          this.blockBody('X18', '本案已有进行中的审批链', '先办结或撤回当前审批链'),
          {
            action: 'case.reassignment-submitted',
            outcome: 'failed',
            reason: 'X18' as CaseReassignmentSubmittedFailedReason,
            ...this.parties(actor, account, view.handlingOrgId, caseId, SUBMIT_OPCODE),
          },
        );
      }
      const inserted = await tx.cases.insertReassignment({
        id: reassignmentId,
        caseId,
        reasonCode,
        note,
        conflictLineageId: reasonCode === 'recusal' ? lineageId : null,
        requestedBy: actor.personnelId,
        requestedAt: at,
        approvalChainId: chainId,
        proposedJson: JSON.stringify(proposed),
      });
      if (!inserted) {
        return rejected<CaseReassignHttpOutcome>(
          this.blockBody('concurrent-change', '改派呈批已被他人更新', '请重新读取后再试'),
          {
            action: 'case.reassignment-submitted',
            outcome: 'failed',
            reason: 'concurrent-change' as CaseReassignmentSubmittedFailedReason,
            ...this.parties(actor, account, view.handlingOrgId, caseId, SUBMIT_OPCODE),
          },
        );
      }
      const parties = this.parties(actor, account, view.handlingOrgId, caseId, SUBMIT_OPCODE);
      await tx.audit.append({
        action: 'case.reassignment-submitted',
        ...parties,
        detail: JSON.stringify({
          reassignmentId,
          reasonCode,
          conflictLineageId: reasonCode === 'recusal' ? lineageId : null,
          initiator,
          currentHandlers: proposed.currentHandlers,
          proposedHandlers: proposed.handlers,
        }),
      });
      if (decision.confirmation) {
        await appendRuleConfirmation(tx.audit, {
          parties,
          confirmation: decision.confirmation,
          at,
          step: 'reassignment-submit',
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'reassignment-submitted',
          caseId,
          reassignmentId,
          status: 'pending_approval',
          reasonCode,
          reasonName: REASSIGN_REASON_NAMES[reasonCode],
          proposedHandlers: proposed.handlers,
          approvalChainId: chainId,
        },
      };
    });
  }

  /** 批准改派呈批。批准前名单不变，批准后才关闭旧行、追加新行。 */
  async approve(
    actor: ActorRef,
    caseId: string,
    reassignmentId: string,
    input: { readonly opinion: string | null },
  ): Promise<CaseReassignHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    const denied = await this.authorize(actor, APPROVE_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };

    const row = await this.cases.readReassignment(reassignmentId);
    if (!row || row.caseId !== caseId) return { status: 404, body: { result: 'not-found' } };
    if (row.status !== 'pending_approval') {
      return this.failApprove(actor, account, view.handlingOrgId, caseId, {
        status: 409,
        reason: 'invalid-state',
        message: '改派呈批不在待批准',
      });
    }
    const reasonCode = row.reasonCode;
    if (!isReassignReasonCode(reasonCode)) {
      return this.failApprove(actor, account, view.handlingOrgId, caseId, {
        status: 409,
        reason: 'invalid-state',
        message: '改派原因不合规',
      });
    }
    const proposed = parseProposed(row.proposedJson);
    if (!proposed) {
      return this.failApprove(actor, account, view.handlingOrgId, caseId, {
        status: 409,
        reason: 'invalid-state',
        message: '改派名单不合规',
      });
    }

    const conflictFact = reasonCode === 'recusal'
      ? await this.loadConflictDecision(caseId, row.conflictLineageId ?? '')
      : null;
    const conflictIssue = checkRecusalReference({
      reasonCode,
      lineageId: row.conflictLineageId,
      decision: conflictFact,
      approverId: actor.personnelId,
    });
    if (conflictIssue) {
      return this.failApprove(actor, account, view.handlingOrgId, caseId, {
        status: 409,
        reason: conflictIssue,
        message: conflictIssue === 'conflict-decider-mismatch'
          ? APPROVE_RESTART_MESSAGE
          : this.conflictMessage(conflictIssue),
      });
    }

    const candidates = await this.candidateFacts(view.handlingOrgId, proposed.mainId, [...proposed.assistIds]);
    const proposalIssue = checkReassignProposal(candidates);
    if (proposalIssue) return this.failProposal(actor, account, view, caseId, 'approve', proposalIssue);

    const currentHandlers = view.handlers.map((row) => ({ personnelId: row.personnelId, role: row.role }));
    if (!sameHandlers(currentHandlers, proposed.currentHandlers)) {
      return this.failApprove(actor, account, view.handlingOrgId, caseId, {
        status: 409,
        reason: 'concurrent-change',
        message: APPROVE_RESTART_MESSAGE,
      });
    }

    const other = Math.max(
      0,
      (await this.cases.countInFlightApprovals(caseId)) - (row.approvalChainId ? 1 : 0),
    );
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T33' },
      subject: this.subjectOf(view, roles, other),
    });
    if (!decision.ok) return this.settleApprove(actor, account, view, decision);

    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const current = await tx.cases.readCaseView(caseId);
      if (
        !current ||
        current.currentStage !== view.currentStage ||
        current.stageEntrySeq !== view.stageEntrySeq ||
        current.status !== view.status
      ) {
        return rejected<CaseReassignHttpOutcome>(
          this.blockBody('concurrent-change', '案件已被他人更新', '请重新读取后再试'),
          {
            action: 'case.reassignment-approved',
            outcome: 'failed',
            reason: 'concurrent-change' as CaseReassignmentApprovedFailedReason,
            ...this.parties(actor, account, view.handlingOrgId, caseId, APPROVE_OPCODE),
          },
        );
      }
      const stints = await tx.cases.listHandlerStints(caseId);
      const active = stints
        .filter((item) => item.endedAt === null)
        .map((item) => ({ personnelId: item.personnelId, role: item.role }));
      if (!sameHandlers(active, proposed.currentHandlers)) {
        return rejected<CaseReassignHttpOutcome>(
          this.blockBody('concurrent-change', APPROVE_RESTART_MESSAGE, APPROVE_RESTART_MESSAGE),
          {
            action: 'case.reassignment-approved',
            outcome: 'failed',
            reason: 'concurrent-change' as CaseReassignmentApprovedFailedReason,
            ...this.parties(actor, account, view.handlingOrgId, caseId, APPROVE_OPCODE),
          },
        );
      }
      const approved = await tx.cases.approveReassignment({
        id: reassignmentId,
        caseId,
        approvedBy: actor.personnelId,
        approvedAt: at,
      });
      if (!approved) {
        return rejected<CaseReassignHttpOutcome>(
          this.blockBody('concurrent-change', '改派呈批已被他人更新', '请重新读取后再试'),
          {
            action: 'case.reassignment-approved',
            outcome: 'failed',
            reason: 'concurrent-change' as CaseReassignmentApprovedFailedReason,
            ...this.parties(actor, account, view.handlingOrgId, caseId, APPROVE_OPCODE),
          },
        );
      }
      await tx.cases.replaceHandlers({
        caseId,
        endedAt: at,
        next: proposed.handlers.map((handler) => ({
          id: newUlid(),
          personnelId: handler.personnelId,
          role: handler.role,
        })),
      });
      const wrote = await persistTransitionEffects(tx.cases, {
        effects: decision.effects,
        caseId,
        clueId: current.sourceClueIds[0] ?? null,
        actorId: actor.personnelId,
        at,
        fromJson: JSON.stringify({
          stage: current.currentStage,
          status: current.status,
          stageEntrySeq: current.stageEntrySeq,
          handlers: active,
        }),
        toJson: JSON.stringify({
          stage: current.currentStage,
          status: current.status,
          stageEntrySeq: current.stageEntrySeq,
          handlers: proposed.handlers,
        }),
        newId: () => newUlid(),
      });
      if (!wrote) {
        return rejected<CaseReassignHttpOutcome>(
          this.blockBody('concurrent-change', '案件已被他人更新', '请重新读取后再试'),
          {
            action: 'case.reassignment-approved',
            outcome: 'failed',
            reason: 'concurrent-change' as CaseReassignmentApprovedFailedReason,
            ...this.parties(actor, account, view.handlingOrgId, caseId, APPROVE_OPCODE),
          },
        );
      }
      if (row.approvalChainId) {
        const closed = await tx.cases.closeApprovalChain(row.approvalChainId);
        if (!closed) {
          return rejected<CaseReassignHttpOutcome>(
            this.blockBody('concurrent-change', '审批链已被他人办结', '请重新读取后再试'),
            {
              action: 'case.reassignment-approved',
              outcome: 'failed',
              reason: 'concurrent-change' as CaseReassignmentApprovedFailedReason,
              ...this.parties(actor, account, view.handlingOrgId, caseId, APPROVE_OPCODE),
            },
          );
        }
      }
      const parties = this.parties(actor, account, view.handlingOrgId, caseId, APPROVE_OPCODE);
      await tx.audit.append({
        action: 'case.reassignment-approved',
        ...parties,
        detail: JSON.stringify({
          reassignmentId,
          reasonCode,
          conflictLineageId: row.conflictLineageId,
          opinion: input.opinion,
          previousHandlers: active,
          nextHandlers: proposed.handlers,
          transitionId: decision.effects.transitionCode,
        }),
      });
      if (decision.confirmation) {
        await appendRuleConfirmation(tx.audit, {
          parties,
          confirmation: decision.confirmation,
          at,
          step: 'reassignment-approve',
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'reassignment-approved',
          caseId,
          reassignmentId,
          status: 'approved',
          currentStage: current.currentStage,
          mainStatus: current.status,
          stageEntrySeq: current.stageEntrySeq,
          handlers: proposed.handlers,
          transitionId: decision.effects.transitionCode,
        },
      };
    });
  }

  /**
   * 发起人批准前撤回（#279）：关闭审批链，改派记录置已撤回。
   * 批准后不可撤回；只有发起人本人可以撤回。
   */
  async withdraw(
    actor: ActorRef,
    caseId: string,
    reassignmentId: string,
    input: { readonly note: string | null },
  ): Promise<CaseReassignHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const denied = await this.authorize(actor, SUBMIT_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };
    const row = await this.cases.readReassignment(reassignmentId);
    if (!row || row.caseId !== caseId) return { status: 404, body: { result: 'not-found' } };
    if (row.requestedBy !== actor.personnelId) return { status: 403, body: { reason: 'permission-denied' } };
    if (row.status !== 'pending_approval') {
      return this.failWithdraw(actor, account, view.handlingOrgId, caseId, {
        status: 409,
        reason: 'invalid-state',
        message: '改派呈批不在待批准，批准后不可撤回',
      });
    }
    return this.uow.run(async (tx) => {
      const settled = await tx.cases.settleReassignment({ id: reassignmentId, caseId, toStatus: 'withdrawn' });
      if (!settled) {
        return rejected<CaseReassignHttpOutcome>(
          this.blockBody('concurrent-change', '改派呈批已被他人更新', '请重新读取后再试'),
          {
            action: 'case.reassignment-withdrawn',
            outcome: 'failed',
            reason: 'concurrent-change' as CaseReassignmentWithdrawnFailedReason,
            ...this.parties(actor, account, view.handlingOrgId, caseId, SUBMIT_OPCODE),
          },
        );
      }
      if (row.approvalChainId) {
        const closed = await tx.cases.closeApprovalChain(row.approvalChainId);
        if (!closed) {
          return rejected<CaseReassignHttpOutcome>(
            this.blockBody('concurrent-change', '审批链已被他人办结', '请重新读取后再试'),
            {
              action: 'case.reassignment-withdrawn',
              outcome: 'failed',
              reason: 'concurrent-change' as CaseReassignmentWithdrawnFailedReason,
              ...this.parties(actor, account, view.handlingOrgId, caseId, SUBMIT_OPCODE),
            },
          );
        }
      }
      await tx.audit.append({
        action: 'case.reassignment-withdrawn',
        ...this.parties(actor, account, view.handlingOrgId, caseId, SUBMIT_OPCODE),
        detail: JSON.stringify({
          reassignmentId,
          reasonCode: row.reasonCode,
          approvalChainId: row.approvalChainId,
          note: input.note,
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'reassignment-withdrawn',
          caseId,
          reassignmentId,
          status: 'withdrawn',
        },
      };
    });
  }

  /** 人员页签：当前与曾任承办人员、改派呈批、材料效力认定与无效清单。 */
  async list(actor: ActorRef, caseId: string): Promise<CaseReassignHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const denied = await this.authorize(actor, READ_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };
    const [reassignments, stints, effectivity] = await Promise.all([
      this.cases.listReassignments(caseId),
      this.cases.listHandlerStints(caseId),
      this.cases.listMaterialEffectiveness(caseId),
    ]);
    const facts: MaterialEffectivenessFact[] = effectivity.map((row) => ({
      id: row.id,
      materialId: row.materialId,
      conclusion: row.conclusion,
      reason: row.reason,
      determinedBy: row.determinedBy,
      determinedAt: row.determinedAt,
    }));
    const latest = latestEffectivenessByMaterial(facts);
    const currentHandlers = stints.filter((row) => row.endedAt === null).map(presentStint);
    const formerHandlers = stints.filter((row) => row.endedAt !== null).map(presentStint);
    const latestRecusal = [...reassignments].reverse().find((row) => row.reasonCode === 'recusal');
    const recusalReassignRequired = latestRecusal?.status === 'returned';
    return {
      status: 200,
      body: {
        result: 'case-reassignments',
        caseId,
        handlingOrgId: view.handlingOrgId,
        currentStage: view.currentStage,
        mainStatus: view.status,
        handlers: currentHandlers,
        formerHandlers,
        handlerHistory: stints.map(presentStint),
        everHandlerPersonnelIds: [...new Set(stints.map((row) => row.personnelId))],
        reassignments: reassignments.map(presentReassignment),
        /** 回避改派被退回后挂到案件上的提示；重新发起回避改派后消失。 */
        recusalReassignRequired,
        recusalReassignNotice: recusalReassignRequired ? RECUSAL_REASSIGN_NOTICE : null,
        materials: view.materials.map((material) => {
          const hit = latest.get(material.id);
          return {
            materialId: material.id,
            kind: material.kind,
            createdAt: material.createdAt.toISOString(),
            effectiveness: hit
              ? {
                  id: hit.id,
                  conclusion: hit.conclusion,
                  conclusionName: MATERIAL_EFFECTIVENESS_NAMES[hit.conclusion as keyof typeof MATERIAL_EFFECTIVENESS_NAMES] ?? hit.conclusion,
                  reason: hit.reason,
                  determinedBy: hit.determinedBy,
                  determinedAt: hit.determinedAt.toISOString(),
                }
              : null,
          };
        }),
        effectivities: effectivity.map((row) => ({
          id: row.id,
          materialId: row.materialId,
          reassignmentId: row.reassignmentId,
          conclusion: row.conclusion,
          conclusionName: MATERIAL_EFFECTIVENESS_NAMES[row.conclusion as keyof typeof MATERIAL_EFFECTIVENESS_NAMES] ?? row.conclusion,
          reason: row.reason,
          determinedBy: row.determinedBy,
          determinedAt: row.determinedAt.toISOString(),
        })),
        invalidMaterialIds: invalidMaterialIds(facts),
      },
    };
  }

  /** 接手主办逐件认定材料效力。只追加，不产生呈批。 */
  async determineMaterial(
    actor: ActorRef,
    caseId: string,
    input: { readonly materialId: string; readonly conclusion: string; readonly reason: string },
  ): Promise<CaseReassignHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const denied = await this.authorize(actor, EFFECTIVITY_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };

    const conclusion = input.conclusion.trim();
    if (!isMaterialEffectivenessConclusion(conclusion)) {
      return this.failEffectivity(actor, account, view.handlingOrgId, caseId, {
        status: 400,
        reason: 'invalid-conclusion',
        message: '认定结论须为有效、无效或需补正',
      });
    }
    const reason = input.reason.trim();
    if (reason === '') {
      return this.failEffectivity(actor, account, view.handlingOrgId, caseId, {
        status: 400,
        reason: 'missing-reason',
        message: '效力认定理由必填',
      });
    }
    const materialId = input.materialId.trim();
    if (!view.materials.some((row) => row.id === materialId)) {
      return this.failEffectivity(actor, account, view.handlingOrgId, caseId, {
        status: 409,
        reason: 'unknown-material',
        message: '材料不属本案',
      });
    }
    if (!view.handlers.some((row) => row.personnelId === actor.personnelId && row.role === 'main')) {
      return this.failEffectivity(actor, account, view.handlingOrgId, caseId, {
        status: 409,
        reason: 'not-main-handler',
        message: '效力认定由接手的主办人作出',
      });
    }
    const reassignments = await this.cases.listReassignments(caseId);
    const recusal = [...reassignments]
      .reverse()
      .find((row) => row.status === 'approved' && row.reasonCode === 'recusal');
    if (!recusal) {
      return this.failEffectivity(actor, account, view.handlingOrgId, caseId, {
        status: 409,
        reason: 'invalid-state',
        message: '回避改派生效后才能认定材料效力',
      });
    }

    const at = this.clock.now();
    const id = newUlid();
    return this.uow.run(async (tx) => {
      await tx.cases.insertMaterialEffectiveness({
        id,
        caseId,
        materialId,
        reassignmentId: recusal.id,
        conclusion,
        reason,
        determinedBy: actor.personnelId,
        determinedAt: at,
      });
      await tx.audit.append({
        action: 'case.material-effectivity-recorded',
        ...this.parties(actor, account, view.handlingOrgId, caseId, EFFECTIVITY_OPCODE),
        detail: JSON.stringify({ materialId, conclusion, reassignmentId: recusal.id }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'material-effectivity-recorded',
          caseId,
          id,
          materialId,
          conclusion,
          conclusionName: MATERIAL_EFFECTIVENESS_NAMES[conclusion],
          reason,
        },
      };
    });
  }

  private async loadConflictDecision(caseId: string, lineageId: string): Promise<ConflictDecisionFact | null> {
    if (lineageId.trim() === '') return null;
    const [events, decisions] = await Promise.all([
      this.cases.listPersonConflictEvents(caseId),
      this.cases.listPersonConflictDecisions(caseId),
    ]);
    const decision = decisions.find((row) => row.lineageId === lineageId);
    if (!decision) return null;
    const latest = latestConflictEvents(events.map(toConflictFact)).find((row) => row.lineageId === lineageId);
    return {
      conclusion: decision.conclusion,
      deciderId: decision.deciderId,
      effective: latest?.status === 'effective',
    };
  }

  private async candidateFacts(
    handlingOrgId: string,
    mainId: string,
    assistIds: readonly string[],
  ): Promise<HandlerCandidateFacts[]> {
    const allowed = new Set(await this.identity.listOrgUnitSubtreeIds(handlingOrgId));
    const now = this.clock.now();
    const ids = [mainId, ...assistIds];
    const rows: HandlerCandidateFacts[] = [];
    for (const [index, personnelId] of ids.entries()) {
      const person = await this.identity.findPersonnelById(personnelId);
      const assignment = person ? await this.identity.findCurrentAssignment(personnelId) : null;
      const roles = person ? await this.identity.listActiveRoleNames(personnelId) : [];
      rows.push({
        personnelId,
        role: (index === 0 ? 'main' : 'assist') as HandlerRole,
        exists: person !== null,
        deactivated: person?.deactivatedAt != null,
        holdsHandlerRole: roles.includes('经办'),
        inHandlingOrgSubtree: assignment !== null && allowed.has(assignment.orgUnitId),
        qualified:
          person !== null &&
          hasEnforcementQualification(
            person.enforcementCertNo,
            person.enforcementCertExpiresOn,
            person.enforcementCertStatus,
            now,
          ),
      });
    }
    return rows;
  }

  private subjectOf(view: CaseView, roles: readonly string[], otherInFlightChains: number): TransitionSubject {
    return {
      caseId: view.id,
      mainStatus: view.status,
      stage: view.currentStage,
      stageEntrySeq: view.stageEntrySeq,
      suspended: view.suspended,
      markers: [],
      clueStatus: null,
      handlingOrgId: view.handlingOrgId,
      proposedHandlingOrgId: null,
      actorRoles: [...roles],
      otherInFlightChains,
      instances: view.instances.map((row) => ({ stage: row.stage, entrySeq: row.entrySeq, status: row.status })),
    };
  }

  private conflictMessage(issue: string): string {
    switch (issue) {
      case 'conflict-decision-required':
        return '原因为回避时，须引用一条生效的回避决定';
      case 'conflict-decision-not-effective':
        return '引用的回避决定未生效';
      case 'conflict-decider-mismatch':
        return '批准人须与回避决定的决定人一致';
      default:
        return '回避决定不合规';
    }
  }

  private failProposal(
    actor: ActorRef,
    account: LoginAccount | null,
    view: CaseView,
    caseId: string,
    stage: 'submit' | 'approve',
    issue: ReassignProposalIssue,
  ): Promise<CaseReassignHttpOutcome> {
    const message = issue.citation ? `${issue.message}（${issue.citation}）` : issue.message;
    if (stage === 'submit') {
      return this.failSubmit(actor, account, view.handlingOrgId, caseId, {
        status: issue.httpStatus,
        reason: issue.code,
        message,
        basis: issue.citation,
      });
    }
    return this.failApprove(actor, account, view.handlingOrgId, caseId, {
      status: issue.httpStatus,
      reason: issue.code,
      message: issue.httpStatus === 409 ? APPROVE_RESTART_MESSAGE : message,
      basis: issue.citation,
    });
  }

  private settleSubmit(
    actor: ActorRef,
    account: LoginAccount | null,
    view: CaseView,
    decision: Exclude<TransitionDecision, { ok: true }>,
  ): Promise<CaseReassignHttpOutcome> {
    if (decision.httpStatus === 400) return Promise.resolve({ status: 400, body: ruleKeyBody(decision) });
    if (decision.httpStatus === 200) {
      return this.holdWarning(actor, account, view.handlingOrgId, view.id, 'case.reassignment-submitted', decision);
    }
    return this.failSubmit(actor, account, view.handlingOrgId, view.id, {
      status: 409,
      reason: decision.reason,
      message: decision.message,
      basis: decision.citation,
    });
  }

  private settleApprove(
    actor: ActorRef,
    account: LoginAccount | null,
    view: CaseView,
    decision: Exclude<TransitionDecision, { ok: true }>,
  ): Promise<CaseReassignHttpOutcome> {
    if (decision.httpStatus === 400) return Promise.resolve({ status: 400, body: ruleKeyBody(decision) });
    if (decision.httpStatus === 200) {
      return this.holdWarning(actor, account, view.handlingOrgId, view.id, 'case.reassignment-approved', decision);
    }
    return this.failApprove(actor, account, view.handlingOrgId, view.id, {
      status: 409,
      reason: decision.reason,
      message: decision.message,
      basis: decision.citation,
    });
  }

  private async holdWarning(
    actor: ActorRef,
    account: LoginAccount | null,
    orgUnitId: string,
    caseId: string,
    action: 'case.reassignment-submitted' | 'case.reassignment-approved',
    decision: Extract<TransitionDecision, { httpStatus: 200 }>,
  ): Promise<CaseReassignHttpOutcome> {
    const entry = {
      action,
      outcome: 'failed' as const,
      // 引擎把 normative 的 X 降为警告；改派路径当前只会命中 X03。
      reason: 'X03',
      ...this.parties(actor, account, orgUnitId, caseId, action === 'case.reassignment-submitted' ? SUBMIT_OPCODE : APPROVE_OPCODE),
    } as unknown as AuditAppend;
    return this.uow.run(async () => rejected<CaseReassignHttpOutcome>(
      { status: 200, body: warningBody(decision.warnings) },
      entry,
    ));
  }

  private failSubmit(
    actor: ActorRef,
    account: LoginAccount | null,
    orgUnitId: string,
    caseId: string,
    fail: ReassignFailure,
  ): Promise<CaseReassignHttpOutcome> {
    return this.reject(
      'case.reassignment-submitted',
      SUBMIT_OPCODE,
      actor,
      account,
      orgUnitId,
      caseId,
      fail,
      fail.reason as CaseReassignmentSubmittedFailedReason,
    );
  }

  private failApprove(
    actor: ActorRef,
    account: LoginAccount | null,
    orgUnitId: string,
    caseId: string,
    fail: ReassignFailure,
  ): Promise<CaseReassignHttpOutcome> {
    return this.reject(
      'case.reassignment-approved',
      APPROVE_OPCODE,
      actor,
      account,
      orgUnitId,
      caseId,
      fail,
      fail.reason as CaseReassignmentApprovedFailedReason,
    );
  }

  private failEffectivity(
    actor: ActorRef,
    account: LoginAccount | null,
    orgUnitId: string,
    caseId: string,
    fail: ReassignFailure,
  ): Promise<CaseReassignHttpOutcome> {
    return this.reject(
      'case.material-effectivity-recorded',
      EFFECTIVITY_OPCODE,
      actor,
      account,
      orgUnitId,
      caseId,
      fail,
      fail.reason as CaseMaterialEffectivityFailedReason,
    );
  }

  private failWithdraw(
    actor: ActorRef,
    account: LoginAccount | null,
    orgUnitId: string,
    caseId: string,
    fail: ReassignFailure,
  ): Promise<CaseReassignHttpOutcome> {
    const outcome: CaseReassignHttpOutcome =
      fail.status === 400
        ? { status: 400, body: { result: 'non-compliant', reason: fail.reason, message: fail.message } }
        : this.blockBody(fail.reason, fail.message, fail.message);
    const entry = {
      action: 'case.reassignment-withdrawn',
      outcome: 'failed' as const,
      reason: fail.reason as CaseReassignmentWithdrawnFailedReason,
      ...this.parties(actor, account, orgUnitId, caseId, SUBMIT_OPCODE),
    } as unknown as AuditAppend;
    return this.uow.run(async () => rejected<CaseReassignHttpOutcome>(outcome, entry));
  }

  private async reject(
    action: 'case.reassignment-submitted' | 'case.reassignment-approved' | 'case.material-effectivity-recorded',
    opcode: string,
    actor: ActorRef,
    account: LoginAccount | null,
    orgUnitId: string,
    caseId: string,
    fail: ReassignFailure,
    reason: CaseReassignmentSubmittedFailedReason | CaseReassignmentApprovedFailedReason | CaseMaterialEffectivityFailedReason,
  ): Promise<CaseReassignHttpOutcome> {
    const outcome: CaseReassignHttpOutcome =
      fail.status === 403
        ? { status: 403, body: { reason: 'permission-denied' } }
        : fail.status === 400
          ? { status: 400, body: { result: 'non-compliant', reason: fail.reason, message: fail.message } }
          : this.blockBody(fail.reason, fail.message, fail.message, fail.basis ?? null);
    const entry = {
      action,
      outcome: 'failed' as const,
      reason,
      ...this.parties(actor, account, orgUnitId, caseId, opcode),
    } as unknown as AuditAppend;
    return this.uow.run(async () => rejected<CaseReassignHttpOutcome>(outcome, entry));
  }

  private blockBody(
    reason: string,
    message: string,
    outlet: string,
    basis: string | null = null,
  ): CaseReassignHttpOutcome {
    return {
      status: 409,
      body: { result: reason, reason, message, basis, outlet },
    };
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

  private parties(actor: ActorRef, account: LoginAccount | null, orgUnitId: string, caseId: string, opcode: string) {
    return {
      actorId: actor.personnelId,
      actorCode: account?.code ?? null,
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

function toConflictFact(row: PersonConflictEventRow): ConflictEventFact {
  return {
    id: row.id,
    lineageId: row.lineageId,
    caseId: row.caseId,
    personId: row.personId,
    source: row.source,
    reason: row.reason,
    status: row.status,
    seq: row.seq,
    createdAt: row.createdAt,
  };
}

function parseProposed(json: string): ProposedSnapshot | null {
  try {
    const parsed = JSON.parse(json) as {
      mainId?: unknown;
      assistIds?: unknown;
      currentHandlers?: unknown;
      handlers?: unknown;
    };
    if (typeof parsed.mainId !== 'string' || parsed.mainId.trim() === '') return null;
    if (!Array.isArray(parsed.assistIds) || parsed.assistIds.some((id) => typeof id !== 'string')) return null;
    const currentHandlers = namedHandlers(parsed.currentHandlers);
    const handlers = namedHandlers(parsed.handlers);
    if (!currentHandlers || !handlers) return null;
    return {
      mainId: parsed.mainId,
      assistIds: parsed.assistIds as string[],
      currentHandlers,
      handlers,
    };
  } catch {
    return null;
  }
}

function namedHandlers(value: unknown): NamedHandler[] | null {
  if (!Array.isArray(value)) return null;
  const rows: NamedHandler[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const { personnelId, role } = item as { personnelId?: unknown; role?: unknown };
    if (typeof personnelId !== 'string' || typeof role !== 'string' || !STRUCTURE_KINDS.has(role)) return null;
    rows.push({ personnelId, role });
  }
  return rows;
}

function sameHandlers(left: readonly NamedHandler[], right: readonly NamedHandler[]): boolean {
  if (left.length !== right.length) return false;
  const keys = (rows: readonly NamedHandler[]): string[] =>
    rows.map((row) => `${row.personnelId}:${row.role}`).sort();
  const a = keys(left);
  const b = keys(right);
  return a.every((value, index) => value === b[index]);
}

function presentStint(row: { readonly id: string; readonly personnelId: string; readonly role: string; readonly assignedAt: Date; readonly endedAt: Date | null }) {
  return {
    id: row.id,
    personnelId: row.personnelId,
    role: row.role,
    roleName: row.role === 'main' ? '主办' : '协办',
    assignedAt: row.assignedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

const REASSIGNMENT_STATUS_NAMES: Readonly<Record<string, string>> = {
  pending_approval: '待批准',
  approved: '已批准',
  returned: '已退回',
  withdrawn: '已撤回',
};

function presentReassignment(row: CaseReassignmentRow): Record<string, unknown> {
  const proposed = parseProposed(row.proposedJson);
  return {
    id: row.id,
    status: row.status,
    statusName: REASSIGNMENT_STATUS_NAMES[row.status] ?? row.status,
    reasonCode: row.reasonCode,
    reasonName: isReassignReasonCode(row.reasonCode) ? REASSIGN_REASON_NAMES[row.reasonCode] : row.reasonCode,
    note: row.note,
    conflictLineageId: row.conflictLineageId,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    proposedHandlers: proposed?.handlers ?? [],
  };
}