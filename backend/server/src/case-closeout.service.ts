// 送达（T24）、执行记载（T25）与结案（T26）的读写（#270）。
// 送达、执行记载与结案呈批沿用 doc.*；执行记载另用 case.execution.record（授经办）。
// 结案批准前调用移送闸口（X11）；移送回证缺失不阻断结案。
// 处罚决定未送达时，执行记载与结案返回 X10 警告（200，两段式确认），不改业务行。
// 结案检查点读 #243 同一份卷宗材料清单与版本（Q25），只记录缺件，不用缺件阻断结案。
// T24–T26 只在本服务的各自事务里落库；通用迁移入口拒绝直接套用。

import { Inject, Injectable } from '@nestjs/common';
import {
  rejected,
  CASE_CLOSEOUT_FAILED_REASONS,
  type CaseCloseoutAction,
  type CaseCloseoutFailedReason,
} from '@natural-enforcement/audit';
import {
  CASE_STORE,
  CASE_SUPERVISION_ROLE,
  CLOSURE_BRANCH_NAMES,
  DELIVERY_RECORD_KIND_NAMES,
  DOSSIER_MATERIALS_RULE_ID,
  DOSSIER_MATERIALS_VERSION,
  EXECUTION_RECORD_KIND_NAMES,
  canTakeFilingStep,
  closureBranchOf,
  decideTransition,
  deriveDecisionKind,
  dossierEventsOf,
  dossierInstanceKey,
  evaluateDossierCompleteness,
  filingStatusAfter,
  isTerminalCaseStatus,
  readActiveCaseMarkers,
  readClosureContent,
  readDeliveryRecord,
  readExecutionRecord,
  readFrozenViolations,
  receiptsCompleteOf,
  requiredDossierItems,
  x10Guard,
  type CaseStore,
  type CaseView,
  type ClosureBranch,
  type DecisionKind,
  type FilingAdminReview,
  type GuardResult,
  type TransitionDecision,
  type TransitionSubject,
} from '@natural-enforcement/case';
import {
  AccessControlService,
  IDENTITY_STORE,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type IdentityStore,
} from '@natural-enforcement/identity';

