// 期限呈批、锚点与工作日历（#246）。
// 计算在 deadline 包。本服务只做呈批、落库和查询。
// 呈批沿用 doc.draft / doc.submit / doc.admin.review / doc.approve。
// T34 在批准事务里落库。超期只提示，不阻断，不自建标记。

import { Inject, Injectable } from '@nestjs/common';
import {
  rejected,
  type CaseDeadlineAction,
  type CaseDeadlineFailedReason,
  type Rejected,
  CASE_DEADLINE_FAILED_REASONS,
} from '@natural-enforcement/audit';
import {
  CASE_STORE,
  CASE_SUPERVISION_ROLE,
  CLUE_STORE,
  canTakeFilingStep,
  decideTransition,
  readActiveCaseMarkers,
  filingStatusAfter,
  findIllegal,
  isTerminalCaseStatus,
  stageIndex,
  type CaseStore,
  type CaseView,
  type ClueStore,
  type DeadlineApprovalRow,
  type DeadlineEventRow,
  type DeadlineRow,
  type FilingAdminReview,
  type PeriodEventRow,
  type TransitionSubject,
} from '@natural-enforcement/case';
import {
  CONSUMPTION_NAMES,
  OVERDUE_PROMPT,
  WORK_CALENDAR_V1,
  calculateDueDate,
  checkCalendarPatch,
  checkExtension,
  checkManualPeriod,
  checkSystemPeriod,
  civilDate,
  exclusionsFromClock,
  inclusiveInterval,
  isExclusionKind,
  mergeCalendars,
  planAnchor,
  planRevision,
  type AnchorPlan,
  type CalendarYearPatch,
  type DueDateHit,
  type WorkCalendar,
} from '@natural-enforcement/deadline';
import {
  AccessControlService,
  IDENTITY_STORE,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type IdentityStore,
} from '@natural-enforcement/identity';

import { FILING_ADMIN_REVIEW } from './case-filing.service.ts';
import { persistTransitionEffects } from './case-transition-write.ts';
import { CLOCK, type Clock } from './clock.ts';
import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type TxScope, type UnitOfWork } from './unit-of-work.ts';

const READ_OPCODE = 'case.read';
const DRAFT_OPCODE = 'doc.draft';
const SUBMIT_OPCODE = 'doc.submit';
const REVIEW_OPCODE = 'doc.admin.review';
const APPROVE_OPCODE = 'doc.approve';
const EXTENSION_BASIS = '处罚办法第38条第1款';
const STAGE_NODE = /^E(0[1-9]|1[0-2])$/;
const FAIL_REASONS = new Set<string>(CASE_DEADLINE_FAILED_REASONS);

export type DeadlineHttpOutcome =
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

interface ExtendContent {
  readonly kind: 'extend';
  readonly days: number;
  readonly reason: string;
}

interface PeriodContent {
  readonly kind: 'period';
  readonly eventKind: string;
  readonly reason: string;
  readonly basisLabel: string;
  readonly basisNote: string;
  readonly startedOn: string;
  readonly endedOn: string;
  readonly backfill: boolean;
}

