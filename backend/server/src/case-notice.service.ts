// 告知、陈述申辩与听证（E05、E06；#272）。
// T10／T11 从 E04 进入 E05；告知呈批沿用 doc.*；T13 送达起算陈述申辩期与听证申请期。
// X07（law＋userLock）在告知批准与送达两处 409；X26（normative）在批准路径走 #258 两段式。
// 较大数额只提示；进入听证程序标记一经写「是」不清除；X28 只拦自动复开，重新申请按 T15。
// 期限计算与缺日历人工确认走 #246；失败与警告不改业务行，只写留痕。

import { Inject, Injectable } from '@nestjs/common';
import {
  rejected,
  CASE_NOTICE_FAILED_REASONS,
  type CaseNoticeAction,
  type CaseNoticeFailedReason,
} from '@natural-enforcement/audit';
import {
  CASE_STORE,
  CASE_SUPERVISION_ROLE,
  activeMarkerKeys,
  applyWarningGate,
  assessHearing,
  assessMandatoryReview,
  assertNoticeGate,
  canTakeFilingStep,
  checkHearingHost,
  checkHearingReopen,
  decideTransition,
  filingStatusAfter,
  findIllegal,
  hearingCountsAsHeld,
  hearingWindowState,
  isHearingEndKind,
  isStickyCaseMarker,
  readNoticeContent,
  readActiveCaseMarkers,
  stageIndex,
  type CaseStore,
  type CaseView,
  type HearingAssessment,
  type HearingRow,
  type NoticeContent,
  type NoticeRow,
  type PartySubmissionRow,
  type TransitionDecision,
  type TransitionSubject,
} from '@natural-enforcement/case';
import {
  WORK_CALENDAR_V1,
  civilDate,
  mergeCalendars,
  planAnchor,
  type AnchorPlan,
  type DeadlineRule,
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
import { appendRuleConfirmation, ruleKeyBody, warningBody } from './case-rule-confirmation.ts';
import { persistTransitionEffects } from './case-transition-write.ts';
import { CLOCK, type Clock } from './clock.ts';
import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type TxScope, type UnitOfWork } from './unit-of-work.ts';

const READ_OPCODE = 'case.read';
const DRAFT_OPCODE = 'doc.draft';
const SUBMIT_OPCODE = 'doc.submit';
const REVIEW_OPCODE = 'doc.admin.review';
const APPROVE_OPCODE = 'doc.approve';
const HEARING_OPCODE = 'case.review.record';
const HANDLER_ROLES = new Set(['main', 'assist']);
const FAIL_REASONS = new Set<string>(CASE_NOTICE_FAILED_REASONS);

export type CaseNoticeHttpOutcome =
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

interface ConfirmationInput {
  readonly confirmedRuleKeys?: readonly string[];
  readonly confirmReasons?: Readonly<Record<string, string>>;
}

interface FrozenSummary {
  readonly id: string;
  readonly opinionId: string;
  readonly kind: string;
  readonly destinationCode: string;
  readonly violations: readonly {
    readonly penaltyCodes: readonly string[];
    readonly fineAmount: number | null;
  }[];
}