import { FILING_ADMIN_REVIEW } from './case-filing.service.ts';
import { CaseTransferService } from './case-transfer.service.ts';
import { appendRuleConfirmation, ruleKeyBody, warningBody } from './case-rule-confirmation.ts';
import { persistTransitionEffects } from './case-transition-write.ts';
import { CLOCK, type Clock } from './clock.ts';
import { LOGIN_DIRECTORY, type LoginAccount, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const READ_OPCODE = 'case.read';
const DRAFT_OPCODE = 'doc.draft';
const SUBMIT_OPCODE = 'doc.submit';
const REVIEW_OPCODE = 'doc.admin.review';
const APPROVE_OPCODE = 'doc.approve';
const EXECUTION_OPCODE = 'case.execution.record';
const HANDLER_ROLES = new Set(['main', 'assist']);
const FAIL_REASONS = new Set<string>(CASE_CLOSEOUT_FAILED_REASONS);

export type CaseCloseoutHttpOutcome =
  | { readonly status: 200; readonly body: Record<string, unknown> }
  | { readonly status: 400; readonly body: Record<string, unknown> }
  | { readonly status: 403; readonly body: { readonly reason: string } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | { readonly status: 409; readonly body: Record<string, unknown> };

interface Prepared {
  readonly actorId: string;
  readonly actorCode: string | null;
  readonly account: LoginAccount | null;
  readonly roles: readonly string[];
  readonly view: CaseView;
}

interface ConfirmationInput {
  readonly confirmedRuleKeys?: readonly string[];
  readonly confirmReasons?: Readonly<Record<string, string>>;
}

interface ChecklistFacts {
  readonly checklist: ReturnType<typeof evaluateDossierCompleteness>['checklist'];
  readonly missingItems: readonly number[];
  readonly requiredItems: readonly number[];
}

@Injectable()
export class CaseCloseoutService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILING_ADMIN_REVIEW) private readonly adminReview: FilingAdminReview,
    private readonly access: AccessControlService,
    private readonly transfers: CaseTransferService,
  ) {}

  async read(actor: ActorRef, caseId: string): Promise<CaseCloseoutHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const denied = await this.authorize(actor, READ_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };
    const [deliveries, executions, approval, closure, checklist, kind, transfers, files] = await Promise.all([
      this.cases.listDeliveries(caseId),
      this.cases.listExecutionRecords(caseId),
      this.cases.readOpenClosureApproval(caseId),
      this.cases.readClosure(caseId),
      this.checklistOf(view),
      this.decisionKindOf(caseId),
      this.cases.listTransfers(caseId),
      this.cases.listTransferFiles(caseId),
    ]);
    const receipts = files.filter((row) => row.kind === 'receipt' && row.transferId !== null);
    const branch = closureBranchOf(view.currentStage);
    const content = approval ? this.parseClosure(approval.contentJson) : null;
    return {
      status: 200,
      body: {
        caseId,
        status: view.status,
        currentStage: view.currentStage,
        stageEntrySeq: view.stageEntrySeq,
        branch,
        branchName: branch ? CLOSURE_BRANCH_NAMES[branch] : null,
        decisionKind: kind,
        deliveries: deliveries.map((row) => presentDelivery(row)),
        executions: executions.map((row) => presentExecution(row)),
        checklist: {
          materialsRuleId: DOSSIER_MATERIALS_RULE_ID,
          materialsRuleVersion: DOSSIER_MATERIALS_VERSION,
          requiredItems: [...checklist.requiredItems],
          missingItems: [...checklist.missingItems],
          rows: checklist.checklist,
        },
        receipt: {
          transfers: transfers.map((row) => ({ id: row.id, kind: row.kind, documentNo: row.documentNo })),
          complete: receiptsCompleteOf(transfers, receipts),
        },
        approval: approval
          ? {
              id: approval.id,
              status: approval.status,
              currentVersionNo: approval.currentVersionNo,
              drafterId: approval.drafterId,
              note: content?.note ?? null,
            }
          : null,
        closure: closure
          ? {
              id: closure.id,
              branch: closure.branch,
              branchName: CLOSURE_BRANCH_NAMES[closure.branch as ClosureBranch] ?? closure.branch,
              checklist: parseAny(closure.checklistJson),
              materialsRuleId: closure.materialsRuleId,
              materialsRuleVersion: closure.materialsRuleVersion,
              closedAt: closure.closedAt.toISOString(),
            }
          : null,
      },
    };
  }

  /** T24：上传送达回证，或记录公告送达的原因和经过并附公告材料。 */
  async recordDelivery(
    actor: ActorRef,
    caseId: string,
    input: { readonly content: unknown } & ConfirmationInput,
  ): Promise<CaseCloseoutHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, SUBMIT_OPCODE, 'case.delivery-recorded', true);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.delivery-recorded', SUBMIT_OPCODE);
    if (terminal) return terminal;
    if (!this.decisionEffective(prepared.view)) {
      return this.fail(prepared, 'case.delivery-recorded', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '决定书尚未批准生效，不能送达',
        outlet: '先完成决定审批',
      });
    }
    const parsed = readDeliveryRecord(input.content);
    if (!parsed.ok) {
      const guard = parsed.hit.reason === 'insufficient-deliverers' || parsed.hit.reason === 'invalid-deliverers';
      return this.fail(prepared, 'case.delivery-recorded', SUBMIT_OPCODE, {
        httpStatus: guard ? 409 : 400,
        reason: parsed.hit.reason,
        message: parsed.hit.message,
        outlet: parsed.hit.outlet,
      });
    }
    const approved = await this.cases.readApprovedDecisionApproval(caseId);
    const decisionContent = approved ? parseJson(approved.contentJson) : null;
    const documentKind = decisionContent && typeof decisionContent.documentType === 'string'
      ? decisionContent.documentType
      : null;
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T24' },
      subject: await this.subjectOf(prepared.view, prepared.roles, await this.cases.countInFlightApprovals(caseId)),
      confirmedRuleKeys: input.confirmedRuleKeys,
      confirmReasons: input.confirmReasons,
    });
    if (!decision.ok) return this.settle(prepared, 'case.delivery-recorded', SUBMIT_OPCODE, decision);
    const effects = decision.effects;
    if (
      effects.kind !== 'advance'
      || effects.transitionCode !== 'T24'
      || !effects.currentStage
      || effects.stageEntrySeq === null
    ) {
      return this.fail(prepared, 'case.delivery-recorded', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '送达没有可执行的去向',
        outlet: '按当前环节重新提交',
      });
    }
    const at = this.clock.now();
    const deliveryId = newUlid();
    return this.uow.run(async (tx) => {
      const wrote = await persistTransitionEffects(tx.cases, {
        effects,
        caseId,
        clueId: prepared.view.sourceClueIds[0] ?? null,
        actorId: actor.personnelId,
        at,
        fromJson: JSON.stringify({
          stage: prepared.view.currentStage,
          status: prepared.view.status,
          stageEntrySeq: prepared.view.stageEntrySeq,
        }),
        toJson: JSON.stringify({
          stage: effects.currentStage,
          status: effects.mainStatus,
          stageEntrySeq: effects.stageEntrySeq,
        }),
        newId: () => newUlid(),
      });
      const moved = wrote
        && (await tx.cases.advanceCasePointer({
          caseId,
          expectedStage: prepared.view.currentStage,
          expectedSeq: prepared.view.stageEntrySeq,
          stage: effects.currentStage as string,
          stageEntrySeq: effects.stageEntrySeq as number,
          status: effects.mainStatus as string,
          suspended: effects.suspended ?? false,
        }));
      if (!moved) {
        return rejected<CaseCloseoutHttpOutcome>(
          this.blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.delivery-recorded',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, SUBMIT_OPCODE),
          },
        );
      }
      await tx.cases.insertDelivery({
        id: deliveryId,
        caseId,
        kind: parsed.content.kind,
        documentKind,
        deliveredOn: parsed.content.deliveredOn,
        deliverers: parsed.content.deliverers,
        reasonRecord: parsed.content.reasonRecord,
        announcementMaterials: parsed.content.announcementMaterials,
        note: parsed.content.note,
        decisionApprovalId: approved?.id ?? null,
        recordedBy: actor.personnelId,
        recordedAt: at,
      });
      const parties = this.parties(prepared, caseId, SUBMIT_OPCODE);
      await tx.audit.append({
        action: 'case.delivery-recorded',
        ...parties,
        detail: JSON.stringify({
          caseId,
          deliveryId,
          kind: parsed.content.kind,
          deliveredOn: parsed.content.deliveredOn,
          deliverers: parsed.content.deliverers.length,
          transitionId: 'T24',
        }),
      });
      await tx.audit.append({
        action: 'case.transitioned',
        ...parties,
        detail: JSON.stringify({ caseId, transitionId: 'T24', deliveryId }),
      });
      if (decision.confirmation) {
        await appendRuleConfirmation(tx.audit, {
          parties,
          confirmation: decision.confirmation,
          at,
          step: 'delivery:T24',
          confirmReasons: input.confirmReasons,
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'delivery-recorded',
          deliveryId,
          caseId,
          kind: parsed.content.kind,
          kindName: DELIVERY_RECORD_KIND_NAMES[parsed.content.kind],
          deliveredOn: parsed.content.deliveredOn,
          currentStage: effects.currentStage,
          stageEntrySeq: effects.stageEntrySeq,
        },
      };
    });
  }

  /** T25：执行记载。「已申请法院强制执行」附申请书；「履行完毕」附缴款凭证等。 */
  async recordExecution(
    actor: ActorRef,
    caseId: string,
    input: { readonly content: unknown } & ConfirmationInput,
  ): Promise<CaseCloseoutHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, EXECUTION_OPCODE, 'case.execution-recorded', true);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.execution-recorded', EXECUTION_OPCODE);
    if (terminal) return terminal;
    const stageHit = this.executionStageHit(prepared, 'case.execution-recorded', EXECUTION_OPCODE);
    if (stageHit) return stageHit;
    if ((await this.decisionKindOf(caseId)) === 'no-penalty') {
      return this.fail(prepared, 'case.execution-recorded', EXECUTION_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '不予处罚案件没有执行记载',
        outlet: '由 E10 直接结案',
      });
    }
    const parsed = readExecutionRecord(input.content);
    if (!parsed.ok) {
      const guard = parsed.hit.reason === 'missing-attachment';
      return this.fail(prepared, 'case.execution-recorded', EXECUTION_OPCODE, {
        httpStatus: guard ? 409 : 400,
        reason: parsed.hit.reason,
        message: parsed.hit.message,
        outlet: parsed.hit.outlet,
      });
    }
    const deliveries = await this.cases.listDeliveries(caseId);
    const advisories: GuardResult[] = [];
    const x10 = x10Guard({ branch: 'penalty', delivered: deliveries.length > 0 });
    if (x10) advisories.push(x10);
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T25' },
      subject: await this.subjectOf(prepared.view, prepared.roles, await this.cases.countInFlightApprovals(caseId)),
      advisories,
      confirmedRuleKeys: input.confirmedRuleKeys,
      confirmReasons: input.confirmReasons,
    });
    if (!decision.ok) return this.settle(prepared, 'case.execution-recorded', EXECUTION_OPCODE, decision);
    const effects = decision.effects;
    if (
      effects.kind !== 'advance'
      || effects.transitionCode !== 'T25'
      || !effects.currentStage
      || effects.stageEntrySeq === null
    ) {
      return this.fail(prepared, 'case.execution-recorded', EXECUTION_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '执行记载没有可执行的去向',
        outlet: '按当前环节重新提交',
      });
    }
    const at = this.clock.now();
    const recordId = newUlid();
    return this.uow.run(async (tx) => {
      const wrote = await persistTransitionEffects(tx.cases, {
        effects,
        caseId,
        clueId: prepared.view.sourceClueIds[0] ?? null,
        actorId: actor.personnelId,
        at,
        fromJson: JSON.stringify({
          stage: prepared.view.currentStage,
          status: prepared.view.status,
          stageEntrySeq: prepared.view.stageEntrySeq,
        }),
        toJson: JSON.stringify({
          stage: effects.currentStage,
          status: effects.mainStatus,
          stageEntrySeq: effects.stageEntrySeq,
        }),
        newId: () => newUlid(),
      });
      const moved = wrote
        && (await tx.cases.advanceCasePointer({
          caseId,
          expectedStage: prepared.view.currentStage,
          expectedSeq: prepared.view.stageEntrySeq,
          stage: effects.currentStage as string,
          stageEntrySeq: effects.stageEntrySeq as number,
          status: effects.mainStatus as string,
          suspended: effects.suspended ?? false,
        }));
      if (!moved) {
        return rejected<CaseCloseoutHttpOutcome>(
          this.blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.execution-recorded',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, EXECUTION_OPCODE),
          },
        );
      }
      await tx.cases.insertExecutionRecord({
        id: recordId,
        caseId,
        kind: parsed.content.kind,
        note: parsed.content.note,
        attachments: parsed.content.attachments,
        recordedBy: actor.personnelId,
        recordedAt: at,
      });
      const parties = this.parties(prepared, caseId, EXECUTION_OPCODE);
      await tx.audit.append({
        action: 'case.execution-recorded',
        ...parties,
        detail: JSON.stringify({
          caseId,
          recordId,
          kind: parsed.content.kind,
          attachments: parsed.content.attachments.length,
          transitionId: 'T25',
        }),
      });
      await tx.audit.append({
        action: 'case.transitioned',
        ...parties,
        detail: JSON.stringify({ caseId, transitionId: 'T25', recordId }),
      });
      if (decision.confirmation) {
        await appendRuleConfirmation(tx.audit, {
          parties,
          confirmation: decision.confirmation,
          at,
          step: 'execution:T25',
          confirmReasons: input.confirmReasons,
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'execution-recorded',
          recordId,
          caseId,
          kind: parsed.content.kind,
          kindName: EXECUTION_RECORD_KIND_NAMES[parsed.content.kind],
          currentStage: effects.currentStage,
          stageEntrySeq: effects.stageEntrySeq,
          hints: [],
        },
      };
    });
  }

  async draftClosure(
    actor: ActorRef,
    caseId: string,
    input: { readonly content: unknown } & ConfirmationInput,
  ): Promise<CaseCloseoutHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.closure-drafted', true);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.closure-drafted', DRAFT_OPCODE);
    if (terminal) return terminal;
    const stageHit = await this.closureStageHit(prepared, 'case.closure-drafted', DRAFT_OPCODE);
    if (stageHit) return stageHit;
    const parsed = readClosureContent(input.content);
    if (!parsed.ok) return this.failContent(prepared, 'case.closure-drafted', DRAFT_OPCODE, parsed.hit);
    const open = await this.cases.readOpenClosureApproval(caseId);
    if (open && open.status !== 'drafting') {
      return this.fail(prepared, 'case.closure-drafted', DRAFT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '结案呈批已提交，不能再拟制',
        outlet: '等待审核或批准',
      });
    }
    if (open && open.drafterId !== actor.personnelId) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    const approvalId = open?.id ?? newUlid();
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const saved = await tx.cases.saveClosureDraft({
        approvalId,
        caseId,
        drafterId: actor.personnelId,
        isNew: open === null,
        expectedVersionNo: open?.currentVersionNo ?? 0,
        versionId: newUlid(),
        contentJson: JSON.stringify(parsed.content),
        at,
      });
      if (!saved) {
        return rejected<CaseCloseoutHttpOutcome>(
          this.blockBody('concurrent-change', '结案呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.closure-drafted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, DRAFT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.closure-drafted',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({ caseId, approvalId, branch: closureBranchOf(prepared.view.currentStage) }),
      });
      return {
        status: 200 as const,
        body: { result: 'closure-drafted', approvalId, caseId, status: 'drafting' },
      };
    });
  }

  async submitClosure(actor: ActorRef, approvalId: string): Promise<CaseCloseoutHttpOutcome> {
    const loaded = await this.cases.readClosureApproval(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, SUBMIT_OPCODE, 'case.closure-submitted', true);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.closure-submitted', SUBMIT_OPCODE);
    if (terminal) return terminal;
    const stageHit = await this.closureStageHit(prepared, 'case.closure-submitted', SUBMIT_OPCODE);
    if (stageHit) return stageHit;
    if (loaded.drafterId !== actor.personnelId) {
      return this.fail(prepared, 'case.closure-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'not-drafter',
        message: '只有拟制人可以提交结案呈批',
        outlet: '由拟制人提交',
      });
    }
    if (!canTakeFilingStep('submit', loaded.status)) {
      return this.fail(prepared, 'case.closure-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '结案呈批不在拟制中',
        outlet: '先保存结案呈批稿',
      });
    }
    const content = this.parseClosure(loaded.contentJson);
    if (!content) {
      return this.fail(prepared, 'case.closure-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-content',
        message: '结案呈批稿不合规',
        outlet: '重新保存结案呈批稿',
      });
    }
    const nextStatus = filingStatusAfter('submit', this.adminReview);
    const at = this.clock.now();
    const chainId = newUlid();
    return this.uow.run(async (tx) => {
      const opened = await tx.cases.openApprovalChain({
        id: chainId,
        caseId: loaded.caseId,
        kind: 'closure',
        openedBy: actor.personnelId,
        openedAt: at,
      });
      if (!opened) {
        return rejected<CaseCloseoutHttpOutcome>(
          this.blockBody('X18', '本案已有进行中的审批链', '同一案件同时只有一条进行中的审批链', '先办结或撤回当前审批链'),
          {
            action: 'case.closure-submitted',
            outcome: 'failed',
            reason: 'X18',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      const stepped = await tx.cases.applyClosureStep({
        approvalId,
        expectedStatus: loaded.status,
        nextStatus,
        approvalChainId: chainId,
        stepId: newUlid(),
        step: 'submit',
        versionNo: loaded.currentVersionNo,
        actorId: actor.personnelId,
        opinion: null,
        at,
      });
      if (!stepped) {
        return rejected<CaseCloseoutHttpOutcome>(
          this.blockBody('concurrent-change', '结案呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.closure-submitted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.closure-submitted',
        ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
        detail: JSON.stringify({ caseId: loaded.caseId, approvalId, chainId }),
      });
      return {
        status: 200 as const,
        body: { result: 'closure-submitted', approvalId, caseId: loaded.caseId, status: nextStatus },
      };
    });
  }

  async reviewClosure(
    actor: ActorRef,
    approvalId: string,
    input: { readonly opinion: string | null },
  ): Promise<CaseCloseoutHttpOutcome> {
    const loaded = await this.cases.readClosureApproval(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, REVIEW_OPCODE, 'case.closure-reviewed', false);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.closure-reviewed', REVIEW_OPCODE);
    if (terminal) return terminal;
    if (!canTakeFilingStep('review', loaded.status)) {
      return this.fail(prepared, 'case.closure-reviewed', REVIEW_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '结案呈批不在待审核',
        outlet: '先提交结案呈批',
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyClosureStep({
        approvalId,
        expectedStatus: loaded.status,
        nextStatus: filingStatusAfter('review', this.adminReview),
        stepId: newUlid(),
        step: 'review',
        versionNo: loaded.currentVersionNo,
        actorId: actor.personnelId,
        opinion: input.opinion,
        at,
      });
      if (!stepped) {
        return rejected<CaseCloseoutHttpOutcome>(
          this.blockBody('concurrent-change', '结案呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.closure-reviewed',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, REVIEW_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.closure-reviewed',
        ...this.parties(prepared, loaded.caseId, REVIEW_OPCODE),
        detail: JSON.stringify({ caseId: loaded.caseId, approvalId }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'closure-reviewed',
          approvalId,
          caseId: loaded.caseId,
          status: filingStatusAfter('review', this.adminReview),
        },
      };
    });
  }

  async approveClosure(
    actor: ActorRef,
    approvalId: string,
    input: ConfirmationInput & { readonly opinion: string | null },
  ): Promise<CaseCloseoutHttpOutcome> {
    const loaded = await this.cases.readClosureApproval(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, APPROVE_OPCODE, 'case.closure-approved', false);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.closure-approved', APPROVE_OPCODE);
    if (terminal) return terminal;
    const stageHit = await this.closureStageHit(prepared, 'case.closure-approved', APPROVE_OPCODE);
    if (stageHit) return stageHit;
    if (!canTakeFilingStep('approve', loaded.status)) {
      return this.fail(prepared, 'case.closure-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '结案呈批不在待审批',
        outlet: '先完成审核',
      });
    }
    const content = this.parseClosure(loaded.contentJson);
    if (!content) {
      return this.fail(prepared, 'case.closure-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-content',
        message: '结案呈批稿不合规',
        outlet: '重新保存结案呈批稿',
      });
    }
    const gate = await this.transfers.closeoutGate(actor, loaded.caseId);
    if (gate.status !== 200) return this.relay(prepared, 'case.closure-approved', APPROVE_OPCODE, gate);
    const branch = closureBranchOf(prepared.view.currentStage) as ClosureBranch;
    const [deliveries, checklist] = await Promise.all([
      this.cases.listDeliveries(loaded.caseId),
      this.checklistOf(prepared.view),
    ]);
    const advisories: GuardResult[] = [];
    const x10 = x10Guard({ branch, delivered: deliveries.length > 0 });
    if (x10) advisories.push(x10);
    const other = Math.max(
      0,
      (await this.cases.countInFlightApprovals(loaded.caseId)) - (loaded.approvalChainId ? 1 : 0),
    );
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T26' },
      subject: await this.subjectOf(prepared.view, prepared.roles, other),
      advisories,
      confirmedRuleKeys: input.confirmedRuleKeys,
      confirmReasons: input.confirmReasons,
    });
    if (!decision.ok) return this.settle(prepared, 'case.closure-approved', APPROVE_OPCODE, decision);
    const effects = decision.effects;
    if (effects.kind !== 'advance' || effects.mainStatus !== 'closed' || effects.transitionCode !== 'T26') {
      return this.fail(prepared, 'case.closure-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '结案呈批没有可执行的去向',
        outlet: '按当前环节重新提交',
      });
    }
    const at = this.clock.now();
    const caseId = loaded.caseId;
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyClosureStep({
        approvalId,
        expectedStatus: loaded.status,
        nextStatus: 'approved',
        stepId: newUlid(),
        step: 'approve',
        versionNo: loaded.currentVersionNo,
        actorId: actor.personnelId,
        opinion: input.opinion,
        at,
      });
      if (!stepped) {
        return rejected<CaseCloseoutHttpOutcome>(
          this.blockBody('concurrent-change', '结案呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.closure-approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, APPROVE_OPCODE),
          },
        );
      }
      const wrote = await persistTransitionEffects(tx.cases, {
        effects,
        caseId,
        clueId: prepared.view.sourceClueIds[0] ?? null,
        actorId: actor.personnelId,
        at,
        fromJson: JSON.stringify({
          stage: prepared.view.currentStage,
          status: prepared.view.status,
          stageEntrySeq: prepared.view.stageEntrySeq,
        }),
        toJson: JSON.stringify({
          stage: effects.currentStage,
          status: effects.mainStatus,
          stageEntrySeq: effects.stageEntrySeq,
        }),
        newId: () => newUlid(),
      });
      const moved = wrote
        && (await tx.cases.advanceCasePointer({
          caseId,
          expectedStage: prepared.view.currentStage,
          expectedSeq: prepared.view.stageEntrySeq,
          stage: effects.currentStage as string,
          stageEntrySeq: effects.stageEntrySeq as number,
          status: 'closed',
          suspended: false,
        }));
      if (!moved) {
        return rejected<CaseCloseoutHttpOutcome>(
          this.blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.closure-approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, APPROVE_OPCODE),
          },
        );
      }
      const inserted = await tx.cases.insertClosure({
        id: newUlid(),
        caseId,
        approvalId,
        branch,
        checklistJson: JSON.stringify(checklist.checklist),
        materialsRuleId: DOSSIER_MATERIALS_RULE_ID,
        materialsRuleVersion: DOSSIER_MATERIALS_VERSION,
        closedBy: actor.personnelId,
        closedAt: at,
      });
      if (!inserted) {
        return rejected<CaseCloseoutHttpOutcome>(
          this.blockBody('concurrent-change', '结案记录已存在', null, '请重新读取后再试'),
          {
            action: 'case.closure-approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, APPROVE_OPCODE),
          },
        );
      }
      if (loaded.approvalChainId) {
        const closed = await tx.cases.closeApprovalChain(loaded.approvalChainId);
        if (!closed) {
          return rejected<CaseCloseoutHttpOutcome>(
            this.blockBody('concurrent-change', '审批链已被他人办结', null, '请重新读取后再试'),
            {
              action: 'case.closure-approved',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, caseId, APPROVE_OPCODE),
            },
          );
        }
      }
      const parties = this.parties(prepared, caseId, APPROVE_OPCODE);
      await tx.audit.append({
        action: 'case.closure-approved',
        ...parties,
        detail: JSON.stringify({
          caseId,
          approvalId,
          branch,
          missingItems: checklist.missingItems,
          materialsRuleVersion: DOSSIER_MATERIALS_VERSION,
        }),
      });
      await tx.audit.append({
        action: 'case.transitioned',
        ...parties,
        detail: JSON.stringify({ caseId, transitionId: 'T26', approvalId }),
      });
      if (decision.confirmation) {
        await appendRuleConfirmation(tx.audit, {
          parties,
          confirmation: decision.confirmation,
          at,
          step: 'closure-approve:T26',
          confirmReasons: input.confirmReasons,
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'closure-approved',
          approvalId,
          caseId,
          status: 'closed',
          branch,
          branchName: CLOSURE_BRANCH_NAMES[branch],
          missingItems: checklist.missingItems,
          materialsRuleId: DOSSIER_MATERIALS_RULE_ID,
          materialsRuleVersion: DOSSIER_MATERIALS_VERSION,
        },
      };
    });
  }

  private async checklistOf(view: CaseView): Promise<ChecklistFacts> {
    const [materialRows, invalidated, transfers, files] = await Promise.all([
      this.cases.listDossierMaterials(view.id),
      this.cases.listInvalidatedInstanceIds(view.id),
      this.cases.listTransfers(view.id),
      this.cases.listTransferFiles(view.id),
    ]);
    const invalidatedKeys = new Set(invalidated);
    const materials = materialRows.map((row) => ({
      itemCode: row.itemCode,
      current:
        row.stage === null
        || row.entrySeq === null
        || !invalidatedKeys.has(dossierInstanceKey(row.stage, row.entrySeq)),
      evidenceJson: row.evidenceJson,
    }));
    const events = dossierEventsOf([...view.instances.map((row) => row.stage), view.currentStage]);
    const requirement = requiredDossierItems({
      reachedReview: events.reachedReview,
      reachedDelivery: events.reachedDelivery,
      terminationClosed: view.status === 'closed' && view.history.some((row) => row.transitionCode === 'T07'),
      jurisdictionTransfer: transfers.some((row) => row.kind === 'jurisdiction'),
    });
    const receipts = files.filter((row) => row.kind === 'receipt' && row.transferId !== null);
    const completeness = evaluateDossierCompleteness({
      requirement,
      materials,
      receiptsComplete: receiptsCompleteOf(transfers, receipts),
      missingReason: null,
    });
    return {
      checklist: completeness.checklist,
      missingItems: completeness.missingItems,
      requiredItems: requirement.requiredItems,
    };
  }

  private async decisionKindOf(caseId: string): Promise<DecisionKind | null> {
    const approved = await this.cases.readApprovedDecisionApproval(caseId);
    if (approved?.contentJson) {
      const content = parseJson(approved.contentJson);
      if (content && (content.kind === 'penalty' || content.kind === 'no-penalty')) return content.kind;
    }
    const frozen = await this.cases.listFrozenDecisions(caseId);
    const latest = frozen.at(-1);
    if (!latest) return null;
    return deriveDecisionKind(readFrozenViolations(parseJson(latest.summaryJson)));
  }

  private decisionEffective(view: CaseView): boolean {
    if (view.status !== 'in_progress' || view.currentStage !== 'E09') return false;
    return currentInstanceCompleted(view);
  }

  private async closureStageHit(
    prepared: Prepared,
    action: CaseCloseoutAction,
    opcode: string,
  ): Promise<CaseCloseoutHttpOutcome | null> {
    if (prepared.view.status !== 'in_progress') {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前案件不在可结案状态',
        outlet: '在送达或执行记载环节结案',
      });
    }
    const branch = closureBranchOf(prepared.view.currentStage);
    if (branch === null) {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前环节不能结案',
        outlet: '完成送达与执行记载后再结案',
      });
    }
    const kind = await this.decisionKindOf(prepared.view.id);
    if (kind === 'penalty' && branch === 'no-penalty') {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '处罚案件须先完成执行记载',
        outlet: '先登记执行记载，再由 E11 结案',
      });
    }
    if (kind === 'no-penalty' && branch === 'penalty') {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '不予处罚案件没有执行记载',
        outlet: '由 E10 直接结案',
      });
    }
    return null;
  }

  private executionStageHit(
    prepared: Prepared,
    action: CaseCloseoutAction,
    opcode: string,
  ): Promise<CaseCloseoutHttpOutcome> | null {
    if (prepared.view.status !== 'in_progress' || prepared.view.currentStage !== 'E10') {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前不在送达完成环节',
        outlet: '先完成送达',
      });
    }
    if (!currentInstanceCompleted(prepared.view)) {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '送达尚未完成',
        outlet: '先完成送达',
      });
    }
    return null;
  }

  private async subjectOf(
    view: CaseView,
    roles: readonly string[],
    otherInFlightChains: number,
  ): Promise<TransitionSubject> {
    return {
      caseId: view.id,
      mainStatus: view.status,
      stage: view.currentStage,
      stageEntrySeq: view.stageEntrySeq,
      suspended: view.suspended,
      markers: await readActiveCaseMarkers(this.cases, view.id),
      clueStatus: null,
      handlingOrgId: view.handlingOrgId,
      proposedHandlingOrgId: null,
      actorRoles: [...roles],
      otherInFlightChains,
      instances: view.instances.map((row) => ({ stage: row.stage, entrySeq: row.entrySeq, status: row.status })),
    };
  }

  private async prepare(
    actor: ActorRef,
    caseId: string,
    opcode: string,
    action: CaseCloseoutAction,
    mustBeHandler: boolean,
  ): Promise<Prepared | CaseCloseoutHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    const prepared: Prepared = { actorId: actor.personnelId, actorCode: account?.code ?? null, account, roles, view };
    const denied = await this.authorize(actor, opcode, view.handlingOrgId, caseId);
    if (denied) {
      const onlySupervision = roles.length > 0 && roles.every((role) => role === CASE_SUPERVISION_ROLE);
      if (denied === 'permission-denied' && onlySupervision) {
        return this.fail(prepared, action, opcode, {
          httpStatus: 409,
          reason: 'X17',
          message: '监督角色不能推进案件',
          outlet: '请由有权办理人操作，监督不能推进主状态',
          basis: 'GLOSSARY「监督」',
        });
      }
      return { status: 403, body: { reason: denied } };
    }
    if (mustBeHandler && !view.handlers.some((row) => row.personnelId === actor.personnelId && HANDLER_ROLES.has(row.role))) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    return prepared;
  }

  private parseClosure(contentJson: string | null): { readonly note: string | null } | null {
    if (contentJson === null) return null;
    const parsed = readClosureContent(parseJson(contentJson));
    return parsed.ok ? parsed.content : null;
  }

  private relay(
    prepared: Prepared,
    action: CaseCloseoutAction,
    opcode: string,
    outcome: { readonly status: number; readonly body: unknown },
  ): Promise<CaseCloseoutHttpOutcome> | CaseCloseoutHttpOutcome {
    const body = (typeof outcome.body === 'object' && outcome.body !== null)
      ? (outcome.body as Record<string, unknown>)
      : {};
    if (outcome.status === 403) return { status: 403, body: { reason: typeof body.reason === 'string' ? body.reason : 'permission-denied' } };
    if (outcome.status === 404) return { status: 404, body: { result: 'not-found' } };
    const reason = typeof body.reason === 'string' ? body.reason : 'invalid-state';
    return this.fail(prepared, action, opcode, {
      httpStatus: outcome.status === 400 ? 400 : 409,
      reason,
      message: typeof body.message === 'string' ? body.message : '结案被拒',
      outlet: typeof body.outlet === 'string' ? body.outlet : '按闸口提示处理',
      basis: typeof body.basis === 'string' ? body.basis : null,
    });
  }

  private async terminalHit(
    prepared: Prepared,
    action: CaseCloseoutAction,
    opcode: string,
  ): Promise<CaseCloseoutHttpOutcome | null> {
    if (!isTerminalCaseStatus(prepared.view.status)) return null;
    return this.fail(prepared, action, opcode, {
      httpStatus: 409,
      reason: 'X12',
      message: '案件已终态，该业务写操作不能继续',
      outlet: '终态后仅可阅读、导出',
    });
  }

  private settle(
    prepared: Prepared,
    action: CaseCloseoutAction,
    opcode: string,
    decision: Exclude<TransitionDecision, { ok: true }>,
  ): Promise<CaseCloseoutHttpOutcome> {
    if (decision.httpStatus === 400) return Promise.resolve({ status: 400, body: ruleKeyBody(decision) });
    if (decision.level === 'block') {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: decision.reason,
        message: decision.message,
        outlet: decision.outlet,
        basis: decision.citation,
      });
    }
    return this.holdWarning(prepared, action, opcode, decision);
  }

  private holdWarning(
    prepared: Prepared,
    action: CaseCloseoutAction,
    opcode: string,
    decision: Extract<TransitionDecision, { httpStatus: 200 }>,
  ): Promise<CaseCloseoutHttpOutcome> {
    const reason = (FAIL_REASONS.has(decision.reason) ? decision.reason : 'invalid-state') as CaseCloseoutFailedReason;
    return this.uow.run(async () =>
      rejected(
        { status: 200 as const, body: warningBody(decision.warnings) },
        {
          action,
          outcome: 'failed',
          reason,
          ...this.parties(prepared, prepared.view.id, opcode),
        },
      ),
    );
  }

  private failContent(
    prepared: Prepared,
    action: CaseCloseoutAction,
    opcode: string,
    hit: { readonly httpStatus: 400; readonly reason: string; readonly message: string; readonly outlet: string },
  ): Promise<CaseCloseoutHttpOutcome> {
    return this.fail(prepared, action, opcode, {
      httpStatus: hit.httpStatus,
      reason: hit.reason,
      message: hit.message,
      outlet: hit.outlet,
    });
  }

  private fail(
    prepared: Prepared,
    action: CaseCloseoutAction,
    opcode: string,
    fail: {
      readonly httpStatus: 400 | 409;
      readonly reason: string;
      readonly message: string;
      readonly outlet: string;
      readonly basis?: string | null;
    },
  ): Promise<CaseCloseoutHttpOutcome> {
    const reason = (FAIL_REASONS.has(fail.reason) ? fail.reason : 'invalid-state') as CaseCloseoutFailedReason;
    const outcome: CaseCloseoutHttpOutcome =
      fail.httpStatus === 400
        ? { status: 400, body: { result: 'non-compliant', reason: fail.reason, message: fail.message, outlet: fail.outlet } }
        : {
            status: 409,
            body: {
              result: fail.reason,
              reason: fail.reason,
              message: fail.message,
              basis: fail.basis ?? null,
              outlet: fail.outlet,
            },
          };
    return this.uow.run(async () =>
      rejected(outcome, {
        action,
        outcome: 'failed',
        reason,
        ...this.parties(prepared, prepared.view.id, opcode),
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

  private parties(prepared: Prepared, caseId: string, opcode: string) {
    return {
      actorId: prepared.actorId,
      actorCode: prepared.actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId: prepared.view.handlingOrgId,
      sourceIp: null,
      opcode,
      resourceType: 'case' as const,
      resourceId: caseId,
    };
  }

  private blockBody(reason: string, message: string, citation: string | null, outlet: string): CaseCloseoutHttpOutcome {
    return { status: 409, body: { result: reason, reason, message, basis: citation, outlet } };
  }
}

function currentInstanceCompleted(view: CaseView): boolean {
  const row = view.instances.find(
    (item) => item.stage === view.currentStage && item.entrySeq === view.stageEntrySeq,
  );
  return row?.status === 'completed';
}

function parseAny(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function presentDelivery(row: {
  readonly id: string;
  readonly kind: string;
  readonly documentKind: string | null;
  readonly deliveredOn: string;
  readonly deliverers: readonly string[];
  readonly reasonRecord: string | null;
  readonly announcementMaterials: readonly string[];
  readonly note: string | null;
  readonly decisionApprovalId: string | null;
  readonly recordedAt: Date;
}): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    kindName: DELIVERY_RECORD_KIND_NAMES[row.kind as keyof typeof DELIVERY_RECORD_KIND_NAMES] ?? row.kind,
    documentKind: row.documentKind,
    deliveredOn: row.deliveredOn,
    deliverers: [...row.deliverers],
    reasonRecord: row.reasonRecord,
    announcementMaterials: [...row.announcementMaterials],
    note: row.note,
    decisionApprovalId: row.decisionApprovalId,
    recordedAt: row.recordedAt.toISOString(),
  };
}

function presentExecution(row: {
  readonly id: string;
  readonly kind: string;
  readonly note: string | null;
  readonly attachments: readonly string[];
  readonly recordedAt: Date;
}): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    kindName: EXECUTION_RECORD_KIND_NAMES[row.kind as keyof typeof EXECUTION_RECORD_KIND_NAMES] ?? row.kind,
    note: row.note,
    attachments: [...row.attachments],
    recordedAt: row.recordedAt.toISOString(),
  };
}