@Injectable()
export class DeadlineService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILING_ADMIN_REVIEW) private readonly adminReview: FilingAdminReview,
    private readonly access: AccessControlService,
  ) {}

  async read(actor: ActorRef, caseId: string): Promise<DeadlineHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const denied = await this.authorize(actor, READ_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };
    const account = await this.directory.findById(actor.personnelId);
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    const prepared: Prepared = { actorId: actor.personnelId, actorCode: account?.code ?? null, roles, view };
    await this.ensureHandle(prepared);
    const [rows, events, periods, openApproval, calendar] = await Promise.all([
      this.cases.listDeadlineRows(caseId),
      this.cases.listDeadlineEvents(caseId),
      this.cases.listPeriodEvents(caseId),
      this.cases.readOpenDeadlineApproval(caseId),
      this.calendar(),
    ]);
    return {
      status: 200,
      body: presentDeadlines({
        caseId,
        rows,
        events,
        periods,
        openApproval,
        calendar,
        asOf: civilDate(this.clock.now()),
      }),
    };
  }

  async saveAnchor(
    actor: ActorRef,
    caseId: string,
    input: {
      readonly ruleKey?: unknown;
      readonly entrySeq?: unknown;
      readonly procedureNode?: unknown;
      readonly startingDocument?: unknown;
      readonly startedOn?: unknown;
    },
  ): Promise<DeadlineHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'deadline.recorded', true);
    if ('status' in prepared) return prepared;
    const blocked = await this.guardSpan(prepared, 'deadline.recorded', DRAFT_OPCODE);
    if (blocked) return blocked;
    const ruleKey = text(input.ruleKey);
    const procedureNode = text(input.procedureNode);
    const startedOn = text(input.startedOn);
    const entrySeq = input.entrySeq;
    const startingDocument = input.startingDocument == null ? null : text(input.startingDocument);
    if (!Number.isInteger(entrySeq) || (entrySeq as number) < 1 || !STAGE_NODE.test(procedureNode)) {
      return this.fail(prepared, 'deadline.recorded', DRAFT_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-entry',
        message: '次序号或程序节点不合规',
        outlet: '填写进入次序号和程序节点',
      });
    }
    const rows = await this.cases.listDeadlineRows(caseId);
    if (rows.some((row) => row.ruleKey === ruleKey && row.entrySeq === entrySeq && row.procedureNode === procedureNode)) {
      return this.fail(prepared, 'deadline.recorded', DRAFT_OPCODE, {
        httpStatus: 409,
        reason: 'anchor-exists',
        message: '该四维锚点已存在',
        outlet: '换进入次序号或程序节点后再登记',
      });
    }
    const lockedStart = ruleKey === 'case.handle' ? earliestHandleStart(rows) : null;
    const calendar = await this.calendar();
    const planned = planAnchor({
      caseId,
      ruleKey,
      entrySeq: entrySeq as number,
      procedureNode,
      startingDocument: startingDocument === '' ? null : startingDocument,
      startedOn: lockedStart ?? startedOn,
      exclusions: [],
      extensionDays: 0,
      paused: false,
      calendar,
    });
    if (!planned.ok) {
      return this.fail(prepared, 'deadline.recorded', DRAFT_OPCODE, {
        httpStatus: 400,
        reason: planned.reason,
        message: '锚点字段不合规',
        outlet: '按已登记的规则键和起算日重填',
      });
    }
    const id = newUlid();
    return this.uow.run(async (tx) => {
      const inserted = await tx.cases.insertDeadlineRow(rowFromPlan(id, caseId, planned.plan, 0, 'open', false));
      if (!inserted) {
        return rejected<DeadlineHttpOutcome>(
          blockBody('anchor-exists', '该四维锚点已存在', null, '换进入次序号或程序节点后再登记'),
          {
            action: 'deadline.recorded',
            outcome: 'failed',
            reason: 'anchor-exists',
            ...this.parties(prepared, caseId, DRAFT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'deadline.recorded',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({
          caseId,
          rowId: id,
          ruleKey: planned.plan.rule.key,
          entrySeq: planned.plan.entrySeq,
          procedureNode: planned.plan.procedureNode,
          startingDocument: planned.plan.startingDocument,
          startedOn: planned.plan.startedOn,
          dueOn: planned.plan.due.dueOn,
          consumption: planned.plan.rule.consumption,
          ruleVersion: planned.plan.rule.version,
          trace: planned.plan.due.trace,
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'anchor-recorded',
          id,
          caseId,
          ruleKey: planned.plan.rule.key,
          entrySeq: planned.plan.entrySeq,
          procedureNode: planned.plan.procedureNode,
          startingDocument: planned.plan.startingDocument,
          startedOn: planned.plan.startedOn,
          dueOn: planned.plan.due.dueOn,
          needsManualConfirmation: planned.plan.due.needsManualConfirmation,
          trace: planned.plan.due.trace,
          consumption: planned.plan.rule.consumption,
          consumptionName: CONSUMPTION_NAMES[planned.plan.rule.consumption],
          ruleVersion: planned.plan.rule.version,
          dayCount: planned.plan.rule.dayCount,
          dayBasis: planned.plan.rule.dayBasis,
          partyFacing: planned.plan.rule.partyFacing,
          extensionAllowance: planned.plan.rule.extensionAllowance,
        },
      };
    });
  }

  async saveExtension(
    actor: ActorRef,
    caseId: string,
    input: { readonly days?: unknown; readonly reason?: unknown },
  ): Promise<DeadlineHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'deadline.drafted', true);
    if ('status' in prepared) return prepared;
    const blocked = await this.guardSpan(prepared, 'deadline.drafted', DRAFT_OPCODE);
    if (blocked) return blocked;
    const days = input.days;
    const reason = typeof input.reason === 'string' ? input.reason : '';
    if (typeof days !== 'number') {
      return this.fail(prepared, 'deadline.drafted', DRAFT_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-days',
        message: '延长天数不合规',
        outlet: '填写正整数天数',
      });
    }
    const checked = checkExtension(days, reason);
    if (!checked.ok) {
      return this.fail(prepared, 'deadline.drafted', DRAFT_OPCODE, {
        httpStatus: checked.reason === 'over-cap' ? 409 : 400,
        reason: checked.reason,
        message: checked.reason === 'over-cap' ? '超过默认上限须写明案情特别复杂' : '延长天数不合规',
        outlet: checked.reason === 'over-cap' ? '填写案情特别复杂，或把天数改到上限以内' : '填写正整数天数',
      });
    }
    const gate = await this.gateTransition(prepared, 'deadline.drafted', DRAFT_OPCODE, 'T34', false);
    if (gate) return gate;
    const content: ExtendContent = { kind: 'extend', days, reason: reason.trim() };
    return this.saveDraft(prepared, 'extend', content);
  }

  async savePeriod(
    actor: ActorRef,
    caseId: string,
    input: {
      readonly eventKind?: unknown;
      readonly reason?: unknown;
      readonly basisLabel?: unknown;
      readonly startedOn?: unknown;
      readonly endedOn?: unknown;
      readonly backfill?: unknown;
    },
  ): Promise<DeadlineHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'deadline.drafted', true);
    if ('status' in prepared) return prepared;
    const blocked = await this.guardSpan(prepared, 'deadline.drafted', DRAFT_OPCODE);
    if (blocked) return blocked;
    const checked = checkManualPeriod({
      eventKind: text(input.eventKind),
      reason: text(input.reason),
      basisLabel: text(input.basisLabel),
      startedOn: text(input.startedOn),
      endedOn: text(input.endedOn),
      backfill: input.backfill === true,
    });
    if (!checked.ok) {
      const clientError = checked.reason === 'missing-reason' || checked.reason === 'missing-basis' || checked.reason === 'invalid-kind';
      return this.fail(prepared, 'deadline.drafted', DRAFT_OPCODE, {
        httpStatus: clientError ? 400 : 409,
        reason: checked.reason,
        message: periodMessage(checked.reason),
        outlet: periodOutlet(checked.reason),
      });
    }
    const content: PeriodContent = { kind: 'period', ...checked.event };
    return this.saveDraft(prepared, 'period', content);
  }

  async saveSystemPeriod(
    actor: ActorRef,
    caseId: string,
    input: {
      readonly eventKind?: unknown;
      readonly basisLabel?: unknown;
      readonly startedOn?: unknown;
      readonly endedOn?: unknown;
    },
  ): Promise<DeadlineHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'deadline.recorded', true);
    if ('status' in prepared) return prepared;
    const blocked = await this.guardSpan(prepared, 'deadline.recorded', DRAFT_OPCODE);
    if (blocked) return blocked;
    const checked = checkSystemPeriod({
      eventKind: text(input.eventKind),
      basisLabel: text(input.basisLabel),
      startedOn: text(input.startedOn),
      endedOn: text(input.endedOn),
    });
    if (!checked.ok) {
      const clientError = checked.reason !== 'invalid-interval';
      return this.fail(prepared, 'deadline.recorded', DRAFT_OPCODE, {
        httpStatus: clientError ? 400 : 409,
        reason: checked.reason,
        message: periodMessage(checked.reason),
        outlet: periodOutlet(checked.reason),
      });
    }
    const id = newUlid();
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      await tx.cases.insertPeriodEvent({
        id,
        caseId,
        kind: checked.event.eventKind,
        source: 'system',
        basisLabel: checked.event.basisLabel,
        basisNote: checked.event.basisNote,
        reason: null,
        startedOn: checked.event.startedOn,
        endedOn: checked.event.endedOn,
        extensionDays: null,
        backfill: false,
        status: 'effective',
        approvalId: null,
        actorId: actor.personnelId,
        createdAt: at,
      });
      await tx.audit.append({
        action: 'deadline.recorded',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({
          caseId,
          eventId: id,
          source: 'system',
          kind: checked.event.eventKind,
          startedOn: checked.event.startedOn,
          endedOn: checked.event.endedOn,
        }),
      });
      return {
        status: 200 as const,
        body: { result: 'period-recorded', id, caseId, source: 'system', status: 'effective' },
      };
    });
  }

  async submit(actor: ActorRef, approvalId: string): Promise<DeadlineHttpOutcome> {
    const approval = await this.cases.readDeadlineApproval(approvalId);
    if (!approval) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, approval.caseId, SUBMIT_OPCODE, 'deadline.submitted', true);
    if ('status' in prepared) return prepared;
    if (approval.drafterId !== actor.personnelId) return { status: 403, body: { reason: 'permission-denied' } };
    if (!canTakeFilingStep('submit', approval.status)) {
      return this.fail(prepared, 'deadline.submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '呈批不在拟制中',
        outlet: '先保存呈批稿',
      });
    }
    const content = parseStored(approval.kind, approval.contentJson);
    if (!content) {
      return this.fail(prepared, 'deadline.submitted', SUBMIT_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-state',
        message: '呈批正文不合规',
        outlet: '重新保存呈批稿',
      });
    }
    if (content.kind === 'extend') {
      const gate = await this.gateTransition(prepared, 'deadline.submitted', SUBMIT_OPCODE, 'T34', false);
      if (gate) return gate;
    }
    const other = await this.cases.countInFlightApprovals(approval.caseId);
    const decision = decideTransition({
      operation: { kind: 'open-approval-chain', chainKind: approval.kind },
      subject: await this.subjectOf(prepared.view, prepared.roles, other),
    });
    if (!decision.ok) return this.refuse(prepared, 'deadline.submitted', SUBMIT_OPCODE, decision);
    const nextStatus = filingStatusAfter('submit', this.adminReview);
    const at = this.clock.now();
    const chainId = newUlid();
    return this.uow.run(async (tx) => {
      const opened = await tx.cases.openApprovalChain({
        id: chainId,
        caseId: approval.caseId,
        kind: approval.kind,
        openedBy: actor.personnelId,
        openedAt: at,
      });
      if (!opened) {
        return rejected<DeadlineHttpOutcome>(
          blockBody('X18', '本案已有进行中的审批链', '同一案件同时只有一条进行中的审批链', '先办结或退回当前呈批'),
          {
            action: 'deadline.submitted',
            outcome: 'failed',
            reason: 'X18',
            ...this.parties(prepared, approval.caseId, SUBMIT_OPCODE),
          },
        );
      }
      const stepped = await tx.cases.applyDeadlineStep({
        approvalId,
        expectedStatus: approval.status,
        nextStatus,
        adminReview: this.adminReview,
        approvalChainId: chainId,
        stepId: newUlid(),
        step: 'submit',
        versionNo: approval.currentVersionNo,
        actorId: actor.personnelId,
        opinion: null,
        at,
      });
      if (!stepped) {
        return rejected<DeadlineHttpOutcome>(
          blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'deadline.submitted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, approval.caseId, SUBMIT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'deadline.submitted',
        ...this.parties(prepared, approval.caseId, SUBMIT_OPCODE),
        detail: JSON.stringify({ caseId: approval.caseId, approvalId, kind: approval.kind, chainId }),
      });
      return {
        status: 200 as const,
        body: { result: 'deadline-submitted', approvalId, caseId: approval.caseId, status: nextStatus },
      };
    });
  }

  async review(actor: ActorRef, approvalId: string, input: { readonly opinion: string | null }): Promise<DeadlineHttpOutcome> {
    const approval = await this.cases.readDeadlineApproval(approvalId);
    if (!approval) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, approval.caseId, REVIEW_OPCODE, 'deadline.reviewed', false);
    if ('status' in prepared) return prepared;
    if (!canTakeFilingStep('review', approval.status)) {
      return this.fail(prepared, 'deadline.reviewed', REVIEW_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前状态不能审核',
        outlet: '呈批须在待审核',
      });
    }
    const at = this.clock.now();
    const nextStatus = filingStatusAfter('review', this.adminReview);
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyDeadlineStep({
        approvalId,
        expectedStatus: approval.status,
        nextStatus,
        stepId: newUlid(),
        step: 'review',
        versionNo: approval.currentVersionNo,
        actorId: actor.personnelId,
        opinion: input.opinion,
        at,
      });
      if (!stepped) {
        return rejected<DeadlineHttpOutcome>(
          blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'deadline.reviewed',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, approval.caseId, REVIEW_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'deadline.reviewed',
        ...this.parties(prepared, approval.caseId, REVIEW_OPCODE),
        detail: JSON.stringify({ caseId: approval.caseId, approvalId }),
      });
      return {
        status: 200 as const,
        body: { result: 'deadline-reviewed', approvalId, caseId: approval.caseId, status: nextStatus },
      };
    });
  }

  async approve(actor: ActorRef, approvalId: string, input: { readonly opinion: string | null }): Promise<DeadlineHttpOutcome> {
    const approval = await this.cases.readDeadlineApproval(approvalId);
    if (!approval) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, approval.caseId, APPROVE_OPCODE, 'deadline.approved', false);
    if ('status' in prepared) return prepared;
    if (!canTakeFilingStep('approve', approval.status)) {
      return this.fail(prepared, 'deadline.approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '呈批不在待审批',
        outlet: '先完成前面的审批步骤',
      });
    }
    const content = parseStored(approval.kind, approval.contentJson);
    if (!content) {
      return this.fail(prepared, 'deadline.approved', APPROVE_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-state',
        message: '呈批正文不合规',
        outlet: '退回后重新保存',
      });
    }
    if (content.kind === 'extend') {
      const gate = await this.gateTransition(prepared, 'deadline.approved', APPROVE_OPCODE, 'T34', true);
      if (gate) return gate;
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyDeadlineStep({
        approvalId,
        expectedStatus: approval.status,
        nextStatus: 'approved',
        stepId: newUlid(),
        step: 'approve',
        versionNo: approval.currentVersionNo,
        actorId: actor.personnelId,
        opinion: input.opinion,
        at,
      });
      if (!stepped) {
        return rejected<DeadlineHttpOutcome>(
          blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'deadline.approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, approval.caseId, APPROVE_OPCODE),
          },
        );
      }
      if (content.kind === 'extend') {
        const wrote = await this.applyExtension(tx, prepared, approval, content, at);
        if (wrote) return wrote;
      }
      if (approval.approvalChainId) {
        const closed = await tx.cases.closeApprovalChain(approval.approvalChainId);
        if (!closed) {
          return rejected<DeadlineHttpOutcome>(
            blockBody('concurrent-change', '审批链已被他人办结', null, '请重新读取后再试'),
            {
              action: 'deadline.approved',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, approval.caseId, APPROVE_OPCODE),
            },
          );
        }
      }
      if (content.kind === 'period') {
        await tx.cases.insertPeriodEvent({
          id: newUlid(),
          caseId: approval.caseId,
          kind: content.eventKind,
          source: 'manual',
          basisLabel: content.basisLabel,
          basisNote: content.basisNote,
          reason: content.reason,
          startedOn: content.startedOn,
          endedOn: content.endedOn,
          extensionDays: null,
          backfill: content.backfill,
          status: 'effective',
          approvalId,
          actorId: actor.personnelId,
          createdAt: at,
        });
      }
      await tx.audit.append({
        action: 'deadline.approved',
        ...this.parties(prepared, approval.caseId, APPROVE_OPCODE),
        detail: JSON.stringify({ caseId: approval.caseId, approvalId, kind: content.kind, content }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'deadline-approved',
          approvalId,
          caseId: approval.caseId,
          kind: content.kind,
          status: 'approved',
          transitionId: content.kind === 'extend' ? 'T34' : null,
        },
      };
    });
  }

  async installCalendar(
    actor: ActorRef,
    input: {
      readonly version?: unknown;
      readonly year?: unknown;
      readonly holidays?: unknown;
      readonly makeupWorkdays?: unknown;
      readonly sourceUrl?: unknown;
    },
  ): Promise<DeadlineHttpOutcome> {
    const account = await this.directory.findById(actor.personnelId);
    const orgUnitId = account?.orgUnitId ?? null;
    if (!orgUnitId) return { status: 403, body: { reason: 'permission-denied' } };
    const denied = await this.authorize(actor, APPROVE_OPCODE, orgUnitId, 'work-calendar');
    if (denied) return { status: 403, body: { reason: denied } };
    const patch = readPatch(input);
    const actorCode = account?.code ?? null;
    const parties = {
      actorId: actor.personnelId,
      actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId,
      sourceIp: null,
      opcode: APPROVE_OPCODE,
      resourceType: 'deadline' as const,
      resourceId: 'work-calendar',
    };
    if (!patch || !checkCalendarPatch(patch).ok) {
      return this.uow.run(async () =>
        rejected<DeadlineHttpOutcome>(
          {
            status: 400,
            body: { result: 'non-compliant', reason: 'invalid-calendar', message: '工作日历不合规', outlet: '按年份填写节假日和调休' },
          },
          { action: 'deadline.recorded', outcome: 'failed', reason: 'invalid-calendar', ...parties },
        ),
      );
    }
    const asOf = civilDate(this.clock.now());
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      await tx.cases.insertCalendarInstall({
        id: newUlid(),
        version: patch.version,
        year: patch.year,
        holidays: patch.holidays,
        makeupWorkdays: patch.makeupWorkdays,
        sourceUrl: patch.sourceUrl,
        installedBy: actor.personnelId,
        createdAt: at,
      });
      const installed = await tx.cases.listCalendarInstalls();
      const calendar = mergeCalendars(WORK_CALENDAR_V1, installed);
      const rows = await tx.cases.listAllDeadlineRows();
      const appended: string[] = [];
      for (const group of groupsOf(rows)) {
        const latest = group[group.length - 1];
        if (!latest) continue;
        const plan = planRevision({
          dayBasis: latest.dayBasis === 'working' ? 'working' : 'calendar',
          rowStatus: latest.rowStatus,
          partyFacing: latest.partyFacing,
          startedOn: latest.startedOn,
          dayCount: latest.dayCount,
          dueOn: latest.dueOn,
          historicalDueOns: group.flatMap((row) => (row.dueOn === null ? [] : [row.dueOn])),
          asOf,
          calendar,
        });
        if (plan.action !== 'append') continue;
        const id = newUlid();
        const inserted = await tx.cases.insertDeadlineRow({
          ...latest,
          id,
          dueOn: plan.dueOn,
          needsManualConfirmation: plan.needsManualConfirmation,
          confirmationTrace: plan.trace,
          revisionNo: latest.revisionNo + 1,
          calendarVersion: plan.calendarVersion,
          clamped: plan.clamped,
        });
        if (inserted) appended.push(id);
      }
      await tx.audit.append({
        action: 'deadline.recorded',
        ...parties,
        detail: JSON.stringify({ version: patch.version, year: patch.year, appended: appended.length, asOf }),
      });
      return {
        status: 200 as const,
        body: { result: 'calendar-installed', version: calendar.version, year: patch.year, appended: appended.length },
      };
    });
  }

  private async applyExtension(
    tx: TxScope,
    prepared: Prepared,
    approval: DeadlineApprovalRow,
    content: ExtendContent,
    at: Date,
  ): Promise<Rejected<DeadlineHttpOutcome> | null> {
    const effects = await this.extensionEffects(prepared, true);
    if (!effects || effects.kind !== 'advance' || !effects.currentStage || !effects.mainStatus || effects.stageEntrySeq === null) {
      return rejected<DeadlineHttpOutcome>(
        blockBody('invalid-state', '该呈批没有可执行的去向', null, '请按当前环节选择呈批'),
        {
          action: 'deadline.approved',
          outcome: 'failed',
          reason: 'invalid-state',
          ...this.parties(prepared, approval.caseId, APPROVE_OPCODE),
        },
      );
    }
    const caseId = approval.caseId;
    const wrote = await persistTransitionEffects(tx.cases, {
      effects,
      caseId,
      clueId: prepared.view.sourceClueIds[0] ?? null,
      actorId: prepared.actorId,
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
      return rejected(blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'), {
        action: 'deadline.approved',
        outcome: 'failed',
        reason: 'concurrent-change',
        ...this.parties(prepared, caseId, APPROVE_OPCODE),
      });
    }
    const moved = await tx.cases.advanceCasePointer({
      caseId,
      expectedStage: prepared.view.currentStage,
      expectedSeq: prepared.view.stageEntrySeq,
      stage: effects.currentStage,
      stageEntrySeq: effects.stageEntrySeq,
      status: effects.mainStatus,
      suspended: effects.suspended ?? prepared.view.suspended,
    });
    if (!moved) {
      return rejected(blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'), {
        action: 'deadline.approved',
        outcome: 'failed',
        reason: 'concurrent-change',
        ...this.parties(prepared, caseId, APPROVE_OPCODE),
      });
    }
    await tx.cases.insertPeriodEvent({
      id: newUlid(),
      caseId,
      kind: 'extension',
      source: 'manual',
      basisLabel: EXTENSION_BASIS,
      basisNote: content.reason === '' ? EXTENSION_BASIS : content.reason,
      reason: content.reason === '' ? null : content.reason,
      startedOn: null,
      endedOn: null,
      extensionDays: content.days,
      backfill: false,
      status: 'effective',
      approvalId: approval.id,
      actorId: prepared.actorId,
      createdAt: at,
    });
    await tx.audit.append({
      action: 'case.transitioned',
      ...this.parties(prepared, caseId, APPROVE_OPCODE),
      detail: JSON.stringify({ caseId, transitionId: 'T34', approvalId: approval.id, days: content.days }),
    });
    return null;
  }

  private async extensionEffects(prepared: Prepared, excludeOwnChain: boolean) {
    const counted = await this.cases.countInFlightApprovals(prepared.view.id);
    const other = excludeOwnChain ? Math.max(0, counted - 1) : counted;
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T34' },
      subject: await this.subjectOf(prepared.view, prepared.roles, other),
    });
    if (!decision.ok) return null;
    return decision.effects;
  }

  private async ensureHandle(prepared: Prepared): Promise<void> {
    const existing = await this.cases.listDeadlineRows(prepared.view.id);
    if (existing.some((row) => row.ruleKey === 'case.handle' && row.procedureNode === 'E02' && row.entrySeq === 1)) return;
    const calendar = await this.calendar();
    const startedOn = civilDate(prepared.view.openedAt);
    const planned = planAnchor({
      caseId: prepared.view.id,
      ruleKey: 'case.handle',
      entrySeq: 1,
      procedureNode: 'E02',
      startingDocument: null,
      startedOn,
      exclusions: [],
      extensionDays: 0,
      paused: false,
      calendar,
    });
    if (!planned.ok) return;
    const caseId = prepared.view.id;
    await this.uow.run(async (tx) => {
      const inserted = await tx.cases.insertDeadlineRow(rowFromPlan(newUlid(), caseId, planned.plan, 0, 'open', false));
      if (!inserted) return { status: 200 as const, body: {} };
      await tx.audit.append({
        action: 'deadline.recorded',
        ...this.parties(prepared, caseId, READ_OPCODE),
        detail: JSON.stringify({
          caseId,
          ruleKey: 'case.handle',
          entrySeq: 1,
          procedureNode: 'E02',
          startedOn,
          dueOn: planned.plan.due.dueOn,
          trace: planned.plan.due.trace,
        }),
      });
      return { status: 200 as const, body: {} };
    });
  }

  private async saveDraft(
    prepared: Prepared,
    kind: 'extend' | 'period',
    content: ExtendContent | PeriodContent,
  ): Promise<DeadlineHttpOutcome> {
    const caseId = prepared.view.id;
    const open = await this.cases.readOpenDeadlineApproval(caseId);
    if (open && open.status !== 'drafting') {
      return this.fail(prepared, 'deadline.drafted', DRAFT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '已有在途呈批',
        outlet: '先办结当前呈批',
      });
    }
    if (open && open.drafterId !== prepared.actorId) return { status: 403, body: { reason: 'permission-denied' } };
    const approvalId = open?.id ?? newUlid();
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const saved = await tx.cases.saveDeadlineDraft({
        approvalId,
        caseId,
        kind,
        drafterId: prepared.actorId,
        isNew: open === null,
        expectedVersionNo: open?.currentVersionNo ?? 0,
        versionId: newUlid(),
        contentJson: JSON.stringify(content),
        at,
      });
      if (!saved) {
        return rejected<DeadlineHttpOutcome>(
          blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'deadline.drafted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, DRAFT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'deadline.drafted',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({ caseId, approvalId, kind }),
      });
      return {
        status: 200 as const,
        body: { result: 'deadline-drafted', approvalId, caseId, kind, status: 'drafting' },
      };
    });
  }

  private async calendar(): Promise<WorkCalendar> {
    const installed = await this.cases.listCalendarInstalls();
    return mergeCalendars(WORK_CALENDAR_V1, installed);
  }

  private async gateTransition(
    prepared: Prepared,
    action: CaseDeadlineAction,
    opcode: string,
    transitionId: 'T34',
    excludeOwnChain: boolean,
  ): Promise<DeadlineHttpOutcome | null> {
    const counted = await this.cases.countInFlightApprovals(prepared.view.id);
    const other = excludeOwnChain ? Math.max(0, counted - 1) : counted;
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId },
      subject: await this.subjectOf(prepared.view, prepared.roles, other),
    });
    if (decision.ok) return null;
    return this.refuse(prepared, action, opcode, decision);
  }

  private refuse(
    prepared: Prepared,
    action: CaseDeadlineAction,
    opcode: string,
    decision: Exclude<ReturnType<typeof decideTransition>, { ok: true }>,
  ): Promise<DeadlineHttpOutcome> {
    return this.fail(prepared, action, opcode, {
      httpStatus: decision.httpStatus === 200 ? 200 : 409,
      reason: decision.reason,
      message: decision.message,
      outlet: decision.httpStatus === 200 ? '该提示不改变案件' : decision.outlet,
      basis: decision.citation,
    });
  }

  private async guardSpan(
    prepared: Prepared,
    action: CaseDeadlineAction,
    opcode: string,
  ): Promise<DeadlineHttpOutcome | null> {
    if (isTerminalCaseStatus(prepared.view.status)) {
      const row = findIllegal('X12');
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: 'X12',
        message: '案件已终态，该业务写操作不能继续',
        outlet: row?.outlet ?? '终态后仅可阅读、导出',
        basis: row?.citation ?? null,
      });
    }
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
    const index = stageIndex(prepared.view.currentStage);
    if (index < stageIndex('E01') || index > stageIndex('E09')) {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前环节不能登记期限',
        outlet: '请在立案后、决定前登记',
      });
    }
    return null;
  }

  private async prepare(
    actor: ActorRef,
    caseId: string,
    opcode: string,
    action: CaseDeadlineAction,
    mustBeHandler: boolean,
  ): Promise<Prepared | DeadlineHttpOutcome> {
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
    action: CaseDeadlineAction,
    opcode: string,
    fail: {
      readonly httpStatus: 200 | 400 | 409;
      readonly reason: string;
      readonly message: string;
      readonly outlet: string;
      readonly basis?: string | null;
    },
  ): Promise<DeadlineHttpOutcome> {
    const reason = (FAIL_REASONS.has(fail.reason) ? fail.reason : 'invalid-state') as CaseDeadlineFailedReason;
    const outcome: DeadlineHttpOutcome =
      fail.httpStatus === 400
        ? { status: 400, body: { result: 'non-compliant', reason: fail.reason, message: fail.message, outlet: fail.outlet } }
        : fail.httpStatus === 200
          ? {
              status: 200,
              body: { result: 'advisory', reason: fail.reason, message: fail.message, basis: fail.basis ?? null, outlet: fail.outlet },
            }
          : {
              status: 409,
              body: { result: fail.reason, reason: fail.reason, message: fail.message, basis: fail.basis ?? null, outlet: fail.outlet },
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

function presentDeadlines(input: {
  readonly caseId: string;
  readonly rows: readonly DeadlineRow[];
  readonly events: readonly DeadlineEventRow[];
  readonly periods: readonly PeriodEventRow[];
  readonly openApproval: DeadlineApprovalRow | null;
  readonly calendar: WorkCalendar;
  readonly asOf: string;
}): Record<string, unknown> {
  const hits = new Map<string, DueDateHit>();
  const shown = input.rows.map((row) => {
    if (row.ruleKey !== 'case.handle') {
      return { ...publicRow(row), dueOn: row.dueOn, paused: false, holidayUnchecked: false };
    }
    const hit = hits.get(row.startedOn) ?? handleHit(row, input.events, input.periods, input.calendar);
    hits.set(row.startedOn, hit);
    return {
      ...publicRow(row),
      dueOn: hit.dueOn,
      paused: hit.paused,
      holidayUnchecked: hit.holidayUnchecked,
      needsManualConfirmation: hit.needsManualConfirmation,
      confirmationTrace: hit.trace ?? row.confirmationTrace,
    };
  });
  const handle = shown
    .filter((row) => row.ruleKey === 'case.handle' && row.procedureNode === 'E02' && row.entrySeq === 1)
    .sort((left, right) => right.revisionNo - left.revisionNo)[0];
  const prompts: string[] = [];
  if (handle?.paused && handle.confirmationTrace) prompts.push(handle.confirmationTrace);
  else if (handle?.dueOn && handle.dueOn < input.asOf) prompts.push(OVERDUE_PROMPT);
  if (handle && !handle.paused && handle.needsManualConfirmation && handle.confirmationTrace) prompts.push(handle.confirmationTrace);
  if (handle && !handle.paused && handle.holidayUnchecked && handle.confirmationTrace) prompts.push(handle.confirmationTrace);
  return {
    result: 'listed',
    caseId: input.caseId,
    sourceUrl: input.calendar.sourceUrl,
    calendarVersion: input.calendar.version,
    asOf: input.asOf,
    blocked: false,
    prompts,
    handling: handle
      ? { startedOn: handle.startedOn, dueOn: handle.dueOn, paused: handle.paused, needsManualConfirmation: handle.needsManualConfirmation }
      : null,
    rows: shown,
    periodEvents: input.periods.map((row) => ({
      id: row.id,
      kind: row.kind,
      source: row.source,
      basisLabel: row.basisLabel,
      basisNote: row.basisNote,
      reason: row.reason,
      startedOn: row.startedOn,
      endedOn: row.endedOn,
      extensionDays: row.extensionDays,
      backfill: row.backfill,
      status: row.status,
      approvalId: row.approvalId,
    })),
    openApproval: input.openApproval
      ? {
          id: input.openApproval.id,
          kind: input.openApproval.kind,
          status: input.openApproval.status,
          versionNo: input.openApproval.currentVersionNo,
        }
      : null,
  };
}

function publicRow(row: DeadlineRow) {
  const consumption = row.consumption === 'continue' || row.consumption === 'restart' ? row.consumption : 'continue';
  return {
    id: row.id,
    ruleKey: row.ruleKey,
    entrySeq: row.entrySeq,
    procedureNode: row.procedureNode,
    startingDocument: row.startingDocument,
    consumption: row.consumption,
    consumptionName: CONSUMPTION_NAMES[consumption],
    ruleVersion: row.ruleVersion,
    dayCount: row.dayCount,
    dayBasis: row.dayBasis,
    partyFacing: row.partyFacing,
    extensionAllowance: row.extensionAllowance,
    startedOn: row.startedOn,
    storedDueOn: row.dueOn,
    needsManualConfirmation: row.needsManualConfirmation,
    confirmationTrace: row.confirmationTrace,
    rowStatus: row.rowStatus,
    revisionNo: row.revisionNo,
    calendarVersion: row.calendarVersion,
    clamped: row.clamped,
  };
}

function handleHit(
  row: DeadlineRow,
  events: readonly DeadlineEventRow[],
  periods: readonly PeriodEventRow[],
  calendar: WorkCalendar,
): DueDateHit {
  const clock = exclusionsFromClock(events.map((item) => ({ eventKind: item.eventKind, on: civilDate(item.createdAt) })));
  const intervals = [
    ...clock.intervals,
    ...periods.flatMap((item) => {
      if (!isExclusionKind(item.kind) || item.startedOn === null || item.endedOn === null) return [];
      return [inclusiveInterval(item.startedOn, item.endedOn)];
    }),
  ];
  const extensionDays = periods.reduce((sum, item) => sum + (item.kind === 'extension' ? (item.extensionDays ?? 0) : 0), 0);
  return calculateDueDate({
    startedOn: row.startedOn,
    dayCount: row.dayCount,
    dayBasis: 'calendar',
    exclusions: intervals,
    extensionDays,
    paused: clock.paused,
    calendar,
  });
}

function rowFromPlan(id: string, caseId: string, plan: AnchorPlan, revisionNo: number, rowStatus: string, clamped: boolean): DeadlineRow {
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
    rowStatus,
    revisionNo,
    calendarVersion: plan.calendarVersion,
    clamped,
  };
}

function earliestHandleStart(rows: readonly DeadlineRow[]): string | null {
  const starts = rows.filter((row) => row.ruleKey === 'case.handle').map((row) => row.startedOn);
  if (starts.length === 0) return null;
  return starts.sort()[0] ?? null;
}

function groupsOf(rows: readonly DeadlineRow[]): DeadlineRow[][] {
  const groups = new Map<string, DeadlineRow[]>();
  for (const row of rows) {
    const key = `${row.caseId}\u001f${row.ruleKey}\u001f${row.entrySeq}\u001f${row.procedureNode}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  for (const list of groups.values()) list.sort((left, right) => left.revisionNo - right.revisionNo);
  return [...groups.values()];
}

function parseStored(kind: string, contentJson: string | null): ExtendContent | PeriodContent | null {
  if (!contentJson) return null;
  try {
    const parsed: unknown = JSON.parse(contentJson);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    if (record.kind !== kind) return null;
    if (kind === 'extend') return parseExtend(record);
    if (kind === 'period') return parsePeriod(record);
    return null;
  } catch {
    return null;
  }
}

function parseExtend(value: Record<string, unknown>): ExtendContent | null {
  if (typeof value.days !== 'number' || typeof value.reason !== 'string') return null;
  if (!checkExtension(value.days, value.reason).ok) return null;
  return { kind: 'extend', days: value.days, reason: value.reason.trim() };
}

function parsePeriod(value: Record<string, unknown>): PeriodContent | null {
  const checked = checkManualPeriod({
    eventKind: typeof value.eventKind === 'string' ? value.eventKind : '',
    reason: typeof value.reason === 'string' ? value.reason : '',
    basisLabel: typeof value.basisLabel === 'string' ? value.basisLabel : '',
    startedOn: typeof value.startedOn === 'string' ? value.startedOn : '',
    endedOn: typeof value.endedOn === 'string' ? value.endedOn : '',
    backfill: value.backfill === true,
  });
  if (!checked.ok) return null;
  return { kind: 'period', ...checked.event };
}

function readPatch(input: {
  readonly version?: unknown;
  readonly year?: unknown;
  readonly holidays?: unknown;
  readonly makeupWorkdays?: unknown;
  readonly sourceUrl?: unknown;
}): CalendarYearPatch | null {
  if (typeof input.version !== 'string' || typeof input.year !== 'number' || typeof input.sourceUrl !== 'string') return null;
  if (!stringList(input.holidays) || !stringList(input.makeupWorkdays)) return null;
  return {
    version: input.version.trim(),
    year: input.year,
    holidays: stringList(input.holidays) as string[],
    makeupWorkdays: stringList(input.makeupWorkdays) as string[],
    sourceUrl: input.sourceUrl.trim(),
  };
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return value as string[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function periodMessage(reason: string): string {
  if (reason === 'missing-reason') return '期间事件理由必填';
  if (reason === 'missing-basis') return '期间事件须带依据标签';
  if (reason === 'invalid-interval') return '期间事件的时间区间不合法';
  return '期间事件类别不合规';
}

function periodOutlet(reason: string): string {
  if (reason === 'missing-reason') return '填写理由';
  if (reason === 'missing-basis') return '填写依据标签';
  if (reason === 'invalid-interval') return '结束日不得早于开始日';
  return '按枚举重选类别';
}

function blockBody(reason: string, message: string, citation: string | null, outlet: string): DeadlineHttpOutcome {
  return { status: 409, body: { result: reason, reason, message, basis: citation, outlet } };
}