@Injectable()
export class CaseNoticeService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILING_ADMIN_REVIEW) private readonly adminReview: 'skip' | 'one-level',
    private readonly access: AccessControlService,
  ) {}

  async read(actor: ActorRef, caseId: string): Promise<CaseNoticeHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const denied = await this.authorize(actor, READ_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };
    await this.settleExpired(caseId);
    const current = (await this.cases.readCaseView(caseId)) ?? view;
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    const notices = await this.cases.listNotices(caseId);
    const notice = notices.at(-1) ?? null;
    const markers = await readActiveCaseMarkers(this.cases, caseId);
    const submissions = await this.cases.listPartySubmissions(caseId);
    const hearings = await this.cases.listHearings(caseId);
    const deadlines = (await this.cases.listDeadlineRows(caseId)).filter(
      (row) => row.ruleKey === 'notice.statement' || row.ruleKey === 'hearing.apply',
    );
    const frozen = await this.latestFrozen(caseId);
    const assessment = notice && frozen ? this.assessOf(notice, frozen) : null;
    const isHandler = current.handlers.some((row) => row.personnelId === actor.personnelId && HANDLER_ROLES.has(row.role));
    const inReview = current.status === 'in_progress' && current.currentStage === 'E04';
    const openHearing = hearings.find((row) => row.status !== 'ended') ?? null;
    const endedHearing = hearings.some((row) => row.status === 'ended');
    const window = notice ? await this.windowOfNotice(notice) : null;
    return {
      status: 200,
      body: {
        id: current.id,
        status: current.status,
        currentStage: current.currentStage,
        stageEntrySeq: current.stageEntrySeq,
        markers,
        hearingEntered: markers.includes('hearing-entered'),
        notice: notice ? noticeView(notice) : null,
        content: notice ? parseJson(notice.contentJson) : null,
        frozenDecision: frozen ? { opinionId: frozen.opinionId, kind: frozen.kind } : null,
        hearingAssessment: assessment
          ? {
              autoHit: assessment.autoHit,
              autoReasons: assessment.autoReasons,
              manualHit: assessment.manualHit,
              required: assessment.required,
              amountReached: assessment.amountReached,
              hints: assessment.hints,
              block: assessment.block,
            }
          : null,
        deadlines: deadlines.map((row) => ({
          ruleKey: row.ruleKey,
          entrySeq: row.entrySeq,
          startedOn: row.startedOn,
          dueOn: row.dueOn,
          needsManualConfirmation: row.needsManualConfirmation,
          confirmationTrace: row.confirmationTrace,
          windowState: hearingWindowState({
            dueOn: row.dueOn,
            needsManualConfirmation: row.needsManualConfirmation,
            today: civilDate(this.clock.now()),
          }),
        })),
        hearingWindow: window,
        submissions: submissions.map(submissionView),
        hearings: hearings.map(hearingView),
        entries: {
          draft: inReview && isHandler,
          submit: notice?.status === 'drafting' && notice.drafterId === actor.personnelId,
          review: notice?.status === 'pending_review' && roles.includes('行政审核'),
          approve: notice?.status === 'pending_approval' && roles.includes('行政审批'),
          serve: notice?.status === 'approved' && isHandler,
          statement: notice?.status === 'served' && isHandler,
          complete: notice?.status === 'served' && isHandler,
          hearingRequest: notice?.status === 'served' && isHandler && openHearing === null && window?.kind !== 'closed',
          hearingOperate: openHearing !== null && roles.includes('行政审核'),
          newFact:
            inReview === false
            && isHandler
            && (current.currentStage === 'E05' || current.currentStage === 'E06'),
          reopen: endedHearing && roles.includes('行政审核'),
        },
      },
    };
  }

  /** 拟制或保存告知：E04 时执行 T10／T11 进入 E05；E05 时更新草稿。 */
  async saveNotice(actor: ActorRef, caseId: string, input: { readonly content?: unknown }): Promise<CaseNoticeHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.notice-drafted', true);
    if ('status' in prepared) return prepared;
    const parsed = readNoticeContent(input.content);
    if (!parsed.ok) return this.failContent(prepared, 'case.notice-drafted', DRAFT_OPCODE, parsed.hit);
    const frozen = await this.latestFrozen(prepared.view.id);
    if (!frozen) {
      return this.fail(prepared, 'case.notice-drafted', DRAFT_OPCODE, {
        httpStatus: 409,
        reason: 'no-frozen-decision',
        message: '缺少已冻结的拟决定摘要',
        outlet: '先完成审理意见签出',
      });
    }
    if (frozen.kind !== parsed.content.kind) {
      return this.fail(prepared, 'case.notice-drafted', DRAFT_OPCODE, {
        httpStatus: 409,
        reason: 'notice-kind-mismatch',
        message: '告知类型与审理意见不一致',
        outlet: '按审理意见的拟处罚或拟不予处罚选择',
      });
    }
    const assessment = this.assessOfContent(parsed.content, frozen);
    const at = this.clock.now();
    if (prepared.view.currentStage === 'E04') {
      const markers = await readActiveCaseMarkers(this.cases, caseId);
      const hearings = await this.cases.listHearings(caseId);
      const mandatory = assessMandatoryReview({
        decisionKind: parsed.content.kind,
        hearingHeld: hearings.some((row) => row.endKind === 'concluded'),
        hearingEntered:
          markers.includes('hearing-entered')
          || hearings.some((row) => row.acceptedAt !== null || row.scheduledAt !== null),
        penaltyCodes: frozen.violations.flatMap((row) => row.penaltyCodes),
        criminalTransfer: false,
        manualItems: [],
      });
      if (mandatory.required) {
        return this.fail(prepared, 'case.notice-drafted', DRAFT_OPCODE, {
          httpStatus: 409,
          reason: 'legal-review-required',
          message: '命中自动必审，须先完成告知前法制审核',
          outlet: '发起法制审核，通过后回到告知',
        });
      }
      const transitionId = parsed.content.kind === 'penalty' ? 'T10' : 'T11';
      const other = await this.cases.countInFlightApprovals(caseId);
      const subject = await this.subjectOf(prepared.view, prepared.roles, other);
      const decision = decideTransition({ operation: { kind: 'transition', transitionId }, subject });
      if (!decision.ok) return this.settle(prepared, 'case.notice-drafted', DRAFT_OPCODE, decision);
      const effects = decision.effects;
      if (
        effects.kind !== 'advance'
        || effects.currentStage !== 'E05'
        || effects.stageEntrySeq === null
        || !effects.transitionCode
      ) {
        return this.fail(prepared, 'case.notice-drafted', DRAFT_OPCODE, {
          httpStatus: 409,
          reason: 'invalid-state',
          message: '该审理意见没有可执行的告知去向',
          outlet: '按当前环节重新提交',
        });
      }
      const noticeId = newUlid();
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
          return rejected<CaseNoticeHttpOutcome>(
            blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
            {
              action: 'case.notice-drafted',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, caseId, DRAFT_OPCODE),
            },
          );
        }
        const saved = await tx.cases.saveNoticeDraft({
          noticeId,
          caseId,
          entrySeq: effects.stageEntrySeq as number,
          kind: parsed.content.kind,
          drafterId: actor.personnelId,
          isNew: true,
          expectedVersionNo: 0,
          versionId: newUlid(),
          contentJson: JSON.stringify(parsed.content),
          at,
        });
        if (!saved) {
          return rejected<CaseNoticeHttpOutcome>(
            blockBody('concurrent-change', '告知已被他人更新', null, '请重新读取后再试'),
            {
              action: 'case.notice-drafted',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, caseId, DRAFT_OPCODE),
            },
          );
        }
        await tx.audit.append({
          action: 'case.notice-drafted',
          ...this.parties(prepared, caseId, DRAFT_OPCODE),
          detail: JSON.stringify({
            caseId,
            noticeId,
            kind: parsed.content.kind,
            transitionId: effects.transitionCode,
            entrySeq: effects.stageEntrySeq,
            hearingRequired: assessment.required,
          }),
        });
        await tx.audit.append({
          action: 'case.transitioned',
          ...this.parties(prepared, caseId, DRAFT_OPCODE),
          detail: JSON.stringify({ caseId, transitionId: effects.transitionCode }),
        });
        return {
          status: 200 as const,
          body: {
            result: 'notice-drafted',
            noticeId,
            caseId,
            currentStage: effects.currentStage,
            stageEntrySeq: effects.stageEntrySeq,
            hints: assessment.hints,
          },
        };
      });
    }
    const existing = await this.cases.readOpenNotice(caseId);
    if (!existing) {
      if (prepared.view.currentStage !== 'E05') {
        return this.fail(prepared, 'case.notice-drafted', DRAFT_OPCODE, {
          httpStatus: 409,
          reason: 'invalid-state',
          message: '当前没有可保存的告知草稿',
          outlet: '先由审理意见进入告知',
        });
      }
      const noticeId = newUlid();
      return this.uow.run(async (tx) => {
        const saved = await tx.cases.saveNoticeDraft({
          noticeId,
          caseId,
          entrySeq: prepared.view.stageEntrySeq,
          kind: parsed.content.kind,
          drafterId: actor.personnelId,
          isNew: true,
          expectedVersionNo: 0,
          versionId: newUlid(),
          contentJson: JSON.stringify(parsed.content),
          at,
        });
        if (!saved) {
          return rejected<CaseNoticeHttpOutcome>(
            blockBody('concurrent-change', '告知已被他人更新', null, '请重新读取后再试'),
            {
              action: 'case.notice-drafted',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, caseId, DRAFT_OPCODE),
            },
          );
        }
        await tx.audit.append({
          action: 'case.notice-drafted',
          ...this.parties(prepared, caseId, DRAFT_OPCODE),
          detail: JSON.stringify({
            caseId,
            noticeId,
            kind: parsed.content.kind,
            entrySeq: prepared.view.stageEntrySeq,
            afterLegalReview: true,
            hearingRequired: assessment.required,
          }),
        });
        return {
          status: 200 as const,
          body: {
            result: 'notice-drafted',
            noticeId,
            caseId,
            currentStage: prepared.view.currentStage,
            stageEntrySeq: prepared.view.stageEntrySeq,
            hints: assessment.hints,
          },
        };
      });
    }
    if (existing.status !== 'drafting') {
      return this.fail(prepared, 'case.notice-drafted', DRAFT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '告知已提交，不能再改',
        outlet: '等审批办结或退回后再改',
      });
    }
    if (existing.drafterId !== actor.personnelId) return { status: 403, body: { reason: 'permission-denied' } };
    return this.uow.run(async (tx) => {
      const saved = await tx.cases.saveNoticeDraft({
        noticeId: existing.id,
        caseId,
        entrySeq: existing.entrySeq,
        kind: existing.kind,
        drafterId: existing.drafterId,
        isNew: false,
        expectedVersionNo: existing.currentVersionNo,
        versionId: newUlid(),
        contentJson: JSON.stringify(parsed.content),
        at,
      });
      if (!saved) {
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('concurrent-change', '告知已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.notice-drafted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, DRAFT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.notice-drafted',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({
          caseId,
          noticeId: existing.id,
          versionNo: existing.currentVersionNo + 1,
          hearingRequired: assessment.required,
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'notice-drafted',
          noticeId: existing.id,
          caseId,
          versionNo: existing.currentVersionNo + 1,
          hints: assessment.hints,
        },
      };
    });
  }

  async submitNotice(actor: ActorRef, noticeId: string): Promise<CaseNoticeHttpOutcome> {
    const loaded = await this.cases.readNoticeById(noticeId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, SUBMIT_OPCODE, 'case.notice-submitted', true);
    if ('status' in prepared) return prepared;
    if (loaded.drafterId !== actor.personnelId) return { status: 403, body: { reason: 'permission-denied' } };
    if (!canTakeFilingStep('submit', loaded.status)) {
      return this.fail(prepared, 'case.notice-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '告知不在拟制中',
        outlet: '先保存告知稿',
      });
    }
    const at = this.clock.now();
    const chainId = newUlid();
    return this.uow.run(async (tx) => {
      const opened = await tx.cases.openApprovalChain({
        id: chainId,
        caseId: loaded.caseId,
        kind: 'notice',
        openedBy: actor.personnelId,
        openedAt: at,
      });
      if (!opened) {
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('X18', '本案已有进行中的审批链', '同一案件同时只有一条进行中的审批链', '先办结或撤回当前呈批'),
          {
            action: 'case.notice-submitted',
            outcome: 'failed',
            reason: 'X18',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      const nextStatus = filingStatusAfter('submit', this.adminReview);
      const stepped = await tx.cases.applyNoticeStep({
        noticeId,
        expectedStatus: loaded.status,
        nextStatus,
        adminReview: this.adminReview,
        approvalChainId: chainId,
        stepId: newUlid(),
        step: 'submit',
        versionNo: loaded.currentVersionNo,
        actorId: actor.personnelId,
        opinion: null,
        at,
      });
      if (!stepped) {
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('concurrent-change', '告知已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.notice-submitted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.notice-submitted',
        ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
        detail: JSON.stringify({ caseId: loaded.caseId, noticeId, chainId }),
      });
      return {
        status: 200 as const,
        body: { result: 'notice-submitted', noticeId, caseId: loaded.caseId, status: nextStatus },
      };
    });
  }

  async reviewNotice(actor: ActorRef, noticeId: string, input: { readonly opinion: string | null }): Promise<CaseNoticeHttpOutcome> {
    const loaded = await this.cases.readNoticeById(noticeId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, REVIEW_OPCODE, 'case.notice-reviewed', false);
    if ('status' in prepared) return prepared;
    if (!canTakeFilingStep('review', loaded.status)) {
      return this.fail(prepared, 'case.notice-reviewed', REVIEW_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前状态不能审核',
        outlet: '告知须在待审核',
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const nextStatus = filingStatusAfter('review', this.adminReview);
      const stepped = await tx.cases.applyNoticeStep({
        noticeId,
        expectedStatus: loaded.status,
        nextStatus,
        stepId: newUlid(),
        step: 'review',
        versionNo: loaded.currentVersionNo,
        actorId: actor.personnelId,
        opinion: input.opinion,
        at,
      });
      if (!stepped) {
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('concurrent-change', '告知已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.notice-reviewed',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, REVIEW_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.notice-reviewed',
        ...this.parties(prepared, loaded.caseId, REVIEW_OPCODE),
        detail: JSON.stringify({ caseId: loaded.caseId, noticeId }),
      });
      return {
        status: 200 as const,
        body: { result: 'notice-reviewed', noticeId, caseId: loaded.caseId, status: nextStatus },
      };
    });
  }

  async approveNotice(
    actor: ActorRef,
    noticeId: string,
    input: ConfirmationInput & { readonly opinion: string | null },
  ): Promise<CaseNoticeHttpOutcome> {
    const loaded = await this.cases.readNoticeById(noticeId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, APPROVE_OPCODE, 'case.notice-approved', false);
    if ('status' in prepared) return prepared;
    if (!canTakeFilingStep('approve', loaded.status)) {
      return this.fail(prepared, 'case.notice-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '告知不在待审批',
        outlet: '先完成前面的审批步骤',
      });
    }
    const content = readNoticeContent(parseJson(loaded.contentJson));
    if (!content.ok) return { status: 400, body: { result: 'non-compliant', ...content.hit } };
    const frozen = await this.latestFrozen(loaded.caseId);
    if (!frozen) {
      return this.fail(prepared, 'case.notice-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'no-frozen-decision',
        message: '缺少已冻结的拟决定摘要',
        outlet: '先完成审理意见签出',
      });
    }
    const assessment = this.assessOfContent(content.content, frozen);
    const blocked = this.x07Outcome(prepared, 'case.notice-approved', APPROVE_OPCODE, assessment);
    if (blocked) return blocked;
    const markers = await readActiveCaseMarkers(this.cases, loaded.caseId);
    const hearings = await this.cases.listHearings(loaded.caseId);
    const mandatoryAssessment = assessMandatoryReview({
      decisionKind: content.content.kind,
      hearingHeld: hearings.some((row) => row.endKind === 'concluded'),
      hearingEntered:
        markers.includes('hearing-entered')
        || hearings.some((row) => row.acceptedAt !== null || row.scheduledAt !== null),
      penaltyCodes: frozen.violations.flatMap((row) => row.penaltyCodes),
      criminalTransfer: false,
      manualItems: [],
    });
    const mandatory = mandatoryAssessment.required || content.content.mandatoryReview;
    const coverage = await this.noticeCoverage(content.content.preReviewApproval, loaded.caseId, frozen);
    const warning = assertNoticeGate({
      mandatory,
      preReviewApproval: content.content.preReviewApproval,
      coverage,
    });
    const gate = applyWarningGate({
      notes: warning ? [warning] : [],
      confirmedRuleKeys: input.confirmedRuleKeys,
      confirmReasons: input.confirmReasons,
    });
    if (gate.kind === 'reject') return { status: 400, body: ruleKeyBody(gate.decision) };
    if (gate.kind === 'hold') return this.holdWarning(prepared, 'case.notice-approved', APPROVE_OPCODE, gate.decision);
    const confirmation = gate.kind === 'clear' ? gate.confirmation : null;
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyNoticeStep({
        noticeId,
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
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('concurrent-change', '告知已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.notice-approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
          },
        );
      }
      if (loaded.approvalChainId) {
        const closed = await tx.cases.closeApprovalChain(loaded.approvalChainId);
        if (!closed) {
          return rejected<CaseNoticeHttpOutcome>(
            blockBody('concurrent-change', '审批链已被他人办结', null, '请重新读取后再试'),
            {
              action: 'case.notice-approved',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
            },
          );
        }
      }
      const parties = this.parties(prepared, loaded.caseId, APPROVE_OPCODE);
      await tx.audit.append({
        action: 'case.notice-approved',
        ...parties,
        detail: JSON.stringify({
          caseId: loaded.caseId,
          noticeId,
          hearingRequired: assessment.required,
          mandatoryReview: mandatory,
          confirmationRuleKeys: confirmation?.ruleKeys ?? [],
        }),
      });
      if (confirmation) {
        await appendRuleConfirmation(tx.audit, {
          parties,
          confirmation,
          at,
          step: 'notice-approve:X26',
          confirmReasons: input.confirmReasons,
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'notice-approved',
          noticeId,
          caseId: loaded.caseId,
          hints: assessment.hints,
          hearingRequired: assessment.required,
        },
      };
    });
  }

  /** T13 送达：进入告知等待，起算陈述申辩期与听证申请期。 */
  async serveNotice(actor: ActorRef, noticeId: string): Promise<CaseNoticeHttpOutcome> {
    const loaded = await this.cases.readNoticeById(noticeId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, SUBMIT_OPCODE, 'case.notice-served', true);
    if ('status' in prepared) return prepared;
    if (loaded.status !== 'approved') {
      return this.fail(prepared, 'case.notice-served', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '告知须先批准再送达',
        outlet: '先完成告知审批',
      });
    }
    const content = readNoticeContent(parseJson(loaded.contentJson));
    if (!content.ok) return { status: 400, body: { result: 'non-compliant', ...content.hit } };
    const frozen = await this.latestFrozen(loaded.caseId);
    if (!frozen) {
      return this.fail(prepared, 'case.notice-served', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'no-frozen-decision',
        message: '缺少已冻结的拟决定摘要',
        outlet: '先完成审理意见签出',
      });
    }
    const assessment = this.assessOfContent(content.content, frozen);
    const blocked = this.x07Outcome(prepared, 'case.notice-served', SUBMIT_OPCODE, assessment);
    if (blocked) return blocked;
    const other = await this.cases.countInFlightApprovals(loaded.caseId);
    const subject = await this.subjectOf(prepared.view, prepared.roles, other);
    const decision = decideTransition({ operation: { kind: 'transition', transitionId: 'T13' }, subject });
    if (!decision.ok) return this.settle(prepared, 'case.notice-served', SUBMIT_OPCODE, decision);
    const effects = decision.effects;
    const at = this.clock.now();
    const servedOn = civilDate(at);
    const deadlines = await this.planDeadlines(loaded, content.content, servedOn);
    return this.uow.run(async (tx) => {
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
      if (!wrote) {
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.notice-served',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      const served = await tx.cases.markNoticeServed({
        noticeId,
        servedBy: actor.personnelId,
        servedAt: at,
        servedOn,
      });
      if (!served) {
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('concurrent-change', '告知已被他人送达', null, '请重新读取后再试'),
          {
            action: 'case.notice-served',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      for (const deadline of deadlines.rows) {
        const inserted = await tx.cases.insertDeadlineRow({
          id: newUlid(),
          caseId: loaded.caseId,
          ruleKey: deadline.rule.key,
          entrySeq: deadline.entrySeq,
          procedureNode: 'E05',
          startingDocument: noticeId,
          consumption: deadline.rule.consumption,
          ruleVersion: deadline.rule.version,
          dayCount: deadline.rule.dayCount,
          dayBasis: deadline.rule.dayBasis,
          partyFacing: deadline.rule.partyFacing,
          extensionAllowance: deadline.rule.extensionAllowance,
          startedOn: deadline.startedOn,
          dueOn: deadline.due.dueOn,
          needsManualConfirmation: deadline.due.needsManualConfirmation,
          confirmationTrace: deadline.due.trace,
          rowStatus: 'open',
          revisionNo: 0,
          calendarVersion: deadline.calendarVersion,
          clamped: false,
        });
        if (!inserted) {
          return rejected<CaseNoticeHttpOutcome>(
            blockBody('concurrent-change', '期限锚点已存在', null, '请重新读取后再试'),
            {
              action: 'case.notice-served',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
            },
          );
        }
        await tx.audit.append({
          action: 'deadline.recorded',
          ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          detail: JSON.stringify({
            caseId: loaded.caseId,
            ruleKey: deadline.rule.key,
            entrySeq: deadline.entrySeq,
            procedureNode: 'E05',
            startedOn: deadline.startedOn,
            dueOn: deadline.due.dueOn,
            needsManualConfirmation: deadline.due.needsManualConfirmation,
            trace: deadline.due.trace,
          }),
        });
      }
      await this.setMarker(tx, prepared, loaded.caseId, 'notice-served', 'set', noticeId);
      await this.setMarker(tx, prepared, loaded.caseId, 'notice-waiting', 'set', noticeId);
      const parties = this.parties(prepared, loaded.caseId, SUBMIT_OPCODE);
      await tx.audit.append({
        action: 'case.notice-served',
        ...parties,
        detail: JSON.stringify({ caseId: loaded.caseId, noticeId, servedOn, transitionId: 'T13' }),
      });
      await tx.audit.append({
        action: 'case.transitioned',
        ...parties,
        detail: JSON.stringify({ caseId: loaded.caseId, transitionId: 'T13' }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'notice-served',
          noticeId,
          caseId: loaded.caseId,
          servedOn,
          deadlines: deadlines.rows.map((row) => ({
            ruleKey: row.rule.key,
            startedOn: row.startedOn,
            dueOn: row.due.dueOn,
            needsManualConfirmation: row.due.needsManualConfirmation,
            confirmationTrace: row.due.trace,
          })),
          hints: assessment.hints,
          prompts: deadlines.needsManual ? ['工作日口径缺日历年，需人工确认届满日'] : [],
        },
      };
    });
  }

  /** 登记当事人陈述申辩。不改状态。 */
  async recordStatement(actor: ActorRef, caseId: string, input: { readonly note?: unknown }): Promise<CaseNoticeHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, SUBMIT_OPCODE, 'case.statement-recorded', true);
    if ('status' in prepared) return prepared;
    const note = text(input.note);
    if (note === '') {
      return this.fail(prepared, 'case.statement-recorded', SUBMIT_OPCODE, {
        httpStatus: 400,
        reason: 'missing-note',
        message: '陈述申辩内容必填',
        outlet: '填写陈述申辩内容',
      });
    }
    const notice = await this.cases.readOpenNotice(caseId);
    const served = (await this.cases.listNotices(caseId)).at(-1) ?? null;
    const target = notice?.status === 'served' ? notice : served?.status === 'served' ? served : null;
    if (!target) {
      return this.fail(prepared, 'case.statement-recorded', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '告知书尚未送达',
        outlet: '先送达告知书',
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      await tx.cases.insertPartySubmission({
        id: newUlid(),
        caseId,
        noticeId: target.id,
        kind: 'statement',
        note,
        recordedBy: actor.personnelId,
        recordedAt: at,
      });
      await tx.audit.append({
        action: 'case.statement-recorded',
        ...this.parties(prepared, caseId, SUBMIT_OPCODE),
        detail: JSON.stringify({ caseId, noticeId: target.id, kind: 'statement' }),
      });
      return { status: 200 as const, body: { result: 'statement-recorded', caseId, noticeId: target.id } };
    });
  }

  /** T14：书面放弃、陈述申辩完毕或期满视为放弃，进入决定拟制。 */
  async completeNotice(
    actor: ActorRef,
    caseId: string,
    input: { readonly basis?: unknown; readonly note?: unknown },
  ): Promise<CaseNoticeHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, SUBMIT_OPCODE, 'case.notice-completed', true);
    if ('status' in prepared) return prepared;
    const basis = text(input.basis);
    if (basis !== 'waiver' && basis !== 'statement-complete' && basis !== 'deemed-waived') {
      return this.fail(prepared, 'case.notice-completed', SUBMIT_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-kind',
        message: '没有这类告知等待结束依据',
        outlet: '按书面放弃、陈述申辩完毕或期满视为放弃选择',
      });
    }
    const note = text(input.note);
    if (basis === 'waiver' && note === '') {
      return this.fail(prepared, 'case.notice-completed', SUBMIT_OPCODE, {
        httpStatus: 400,
        reason: 'missing-note',
        message: '书面放弃须写明记载',
        outlet: '填写书面放弃的记载',
      });
    }
    const notices = await this.cases.listNotices(caseId);
    const notice = notices.at(-1) ?? null;
    if (!notice || notice.status !== 'served') {
      return this.fail(prepared, 'case.notice-completed', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '告知书尚未送达',
        outlet: '先送达告知书',
      });
    }
    if (basis === 'deemed-waived') {
      const state = await this.windowOfNotice(notice);
      if (state.kind === 'manual') {
        return this.deadlineManual(prepared, 'case.notice-completed', SUBMIT_OPCODE);
      }
      if (state.kind === 'open') {
        return this.fail(prepared, 'case.notice-completed', SUBMIT_OPCODE, {
          httpStatus: 409,
          reason: 'invalid-state',
          message: '告知期限未满，不能视为放弃',
          outlet: '待期限届满或登记书面放弃',
        });
      }
    }
    if (prepared.view.currentStage !== 'E05') {
      return this.fail(prepared, 'case.notice-completed', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '告知等待已结束',
        outlet: '按当前环节处理',
      });
    }
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T14' },
      subject: await this.subjectOf(prepared.view, prepared.roles, await this.cases.countInFlightApprovals(caseId)),
    });
    if (!decision.ok) return this.settle(prepared, 'case.notice-completed', SUBMIT_OPCODE, decision);
    const effects = decision.effects;
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      if (basis === 'waiver') {
        await tx.cases.insertPartySubmission({
          id: newUlid(),
          caseId,
          noticeId: notice.id,
          kind: 'notice-waiver',
          note,
          recordedBy: actor.personnelId,
          recordedAt: at,
        });
      }
      if (basis === 'deemed-waived') {
        await this.setMarker(tx, prepared, caseId, 'deemed-waived', 'set', notice.id);
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
          status: effects.mainStatus as string,
          suspended: effects.suspended ?? false,
        }));
      if (!moved) {
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.notice-completed',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, SUBMIT_OPCODE),
          },
        );
      }
      const parties = this.parties(prepared, caseId, SUBMIT_OPCODE);
      await tx.audit.append({
        action: 'case.notice-completed',
        ...parties,
        detail: JSON.stringify({ caseId, noticeId: notice.id, basis, note }),
      });
      await tx.audit.append({
        action: 'case.transitioned',
        ...parties,
        detail: JSON.stringify({ caseId, transitionId: 'T14', basis }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'notice-completed',
          caseId,
          basis,
          currentStage: effects.currentStage,
          stageEntrySeq: effects.stageEntrySeq,
          hearingEntered: (await readActiveCaseMarkersFrom(tx, caseId)).includes('hearing-entered'),
        },
      };
    });
  }

  /** T15：当事人申请听证。T14a 的视为放弃在此清除并恢复听证权利。 */
  async requestHearing(actor: ActorRef, caseId: string, input: { readonly note?: unknown }): Promise<CaseNoticeHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, SUBMIT_OPCODE, 'case.hearing-applied', true);
    if ('status' in prepared) return prepared;
    const notice = (await this.cases.listNotices(caseId)).at(-1) ?? null;
    if (!notice || notice.status !== 'served') {
      return this.fail(prepared, 'case.hearing-applied', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'hearing-request-before-notice',
        message: '告知书尚未送达，不能申请听证',
        outlet: '先送达告知书',
      });
    }
    const content = readNoticeContent(parseJson(notice.contentJson));
    if (!content.ok || !content.content.hearingNoticeAttached) {
      return this.fail(prepared, 'case.hearing-applied', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'hearing-request-before-notice',
        message: '本案告知未带听证告知，不能申请听证',
        outlet: '按告知内容处理',
      });
    }
    const openHearing = await this.cases.readOpenHearing(caseId);
    if (openHearing) {
      return this.fail(prepared, 'case.hearing-applied', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'hearing-already-requested',
        message: '本案已有进行中的听证申请',
        outlet: '先办结当前听证',
      });
    }
    const window = await this.windowOfNotice(notice);
    if (window.kind === 'manual') return this.deadlineManual(prepared, 'case.hearing-applied', SUBMIT_OPCODE);
    if (window.kind === 'closed') {
      return this.fail(prepared, 'case.hearing-applied', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'hearing-window-closed',
        message: '听证申请期已届满，视为放弃',
        outlet: '当事人不能在本案再申请听证',
      });
    }
    const markers = await readActiveCaseMarkers(this.cases, caseId);
    const submissions = await this.cases.listPartySubmissions(caseId);
    const restoredFromWaiver = submissions.some((row) => row.noticeId === notice.id && row.kind === 'notice-waiver');
    const restoring = markers.includes('deemed-waived') || restoredFromWaiver;
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T15' },
      subject: await this.subjectOf(prepared.view, prepared.roles, await this.cases.countInFlightApprovals(caseId)),
    });
    if (!decision.ok) return this.settle(prepared, 'case.hearing-applied', SUBMIT_OPCODE, decision);
    const effects = decision.effects;
    if (effects.stageEntrySeq === null) {
      return this.fail(prepared, 'case.hearing-applied', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '听证去向没有进入次序号',
        outlet: '按当前环节重新提交',
      });
    }
    const at = this.clock.now();
    const note = text(input.note);
    const hearingId = newUlid();
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
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.hearing-applied',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, SUBMIT_OPCODE),
          },
        );
      }
      const inserted = await tx.cases.insertHearing({
        id: hearingId,
        caseId,
        noticeId: notice.id,
        entrySeq: effects.stageEntrySeq as number,
        status: 'applied',
        hostPersonnelId: null,
        appliedAt: at,
        acceptedAt: null,
        scheduledAt: null,
        scheduledFor: null,
        endedAt: null,
        endKind: null,
        note: note === '' ? null : note,
        recordedBy: actor.personnelId,
      });
      if (!inserted) {
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('hearing-already-requested', '本案已有进行中的听证申请', null, '先办结当前听证'),
          {
            action: 'case.hearing-applied',
            outcome: 'failed',
            reason: 'hearing-already-requested',
            ...this.parties(prepared, caseId, SUBMIT_OPCODE),
          },
        );
      }
      await this.setMarker(tx, prepared, caseId, 'notice-waiting', 'cleared', hearingId);
      if (restoring) await this.setMarker(tx, prepared, caseId, 'deemed-waived', 'cleared', hearingId);
      await this.setMarker(tx, prepared, caseId, 'hearing-terminated', 'cleared', hearingId);
      const parties = this.parties(prepared, caseId, SUBMIT_OPCODE);
      await tx.audit.append({
        action: 'case.hearing-applied',
        ...parties,
        detail: JSON.stringify({
          caseId,
          hearingId,
          noticeId: notice.id,
          entrySeq: effects.stageEntrySeq,
          t14aRestored: restoring,
          note,
        }),
      });
      await tx.audit.append({
        action: 'case.transitioned',
        ...parties,
        detail: JSON.stringify({ caseId, transitionId: 'T15', t14aRestored: restoring }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'hearing-applied',
          caseId,
          hearingId,
          currentStage: effects.currentStage,
          stageEntrySeq: effects.stageEntrySeq,
          t14aRestored: restoring,
        },
      };
    });
  }

  async acceptHearing(actor: ActorRef, hearingId: string): Promise<CaseNoticeHttpOutcome> {
    const loaded = await this.cases.readHearing(hearingId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, HEARING_OPCODE, 'case.hearing-accepted', false);
    if ('status' in prepared) return prepared;
    if (loaded.status !== 'applied') {
      return this.fail(prepared, 'case.hearing-accepted', HEARING_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '听证不在待受理',
        outlet: '按当前听证状态处理',
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const updated = await tx.cases.applyHearingStep({
        hearingId,
        expectedStatuses: ['applied'],
        nextStatus: 'accepted',
        acceptedAt: at,
        at,
      });
      if (!updated) {
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('concurrent-change', '听证已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.hearing-accepted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, HEARING_OPCODE),
          },
        );
      }
      await this.setMarker(tx, prepared, loaded.caseId, 'hearing-entered', 'set', hearingId);
      await tx.audit.append({
        action: 'case.hearing-accepted',
        ...this.parties(prepared, loaded.caseId, HEARING_OPCODE),
        detail: JSON.stringify({ caseId: loaded.caseId, hearingId }),
      });
      return { status: 200 as const, body: { result: 'hearing-accepted', hearingId, caseId: loaded.caseId } };
    });
  }

  async scheduleHearing(
    actor: ActorRef,
    hearingId: string,
    input: { readonly scheduledFor?: unknown },
  ): Promise<CaseNoticeHttpOutcome> {
    const loaded = await this.cases.readHearing(hearingId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, HEARING_OPCODE, 'case.hearing-scheduled', false);
    if ('status' in prepared) return prepared;
    if (loaded.status !== 'applied' && loaded.status !== 'accepted') {
      return this.fail(prepared, 'case.hearing-scheduled', HEARING_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '听证不在可排期状态',
        outlet: '先受理或按当前状态处理',
      });
    }
    const scheduledFor = parseInstant(input.scheduledFor);
    if (scheduledFor === null) {
      return this.fail(prepared, 'case.hearing-scheduled', HEARING_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-state',
        message: '听证排期时间必填',
        outlet: '填写排期时间',
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const updated = await tx.cases.applyHearingStep({
        hearingId,
        expectedStatuses: ['applied', 'accepted'],
        nextStatus: 'scheduled',
        acceptedAt: loaded.acceptedAt ?? at,
        scheduledAt: at,
        scheduledFor,
        at,
      });
      if (!updated) {
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('concurrent-change', '听证已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.hearing-scheduled',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, HEARING_OPCODE),
          },
        );
      }
      await this.setMarker(tx, prepared, loaded.caseId, 'hearing-entered', 'set', hearingId);
      await tx.audit.append({
        action: 'case.hearing-scheduled',
        ...this.parties(prepared, loaded.caseId, HEARING_OPCODE),
        detail: JSON.stringify({ caseId: loaded.caseId, hearingId, scheduledFor: scheduledFor.toISOString() }),
      });
      return {
        status: 200 as const,
        body: { result: 'hearing-scheduled', hearingId, caseId: loaded.caseId, scheduledFor: scheduledFor.toISOString() },
      };
    });
  }

  /** 主持人指定：曾任主办、协办（含已换下的）不得主持。 */
  async designateHost(
    actor: ActorRef,
    hearingId: string,
    input: { readonly personnelId?: unknown },
  ): Promise<CaseNoticeHttpOutcome> {
    const loaded = await this.cases.readHearing(hearingId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, HEARING_OPCODE, 'case.hearing-host-designated', false);
    if ('status' in prepared) return prepared;
    if (loaded.status === 'ended') {
      return this.fail(prepared, 'case.hearing-host-designated', HEARING_OPCODE, {
        httpStatus: 409,
        reason: 'hearing-not-open',
        message: '听证已结束',
        outlet: '按当前听证状态处理',
      });
    }
    const personnelId = text(input.personnelId);
    if (personnelId === '') {
      return this.fail(prepared, 'case.hearing-host-designated', HEARING_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-state',
        message: '主持人必填',
        outlet: '选择主持人',
      });
    }
    const stints = await this.cases.listHandlerStints(loaded.caseId);
    const checked = checkHearingHost({
      handlerPersonnelIds: stints.map((row) => row.personnelId),
      candidateId: personnelId,
    });
    if (!checked.ok) {
      return this.fail(prepared, 'case.hearing-host-designated', HEARING_OPCODE, {
        httpStatus: 409,
        reason: checked.reason,
        message: checked.message,
        outlet: checked.outlet,
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const updated = await tx.cases.applyHearingStep({
        hearingId,
        expectedStatuses: [loaded.status],
        nextStatus: loaded.status,
        hostPersonnelId: personnelId,
        at,
      });
      if (!updated) {
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('concurrent-change', '听证已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.hearing-host-designated',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, HEARING_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.hearing-host-designated',
        ...this.parties(prepared, loaded.caseId, HEARING_OPCODE),
        detail: JSON.stringify({ caseId: loaded.caseId, hearingId, personnelId }),
      });
      return {
        status: 200 as const,
        body: { result: 'hearing-host-designated', hearingId, caseId: loaded.caseId, personnelId },
      };
    });
  }

  /** T16：听证结束。受理前撤回不算经过听证；其余算，标记保持「是」。 */
  async endHearing(
    actor: ActorRef,
    hearingId: string,
    input: { readonly endKind?: unknown; readonly note?: unknown },
  ): Promise<CaseNoticeHttpOutcome> {
    const loaded = await this.cases.readHearing(hearingId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, HEARING_OPCODE, 'case.hearing-ended', false);
    if ('status' in prepared) return prepared;
    if (loaded.status === 'ended') {
      return this.fail(prepared, 'case.hearing-ended', HEARING_OPCODE, {
        httpStatus: 409,
        reason: 'hearing-not-open',
        message: '听证已结束',
        outlet: '按当前听证状态处理',
      });
    }
    const endKind = text(input.endKind);
    if (!isHearingEndKind(endKind)) {
      return this.fail(prepared, 'case.hearing-ended', HEARING_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-kind',
        message: '没有这类听证结束方式',
        outlet: '按听证终结、撤回、放弃、不到场或终止选择',
      });
    }
    if (endKind === 'withdrawn-before-acceptance') {
      if (loaded.status !== 'applied') {
        return this.fail(prepared, 'case.hearing-ended', HEARING_OPCODE, {
          httpStatus: 409,
          reason: 'hearing-end-kind-invalid',
          message: '已受理的听证不能按受理前撤回结束',
          outlet: '按受理后撤回、放弃或终止选择',
        });
      }
    } else if (loaded.status === 'applied') {
      return this.fail(prepared, 'case.hearing-ended', HEARING_OPCODE, {
        httpStatus: 409,
        reason: 'hearing-end-kind-invalid',
        message: '未受理、未排期的听证不能按举行或不到场结束',
        outlet: '先受理或排期，或按受理前撤回结束',
      });
    }
    const countsAsHeld = hearingCountsAsHeld(endKind);
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T16' },
      subject: await this.subjectOf(prepared.view, prepared.roles, await this.cases.countInFlightApprovals(loaded.caseId)),
    });
    if (!decision.ok) return this.settle(prepared, 'case.hearing-ended', HEARING_OPCODE, decision);
    const effects = decision.effects;
    const at = this.clock.now();
    const note = text(input.note);
    return this.uow.run(async (tx) => {
      const ended = await tx.cases.applyHearingStep({
        hearingId,
        expectedStatuses: [loaded.status],
        nextStatus: 'ended',
        endedAt: at,
        endKind,
        note: note === '' ? loaded.note : note,
        at,
      });
      if (!ended) {
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('concurrent-change', '听证已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.hearing-ended',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, HEARING_OPCODE),
          },
        );
      }
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
        && (await tx.cases.advanceCasePointer({
          caseId: loaded.caseId,
          expectedStage: prepared.view.currentStage,
          expectedSeq: prepared.view.stageEntrySeq,
          stage: effects.currentStage as string,
          stageEntrySeq: effects.stageEntrySeq as number,
          status: effects.mainStatus as string,
          suspended: effects.suspended ?? false,
        }));
      if (!moved) {
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.hearing-ended',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, HEARING_OPCODE),
          },
        );
      }
      if (countsAsHeld) {
        await this.setMarker(tx, prepared, loaded.caseId, 'hearing-entered', 'set', hearingId);
        await this.setMarker(tx, prepared, loaded.caseId, 'hearing-terminated', 'set', hearingId);
      }
      // 决定尚未作出：告知等待重新挂起，允许按 T15 重新申请（T16a）。
      await this.setMarker(tx, prepared, loaded.caseId, 'notice-waiting', 'set', hearingId);
      const parties = this.parties(prepared, loaded.caseId, HEARING_OPCODE);
      await tx.audit.append({
        action: 'case.hearing-ended',
        ...parties,
        detail: JSON.stringify({
          caseId: loaded.caseId,
          hearingId,
          endKind,
          countsAsHeld,
          hearingEntered: countsAsHeld,
          reReviewRequired: countsAsHeld,
        }),
      });
      await tx.audit.append({
        action: 'case.transitioned',
        ...parties,
        detail: JSON.stringify({ caseId: loaded.caseId, transitionId: 'T16', endKind }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'hearing-ended',
          hearingId,
          caseId: loaded.caseId,
          endKind,
          countsAsHeld,
          hearingEntered: countsAsHeld,
          currentStage: effects.currentStage,
          stageEntrySeq: effects.stageEntrySeq,
        },
      };
    });
  }

  /** X28：自动复开已终止的听证一律 409；重新申请走 T15。 */
  async reopenHearing(actor: ActorRef, caseId: string): Promise<CaseNoticeHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, HEARING_OPCODE, 'case.hearing-reopen-refused', false);
    if ('status' in prepared) return prepared;
    const hearings = await this.cases.listHearings(caseId);
    const check = checkHearingReopen({ hasTerminatedHearing: hearings.some((row) => row.status === 'ended') });
    if (check.code === 'X28') {
      const row = findIllegal('X28');
      return this.fail(prepared, 'case.hearing-reopen-refused', HEARING_OPCODE, {
        httpStatus: 409,
        reason: 'X28',
        message: check.message,
        outlet: check.outlet,
        basis: row?.citation ?? null,
      });
    }
    return this.fail(prepared, 'case.hearing-reopen-refused', HEARING_OPCODE, {
      httpStatus: 409,
      reason: 'invalid-state',
      message: check.message,
      outlet: check.outlet,
    });
  }

  /** T17：陈述申辩或听证中提出须核实的新事实，回 E02，次序号加 1。 */
  async returnToInvestigation(
    actor: ActorRef,
    caseId: string,
    input: { readonly note?: unknown },
  ): Promise<CaseNoticeHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, SUBMIT_OPCODE, 'case.new-fact-returned', true);
    if ('status' in prepared) return prepared;
    const note = text(input.note);
    if (note === '') {
      return this.fail(prepared, 'case.new-fact-returned', SUBMIT_OPCODE, {
        httpStatus: 400,
        reason: 'missing-note',
        message: '新事实说明必填',
        outlet: '填写须核实的新事实',
      });
    }
    const openHearing = await this.cases.readOpenHearing(caseId);
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T17' },
      subject: await this.subjectOf(prepared.view, prepared.roles, await this.cases.countInFlightApprovals(caseId)),
    });
    if (!decision.ok) return this.settle(prepared, 'case.new-fact-returned', SUBMIT_OPCODE, decision);
    const effects = decision.effects;
    if (effects.stageEntrySeq === null) {
      return this.fail(prepared, 'case.new-fact-returned', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '回流没有进入次序号',
        outlet: '按当前环节重新提交',
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      if (openHearing) {
        const closed = await tx.cases.applyHearingStep({
          hearingId: openHearing.id,
          expectedStatuses: [openHearing.status],
          nextStatus: 'ended',
          endedAt: at,
          endKind: 'terminated',
          at,
        });
        if (!closed) {
          return rejected<CaseNoticeHttpOutcome>(
            blockBody('concurrent-change', '听证已被他人更新', null, '请重新读取后再试'),
            {
              action: 'case.new-fact-returned',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, caseId, SUBMIT_OPCODE),
            },
          );
        }
        if (openHearing.status !== 'applied') {
          await this.setMarker(tx, prepared, caseId, 'hearing-entered', 'set', openHearing.id);
        }
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
          status: effects.mainStatus as string,
          suspended: effects.suspended ?? false,
        }));
      if (!moved) {
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.new-fact-returned',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, SUBMIT_OPCODE),
          },
        );
      }
      const main = prepared.view.handlers.find((row) => row.role === 'main');
      const opinionId = newUlid();
      const returnId = newUlid();
      await tx.cases.appendApprovalOpinion({
        id: opinionId,
        caseId,
        reasonCode: 'R2',
        note,
        targetKey: 'stage:E02',
        actorId: actor.personnelId,
        createdAt: at,
      });
      await tx.cases.appendCaseReturn({
        id: returnId,
        caseId,
        opinionId,
        reasonCode: 'R2',
        inheritedCode: null,
        targetKey: 'stage:E02',
        receiverId: main?.personnelId ?? actor.personnelId,
        reflow: true,
        n5: false,
        entrySeqBefore: prepared.view.stageEntrySeq,
        entrySeqAfter: effects.stageEntrySeq,
        exitCode: null,
        rehearingRequired: true,
        revokeNotice: false,
        actorId: actor.personnelId,
        createdAt: at,
      });
      const invalidated = await tx.cases.listInvalidatedInstanceIds(caseId);
      const downstream = prepared.view.instances
        .filter((row) => stageIndex(row.stage) >= stageIndex('E05') && !invalidated.includes(row.id))
        .map((row) => row.id);
      for (const instanceId of downstream) {
        await tx.cases.appendStageInvalidation({
          id: newUlid(),
          caseId,
          instanceId,
          returnId,
          createdAt: at,
        });
      }
      const anchored = await this.writeReturnAnchor(tx, {
        caseId,
        entrySeq: effects.stageEntrySeq as number,
        actorId: actor.personnelId,
        at,
        openedAt: prepared.view.openedAt,
        handlingOrgId: prepared.view.handlingOrgId,
      });
      if (!anchored) {
        return rejected<CaseNoticeHttpOutcome>(
          blockBody('concurrent-change', '期限锚点已被他人写入', null, '请重新读取后再试'),
          {
            action: 'case.new-fact-returned',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, SUBMIT_OPCODE),
          },
        );
      }
      await this.setMarker(tx, prepared, caseId, 'notice-waiting', 'cleared', returnId);
      await this.setMarker(tx, prepared, caseId, 'deemed-waived', 'cleared', returnId);
      await this.setMarker(tx, prepared, caseId, 'hearing-terminated', 'cleared', returnId);
      const parties = this.parties(prepared, caseId, SUBMIT_OPCODE);
      await tx.audit.append({
        action: 'case.new-fact-returned',
        ...parties,
        detail: JSON.stringify({
          caseId,
          returnId,
          reasonCode: 'R2',
          entrySeqBefore: prepared.view.stageEntrySeq,
          entrySeqAfter: effects.stageEntrySeq,
        }),
      });
      await tx.audit.append({
        action: 'case.transitioned',
        ...parties,
        detail: JSON.stringify({ caseId, transitionId: 'T17' }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'new-fact-returned',
          caseId,
          currentStage: effects.currentStage,
          stageEntrySeq: effects.stageEntrySeq,
          returnId,
        },
      };
    });
  }

  /** 系统内法审引用的摘要覆盖：引用解析不出时按外部引用处理（#272 旧口径）。 */
  private async noticeCoverage(
    reference: string | null,
    caseId: string,
    frozen: FrozenSummary,
  ): Promise<'covered' | 'not-covered' | 'unknown'> {
    if (reference === null || reference.trim() === '') return 'unknown';
    const opinion = await this.cases.readLegalReviewOpinion(reference.trim());
    if (!opinion || opinion.caseId !== caseId) return 'unknown';
    const passed = opinion.conclusion === 'pass' && opinion.headSignedAt !== null;
    return passed && opinion.frozenDecisionId === frozen.id ? 'covered' : 'not-covered';
  }

  private async prepare(
    actor: ActorRef,
    caseId: string,
    opcode: string,
    action: CaseNoticeAction,
    mustBeHandler: boolean,
  ): Promise<Prepared | CaseNoticeHttpOutcome> {
    const initialView = await this.cases.readCaseView(caseId);
    if (!initialView) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    const initial: Prepared = { actorId: actor.personnelId, actorCode: account?.code ?? null, roles, view: initialView };
    const denied = await this.authorize(actor, opcode, initialView.handlingOrgId, caseId);
    if (denied) {
      const onlySupervision = roles.length > 0 && roles.every((role) => role === CASE_SUPERVISION_ROLE);
      if (denied === 'permission-denied' && onlySupervision) {
        return this.fail(initial, action, opcode, {
          httpStatus: 409,
          reason: 'X17',
          message: '监督角色不能推进案件',
          outlet: '请由有权办理人操作，监督不能推进主状态',
        });
      }
      return { status: 403, body: { reason: denied } };
    }
    await this.settleExpired(caseId);
    const view = (await this.cases.readCaseView(caseId)) ?? initialView;
    const prepared: Prepared = { ...initial, view };
    if (mustBeHandler && !view.handlers.some((row) => row.personnelId === actor.personnelId && HANDLER_ROLES.has(row.role))) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    return prepared;
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

  private async latestFrozen(caseId: string): Promise<FrozenSummary | null> {
    const rows = await this.cases.listFrozenDecisions(caseId);
    const latest = rows.at(-1);
    if (!latest) return null;
    try {
      const parsed = JSON.parse(latest.summaryJson) as Record<string, unknown>;
      const violations = Array.isArray(parsed.violations) ? parsed.violations : [];
      return {
        id: latest.id,
        opinionId: typeof parsed.opinionId === 'string' ? parsed.opinionId : latest.opinionId,
        kind: typeof parsed.kind === 'string' ? parsed.kind : '',
        destinationCode: typeof parsed.destinationCode === 'string' ? parsed.destinationCode : '',
        violations: violations.map((item) => {
          const row = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
          return {
            penaltyCodes: Array.isArray(row.penaltyCodes) ? (row.penaltyCodes as string[]) : [],
            fineAmount: typeof row.fineAmount === 'number' ? row.fineAmount : null,
          };
        }),
      };
    } catch {
      return null;
    }
  }

  private assessOf(notice: NoticeRow, frozen: FrozenSummary): HearingAssessment {
    const parsed = readNoticeContent(parseJson(notice.contentJson));
    if (!parsed.ok) {
      return {
        autoHit: false,
        autoReasons: [],
        manualHit: false,
        required: false,
        amountReached: false,
        hints: [],
        block: null,
      };
    }
    return this.assessOfContent(parsed.content, frozen);
  }

  private assessOfContent(content: NoticeContent, frozen: FrozenSummary): HearingAssessment {
    const penaltyCodes = frozen.violations.flatMap((row) => row.penaltyCodes);
    const fineAmount = frozen.violations.reduce((sum, row) => sum + (row.fineAmount ?? 0), 0);
    return assessHearing({
      penaltyCodes,
      fineAmount,
      confiscationValue: content.confiscationValue,
      partyType: content.partyType,
      manualItems: content.manualHearingItems,
      notApplicableHearing: content.notApplicableHearing,
      hearingNoticeAttached: content.hearingNoticeAttached,
    });
  }

  private x07Outcome(
    prepared: Prepared,
    action: CaseNoticeAction,
    opcode: string,
    assessment: HearingAssessment,
  ): Promise<CaseNoticeHttpOutcome> | null {
    if (!assessment.block) return null;
    const row = findIllegal('X07');
    return this.fail(prepared, action, opcode, {
      httpStatus: 409,
      reason: 'X07',
      message: assessment.block.message,
      outlet: row?.outlet ?? '先发听证告知',
      basis: row?.citation ?? null,
    });
  }

  private async deadlineManual(
    prepared: Prepared,
    action: CaseNoticeAction,
    opcode: string,
  ): Promise<CaseNoticeHttpOutcome> {
    return this.fail(prepared, action, opcode, {
      httpStatus: 409,
      reason: 'deadline-manual-confirmation-required',
      message: '工作日口径缺日历年，届满日需人工确认',
      outlet: '先装入工作日历或人工确认届满日，不按日历日计算',
    });
  }

  private async windowOfNotice(notice: NoticeRow): Promise<{ kind: 'open' | 'closed' | 'manual'; dueOn: string | null }> {
    const rows = await this.cases.listDeadlineRows(notice.caseId);
    const content = readNoticeContent(parseJson(notice.contentJson));
    const ruleKey = content.ok && content.content.hearingNoticeAttached ? 'hearing.apply' : 'notice.statement';
    const row = rows.find((item) => item.ruleKey === ruleKey && item.entrySeq === notice.entrySeq) ?? null;
    if (!row) return { kind: 'manual', dueOn: null };
    return {
      kind: hearingWindowState({
        dueOn: row.dueOn,
        needsManualConfirmation: row.needsManualConfirmation,
        today: civilDate(this.clock.now()),
      }),
      dueOn: row.dueOn,
    };
  }

  private windowOf(
    notice: NoticeRow | null,
    deadlines: readonly { readonly ruleKey: string; readonly entrySeq: number }[],
  ): 'open' | 'closed' | 'manual' | null {
    if (!notice) return null;
    const content = readNoticeContent(parseJson(notice.contentJson));
    const ruleKey = content.ok && content.content.hearingNoticeAttached ? 'hearing.apply' : 'notice.statement';
    const row = deadlines.find((item) => item.ruleKey === ruleKey && item.entrySeq === notice.entrySeq);
    if (!row) return null;
    return 'open';
  }

  /** 惰性结算：期限届满仍未申请，置「视为放弃」。只写留痕，不自动 T14。 */
  private async settleExpired(caseId: string): Promise<void> {
    const notices = await this.cases.listNotices(caseId);
    const notice = notices.at(-1);
    if (!notice || notice.status !== 'served') return;
    const markers = await readActiveCaseMarkers(this.cases, caseId);
    if (!markers.includes('notice-waiting') || markers.includes('deemed-waived')) return;
    if (markers.includes('hearing-entered')) return;
    const window = await this.windowOfNotice(notice);
    if (window.kind !== 'closed') return;
    const at = this.clock.now();
    await this.uow.run(async (tx) => {
      await tx.cases.appendCaseMarker({
        id: newUlid(),
        caseId,
        marker: 'deemed-waived',
        state: 'set',
        note: '期满未申请，视为放弃',
        actorId: notificationActor(notice),
        changedAt: at,
      });
      await tx.audit.append({
        action: 'case.marker-changed',
        actorId: notificationActor(notice),
        actorCode: null,
        subjectPersonnelId: null,
        subjectCode: null,
        orgUnitId: null,
        sourceIp: null,
        opcode: SUBMIT_OPCODE,
        resourceType: 'case',
        resourceId: caseId,
        detail: JSON.stringify({ caseId, marker: 'deemed-waived', state: 'set', basis: 'notice-window-closed' }),
      });
    });
  }

  private async planDeadlines(
    notice: NoticeRow,
    content: NoticeContent,
    servedOn: string,
  ): Promise<{
    readonly rows: readonly {
      readonly rule: DeadlineRule;
      readonly entrySeq: number;
      readonly startedOn: string;
      readonly due: DueDateHit;
      readonly calendarVersion: string;
    }[];
    readonly needsManual: boolean;
  }> {
    const installed = await this.cases.listCalendarInstalls();
    const calendar: WorkCalendar = mergeCalendars(WORK_CALENDAR_V1, installed);
    const keys = ['notice.statement', ...(content.hearingNoticeAttached ? ['hearing.apply'] : [])];
    const rows = [];
    let needsManual = false;
    for (const key of keys) {
      const planned = planAnchor({
        caseId: notice.caseId,
        ruleKey: key,
        entrySeq: notice.entrySeq,
        procedureNode: 'E05',
        startingDocument: notice.id,
        startedOn: servedOn,
        exclusions: [],
        extensionDays: 0,
        paused: false,
        calendar,
      });
      if (!planned.ok) continue;
      if (planned.plan.due.needsManualConfirmation) needsManual = true;
      rows.push({
        rule: planned.plan.rule,
        entrySeq: planned.plan.entrySeq,
        startedOn: planned.plan.startedOn,
        due: planned.plan.due,
        calendarVersion: planned.plan.calendarVersion,
      });
    }
    return { rows, needsManual };
  }

  private async writeReturnAnchor(
    tx: TxScope,
    input: {
      readonly caseId: string;
      readonly entrySeq: number;
      readonly actorId: string;
      readonly at: Date;
      readonly openedAt: Date;
      readonly handlingOrgId: string;
    },
  ): Promise<boolean> {
    const rows = await tx.cases.listDeadlineRows(input.caseId);
    const starts = rows.filter((row) => row.ruleKey === 'case.handle').map((row) => row.startedOn);
    const startedOn = starts.length > 0 ? starts.sort()[0] as string : civilDate(input.openedAt);
    const calendar = mergeCalendars(WORK_CALENDAR_V1, await tx.cases.listCalendarInstalls());
    const planned = planAnchor({
      caseId: input.caseId,
      ruleKey: 'case.handle',
      entrySeq: input.entrySeq,
      procedureNode: 'E02',
      startingDocument: null,
      startedOn,
      exclusions: [],
      extensionDays: 0,
      paused: false,
      calendar,
    });
    if (!planned.ok) return false;
    const inserted = await tx.cases.insertDeadlineRow(deadlineRowFromPlan(newUlid(), input.caseId, planned.plan));
    if (!inserted) return false;
    await tx.audit.append({
      action: 'deadline.recorded',
      actorId: input.actorId,
      actorCode: null,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId: input.handlingOrgId,
      sourceIp: null,
      opcode: SUBMIT_OPCODE,
      resourceType: 'case',
      resourceId: input.caseId,
      detail: JSON.stringify({
        caseId: input.caseId,
        ruleKey: 'case.handle',
        entrySeq: input.entrySeq,
        procedureNode: 'E02',
        startedOn,
        dueOn: planned.plan.due.dueOn,
        needsManualConfirmation: planned.plan.due.needsManualConfirmation,
        trace: planned.plan.due.trace,
      }),
    });
    return true;
  }

  private async setMarker(
    tx: TxScope,
    prepared: Prepared,
    caseId: string,
    marker: string,
    state: 'set' | 'cleared',
    note: string | null,
  ): Promise<void> {
    if (state === 'cleared' && isStickyCaseMarker(marker)) return;
    const at = this.clock.now();
    await tx.cases.appendCaseMarker({
      id: newUlid(),
      caseId,
      marker,
      state,
      note,
      actorId: prepared.actorId,
      changedAt: at,
    });
    await tx.audit.append({
      action: 'case.marker-changed',
      ...this.parties(prepared, caseId, SUBMIT_OPCODE),
      detail: JSON.stringify({ caseId, marker, state, note }),
    });
  }

  private async settle(
    prepared: Prepared,
    action: CaseNoticeAction,
    opcode: string,
    decision: Exclude<TransitionDecision, { ok: true }>,
  ): Promise<CaseNoticeHttpOutcome> {
    if (decision.httpStatus === 400) return { status: 400, body: ruleKeyBody(decision) };
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
    action: CaseNoticeAction,
    opcode: string,
    decision: Extract<TransitionDecision, { httpStatus: 200 }>,
  ): Promise<CaseNoticeHttpOutcome> {
    const reason = (FAIL_REASONS.has(decision.reason) ? decision.reason : 'invalid-state') as CaseNoticeFailedReason;
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
    action: CaseNoticeAction,
    opcode: string,
    hit: { readonly reason: string; readonly message: string; readonly outlet: string },
  ): Promise<CaseNoticeHttpOutcome> {
    return this.fail(prepared, action, opcode, {
      httpStatus: 400,
      reason: hit.reason,
      message: hit.message,
      outlet: hit.outlet,
    });
  }

  private async fail(
    prepared: Prepared,
    action: CaseNoticeAction,
    opcode: string,
    fail: {
      readonly httpStatus: 400 | 409;
      readonly reason: string;
      readonly message: string;
      readonly outlet: string;
      readonly basis?: string | null;
    },
  ): Promise<CaseNoticeHttpOutcome> {
    const reason = (FAIL_REASONS.has(fail.reason) ? fail.reason : 'invalid-state') as CaseNoticeFailedReason;
    const outcome: CaseNoticeHttpOutcome =
      fail.httpStatus === 400
        ? {
            status: 400,
            body: { result: 'non-compliant', reason: fail.reason, message: fail.message, outlet: fail.outlet },
          }
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
}

async function readActiveCaseMarkersFrom(tx: TxScope, caseId: string): Promise<readonly string[]> {
  return activeMarkerKeys(await tx.cases.listCaseMarkers(caseId));
}

function notificationActor(notice: NoticeRow): string {
  return notice.servedBy ?? notice.drafterId;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function noticeView(row: NoticeRow): Record<string, unknown> {
  return {
    id: row.id,
    entrySeq: row.entrySeq,
    kind: row.kind,
    status: row.status,
    drafterId: row.drafterId,
    currentVersionNo: row.currentVersionNo,
    servedBy: row.servedBy,
    servedAt: row.servedAt?.toISOString() ?? null,
    servedOn: row.servedOn,
    createdAt: row.createdAt.toISOString(),
  };
}

function submissionView(row: PartySubmissionRow): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    note: row.note,
    recordedBy: row.recordedBy,
    recordedAt: row.recordedAt.toISOString(),
  };
}

function hearingView(row: HearingRow): Record<string, unknown> {
  return {
    id: row.id,
    entrySeq: row.entrySeq,
    status: row.status,
    hostPersonnelId: row.hostPersonnelId,
    appliedAt: row.appliedAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    endKind: row.endKind,
    note: row.note,
  };
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

function blockBody(reason: string, message: string, citation: string | null, outlet: string): CaseNoticeHttpOutcome {
  return { status: 409, body: { result: reason, reason, message, basis: citation, outlet } };
}