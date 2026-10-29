// 调查环节与收尾（#236）。
// 呈批沿用 doc.draft / doc.submit / doc.admin.review / doc.approve，不新增操作码。
// T03–T07 只在本服务的批准事务里落库。通用迁移入口拒绝直接套用。
// 停表类别与追诉时效出口映射都读注入参数，调用处不写死。

import { Inject, Injectable } from '@nestjs/common';
import {
  rejected,
  type CaseInvestigationAction,
  type CaseInvestigationFailedReason,
  CASE_INVESTIGATION_FAILED_REASONS,
} from '@natural-enforcement/audit';
import {
  CASE_STORE,
  CASE_SUPERVISION_ROLE,
  CLUE_STORE,
  EXTEND_DEADLINE_PROMPT,
  INQUIRY_OFFICER_CITATION,
  PARTY_NOTICE_PROMPT,
  PROCEDURE_TRANSITION,
  X03_WARN_MESSAGE,
  applyWarningGate,
  canTakeFilingStep,
  checkInquiryOfficers,
  checkLimitationDiscoveryExit,
  checkProcedureContent,
  checkProcedureState,
  checkVoidViolation,
  classifyIllegal,
  decideTransition,
  readActiveCaseMarkers,
  filingStatusAfter,
  findIllegal,
  inquiryOfficerBlock,
  isRecognitionMode,
  isTerminalCaseStatus,
  parseCalendarDay,
  suspensionClockEvent,
  type CaseStore,
  type CaseView,
  type ClueStore,
  type FilingAdminReview,
  type LimitationDiscoveryExit,
  type ProcedureContent,
  type RuleConfirmation,
  type SuspensionClockParameter,
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
import { appendRuleConfirmation, ruleKeyBody, warningBody } from './case-rule-confirmation.ts';
import { persistTransitionEffects } from './case-transition-write.ts';
import { CLOCK, type Clock } from './clock.ts';
import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

/** 停表、续表的类别参数。默认值在 case 包，测试可覆写。 */
export const SUSPENSION_CLOCK = Symbol('SUSPENSION_CLOCK');

/** 追诉时效发现时点到出口的映射。默认是带版本号的常量。 */
export const LIMITATION_DISCOVERY_EXIT = Symbol('LIMITATION_DISCOVERY_EXIT');

const READ_OPCODE = 'case.read';
const DRAFT_OPCODE = 'doc.draft';
const SUBMIT_OPCODE = 'doc.submit';
const REVIEW_OPCODE = 'doc.admin.review';
const APPROVE_OPCODE = 'doc.approve';

const FAIL_REASONS = new Set<string>(CASE_INVESTIGATION_FAILED_REASONS);

export type InvestigationHttpOutcome =
  | { readonly status: 200; readonly body: Record<string, unknown> }
  | { readonly status: 400; readonly body: Record<string, unknown> }
  | { readonly status: 403; readonly body: { readonly reason: string } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | { readonly status: 409; readonly body: Record<string, unknown> };

interface Prepared {
  readonly actorId: string;
  readonly actorCode: string | null;
  readonly roles: readonly string[];
  readonly view: CaseView;
}

@Injectable()
export class InvestigationService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILING_ADMIN_REVIEW) private readonly adminReview: FilingAdminReview,
    @Inject(SUSPENSION_CLOCK) private readonly clockParameter: SuspensionClockParameter,
    @Inject(LIMITATION_DISCOVERY_EXIT) private readonly limitationExit: LimitationDiscoveryExit,
    private readonly access: AccessControlService,
  ) {}

  async read(actor: ActorRef, caseId: string): Promise<InvestigationHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const denied = await this.authorize(actor, READ_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };
    const [violations, inquiries, openProcedure, notices, deadlineEvents] = await Promise.all([
      this.cases.listViolationRecords(caseId),
      this.cases.listInquiryRecords(caseId),
      this.cases.readOpenProcedure(caseId),
      this.cases.listPartyNotices(caseId),
      this.cases.listDeadlineEvents(caseId),
    ]);
    const investigating = view.status === 'in_progress' && view.currentStage === 'E02';
    const pending = view.status === 'terminated_pending';
    return {
      status: 200,
      body: {
        id: view.id,
        status: view.status,
        currentStage: view.currentStage,
        suspended: view.suspended,
        prompts: {
          extendDeadline: EXTEND_DEADLINE_PROMPT,
          partyNotice: PARTY_NOTICE_PROMPT,
        },
        entries: {
          inquiry: investigating,
          violation: investigating,
          suspend: investigating && !view.suspended,
          resume: investigating && view.suspended,
          terminate: investigating,
          withdraw: pending,
          close: pending,
        },
        violations: violations.map((row) => ({
          id: row.id,
          behaviorDescription: row.behaviorDescription,
          parties: [...row.parties],
          startedOn: dayText(row.startedOn),
          endedOn: dayText(row.endedOn),
          recognition: row.recognition,
          status: row.status,
          statusName: row.status === 'voided' ? '作废' : '有效',
          voidReason: row.voidReason,
        })),
        inquiries: inquiries.map((row) => ({
          id: row.id,
          occurredAt: row.occurredAt.toISOString(),
          place: row.place,
          interviewee: row.interviewee,
          officerIds: [...row.officerIds],
          attachmentName: row.attachmentName,
        })),
        openProcedure: openProcedure
          ? {
              id: openProcedure.id,
              kind: openProcedure.kind,
              status: openProcedure.status,
              versionNo: openProcedure.currentVersionNo,
              content: parseJson(openProcedure.contentJson),
            }
          : null,
        notices: notices.map((row) => ({
          id: row.id,
          occasion: row.occasion,
          note: row.note,
          recordedAt: row.recordedAt.toISOString(),
        })),
        deadlineEvents: deadlineEvents.map((row) => ({
          id: row.id,
          eventKind: row.eventKind,
          basisLabel: row.basisLabel,
          basisNote: row.basisNote,
          stage: row.stage,
          entrySeq: row.entrySeq,
          transitionCode: row.transitionCode,
          createdAt: row.createdAt.toISOString(),
        })),
      },
    };
  }

  async saveViolation(
    actor: ActorRef,
    caseId: string,
    input: {
      readonly behaviorDescription?: unknown;
      readonly parties?: unknown;
      readonly startedOn?: unknown;
      readonly endedOn?: unknown;
      readonly recognition?: unknown;
    },
  ): Promise<InvestigationHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.violation-recorded', true);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.violation-recorded', DRAFT_OPCODE);
    if (terminal) return terminal;
    const stageHit = await this.requireInvestigation(prepared, 'case.violation-recorded', DRAFT_OPCODE);
    if (stageHit) return stageHit;
    const description = text(input.behaviorDescription);
    const parties = stringList(input.parties);
    const startedOn = parseCalendarDay(input.startedOn);
    const endedOn = parseCalendarDay(input.endedOn);
    const recognition = typeof input.recognition === 'string' ? input.recognition : '';
    if (description === '' || !parties || !startedOn || !endedOn || startedOn > endedOn || !isRecognitionMode(recognition)) {
      return this.fail(prepared, 'case.violation-recorded', DRAFT_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-reason',
        message: '违法记录字段不合规',
        outlet: '补齐行为描述、当事人、起止日和认定方式',
      });
    }
    const id = newUlid();
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      await tx.cases.insertViolationRecord({
        id,
        caseId,
        behaviorDescription: description,
        parties,
        startedOn: utcDay(startedOn),
        endedOn: utcDay(endedOn),
        recognition,
        createdBy: actor.personnelId,
        createdAt: at,
      });
      await tx.audit.append({
        action: 'case.violation-recorded',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({ caseId, recordId: id, recognition }),
      });
      return { status: 200 as const, body: { result: 'violation-recorded', id, caseId, status: 'active' } };
    });
  }

  async voidViolation(
    actor: ActorRef,
    caseId: string,
    recordId: string,
    input: { readonly reason: unknown },
  ): Promise<InvestigationHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.violation-voided', false);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.violation-voided', DRAFT_OPCODE);
    if (terminal) return terminal;
    const checked = checkVoidViolation({
      stage: prepared.view.currentStage,
      reason: text(input.reason),
      isMainHandler: prepared.view.handlers.some((row) => row.personnelId === actor.personnelId && row.role === 'main'),
    });
    if (!checked.ok) {
      return this.fail(prepared, 'case.violation-voided', DRAFT_OPCODE, {
        httpStatus: checked.httpStatus,
        reason: checked.reason,
        message: checked.message,
        outlet: checked.outlet,
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const voided = await tx.cases.voidViolationRecord({
        id: recordId,
        caseId,
        reason: checked.reason,
        actorId: actor.personnelId,
        at,
      });
      if (!voided) {
        return rejected<InvestigationHttpOutcome>(
          { status: 409, body: { result: 'invalid-state', reason: 'invalid-state', message: '违法记录不能作废', basis: null, outlet: '只作废本案仍有效的记录' } },
          {
            action: 'case.violation-voided',
            outcome: 'failed',
            reason: 'invalid-state',
            ...this.parties(prepared, caseId, DRAFT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.violation-voided',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({ caseId, recordId, status: 'voided' }),
      });
      return { status: 200 as const, body: { result: 'violation-voided', id: recordId, caseId, status: 'voided' } };
    });
  }

  async saveInquiry(
    actor: ActorRef,
    caseId: string,
    input: {
      readonly occurredAt?: unknown;
      readonly place?: unknown;
      readonly interviewee?: unknown;
      readonly officerIds?: unknown;
      readonly attachmentName?: unknown;
    },
  ): Promise<InvestigationHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.inquiry-recorded', true);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.inquiry-recorded', DRAFT_OPCODE);
    if (terminal) return terminal;
    const stageHit = await this.requireInvestigation(prepared, 'case.inquiry-recorded', DRAFT_OPCODE);
    if (stageHit) return stageHit;
    const place = text(input.place);
    const interviewee = text(input.interviewee);
    const attachmentName = text(input.attachmentName);
    const occurredAt = typeof input.occurredAt === 'string' ? new Date(input.occurredAt) : null;
    const officerIds = stringList(input.officerIds);
    if (place === '' || interviewee === '' || attachmentName === '' || !occurredAt || Number.isNaN(occurredAt.getTime()) || !officerIds) {
      return this.fail(prepared, 'case.inquiry-recorded', DRAFT_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-reason',
        message: '笔录字段不合规',
        outlet: '补齐时间、地点、被询问人、在场人员和附件名',
      });
    }
    const officers = checkInquiryOfficers(officerIds, prepared.view.handlers.map((row) => row.personnelId));
    if (!officers.ok) {
      const block = inquiryOfficerBlock();
      return this.fail(prepared, 'case.inquiry-recorded', DRAFT_OPCODE, {
        httpStatus: 409,
        reason: 'X20',
        message: block.message,
        outlet: block.outlet,
        basis: INQUIRY_OFFICER_CITATION,
      });
    }
    const id = newUlid();
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      await tx.cases.insertInquiryRecord({
        id,
        caseId,
        occurredAt,
        place,
        interviewee,
        officerIds: officers.officerIds,
        attachmentName,
        createdBy: actor.personnelId,
        createdAt: at,
      });
      await tx.audit.append({
        action: 'case.inquiry-recorded',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({ caseId, recordId: id, officerCount: officers.officerIds.length }),
      });
      return { status: 200 as const, body: { result: 'inquiry-recorded', id, caseId } };
    });
  }

  async saveNotice(
    actor: ActorRef,
    caseId: string,
    input: { readonly occasion?: unknown; readonly note?: unknown },
  ): Promise<InvestigationHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.party-notice-recorded', true);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.party-notice-recorded', DRAFT_OPCODE);
    if (terminal) return terminal;
    const stageHit = await this.requireInvestigation(prepared, 'case.party-notice-recorded', DRAFT_OPCODE);
    if (stageHit) return stageHit;
    const occasion = input.occasion === 'suspend' || input.occasion === 'resume' ? input.occasion : '';
    const note = text(input.note);
    if (occasion === '' || note === '') {
      return this.fail(prepared, 'case.party-notice-recorded', DRAFT_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-reason',
        message: '告知记录字段不合规',
        outlet: '选择中止或恢复，并填写告知说明',
      });
    }
    const id = newUlid();
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      await tx.cases.insertPartyNotice({
        id,
        caseId,
        occasion,
        note,
        recordedBy: actor.personnelId,
        recordedAt: at,
      });
      await tx.audit.append({
        action: 'case.party-notice-recorded',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({ caseId, noticeId: id, occasion }),
      });
      return { status: 200 as const, body: { result: 'party-notice-recorded', id, caseId, occasion } };
    });
  }

  async saveDraft(
    actor: ActorRef,
    caseId: string,
    input: {
      readonly kind?: unknown;
      readonly reason?: unknown;
      readonly extendTogether?: unknown;
      readonly confirmedRuleKeys?: readonly string[];
      readonly confirmReasons?: Readonly<Record<string, string>>;
    },
  ): Promise<InvestigationHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.procedure-drafted', true);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.procedure-drafted', DRAFT_OPCODE);
    if (terminal) return terminal;
    const checked = await this.checkDraft(prepared, input);
    if ('status' in checked) return checked;
    const open = await this.cases.readOpenProcedure(caseId);
    if (open && open.status !== 'drafting') {
      return this.fail(prepared, 'case.procedure-drafted', DRAFT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '已有在途呈批',
        outlet: '先办结或退回当前呈批',
      });
    }
    if (open && open.drafterId !== actor.personnelId) return { status: 403, body: { reason: 'permission-denied' } };
    const approvalId = open?.id ?? newUlid();
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const saved = await tx.cases.saveProcedureDraft({
        approvalId,
        caseId,
        kind: checked.content.kind,
        drafterId: actor.personnelId,
        isNew: open === null,
        expectedVersionNo: open?.currentVersionNo ?? 0,
        versionId: newUlid(),
        contentJson: JSON.stringify(checked.content),
        at,
      });
      if (!saved) {
        return rejected<InvestigationHttpOutcome>(
          blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.procedure-drafted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, DRAFT_OPCODE),
          },
        );
      }
      const parties = this.parties(prepared, caseId, DRAFT_OPCODE);
      await tx.audit.append({
        action: 'case.procedure-drafted',
        ...parties,
        detail: JSON.stringify({ caseId, approvalId, kind: checked.content.kind }),
      });
      if (checked.confirmation) {
        await appendRuleConfirmation(tx.audit, {
          parties,
          confirmation: checked.confirmation,
          at,
          step: `procedure-draft:${checked.content.kind}`,
          confirmReasons: input.confirmReasons,
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'procedure-drafted',
          approvalId,
          caseId,
          kind: checked.content.kind,
          status: 'drafting',
          prompt: checked.content.kind === 'suspend' ? EXTEND_DEADLINE_PROMPT : null,
        },
      };
    });
  }

  async submit(
    actor: ActorRef,
    approvalId: string,
    input: {
      readonly confirmedRuleKeys?: readonly string[];
      readonly confirmReasons?: Readonly<Record<string, string>>;
    } = {},
  ): Promise<InvestigationHttpOutcome> {
    const loaded = await this.loadProcedure(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.approval.caseId, SUBMIT_OPCODE, 'case.procedure-submitted', true);
    if ('status' in prepared) return prepared;
    if (loaded.approval.drafterId !== actor.personnelId) return { status: 403, body: { reason: 'permission-denied' } };
    if (!canTakeFilingStep('submit', loaded.approval.status)) {
      return this.fail(prepared, 'case.procedure-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '呈批不在拟制中',
        outlet: '先保存呈批稿',
      });
    }
    const content = this.parseStored(loaded.approval.contentJson);
    if (!content) {
      return this.fail(prepared, 'case.procedure-submitted', SUBMIT_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-reason',
        message: '呈批正文不合规',
        outlet: '重新保存呈批稿',
      });
    }
    const guarded = await this.guardContent(prepared, content, 'case.procedure-submitted', SUBMIT_OPCODE, input);
    if ('status' in guarded) return guarded;
    const other = await this.cases.countInFlightApprovals(loaded.approval.caseId);
    const decision = decideTransition({
      operation: { kind: 'open-approval-chain', chainKind: content.kind },
      subject: await this.subjectOf(prepared.view, prepared.roles, other),
      confirmedRuleKeys: input.confirmedRuleKeys,
      confirmReasons: input.confirmReasons,
    });
    if (!decision.ok) {
      if (decision.httpStatus === 400) return { status: 400, body: ruleKeyBody(decision) };
      if (decision.httpStatus === 200) {
        return this.holdWarning(prepared, 'case.procedure-submitted', SUBMIT_OPCODE, decision);
      }
      return this.fail(prepared, 'case.procedure-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: decision.reason,
        message: decision.message,
        outlet: 'outlet' in decision ? decision.outlet : '该呈批不能提交',
        basis: decision.citation,
      });
    }
    const confirmation = decision.confirmation ?? guarded.confirmation;
    const nextStatus = filingStatusAfter('submit', this.adminReview);
    const at = this.clock.now();
    const chainId = newUlid();
    return this.uow.run(async (tx) => {
      const opened = await tx.cases.openApprovalChain({
        id: chainId,
        caseId: loaded.approval.caseId,
        kind: content.kind,
        openedBy: actor.personnelId,
        openedAt: at,
      });
      if (!opened) {
        return rejected<InvestigationHttpOutcome>(
          blockBody('X18', '本案已有进行中的审批链', '同一案件同时只有一条进行中的审批链', '先办结或退回当前呈批'),
          {
            action: 'case.procedure-submitted',
            outcome: 'failed',
            reason: 'X18',
            ...this.parties(prepared, loaded.approval.caseId, SUBMIT_OPCODE),
          },
        );
      }
      const stepped = await tx.cases.applyProcedureStep({
        approvalId,
        expectedStatus: loaded.approval.status,
        nextStatus,
        adminReview: this.adminReview,
        approvalChainId: chainId,
        stepId: newUlid(),
        step: 'submit',
        versionNo: loaded.approval.currentVersionNo,
        actorId: actor.personnelId,
        opinion: null,
        at,
      });
      if (!stepped) {
        return rejected<InvestigationHttpOutcome>(
          blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.procedure-submitted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.approval.caseId, SUBMIT_OPCODE),
          },
        );
      }
      const parties = this.parties(prepared, loaded.approval.caseId, SUBMIT_OPCODE);
      await tx.audit.append({
        action: 'case.procedure-submitted',
        ...parties,
        detail: JSON.stringify({ caseId: loaded.approval.caseId, approvalId, kind: content.kind, chainId }),
      });
      if (confirmation) {
        await appendRuleConfirmation(tx.audit, {
          parties,
          confirmation,
          at,
          step: `procedure-submit:${content.kind}`,
          confirmReasons: input.confirmReasons,
        });
      }
      return {
        status: 200 as const,
        body: { result: 'procedure-submitted', approvalId, caseId: loaded.approval.caseId, status: nextStatus },
      };
    });
  }

  async review(actor: ActorRef, approvalId: string, input: { readonly opinion: string | null }): Promise<InvestigationHttpOutcome> {
    return this.stepWithoutTransition(actor, approvalId, 'review', REVIEW_OPCODE, 'case.procedure-reviewed', input.opinion);
  }

  async returnToDraft(
    actor: ActorRef,
    approvalId: string,
    input: { readonly opinion: string | null },
  ): Promise<InvestigationHttpOutcome> {
    const loaded = await this.loadProcedure(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const opcode = loaded.approval.status === 'pending_review' ? REVIEW_OPCODE : APPROVE_OPCODE;
    const prepared = await this.prepare(actor, loaded.approval.caseId, opcode, 'case.procedure-returned', false);
    if ('status' in prepared) return prepared;
    if (!canTakeFilingStep('return', loaded.approval.status)) {
      return this.fail(prepared, 'case.procedure-returned', opcode, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前状态不能退回',
        outlet: '呈批须在待审核或待审批',
      });
    }
    const opinion = input.opinion?.trim() ?? '';
    if (opinion === '') {
      return this.fail(prepared, 'case.procedure-returned', opcode, {
        httpStatus: 400,
        reason: 'missing-return-reason',
        message: '退回理由必填',
        outlet: '填写退回理由',
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      if (loaded.approval.approvalChainId) {
        const closed = await tx.cases.closeApprovalChain(loaded.approval.approvalChainId);
        if (!closed) {
          return rejected<InvestigationHttpOutcome>(
            blockBody('concurrent-change', '审批链已被他人办结', null, '请重新读取后再试'),
            {
              action: 'case.procedure-returned',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, loaded.approval.caseId, opcode),
            },
          );
        }
      }
      const stepped = await tx.cases.applyProcedureStep({
        approvalId,
        expectedStatus: loaded.approval.status,
        nextStatus: 'drafting',
        approvalChainId: null,
        stepId: newUlid(),
        step: 'return',
        versionNo: loaded.approval.currentVersionNo,
        actorId: actor.personnelId,
        opinion,
        at,
      });
      if (!stepped) {
        return rejected<InvestigationHttpOutcome>(
          blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.procedure-returned',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.approval.caseId, opcode),
          },
        );
      }
      await tx.audit.append({
        action: 'case.procedure-returned',
        ...this.parties(prepared, loaded.approval.caseId, opcode),
        detail: JSON.stringify({ caseId: loaded.approval.caseId, approvalId }),
      });
      return {
        status: 200 as const,
        body: { result: 'procedure-returned', approvalId, caseId: loaded.approval.caseId, status: 'drafting' },
      };
    });
  }

  async approve(
    actor: ActorRef,
    approvalId: string,
    input: {
      readonly opinion: string | null;
      readonly confirmedRuleKeys?: readonly string[];
      readonly confirmReasons?: Readonly<Record<string, string>>;
    },
  ): Promise<InvestigationHttpOutcome> {
    const loaded = await this.loadProcedure(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.approval.caseId, APPROVE_OPCODE, 'case.procedure-approved', false);
    if ('status' in prepared) return prepared;
    if (!canTakeFilingStep('approve', loaded.approval.status)) {
      return this.fail(prepared, 'case.procedure-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '呈批不在待审批',
        outlet: '先完成前面的审批步骤',
      });
    }
    const content = this.parseStored(loaded.approval.contentJson);
    if (!content) {
      return this.fail(prepared, 'case.procedure-approved', APPROVE_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-reason',
        message: '呈批正文不合规',
        outlet: '退回后重新保存',
      });
    }
    const guarded = await this.guardContent(prepared, content, 'case.procedure-approved', APPROVE_OPCODE, input);
    if ('status' in guarded) return guarded;
    const other = Math.max(0, (await this.cases.countInFlightApprovals(loaded.approval.caseId)) - (loaded.approval.approvalChainId ? 1 : 0));
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: PROCEDURE_TRANSITION[content.kind] },
      subject: await this.subjectOf(prepared.view, prepared.roles, other),
      confirmedRuleKeys: input.confirmedRuleKeys,
      confirmReasons: input.confirmReasons,
    });
    if (!decision.ok) {
      if (decision.httpStatus === 400) return { status: 400, body: ruleKeyBody(decision) };
      if (decision.httpStatus === 200) {
        return this.holdWarning(prepared, 'case.procedure-approved', APPROVE_OPCODE, decision);
      }
      return this.fail(prepared, 'case.procedure-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: decision.reason,
        message: decision.message,
        outlet: 'outlet' in decision ? decision.outlet : '该呈批不能批准',
        basis: decision.citation,
      });
    }
    const confirmation = decision.confirmation ?? guarded.confirmation;
    const effects = decision.effects;
    if (effects.kind !== 'advance' || !effects.currentStage || !effects.mainStatus || effects.stageEntrySeq === null || !effects.transitionCode) {
      return this.fail(prepared, 'case.procedure-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '该呈批没有可执行的去向',
        outlet: '请按当前环节选择呈批',
      });
    }
    const at = this.clock.now();
    const caseId = loaded.approval.caseId;
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyProcedureStep({
        approvalId,
        expectedStatus: loaded.approval.status,
        nextStatus: 'approved',
        stepId: newUlid(),
        step: 'approve',
        versionNo: loaded.approval.currentVersionNo,
        actorId: actor.personnelId,
        opinion: input.opinion,
        at,
      });
      if (!stepped) {
        return rejected<InvestigationHttpOutcome>(
          blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.procedure-approved',
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
          suspended: prepared.view.suspended,
        }),
        toJson: JSON.stringify({
          stage: effects.currentStage,
          status: effects.mainStatus,
          stageEntrySeq: effects.stageEntrySeq,
          suspended: effects.suspended,
        }),
        newId: () => newUlid(),
      });
      if (!wrote) {
        return rejected<InvestigationHttpOutcome>(
          blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.procedure-approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, APPROVE_OPCODE),
          },
        );
      }
      const moved = await tx.cases.advanceCasePointer({
        caseId,
        expectedStage: prepared.view.currentStage,
        expectedSeq: prepared.view.stageEntrySeq,
        stage: effects.currentStage as string,
        stageEntrySeq: effects.stageEntrySeq as number,
        status: effects.mainStatus as string,
        suspended: effects.suspended ?? false,
      });
      if (!moved) {
        return rejected<InvestigationHttpOutcome>(
          blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.procedure-approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, APPROVE_OPCODE),
          },
        );
      }
      if (loaded.approval.approvalChainId) {
        const closed = await tx.cases.closeApprovalChain(loaded.approval.approvalChainId);
        if (!closed) {
          return rejected<InvestigationHttpOutcome>(
            blockBody('concurrent-change', '审批链已被他人办结', null, '请重新读取后再试'),
            {
              action: 'case.procedure-approved',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, caseId, APPROVE_OPCODE),
            },
          );
        }
      }
      if (effects.transitionCode === 'T03' || effects.transitionCode === 'T04') {
        const draft = suspensionClockEvent(this.clockParameter, {
          eventKind: effects.transitionCode === 'T03' ? 'stop' : 'continue',
          stage: prepared.view.currentStage,
          entrySeq: prepared.view.stageEntrySeq,
          transitionCode: effects.transitionCode,
        });
        await tx.cases.insertDeadlineEvent({
          id: newUlid(),
          caseId,
          eventKind: draft.eventKind,
          basisLabel: draft.basisLabel,
          basisNote: draft.basisNote,
          stage: draft.stage,
          entrySeq: draft.entrySeq,
          transitionCode: draft.transitionCode,
          actorId: actor.personnelId,
          createdAt: at,
        });
      }
      await tx.audit.append({
        action: 'case.procedure-approved',
        ...this.parties(prepared, caseId, APPROVE_OPCODE),
        detail: JSON.stringify({ caseId, approvalId, kind: content.kind, transitionId: effects.transitionCode }),
      });
      const transitionParties = this.parties(prepared, caseId, APPROVE_OPCODE);
      await tx.audit.append({
        action: 'case.transitioned',
        ...transitionParties,
        detail: JSON.stringify({ caseId, transitionId: effects.transitionCode, approvalId }),
      });
      if (confirmation) {
        await appendRuleConfirmation(tx.audit, {
          parties: transitionParties,
          confirmation,
          at,
          step: `procedure-approve:${effects.transitionCode}`,
          confirmReasons: input.confirmReasons,
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'procedure-approved',
          approvalId,
          caseId,
          kind: content.kind,
          status: effects.mainStatus,
          suspended: effects.suspended ?? false,
          transitionId: effects.transitionCode,
        },
      };
    });
  }

  private async stepWithoutTransition(
    actor: ActorRef,
    approvalId: string,
    step: 'review',
    opcode: string,
    action: CaseInvestigationAction,
    opinion: string | null,
  ): Promise<InvestigationHttpOutcome> {
    const loaded = await this.loadProcedure(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.approval.caseId, opcode, action, false);
    if ('status' in prepared) return prepared;
    if (!canTakeFilingStep(step, loaded.approval.status)) {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前状态不能审核',
        outlet: '呈批须在待审核',
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyProcedureStep({
        approvalId,
        expectedStatus: loaded.approval.status,
        nextStatus: filingStatusAfter(step, this.adminReview),
        stepId: newUlid(),
        step,
        versionNo: loaded.approval.currentVersionNo,
        actorId: actor.personnelId,
        opinion,
        at,
      });
      if (!stepped) {
        return rejected<InvestigationHttpOutcome>(
          blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action,
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.approval.caseId, opcode),
          },
        );
      }
      await tx.audit.append({
        action,
        ...this.parties(prepared, loaded.approval.caseId, opcode),
        detail: JSON.stringify({ caseId: loaded.approval.caseId, approvalId }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'procedure-reviewed',
          approvalId,
          caseId: loaded.approval.caseId,
          status: filingStatusAfter(step, this.adminReview),
        },
      };
    });
  }

  private async checkDraft(
    prepared: Prepared,
    input: {
      readonly kind?: unknown;
      readonly reason?: unknown;
      readonly extendTogether?: unknown;
      readonly confirmedRuleKeys?: readonly string[];
      readonly confirmReasons?: Readonly<Record<string, string>>;
    },
  ): Promise<
    | { readonly content: ProcedureContent; readonly confirmation: RuleConfirmation | null }
    | InvestigationHttpOutcome
  > {
    const checked = checkProcedureContent({
      kind: typeof input.kind === 'string' ? input.kind : '',
      reason: input.reason,
      extendTogether: input.extendTogether,
    });
    if (!checked.ok) {
      return this.fail(prepared, 'case.procedure-drafted', DRAFT_OPCODE, {
        httpStatus: checked.hit.httpStatus,
        reason: checked.hit.reason,
        message: checked.hit.message,
        outlet: 'outlet' in checked.hit ? checked.hit.outlet : '按枚举重选',
      });
    }
    const guarded = await this.guardContent(prepared, checked.content, 'case.procedure-drafted', DRAFT_OPCODE, input);
    if ('status' in guarded) return guarded;
    return { content: checked.content, confirmation: guarded.confirmation };
  }

  private async guardContent(
    prepared: Prepared,
    content: ProcedureContent,
    action: CaseInvestigationAction,
    opcode: string,
    input: {
      readonly confirmedRuleKeys?: readonly string[];
      readonly confirmReasons?: Readonly<Record<string, string>>;
    } = {},
  ): Promise<InvestigationHttpOutcome | { readonly confirmation: RuleConfirmation | null }> {
    const limited = checkLimitationDiscoveryExit({
      stage: prepared.view.currentStage,
      kind: content.kind,
      reason: reasonOf(content),
      rule: this.limitationExit,
    });
    if (!limited.ok) {
      return this.fail(prepared, action, opcode, {
        httpStatus: limited.hit.httpStatus,
        reason: limited.hit.reason,
        message: limited.hit.message,
        outlet: limited.hit.outlet,
        outcomeCode: 'outcomeCode' in limited.hit ? limited.hit.outcomeCode : undefined,
        transitionId: 'transitionId' in limited.hit ? limited.hit.transitionId : undefined,
        applyInThisTicket: 'applyInThisTicket' in limited.hit ? limited.hit.applyInThisTicket : undefined,
      });
    }
    const state = checkProcedureState({
      kind: content.kind,
      mainStatus: prepared.view.status,
      stage: prepared.view.currentStage,
      suspended: prepared.view.suspended,
    });
    if (!state.ok) {
      if (state.hit.reason === 'X03') {
        const classified = classifyIllegal('X03', X03_WARN_MESSAGE);
        if (!classified.ok && classified.httpStatus === 200) {
          const gate = applyWarningGate({
            notes: classified.advisories,
            confirmedRuleKeys: input.confirmedRuleKeys,
            confirmReasons: input.confirmReasons,
          });
          if (gate.kind === 'reject') return { status: 400, body: ruleKeyBody(gate.decision) };
          if (gate.kind === 'hold') return this.holdWarning(prepared, action, opcode, gate.decision);
          return { confirmation: gate.confirmation };
        }
      }
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: state.hit.reason,
        message: state.hit.message,
        outlet: state.hit.outlet,
        basis: 'citation' in state.hit ? state.hit.citation : null,
      });
    }
    const idle = applyWarningGate({
      notes: [],
      confirmedRuleKeys: input.confirmedRuleKeys,
      confirmReasons: input.confirmReasons,
    });
    if (idle.kind === 'reject') return { status: 400, body: ruleKeyBody(idle.decision) };
    return { confirmation: null };
  }

  private holdWarning(
    prepared: Prepared,
    action: CaseInvestigationAction,
    opcode: string,
    decision: Extract<TransitionDecision, { httpStatus: 200 }>,
  ): Promise<InvestigationHttpOutcome> {
    const reason = (FAIL_REASONS.has(decision.reason) ? decision.reason : 'invalid-state') as CaseInvestigationFailedReason;
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

  private async requireInvestigation(
    prepared: Prepared,
    action: CaseInvestigationAction,
    opcode: string,
  ): Promise<InvestigationHttpOutcome | null> {
    if (prepared.view.status === 'in_progress' && prepared.view.currentStage === 'E02') return null;
    if (prepared.view.status === 'terminated_pending') {
      const row = findIllegal('X03');
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: 'X03',
        message: '待收尾状态下只能撤案或结案',
        outlet: row?.outlet ?? '只可走撤案呈批或结案呈批',
        basis: row?.citation ?? null,
      });
    }
    return this.fail(prepared, action, opcode, {
      httpStatus: 409,
      reason: 'invalid-state',
      message: '当前环节不能登记',
      outlet: '请在调查环节登记',
    });
  }

  private async terminalHit(
    prepared: Prepared,
    action: CaseInvestigationAction,
    opcode: string,
  ): Promise<InvestigationHttpOutcome | null> {
    if (!isTerminalCaseStatus(prepared.view.status)) return null;
    const row = findIllegal('X12');
    return this.fail(prepared, action, opcode, {
      httpStatus: 409,
      reason: 'X12',
      message: '案件已终态，该业务写操作不能继续',
      outlet: row?.outlet ?? '终态后仅可阅读、导出',
      basis: row?.citation ?? null,
    });
  }

  private async prepare(
    actor: ActorRef,
    caseId: string,
    opcode: string,
    action: CaseInvestigationAction,
    mustBeHandler: boolean,
  ): Promise<Prepared | InvestigationHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const actorCode = account?.code ?? null;
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    const denied = await this.authorize(actor, opcode, view.handlingOrgId, caseId);
    const prepared = { actorId: actor.personnelId, actorCode, roles, view };
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
    if (mustBeHandler && !view.handlers.some((row) => row.personnelId === actor.personnelId)) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    return prepared;
  }

  private async loadProcedure(approvalId: string) {
    const approval = await this.cases.readProcedure(approvalId);
    if (!approval) return null;
    return { approval };
  }

  private parseStored(contentJson: string | null): ProcedureContent | null {
    if (!contentJson) return null;
    try {
      const parsed = JSON.parse(contentJson) as { kind?: unknown; reason?: unknown; extendTogether?: unknown };
      const checked = checkProcedureContent({
        kind: typeof parsed.kind === 'string' ? parsed.kind : '',
        reason: parsed.reason,
        extendTogether: parsed.extendTogether,
      });
      return checked.ok ? checked.content : null;
    } catch {
      return null;
    }
  }

  private async subjectOf(view: CaseView, roles: readonly string[], otherInFlightChains: number): Promise<TransitionSubject> {
    const clueId = view.sourceClueIds[0];
    const clue = clueId ? await this.clues.readDispatchContext(clueId) : null;
    return {
      caseId: view.id,
      mainStatus: view.status,
      stage: view.currentStage,
      stageEntrySeq: view.stageEntrySeq,
      suspended: view.suspended,
      markers: await readActiveCaseMarkers(this.cases, view.id),
      clueStatus: clue?.status ?? null,
      handlingOrgId: view.handlingOrgId,
      proposedHandlingOrgId: null,
      actorRoles: [...roles],
      otherInFlightChains,
      instances: view.instances.map((row) => ({ stage: row.stage, entrySeq: row.entrySeq, status: row.status })),
    };
  }

  private fail(
    prepared: Prepared,
    action: CaseInvestigationAction,
    opcode: string,
    fail: {
      readonly httpStatus: 400 | 409;
      readonly reason: string;
      readonly message: string;
      readonly outlet: string;
      readonly basis?: string | null;
      readonly outcomeCode?: string;
      readonly transitionId?: string;
      readonly applyInThisTicket?: false;
    },
  ): Promise<InvestigationHttpOutcome> {
    const reason = (FAIL_REASONS.has(fail.reason) ? fail.reason : 'invalid-state') as CaseInvestigationFailedReason;
    const outcome: InvestigationHttpOutcome =
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
              ...(fail.outcomeCode === undefined
                ? {}
                : {
                    outcomeCode: fail.outcomeCode,
                    transitionId: fail.transitionId ?? '',
                    applyInThisTicket: fail.applyInThisTicket,
                  }),
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
}

function reasonOf(content: ProcedureContent): string | null {
  if (content.kind === 'terminate' || content.kind === 'withdraw' || content.kind === 'close') return content.reason;
  return null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return value.map((item) => item.trim()).filter((item) => item !== '');
}

function utcDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function dayText(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function blockBody(reason: string, message: string, citation: string | null, outlet: string): InvestigationHttpOutcome {
  return { status: 409, body: { result: reason, reason, message, basis: citation, outlet } };
}
