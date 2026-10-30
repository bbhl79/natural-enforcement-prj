// 案件阶段三类移送（#242）：呈批、记载、回证；外部决定与人工出口（T30）。
// 判定在 case 包的纯函数里，这里只喂事实、落库、写留痕。
// 管辖移送批准后写记载，不直送对方待分派池（无该代码路径）。
// 涉刑移送批准前须有通过的法审（criminal-transfer 必审项，未通过 409）。
// T30 分支由本服务解析出单一落点后再交引擎算效果（R-01），不改引擎分支机制。

import { Inject, Injectable } from '@nestjs/common';
import {
  rejected,
  CASE_TRANSFER_FAILED_REASONS,
  type CaseTransferAction,
  type CaseTransferFailedReason,
} from '@natural-enforcement/audit';
import {
  CASE_STORE,
  CASE_SUPERVISION_ROLE,
  CRIMINAL_DECISION_REVIEW_RULE_KEY,
  CRIMINAL_DECISION_SOURCE_NAMES,
  CRIMINAL_OUTLET_NAMES,
  CRIMINAL_TRANSFER_DECISION_RULE_KEY,
  TRANSFER_KIND_NAMES,
  assertCloseoutTransferGate,
  assertCriminalTransferReview,
  buildTransitionEffects,
  classifyIllegal,
  criminalOutletLanding,
  criminalTransferReviewPass,
  decideTransition,
  contentDigest,
  findTransition,
  isTerminalCaseStatus,
  readActiveCaseMarkers,
  readCriminalDecisionContent,
  readCriminalOutletContent,
  readTransferContent,
  receiptsCompleteOf,
  resolveTransferApprovalChain,
  transferStatusAfter,
  validateAttachmentSet,
  beijingDateOf,
  TRANSFER_CLOCK_BASIS,
  type CaseStore,
  type CaseView,
  type CriminalDecisionRow,
  type TransferApprovalChain,
  type TransferApprovalRow,
  type TransferContent,
  type TransferKind,
  type TransferRow,
  type TransitionDecision,
  type TransitionSubject,
} from '@natural-enforcement/case';
import {
  WORK_CALENDAR_V1,
  civilDate,
  mergeCalendars,
  planAnchor,
  type AnchorPlan,
  type WorkCalendar,
} from '@natural-enforcement/deadline';
import {
  AccessControlService,
  IDENTITY_STORE,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type DenyReason,
  type IdentityStore,
} from '@natural-enforcement/identity';
import { STORAGE_PORT, type StoragePort } from '@natural-enforcement/storage';

import { CLOCK, type Clock } from './clock.ts';
import { appendRuleConfirmation, ruleKeyBody, warningBody } from './case-rule-confirmation.ts';
import { persistTransitionEffects } from './case-transition-write.ts';
import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const DRAFT_OPCODE = 'doc.draft';
const SUBMIT_OPCODE = 'doc.submit';
const REVIEW_OPCODE = 'doc.admin.review';
const APPROVE_OPCODE = 'doc.approve';
const READ_OPCODE = 'case.read';

const FAIL_REASONS = new Set<string>(CASE_TRANSFER_FAILED_REASONS);

/** 三日期限提示文案。只提醒，不阻断。 */
const REVIEW_COUNTDOWN_MESSAGE = '自接到不予立案通知之日起三日，只提醒不阻断';

export interface TransferUploadedFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly content: Uint8Array;
}

export type CaseTransferHttpOutcome =
  | { readonly status: 200; readonly body: Record<string, unknown> }
  | { readonly status: 400; readonly body: Record<string, unknown> }
  | { readonly status: 403; readonly body: { readonly reason: DenyReason | string } }
  | { readonly status: 404; readonly body: { readonly result: 'not-found' } }
  | { readonly status: 409; readonly body: Record<string, unknown> };

interface Prepared {
  readonly actorId: string;
  readonly actorCode: string | null;
  readonly roles: readonly string[];
  readonly view: CaseView;
}

interface ConfirmationInput {
  readonly confirmedRuleKeys?: readonly string[];
  readonly confirmReasons?: Readonly<Record<string, string>>;
}

@Injectable()
export class CaseTransferService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly access: AccessControlService,
  ) {}

  /** 本案移送总览：记载、呈批、回证齐全、外部决定与出口。 */
  async read(actor: ActorRef, caseId: string): Promise<CaseTransferHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, READ_OPCODE, 'case.transfer-drafted', false);
    if ('status' in prepared) return prepared;
    const [transfers, files, approvals, decisions, outlets, legalReviews, deadlines] = await Promise.all([
      this.cases.listTransfers(caseId),
      this.cases.listTransferFiles(caseId),
      this.cases.listTransferApprovals(caseId),
      this.cases.listCriminalDecisions(caseId),
      this.cases.listCriminalOutlets(caseId),
      this.cases.listLegalReviews(caseId),
      this.cases.listDeadlineRows(caseId),
    ]);
    const receipts = files.filter((row) => row.kind === 'receipt' && row.transferId !== null);
    const today = beijingDateOf(this.clock.now());
    const calendar = mergeCalendars(WORK_CALENDAR_V1, await this.cases.listCalendarInstalls());
    return {
      status: 200,
      body: {
        caseId,
        chain: this.chainView(resolveTransferApprovalChain()),
        transfers: transfers.map((row) => {
          const receiptCount = receipts.filter((file) => file.transferId === row.id).length;
          return {
            ...this.transferView(row),
            receiptCount,
            receiptsComplete: receiptCount > 0,
          };
        }),
        receiptsComplete: receiptsCompleteOf(transfers, receipts),
        approvals: approvals.map((row) => ({
          id: row.id,
          caseId: row.caseId,
          kind: row.kind,
          kindName: TRANSFER_KIND_NAMES[row.kind as TransferKind] ?? row.kind,
          status: row.status,
          currentVersionNo: row.currentVersionNo,
          content: parseJson(row.contentJson),
          decisionDueOn: this.decisionDueOn(row, deadlines),
          attachments: files
            .filter((file) => file.kind === 'attachment' && file.approvalId === row.id)
            .map((file) => file.fileName),
        })),
        criminalTransferReviewPass: criminalTransferReviewPass(legalReviews),
        criminalDecisions: decisions.map((row) => this.decisionView(row, today, calendar)),
        outlets: outlets.map((row) => ({
          id: row.id,
          decisionId: row.decisionId,
          outlet: row.outlet,
          outletName: CRIMINAL_OUTLET_NAMES[row.outlet as keyof typeof CRIMINAL_OUTLET_NAMES] ?? row.outlet,
          status: row.status,
          content: parseJson(row.contentJson),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
      },
    };
  }

  /** 拟制移送呈批。附件 0..n 随呈批上传；发函日期缺省北京当日，可补录。 */
  async draft(
    actor: ActorRef,
    caseId: string,
    input: {
      readonly content: Record<string, unknown>;
      readonly attachments: readonly TransferUploadedFile[];
    },
  ): Promise<CaseTransferHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.transfer-drafted', true);
    if ('status' in prepared) return prepared;
    const terminal = this.terminalBlock(prepared, 'case.transfer-drafted', DRAFT_OPCODE);
    if (terminal) return terminal;
    const parsed = readTransferContent(input.content, beijingDateOf(this.clock.now()));
    if (!parsed.ok) return this.failContent(prepared, 'case.transfer-drafted', DRAFT_OPCODE, parsed.hit);
    const content = parsed.content;
    const files = input.attachments.map((file) => ({
      fileName: file.fileName,
      byteSize: file.byteSize,
      content: file.content,
    }));
    const attachmentCheck = validateAttachmentSet(files);
    if (!attachmentCheck.ok) {
      return this.fail(prepared, 'case.transfer-drafted', DRAFT_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-attachment',
        message: '附件校验未通过',
        outlet: '按附件要求重新上传',
      });
    }
    const approvalId = newUlid();
    const stored = await this.storeFiles(
      caseId,
      `case/${caseId}/transfer/${approvalId}`,
      input.attachments,
      'attachment',
    );
    const at = this.clock.now();
    const versionId = newUlid();
    const storedContent = {
      ...content,
      attachments: input.attachments.length > 0 ? input.attachments.map((file) => file.fileName) : content.attachments,
    };
    return this.uow.run(async (tx) => {
      const saved = await tx.cases.saveTransferDraft({
        approvalId,
        caseId,
        kind: content.kind,
        drafterId: actor.personnelId,
        isNew: true,
        expectedVersionNo: 0,
        versionId,
        contentJson: JSON.stringify(storedContent),
        at,
      });
      if (!saved) {
        return rejected<CaseTransferHttpOutcome>(
          this.blockBody('concurrent-change', '移送呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.transfer-drafted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, DRAFT_OPCODE),
          },
        );
      }
      for (const file of stored) {
        await tx.cases.insertTransferFile({
          id: file.id,
          caseId,
          approvalId,
          transferId: null,
          kind: 'attachment',
          fileKey: file.fileKey,
          versionId: file.versionId,
          fileName: file.fileName,
          contentType: file.contentType,
          byteSize: file.byteSize,
          digest: file.digest,
          uploadedBy: actor.personnelId,
          uploadedAt: at,
        });
      }
      await tx.audit.append({
        action: 'case.transfer-drafted',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({
          approvalId,
          kind: content.kind,
          receivingOrg: content.receivingOrg,
          documentNo: content.documentNo,
          letterDate: content.letterDate,
          attachments: content.attachments,
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'transfer-drafted',
          caseId,
          approvalId,
          kind: content.kind,
          kindName: TRANSFER_KIND_NAMES[content.kind],
          status: 'drafting',
          letterDate: content.letterDate,
          attachments: input.attachments.map((file) => file.fileName),
        },
      };
    });
  }

  /** 提交移送呈批。涉刑同时登记三个工作日提示（#246 规则键，日历归 #246）。 */
  async submit(actor: ActorRef, approvalId: string, input: ConfirmationInput = {}): Promise<CaseTransferHttpOutcome> {
    const loaded = await this.cases.readTransferApproval(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, SUBMIT_OPCODE, 'case.transfer-submitted', true);
    if ('status' in prepared) return prepared;
    if (loaded.drafterId !== actor.personnelId) return { status: 403, body: { reason: 'permission-denied' } };
    if (loaded.status !== 'drafting') {
      return this.fail(prepared, 'case.transfer-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '呈批不在拟制中',
        outlet: '先保存呈批稿',
      });
    }
    const content = this.storedContent(loaded);
    if (!content) {
      return this.fail(prepared, 'case.transfer-submitted', SUBMIT_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-content',
        message: '呈批正文不合规',
        outlet: '重新保存呈批稿',
      });
    }
    const chain = resolveTransferApprovalChain();
    // 附录 A「呈批前须法审通过」：涉刑移送在提交时先过法审闸口。
    if (content.kind === 'criminal') {
      const reviews = await this.cases.listLegalReviews(loaded.caseId);
      const gate = assertCriminalTransferReview({
        required: true,
        passedReviewId: criminalTransferReviewPass(reviews),
      });
      if (gate) {
        return this.fail(prepared, 'case.transfer-submitted', SUBMIT_OPCODE, {
          httpStatus: 409,
          reason: 'legal-review-required',
          message: gate.message,
          outlet: '先在审理或决定环节完成法制审核（勾选涉刑移送），通过后再提交',
          basis: gate.citation ?? null,
        });
      }
    }
    const other = await this.cases.countInFlightApprovals(loaded.caseId);
    const decision = decideTransition({
      operation: { kind: 'open-approval-chain', chainKind: 'transfer' },
      subject: await this.subjectOf(prepared.view, prepared.roles, other),
      confirmedRuleKeys: input.confirmedRuleKeys,
      confirmReasons: input.confirmReasons,
    });
    if (!decision.ok) return this.settle(prepared, 'case.transfer-submitted', SUBMIT_OPCODE, decision);
    const nextStatus = transferStatusAfter('submit', chain);
    if (!nextStatus) {
      return this.fail(prepared, 'case.transfer-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '呈批链路不合规',
        outlet: '按默认链路重新提交',
      });
    }
    const at = this.clock.now();
    const chainId = newUlid();
    const calendar = mergeCalendars(WORK_CALENDAR_V1, await this.cases.listCalendarInstalls());
    return this.uow.run(async (tx) => {
      const opened = await tx.cases.openApprovalChain({
        id: chainId,
        caseId: loaded.caseId,
        kind: 'transfer',
        openedBy: actor.personnelId,
        openedAt: at,
      });
      if (!opened) {
        return rejected<CaseTransferHttpOutcome>(
          this.blockBody('X18', '本案已有进行中的审批链', null, '先办结或撤回当前审批链'),
          {
            action: 'case.transfer-submitted',
            outcome: 'failed',
            reason: 'X18',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      const stepped = await tx.cases.applyTransferStep({
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
        return rejected<CaseTransferHttpOutcome>(
          this.blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.transfer-submitted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      let decisionDueOn: string | null = null;
      if (content.kind === 'criminal') {
        const planned = planAnchor({
          caseId: loaded.caseId,
          ruleKey: CRIMINAL_TRANSFER_DECISION_RULE_KEY,
          entrySeq: prepared.view.stageEntrySeq ?? 1,
          procedureNode: prepared.view.currentStage ?? 'E02',
          startingDocument: approvalId,
          startedOn: civilDate(at),
          exclusions: [],
          extensionDays: 0,
          paused: false,
          calendar,
        });
        if (planned.ok) {
          decisionDueOn = planned.plan.due.dueOn;
          // 同一进入次序号只留一行提示；重复登记不影响提交。
          await tx.cases.insertDeadlineRow(deadlineRowFromPlan(newUlid(), loaded.caseId, planned.plan));
        }
      }
      const parties = this.parties(prepared, loaded.caseId, SUBMIT_OPCODE);
      await tx.audit.append({
        action: 'case.transfer-submitted',
        ...parties,
        detail: JSON.stringify({ approvalId, kind: content.kind, chainId, decisionDueOn }),
      });
      if (decision.confirmation) {
        await appendRuleConfirmation(tx.audit, {
          parties,
          confirmation: decision.confirmation,
          at,
          step: 'transfer-submit',
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'transfer-submitted',
          approvalId,
          caseId: loaded.caseId,
          status: nextStatus,
          kind: content.kind,
          decisionDueOn,
        },
      };
    });
  }

  /** 承办机构负责人审核。批准前环节与主状态不变。 */
  async review(
    actor: ActorRef,
    approvalId: string,
    input: { readonly opinion: string | null },
  ): Promise<CaseTransferHttpOutcome> {
    const loaded = await this.cases.readTransferApproval(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, REVIEW_OPCODE, 'case.transfer-reviewed', false);
    if ('status' in prepared) return prepared;
    if (loaded.status !== 'pending_review') {
      return this.fail(prepared, 'case.transfer-reviewed', REVIEW_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '呈批不在待审核',
        outlet: '呈批须在待审核',
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyTransferStep({
        approvalId,
        expectedStatus: loaded.status,
        nextStatus: 'pending_approval',
        stepId: newUlid(),
        step: 'review',
        versionNo: loaded.currentVersionNo,
        actorId: actor.personnelId,
        opinion: input.opinion,
        at,
      });
      if (!stepped) {
        return rejected<CaseTransferHttpOutcome>(
          this.blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.transfer-reviewed',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, REVIEW_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.transfer-reviewed',
        ...this.parties(prepared, loaded.caseId, REVIEW_OPCODE),
        detail: JSON.stringify({ approvalId, kind: loaded.kind }),
      });
      return {
        status: 200 as const,
        body: { result: 'transfer-reviewed', approvalId, caseId: loaded.caseId, status: 'pending_approval' },
      };
    });
  }

  /** 部门负责人批准。批准后才写记载；管辖不直送对方池。 */
  async approve(
    actor: ActorRef,
    approvalId: string,
    input: ConfirmationInput & { readonly opinion: string | null },
  ): Promise<CaseTransferHttpOutcome> {
    const loaded = await this.cases.readTransferApproval(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, APPROVE_OPCODE, 'case.transfer-approved', false);
    if ('status' in prepared) return prepared;
    if (loaded.status !== 'pending_approval') {
      return this.fail(prepared, 'case.transfer-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '呈批不在待审批',
        outlet: '先完成审核',
      });
    }
    const content = this.storedContent(loaded);
    if (!content || content.kind !== loaded.kind) {
      return this.fail(prepared, 'case.transfer-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '呈批正文不合规',
        outlet: '退回或撤回后重新拟制',
      });
    }
    if (content.kind === 'criminal') {
      const reviews = await this.cases.listLegalReviews(loaded.caseId);
      const gate = assertCriminalTransferReview({
        required: true,
        passedReviewId: criminalTransferReviewPass(reviews),
      });
      if (gate) {
        return this.fail(prepared, 'case.transfer-approved', APPROVE_OPCODE, {
          httpStatus: 409,
          reason: 'legal-review-required',
          message: gate.message,
          outlet: '先完成法制审核（勾选涉刑移送），通过后再批准',
          basis: gate.citation ?? null,
        });
      }
    }
    const terminal = this.terminalBlock(prepared, 'case.transfer-approved', APPROVE_OPCODE);
    if (terminal) return terminal;
    const subject = await this.subjectOf(
      prepared.view,
      prepared.roles,
      Math.max(0, (await this.cases.countInFlightApprovals(loaded.caseId)) - (loaded.approvalChainId ? 1 : 0)),
    );
    let decision: TransitionDecision | null = null;
    if (content.kind !== 'jurisdiction') {
      decision = decideTransition({
        operation: { kind: 'transition', transitionId: 'T29' },
        subject,
        confirmedRuleKeys: input.confirmedRuleKeys,
        confirmReasons: input.confirmReasons,
      });
      if (!decision.ok) return this.settle(prepared, 'case.transfer-approved', APPROVE_OPCODE, decision);
    }
    const at = this.clock.now();
    const transferId = newUlid();
    return this.uow.run(async (tx) => {
      const current = await tx.cases.readCaseView(loaded.caseId);
      if (
        !current
        || current.currentStage !== prepared.view.currentStage
        || current.stageEntrySeq !== prepared.view.stageEntrySeq
        || current.status !== prepared.view.status
      ) {
        return rejected<CaseTransferHttpOutcome>(
          this.blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.transfer-approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
          },
        );
      }
      if (decision && decision.ok) {
        const wrote = await persistTransitionEffects(tx.cases, {
          effects: decision.effects,
          caseId: loaded.caseId,
          clueId: prepared.view.sourceClueIds[0] ?? null,
          actorId: actor.personnelId,
          at,
          fromJson: JSON.stringify({
            stage: prepared.view.currentStage,
            status: prepared.view.status,
            stageEntrySeq: prepared.view.stageEntrySeq,
          }),
          toJson: JSON.stringify({
            stage: decision.effects.currentStage,
            status: decision.effects.mainStatus,
            stageEntrySeq: decision.effects.stageEntrySeq,
          }),
          newId: () => newUlid(),
        });
        if (!wrote) {
          return rejected<CaseTransferHttpOutcome>(
            this.blockBody('concurrent-change', '案件环节写入失败', null, '请重新读取后再试'),
            {
              action: 'case.transfer-approved',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
            },
          );
        }
      }
      const inserted = await tx.cases.insertTransfer({
        id: transferId,
        caseId: loaded.caseId,
        kind: content.kind,
        receivingOrg: content.receivingOrg,
        documentNo: content.documentNo,
        letterDate: content.letterDate,
        reason: content.reason,
        approvalId,
        recordedBy: actor.personnelId,
        recordedAt: at,
      });
      if (!inserted) {
        return rejected<CaseTransferHttpOutcome>(
          this.blockBody('concurrent-change', '该呈批已生成记载', null, '请重新读取后再试'),
          {
            action: 'case.transfer-approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
          },
        );
      }
      if (content.kind === 'criminal') {
        await tx.cases.insertDeadlineEvent({
          id: newUlid(),
          caseId: loaded.caseId,
          eventKind: 'stop',
          basisLabel: TRANSFER_CLOCK_BASIS.basisLabel,
          basisNote: TRANSFER_CLOCK_BASIS.basisNote,
          stage: prepared.view.currentStage ?? 'E02',
          entrySeq: prepared.view.stageEntrySeq ?? 1,
          transitionCode: 'T29',
          actorId: actor.personnelId,
          createdAt: at,
        });
        await tx.cases.appendCaseMarker({
          id: newUlid(),
          caseId: loaded.caseId,
          marker: 'criminal-transfer',
          state: 'set',
          note: null,
          actorId: actor.personnelId,
          changedAt: at,
        });
      }
      const stepped = await tx.cases.applyTransferStep({
        approvalId,
        expectedStatus: loaded.status,
        nextStatus: 'approved',
        approvalChainId: null,
        stepId: newUlid(),
        step: 'approve',
        versionNo: loaded.currentVersionNo,
        actorId: actor.personnelId,
        opinion: input.opinion,
        at,
      });
      if (!stepped) {
        return rejected<CaseTransferHttpOutcome>(
          this.blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.transfer-approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
          },
        );
      }
      if (loaded.approvalChainId) {
        const closed = await tx.cases.closeApprovalChain(loaded.approvalChainId);
        if (!closed) {
          return rejected<CaseTransferHttpOutcome>(
            this.blockBody('concurrent-change', '审批链已被他人办结', null, '请重新读取后再试'),
            {
              action: 'case.transfer-approved',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
            },
          );
        }
      }
      await tx.audit.append({
        action: 'case.transfer-approved',
        ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
        detail: JSON.stringify({
          approvalId,
          transferId,
          kind: content.kind,
          receivingOrg: content.receivingOrg,
          documentNo: content.documentNo,
          letterDate: content.letterDate,
        }),
      });
      if (decision && decision.ok) {
        await tx.audit.append({
          action: 'case.transitioned',
          ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
          detail: JSON.stringify({
            caseId: loaded.caseId,
            transitionId: decision.effects.transitionCode,
            approvalId,
          }),
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'transfer-approved',
          caseId: loaded.caseId,
          approvalId,
          transferId,
          kind: content.kind,
          kindName: TRANSFER_KIND_NAMES[content.kind],
          receivingOrg: content.receivingOrg,
          letterDate: content.letterDate,
          currentStage: prepared.view.currentStage,
        },
      };
    });
  }

  /** 上传或补传回证。结案后补传走 X12 白名单第 2 项；只追加。 */
  async uploadReceipt(
    actor: ActorRef,
    caseId: string,
    transferId: string,
    files: readonly TransferUploadedFile[],
  ): Promise<CaseTransferHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.transfer-receipt-uploaded', true);
    if ('status' in prepared) return prepared;
    const transfers = await this.cases.listTransfers(caseId);
    const transfer = transfers.find((row) => row.id === transferId);
    if (!transfer) return { status: 404, body: { result: 'not-found' } };
    if (files.length === 0) {
      return this.fail(prepared, 'case.transfer-receipt-uploaded', DRAFT_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-attachment',
        message: '至少上传一份回证',
        outlet: '选择回证文件上传',
      });
    }
    // 回证补传只到定型前；已定型后是 X12。
    if (prepared.view.status === 'finalized') {
      const deny = classifyIllegal('X12', '案件已定型，回证不能补传');
      if (!deny.ok) return this.settle(prepared, 'case.transfer-receipt-uploaded', DRAFT_OPCODE, deny);
    }
    const attachmentCheck = validateAttachmentSet(
      files.map((file) => ({ fileName: file.fileName, byteSize: file.byteSize, content: file.content })),
    );
    if (!attachmentCheck.ok) {
      return this.fail(prepared, 'case.transfer-receipt-uploaded', DRAFT_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-attachment',
        message: '回证校验未通过',
        outlet: '按附件要求重新上传',
      });
    }
    const receipt = decideTransition({
      operation: { kind: 'post-close-receipt' },
      subject: await this.subjectOf(prepared.view, prepared.roles, 0),
    });
    if (!receipt.ok) return this.settle(prepared, 'case.transfer-receipt-uploaded', DRAFT_OPCODE, receipt);
    const stored = await this.storeFiles(caseId, `case/${caseId}/transfer/${transferId}/receipt`, files, 'receipt');
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      for (const file of stored) {
        await tx.cases.insertTransferFile({
          id: file.id,
          caseId,
          approvalId: null,
          transferId,
          kind: 'receipt',
          fileKey: file.fileKey,
          versionId: file.versionId,
          fileName: file.fileName,
          contentType: file.contentType,
          byteSize: file.byteSize,
          digest: file.digest,
          uploadedBy: actor.personnelId,
          uploadedAt: at,
        });
      }
      const all = await tx.cases.listTransferFiles(caseId);
      const receipts = all.filter((row) => row.kind === 'receipt' && row.transferId !== null);
      const rows = await tx.cases.listTransfers(caseId);
      await tx.audit.append({
        action: 'case.transfer-receipt-uploaded',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({
          transferId,
          kind: transfer.kind,
          files: files.map((file) => file.fileName),
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'receipt-uploaded',
          caseId,
          transferId,
          fileCount: files.length,
          receiptsComplete: receiptsCompleteOf(rows, receipts),
        },
      };
    });
  }

  /** 记载公安、检察决定（T30）。只追加；记载后不自动迁移。 */
  async recordCriminalDecision(
    actor: ActorRef,
    caseId: string,
    raw: Record<string, unknown>,
  ): Promise<CaseTransferHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.criminal-decision-recorded', true);
    if ('status' in prepared) return prepared;
    const terminal = this.terminalBlock(prepared, 'case.criminal-decision-recorded', DRAFT_OPCODE);
    if (terminal) return terminal;
    const transfers = await this.cases.listTransfers(caseId);
    if (!transfers.some((row) => row.kind === 'criminal')) {
      return this.fail(prepared, 'case.criminal-decision-recorded', DRAFT_OPCODE, {
        httpStatus: 409,
        reason: 'no-criminal-decision',
        message: '本案尚无涉刑移送记载',
        outlet: '先完成涉刑移送呈批',
      });
    }
    const parsed = readCriminalDecisionContent(raw);
    if (!parsed.ok) return this.failContent(prepared, 'case.criminal-decision-recorded', DRAFT_OPCODE, parsed.hit);
    const content = parsed.content;
    const at = this.clock.now();
    const decisionId = newUlid();
    const calendar = mergeCalendars(WORK_CALENDAR_V1, await this.cases.listCalendarInstalls());
    const countdown = this.countdown(content.notifiedOn, beijingDateOf(at), calendar);
    return this.uow.run(async (tx) => {
      await tx.cases.insertCriminalDecision({
        id: decisionId,
        caseId,
        source: content.source,
        notifiedOn: content.notifiedOn,
        reason: content.reason,
        caseReturned: content.caseReturned,
        returnedListJson: JSON.stringify(content.returnedList),
        reviewJson: JSON.stringify({
          reviewRequested: content.reviewRequested,
          supervisionSuggested: content.supervisionSuggested,
          reviewOn: content.reviewOn,
          reviewResult: content.reviewResult,
        }),
        partyNoticeJson: JSON.stringify({
          notifiedOn: content.partyNotifiedOn,
          note: content.partyNoticeNote,
        }),
        recordedBy: actor.personnelId,
        recordedAt: at,
      });
      await tx.audit.append({
        action: 'case.criminal-decision-recorded',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({
          decisionId,
          source: content.source,
          notifiedOn: content.notifiedOn,
          caseReturned: content.caseReturned,
          countdown,
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'criminal-decision-recorded',
          caseId,
          decisionId,
          source: content.source,
          sourceName: CRIMINAL_DECISION_SOURCE_NAMES[content.source],
          notifiedOn: content.notifiedOn,
          caseReturned: content.caseReturned,
          countdown,
          warnings: [countdown.warning],
        },
      };
    });
  }

  /** 拟制人工出口（A 回调查／B 结案或其他处理）。同一次决定 A、B 互斥。 */
  async draftOutlet(
    actor: ActorRef,
    caseId: string,
    decisionId: string,
    raw: Record<string, unknown>,
  ): Promise<CaseTransferHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.criminal-outlet-drafted', true);
    if ('status' in prepared) return prepared;
    const terminal = this.terminalBlock(prepared, 'case.criminal-outlet-drafted', DRAFT_OPCODE);
    if (terminal) return terminal;
    const decisions = await this.cases.listCriminalDecisions(caseId);
    const decision = decisions.find((row) => row.id === decisionId);
    if (!decision) return { status: 404, body: { result: 'not-found' } };
    const parsed = readCriminalOutletContent(raw);
    if (!parsed.ok) return this.failContent(prepared, 'case.criminal-outlet-drafted', DRAFT_OPCODE, parsed.hit);
    const outlets = await this.cases.listCriminalOutlets(caseId);
    if (outlets.some((row) => row.decisionId === decisionId && row.status !== 'drafting' && row.status !== 'withdrawn')) {
      return this.fail(prepared, 'case.criminal-outlet-drafted', DRAFT_OPCODE, {
        httpStatus: 409,
        reason: 'outlet-conflict',
        message: '同一次外部决定只能走一个出口',
        outlet: '已选定的出口需先办结或撤回',
      });
    }
    const at = this.clock.now();
    const outletId = newUlid();
    return this.uow.run(async (tx) => {
      await tx.cases.insertCriminalOutlet({
        id: outletId,
        caseId,
        decisionId,
        outlet: parsed.content.outlet,
        contentJson: JSON.stringify(parsed.content),
        drafterId: actor.personnelId,
        at,
      });
      await tx.audit.append({
        action: 'case.criminal-outlet-drafted',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({ outletId, decisionId, outlet: parsed.content.outlet }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'criminal-outlet-drafted',
          caseId,
          outletId,
          decisionId,
          outlet: parsed.content.outlet,
          outletName: CRIMINAL_OUTLET_NAMES[parsed.content.outlet],
          status: 'drafting',
        },
      };
    });
  }

  /** 提交人工出口呈批。 */
  async submitOutlet(actor: ActorRef, outletId: string): Promise<CaseTransferHttpOutcome> {
    const loaded = await this.cases.readCriminalOutlet(outletId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, SUBMIT_OPCODE, 'case.criminal-outlet-submitted', true);
    if ('status' in prepared) return prepared;
    if (loaded.drafterId !== actor.personnelId) return { status: 403, body: { reason: 'permission-denied' } };
    if (loaded.status !== 'drafting') {
      return this.fail(prepared, 'case.criminal-outlet-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '出口呈批不在拟制中',
        outlet: '先保存出口呈批稿',
      });
    }
    const other = await this.cases.countInFlightApprovals(loaded.caseId);
    const decision = decideTransition({
      operation: { kind: 'open-approval-chain', chainKind: 'criminal-outlet' },
      subject: await this.subjectOf(prepared.view, prepared.roles, other),
    });
    if (!decision.ok) return this.settle(prepared, 'case.criminal-outlet-submitted', SUBMIT_OPCODE, decision);
    const at = this.clock.now();
    const chainId = newUlid();
    return this.uow.run(async (tx) => {
      const opened = await tx.cases.openApprovalChain({
        id: chainId,
        caseId: loaded.caseId,
        kind: 'criminal-outlet',
        openedBy: actor.personnelId,
        openedAt: at,
      });
      if (!opened) {
        return rejected<CaseTransferHttpOutcome>(
          this.blockBody('X18', '本案已有进行中的审批链', null, '先办结或撤回当前审批链'),
          {
            action: 'case.criminal-outlet-submitted',
            outcome: 'failed',
            reason: 'X18',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      const stepped = await tx.cases.applyCriminalOutletStep({
        outletId,
        expectedStatus: loaded.status,
        nextStatus: 'pending_approval',
        approvalChainId: chainId,
        stepId: newUlid(),
        step: 'submit',
        actorId: actor.personnelId,
        opinion: null,
        at,
      });
      if (!stepped) {
        return rejected<CaseTransferHttpOutcome>(
          this.blockBody('concurrent-change', '出口呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.criminal-outlet-submitted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.criminal-outlet-submitted',
        ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
        detail: JSON.stringify({ outletId, decisionId: loaded.decisionId, outlet: loaded.outlet }),
      });
      return {
        status: 200 as const,
        body: { result: 'criminal-outlet-submitted', outletId, caseId: loaded.caseId, status: 'pending_approval' },
      };
    });
  }

  /** 批准人工出口。A 回 E02（进入次序号加 1）；B 不前移。都发续表事件。 */
  async approveOutlet(
    actor: ActorRef,
    outletId: string,
    input: ConfirmationInput & { readonly opinion: string | null },
  ): Promise<CaseTransferHttpOutcome> {
    const loaded = await this.cases.readCriminalOutlet(outletId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, APPROVE_OPCODE, 'case.criminal-outlet-approved', false);
    if ('status' in prepared) return prepared;
    if (loaded.status !== 'pending_approval') {
      return this.fail(prepared, 'case.criminal-outlet-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '出口呈批不在待批准',
        outlet: '先提交出口呈批',
      });
    }
    const parsed = readCriminalOutletContent(parseJson(loaded.contentJson));
    if (!parsed.ok) {
      return this.fail(prepared, 'case.criminal-outlet-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-content',
        message: '出口正文不合规',
        outlet: '重新拟制出口呈批',
      });
    }
    const outlets = await this.cases.listCriminalOutlets(loaded.caseId);
    if (outlets.some((row) => row.id !== outletId && row.decisionId === loaded.decisionId && row.status === 'approved')) {
      return this.fail(prepared, 'case.criminal-outlet-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'outlet-conflict',
        message: '同一次外部决定只能批准一个出口',
        outlet: '已批准的出口不能重复选择',
      });
    }
    const terminal = this.terminalBlock(prepared, 'case.criminal-outlet-approved', APPROVE_OPCODE);
    if (terminal) return terminal;
    const subject = await this.subjectOf(
      prepared.view,
      prepared.roles,
      Math.max(0, (await this.cases.countInFlightApprovals(loaded.caseId)) - (loaded.approvalChainId ? 1 : 0)),
    );
    if (subject.otherInFlightChains > 0) {
      return this.fail(prepared, 'case.criminal-outlet-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'X18',
        message: '本案已有进行中的审批链',
        outlet: '先办结或撤回当前审批链',
      });
    }
    const t30 = findTransition('T30');
    if (!t30) {
      return this.fail(prepared, 'case.criminal-outlet-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'unknown-transition',
        message: '没有 T30 迁移',
        outlet: '核对状态机目录',
      });
    }
    const landing = criminalOutletLanding(parsed.content.outlet);
    const effects = landing
      ? buildTransitionEffects({ ...t30, to: landing }, subject)
      : null;
    if (landing && !effects) {
      return this.fail(prepared, 'case.criminal-outlet-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '出口没有可执行的落点',
        outlet: '按当前环节重新提交',
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const current = await tx.cases.readCaseView(loaded.caseId);
      if (
        !current
        || current.currentStage !== prepared.view.currentStage
        || current.stageEntrySeq !== prepared.view.stageEntrySeq
        || current.status !== prepared.view.status
      ) {
        return rejected<CaseTransferHttpOutcome>(
          this.blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.criminal-outlet-approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
          },
        );
      }
      if (effects) {
        const wrote = await persistTransitionEffects(tx.cases, {
          effects,
          caseId: loaded.caseId,
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
          && effects.currentStage !== null
          && effects.stageEntrySeq !== null
          && effects.mainStatus !== null
          && effects.suspended !== null
          && (await tx.cases.advanceCasePointer({
            caseId: loaded.caseId,
            expectedStage: prepared.view.currentStage,
            expectedSeq: prepared.view.stageEntrySeq,
            stage: effects.currentStage,
            stageEntrySeq: effects.stageEntrySeq,
            status: effects.mainStatus,
            suspended: effects.suspended,
          }));
        if (!moved) {
          return rejected<CaseTransferHttpOutcome>(
            this.blockBody('concurrent-change', '案件环节写入失败', null, '请重新读取后再试'),
            {
              action: 'case.criminal-outlet-approved',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
            },
          );
        }
      }
      await tx.cases.insertDeadlineEvent({
        id: newUlid(),
        caseId: loaded.caseId,
        eventKind: 'continue',
        basisLabel: TRANSFER_CLOCK_BASIS.basisLabel,
        basisNote: TRANSFER_CLOCK_BASIS.basisNote,
        stage: prepared.view.currentStage ?? 'E02',
        entrySeq: prepared.view.stageEntrySeq ?? 1,
        transitionCode: 'T30',
        actorId: actor.personnelId,
        createdAt: at,
      });
      const stepped = await tx.cases.applyCriminalOutletStep({
        outletId,
        expectedStatus: loaded.status,
        nextStatus: 'approved',
        approvalChainId: null,
        stepId: newUlid(),
        step: 'approve',
        actorId: actor.personnelId,
        opinion: input.opinion,
        at,
      });
      if (!stepped) {
        return rejected<CaseTransferHttpOutcome>(
          this.blockBody('concurrent-change', '出口呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.criminal-outlet-approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
          },
        );
      }
      if (loaded.approvalChainId) {
        const closed = await tx.cases.closeApprovalChain(loaded.approvalChainId);
        if (!closed) {
          return rejected<CaseTransferHttpOutcome>(
            this.blockBody('concurrent-change', '审批链已被他人办结', null, '请重新读取后再试'),
            {
              action: 'case.criminal-outlet-approved',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
            },
          );
        }
      }
      await tx.audit.append({
        action: 'case.criminal-outlet-approved',
        ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
        detail: JSON.stringify({
          outletId,
          decisionId: loaded.decisionId,
          outlet: loaded.outlet,
          currentStage: effects?.currentStage ?? prepared.view.currentStage,
          stageEntrySeq: effects?.stageEntrySeq ?? prepared.view.stageEntrySeq,
        }),
      });
      if (effects) {
        await tx.audit.append({
          action: 'case.transitioned',
          ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
          detail: JSON.stringify({ caseId: loaded.caseId, transitionId: 'T30', outletId }),
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'criminal-outlet-approved',
          caseId: loaded.caseId,
          outletId,
          decisionId: loaded.decisionId,
          outlet: loaded.outlet,
          outletName: CRIMINAL_OUTLET_NAMES[parsed.content.outlet],
          currentStage: effects?.currentStage ?? prepared.view.currentStage,
          stageEntrySeq: effects?.stageEntrySeq ?? prepared.view.stageEntrySeq,
          continued: true,
        },
      };
    });
  }

  /**
   * 结案闸口（X11；#270 在 T26 批准前调用）。
   * 回证缺失不阻断；只给出是否齐全。
   */
  async closeoutGate(actor: ActorRef, caseId: string): Promise<CaseTransferHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, APPROVE_OPCODE, 'case.closeout-gate-checked', false);
    if ('status' in prepared) return prepared;
    const [transfers, approvals, files] = await Promise.all([
      this.cases.listTransfers(caseId),
      this.cases.listTransferApprovals(caseId),
      this.cases.listTransferFiles(caseId),
    ]);
    const receipts = files.filter((row) => row.kind === 'receipt' && row.transferId !== null);
    const checked = assertCloseoutTransferGate({ records: transfers, approvals });
    if (!checked.ok) {
      return this.uow.run(async () =>
        rejected<CaseTransferHttpOutcome>(
          this.blockBody(checked.block.code, checked.block.message, checked.block.citation, checked.block.outlet),
          {
            action: 'case.closeout-gate-checked',
            outcome: 'failed',
            reason: 'X11',
            ...this.parties(prepared, caseId, APPROVE_OPCODE),
          },
        ),
      );
    }
    return this.uow.run(async (tx) => {
      await tx.audit.append({
        action: 'case.closeout-gate-checked',
        ...this.parties(prepared, caseId, APPROVE_OPCODE),
        detail: JSON.stringify({
          caseId,
          gate: 'passed',
          transfers: transfers.map((row) => row.kind),
          receiptsComplete: receiptsCompleteOf(transfers, receipts),
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'closeout-gate-passed',
          caseId,
          receiptsComplete: receiptsCompleteOf(transfers, receipts),
        },
      };
    });
  }

  private transferView(row: TransferRow) {
    return {
      id: row.id,
      caseId: row.caseId,
      kind: row.kind,
      kindName: TRANSFER_KIND_NAMES[row.kind as TransferKind] ?? row.kind,
      receivingOrg: row.receivingOrg,
      documentNo: row.documentNo,
      letterDate: row.letterDate,
      reason: row.reason,
      approvalId: row.approvalId,
      recordedBy: row.recordedBy,
      recordedAt: row.recordedAt.toISOString(),
    };
  }

  private decisionView(row: CriminalDecisionRow, today: string, calendar: WorkCalendar) {
    const review = parseJson(row.reviewJson) as {
      reviewRequested?: unknown;
      supervisionSuggested?: unknown;
      reviewOn?: unknown;
      reviewResult?: unknown;
    };
    const party = parseJson(row.partyNoticeJson) as { notifiedOn?: unknown; note?: unknown };
    return {
      id: row.id,
      caseId: row.caseId,
      source: row.source,
      sourceName: CRIMINAL_DECISION_SOURCE_NAMES[row.source as keyof typeof CRIMINAL_DECISION_SOURCE_NAMES] ?? row.source,
      notifiedOn: row.notifiedOn,
      reason: row.reason,
      caseReturned: row.caseReturned,
      returnedList: parseJson(row.returnedListJson),
      review: {
        reviewRequested: typeof review.reviewRequested === 'boolean' ? review.reviewRequested : null,
        supervisionSuggested: typeof review.supervisionSuggested === 'boolean' ? review.supervisionSuggested : null,
        reviewOn: typeof review.reviewOn === 'string' ? review.reviewOn : null,
        reviewResult: typeof review.reviewResult === 'string' ? review.reviewResult : null,
      },
      partyNotice: {
        notifiedOn: typeof party.notifiedOn === 'string' ? party.notifiedOn : null,
        note: typeof party.note === 'string' ? party.note : null,
      },
      countdown: this.countdown(row.notifiedOn, today, calendar),
    };
  }

  private countdown(notifiedOn: string, today: string, calendar: WorkCalendar) {
    const planned = planAnchor({
      caseId: 'countdown',
      ruleKey: CRIMINAL_DECISION_REVIEW_RULE_KEY,
      entrySeq: 1,
      procedureNode: 'E09',
      startingDocument: null,
      startedOn: notifiedOn,
      exclusions: [],
      extensionDays: 0,
      paused: false,
      calendar,
    });
    const dueOn = planned.ok ? planned.plan.due.dueOn : null;
    const expired = dueOn !== null && dueOn < today;
    return {
      ruleKey: CRIMINAL_DECISION_REVIEW_RULE_KEY,
      dueOn,
      expired,
      warning: {
        level: 'warn' as const,
        code: CRIMINAL_DECISION_REVIEW_RULE_KEY,
        message: REVIEW_COUNTDOWN_MESSAGE,
        dueOn,
        expired,
      },
    };
  }

  private decisionDueOn(row: TransferApprovalRow, deadlines: readonly { ruleKey: string; startingDocument: string | null; dueOn: string | null }[]): string | null {
    if (row.kind !== 'criminal') return null;
    return deadlines.find((item) => item.ruleKey === CRIMINAL_TRANSFER_DECISION_RULE_KEY && item.startingDocument === row.id)?.dueOn ?? null;
  }

  private chainView(chain: TransferApprovalChain) {
    return {
      ruleId: chain.ruleId,
      version: chain.version,
      basis: chain.basis,
      levels: [...chain.levels],
    };
  }

  private storedContent(row: TransferApprovalRow): TransferContent | null {
    if (!row.contentJson) return null;
    const parsed = readTransferContent(parseJson(row.contentJson), beijingDateOf(this.clock.now()));
    return parsed.ok ? parsed.content : null;
  }

  private async storeFiles(
    caseId: string,
    prefix: string,
    files: readonly TransferUploadedFile[],
    kind: 'attachment' | 'receipt',
  ): Promise<Array<{ id: string; fileKey: string; versionId: string; fileName: string; contentType: string; byteSize: number; digest: string }>> {
    const stored = [];
    let index = 0;
    for (const file of files) {
      index += 1;
      const fileKey = `${prefix}/${kind}/${index}-${sanitizeFileName(file.fileName)}`;
      const ref = await this.storage.putVersion(fileKey, file.content);
      stored.push({
        id: newUlid(),
        fileKey: ref.fileKey,
        versionId: ref.versionId,
        fileName: file.fileName,
        contentType: file.contentType,
        byteSize: file.byteSize,
        digest: contentDigest(file.content),
      });
    }
    return stored;
  }

  private async prepare(
    actor: ActorRef,
    caseId: string,
    opcode: string,
    action: CaseTransferAction,
    mustBeHandler: boolean,
  ): Promise<Prepared | CaseTransferHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    const denied = await this.authorize(actor, opcode, view.handlingOrgId, caseId);
    const prepared: Prepared = { actorId: actor.personnelId, actorCode: account?.code ?? null, roles, view };
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

  private terminalBlock(prepared: Prepared, action: CaseTransferAction, opcode: string): Promise<CaseTransferHttpOutcome> | null {
    if (!isTerminalCaseStatus(prepared.view.status)) return null;
    const decision = classifyIllegal('X12', '案件已终态，该业务写操作不能继续');
    if (decision.ok) return null;
    return this.settle(prepared, action, opcode, decision);
  }

  private async subjectOf(view: CaseView, roles: readonly string[], otherInFlightChains: number): Promise<TransitionSubject> {
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

  private settle(
    prepared: Prepared,
    action: CaseTransferAction,
    opcode: string,
    decision: Exclude<TransitionDecision, { ok: true }>,
  ): Promise<CaseTransferHttpOutcome> {
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

  private async holdWarning(
    prepared: Prepared,
    action: CaseTransferAction,
    opcode: string,
    decision: Extract<TransitionDecision, { httpStatus: 200 }>,
  ): Promise<CaseTransferHttpOutcome> {
    const reason = (FAIL_REASONS.has(decision.reason) ? decision.reason : 'invalid-state') as CaseTransferFailedReason;
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
    action: CaseTransferAction,
    opcode: string,
    hit: { readonly reason: string; readonly message: string; readonly outlet: string },
  ): Promise<CaseTransferHttpOutcome> {
    return this.fail(prepared, action, opcode, {
      httpStatus: 400,
      reason: hit.reason,
      message: hit.message,
      outlet: hit.outlet,
    });
  }

  private async fail(
    prepared: Prepared,
    action: CaseTransferAction,
    opcode: string,
    fail: {
      readonly httpStatus: 400 | 409;
      readonly reason: string;
      readonly message: string;
      readonly outlet: string;
      readonly basis?: string | null;
    },
  ): Promise<CaseTransferHttpOutcome> {
    const reason = (FAIL_REASONS.has(fail.reason) ? fail.reason : 'invalid-state') as CaseTransferFailedReason;
    const outcome: CaseTransferHttpOutcome = fail.httpStatus === 400
      ? { status: 400, body: { result: 'non-compliant', reason: fail.reason, message: fail.message } }
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

  private blockBody(reason: string, message: string, citation: string | null, outlet: string) {
    return { status: 409 as const, body: { result: reason, reason, message, basis: citation, outlet } };
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

function parseJson(value: string | null): unknown {
  if (value === null || value === '') return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^\w.\-一-龥]+/gu, '_').slice(0, 120) || 'file';
}

function deadlineRowFromPlan(id: string, caseId: string, plan: AnchorPlan) {
  return {
    id,
    caseId,
    ruleKey: plan.rule.key,
    entrySeq: plan.entrySeq,
    procedureNode: plan.procedureNode,
    startingDocument: plan.startingDocument,
    consumption: plan.rule.consumption,
    ruleVersion: plan.rule.version,
    dayCount: plan.rule.dayCount,
    dayBasis: plan.rule.dayBasis,
    partyFacing: plan.rule.partyFacing,
    extensionAllowance: plan.rule.extensionAllowance,
    startedOn: plan.startedOn,
    dueOn: plan.due.dueOn,
    needsManualConfirmation: plan.due.needsManualConfirmation,
    confirmationTrace: plan.due.trace,
    rowStatus: 'open',
    revisionNo: 0,
    calendarVersion: plan.calendarVersion,
    clamped: false,
  };
}