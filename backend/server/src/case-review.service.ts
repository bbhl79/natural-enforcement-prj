// 调查终结与审理（#240）：T08 报告呈批、审理人指定与更换、case.review.record、T09 回流、T09a 异议呈批。
// 呈批沿用 doc.draft / doc.submit / doc.admin.review / doc.approve；审理意见用新增码 case.review.record。
// #282 裁 B：补充调查／修改纠正签出只落意见并开异议窗口，不立即执行 T09。
// 窗口结束（到期、明示放弃、异议支持审理意见）才在同一事务执行 T09：回 E02、R2 退回、#246 期限锚点，90 日不变。
// T08 与 T09 的迁移判定在引擎；T09a、T10、T11、T12 是 branch 边，由本服务解析后落到单一边。
// 「调查审理职能分离」与 X22 走 #258 两段式确认；X23、X32、X33 直接 409。
// 失败与警告不改业务行，只写留痕。

import { Inject, Injectable } from '@nestjs/common';
import {
  rejected,
  CASE_REVIEW_FAILED_REASONS,
  type CaseReviewAction,
  type CaseReviewFailedReason,
} from '@natural-enforcement/audit';
import {
  CASE_STORE,
  CASE_SUPERVISION_ROLE,
  CLUE_STORE,
  REVIEW_RETURN_REASON,
  activeConflicts,
  allowsObjection,
  applyWarningGate,
  canTakeFilingStep,
  checkReviewSign,
  checkReviewerCandidate,
  decideTransition,
  filingStatusAfter,
  findIllegal,
  isTerminalCaseStatus,
  objectionWindowDueAt,
  opinionDestination,
  readDesignationReason,
  readReviewObjectionContent,
  readReviewOpinionContent,
  readReviewReportContent,
  separationWarning,
  stageIndex,
  transitionalDeciderSeats,
  type CaseStore,
  type CaseView,
  type ReviewOpinionRow,
  type ClueStore,
  type ConflictEventFact,
  type FilingAdminReview,
  type HandlingSuggestion,
  type LimitationDiscoveryExit,
  type OpinionDestination,
  type ReviewCandidateFacts,
  type ReviewObjectionWindowRule,
  type ReviewObjectionWindowRow,
  type ReviewOpinionKind,
  type ReviewReportContent,
  type ReviewReportRow,
  type ReviewerDesignationRow,
  type RuleConfirmation,
  type GuardResult,
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
  type IdentityStore,
} from '@natural-enforcement/identity';

import { FILING_ADMIN_REVIEW } from './case-filing.service.ts';
import { LIMITATION_DISCOVERY_EXIT } from './investigation.service.ts';
import { appendRuleConfirmation, ruleKeyBody, warningBody } from './case-rule-confirmation.ts';
import { persistTransitionEffects } from './case-transition-write.ts';
import { CLOCK, type Clock } from './clock.ts';
import { CaseConflictService } from './case-conflict.service.ts';
import { LOGIN_DIRECTORY, type LoginAccount, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type TxScope, type UnitOfWork } from './unit-of-work.ts';

export const REVIEW_OBJECTION_WINDOW = Symbol('REVIEW_OBJECTION_WINDOW');

const READ_OPCODE = 'case.read';
const DRAFT_OPCODE = 'doc.draft';
const SUBMIT_OPCODE = 'doc.submit';
const REVIEW_OPCODE = 'doc.admin.review';
const APPROVE_OPCODE = 'doc.approve';
const RECORD_OPCODE = 'case.review.record';
// 过渡：明示放弃异议复用主办／协办可见的提交码，待 #230 回写 #71 时再定专用码。
const WAIVE_OPCODE = 'doc.submit';
const HANDLER_ROLES = new Set(['main', 'assist']);
const FAIL_REASONS = new Set<string>(CASE_REVIEW_FAILED_REASONS);

export type CaseReviewHttpOutcome =
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

@Injectable()
export class CaseReviewService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(CLUE_STORE) private readonly clues: ClueStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILING_ADMIN_REVIEW) private readonly adminReview: FilingAdminReview,
    @Inject(LIMITATION_DISCOVERY_EXIT) private readonly limitationExit: LimitationDiscoveryExit,
    @Inject(REVIEW_OBJECTION_WINDOW) private readonly objectionWindow: ReviewObjectionWindowRule,
    private readonly access: AccessControlService,
    private readonly conflicts: CaseConflictService,
  ) {}

  async read(actor: ActorRef, caseId: string): Promise<CaseReviewHttpOutcome> {
    const initialView = await this.cases.readCaseView(caseId);
    if (!initialView) return { status: 404, body: { result: 'not-found' } };
    const denied = await this.authorize(actor, READ_OPCODE, initialView.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };
    await this.settleObjectionWindows(caseId);
    const view = (await this.cases.readCaseView(caseId)) ?? initialView;
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    const [report, designations, opinions, frozen, objections, windows] = await Promise.all([
      this.cases.readOpenReviewReport(caseId),
      this.cases.listReviewerDesignations(caseId),
      this.cases.listReviewOpinions(caseId),
      this.cases.listFrozenDecisions(caseId),
      this.cases.listReviewObjections(caseId),
      this.cases.listReviewObjectionWindows(caseId),
    ]);
    const windowsByOpinion = new Map(windows.map((row) => [row.opinionId, row]));
    const currentEntry = view.currentStage === 'E04' ? view.stageEntrySeq : latestHearingEntry(view);
    const active = currentEntry === null ? null : activeDesignation(designations, currentEntry);
    const latest = currentEntry === null ? null : latestOpinionOf(opinions, currentEntry);
    const entryOpinions = currentEntry === null ? [] : opinions.filter((row) => row.entrySeq === currentEntry);
    const concluded = entryOpinions.some((row) => row.destinationCode !== 'T09');
    const leaderDecided = objections.some(
      (row) => row.status === 'decided' && row.decision === 'support-handler' && row.entrySeq === currentEntry,
    );
    const latestWindow = latest === null ? null : windowsByOpinion.get(latest.id) ?? null;
    const windowOpen = latestWindow?.status === 'open';
    const isHandler = view.handlers.some((row) => row.personnelId === actor.personnelId && HANDLER_ROLES.has(row.role));
    const isHead = await this.isHandlingOrgHead(actor.personnelId, view.handlingOrgId);
    const inReview = view.status === 'in_progress' && view.currentStage === 'E04';
    const frozenRow = frozen.at(-1) ?? null;
    return {
      status: 200,
      body: {
        id: view.id,
        status: view.status,
        currentStage: view.currentStage,
        stageEntrySeq: view.stageEntrySeq,
        suspended: view.suspended,
        entries: {
          report: view.status === 'in_progress' && view.currentStage === 'E02' && !view.suspended && isHandler,
          designate: inReview && isHead && !concluded && !leaderDecided && entryOpinions.length === 0,
          sign: inReview && roles.includes('行政审核') && !concluded && !leaderDecided && entryOpinions.length === 0,
          objection: isHandler && latest !== null && allowsObjection(latest.opinionKind) && windowOpen && !leaderDecided,
          waive: isHandler && windowOpen && !leaderDecided,
        },
        report: report
          ? {
              id: report.id,
              status: report.status,
              drafterId: report.drafterId,
              versionNo: report.currentVersionNo,
              content: parseJson(report.contentJson),
            }
          : null,
        reviewer: active
          ? {
              designationId: active.id,
              personnelId: active.personnelId,
              designatedBy: active.designatedBy,
              reason: active.reason,
              designatedAt: active.designatedAt.toISOString(),
            }
          : null,
        designations: designations.map((row) => ({
          id: row.id,
          entrySeq: row.entrySeq,
          personnelId: row.personnelId,
          designatedBy: row.designatedBy,
          reason: row.reason,
          replacesId: row.replacesId,
          designatedAt: row.designatedAt.toISOString(),
          supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
          active: active?.id === row.id,
        })),
        opinions: opinions.map((row) => ({
          id: row.id,
          entrySeq: row.entrySeq,
          kind: row.opinionKind,
          content: row.content,
          signedBy: row.signedBy,
          destinationCode: row.destinationCode,
          outcomeCode: row.outcomeCode,
          outcomeLabel: row.outcomeLabel,
          createdAt: row.createdAt.toISOString(),
          objectionWindow: objectionWindowView(windowsByOpinion.get(row.id)),
        })),
        objectionWindow: objectionWindowView(latestWindow),
        frozenDecision: frozenRow
          ? { opinionId: frozenRow.opinionId, summary: parseJson(frozenRow.summaryJson), createdAt: frozenRow.createdAt.toISOString() }
          : null,
        objections: objections.map((row) => ({
          id: row.id,
          entrySeq: row.entrySeq,
          opinionId: row.opinionId,
          status: row.status,
          decision: row.decision,
          decisionTransition: row.decisionTransition,
          decidedBy: row.decidedBy,
          decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
          createdAt: row.createdAt.toISOString(),
        })),
        prompts: { reviewer: active ? null : '尚未指定审理人' },
      },
    };
  }

  async saveReport(
    actor: ActorRef,
    caseId: string,
    input: { readonly content?: unknown; readonly reviewerId?: unknown },
  ): Promise<CaseReviewHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.review-report-drafted', true);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.review-report-drafted', DRAFT_OPCODE);
    if (terminal) return terminal;
    const stageHit = await this.requireReportDraftStage(prepared);
    if (stageHit) return stageHit;
    const active = await this.activeViolationIds(caseId);
    const content = readReviewReportContent(
      mergeReviewerId(input.content, input.reviewerId),
      active,
      { requireCoverage: false },
    );
    if (!content.ok) return this.failContent(prepared, 'case.review-report-drafted', DRAFT_OPCODE, content.hit);
    const open = await this.cases.readOpenReviewReport(caseId);
    if (open && open.status !== 'drafting') {
      return this.fail(prepared, 'case.review-report-drafted', DRAFT_OPCODE, {
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
      const saved = await tx.cases.saveReviewReportDraft({
        approvalId,
        caseId,
        drafterId: actor.personnelId,
        isNew: open === null,
        expectedVersionNo: open?.currentVersionNo ?? 0,
        versionId: newUlid(),
        contentJson: JSON.stringify(content.content),
        at,
      });
      if (!saved) {
        return rejected<CaseReviewHttpOutcome>(
          blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.review-report-drafted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, DRAFT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.review-report-drafted',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({ caseId, approvalId, versionNo: (open?.currentVersionNo ?? 0) + 1 }),
      });
      return {
        status: 200 as const,
        body: { result: 'review-report-drafted', approvalId, caseId, status: 'drafting' },
      };
    });
  }

  async submitReport(actor: ActorRef, approvalId: string): Promise<CaseReviewHttpOutcome> {
    const loaded = await this.loadReport(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, SUBMIT_OPCODE, 'case.review-report-submitted', true);
    if ('status' in prepared) return prepared;
    if (loaded.drafterId !== actor.personnelId) return { status: 403, body: { reason: 'permission-denied' } };
    if (!canTakeFilingStep('submit', loaded.status)) {
      return this.fail(prepared, 'case.review-report-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '呈批不在拟制中',
        outlet: '先保存呈批稿',
      });
    }
    const content = await this.validatedStoredReport(prepared, loaded, 'case.review-report-submitted', SUBMIT_OPCODE, true);
    if ('status' in content) return content;
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T08' },
      subject: await this.subjectOf(prepared.view, prepared.roles, await this.cases.countInFlightApprovals(loaded.caseId)),
    });
    if (!decision.ok) {
      if (decision.httpStatus === 400) return { status: 400, body: ruleKeyBody(decision) };
      if (decision.httpStatus === 200) {
        return this.holdWarning(prepared, 'case.review-report-submitted', SUBMIT_OPCODE, decision);
      }
      return this.fail(prepared, 'case.review-report-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: decision.reason,
        message: decision.message,
        outlet: decision.outlet,
        basis: decision.citation,
      });
    }
    const nextStatus = filingStatusAfter('submit', this.adminReview);
    const at = this.clock.now();
    const chainId = newUlid();
    return this.uow.run(async (tx) => {
      const opened = await tx.cases.openApprovalChain({
        id: chainId,
        caseId: loaded.caseId,
        kind: 'review-report',
        openedBy: actor.personnelId,
        openedAt: at,
      });
      if (!opened) {
        return rejected<CaseReviewHttpOutcome>(
          blockBody('X18', '本案已有进行中的审批链', '同一案件同时只有一条进行中的审批链', '先办结或退回当前呈批'),
          {
            action: 'case.review-report-submitted',
            outcome: 'failed',
            reason: 'X18',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      const stepped = await tx.cases.applyReviewReportStep({
        reportId: approvalId,
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
        return rejected<CaseReviewHttpOutcome>(
          blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.review-report-submitted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.review-report-submitted',
        ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
        detail: JSON.stringify({ caseId: loaded.caseId, approvalId, chainId }),
      });
      return {
        status: 200 as const,
        body: { result: 'review-report-submitted', approvalId, caseId: loaded.caseId, status: nextStatus },
      };
    });
  }

  async reviewReport(
    actor: ActorRef,
    approvalId: string,
    input: { readonly opinion: string | null },
  ): Promise<CaseReviewHttpOutcome> {
    const loaded = await this.loadReport(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, REVIEW_OPCODE, 'case.review-report-reviewed', false);
    if ('status' in prepared) return prepared;
    if (!canTakeFilingStep('review', loaded.status)) {
      return this.fail(prepared, 'case.review-report-reviewed', REVIEW_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前状态不能审核',
        outlet: '呈批须在待审核',
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyReviewReportStep({
        reportId: approvalId,
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
        return rejected<CaseReviewHttpOutcome>(
          blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.review-report-reviewed',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, REVIEW_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.review-report-reviewed',
        ...this.parties(prepared, loaded.caseId, REVIEW_OPCODE),
        detail: JSON.stringify({ caseId: loaded.caseId, approvalId }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'review-report-reviewed',
          approvalId,
          caseId: loaded.caseId,
          status: filingStatusAfter('review', this.adminReview),
        },
      };
    });
  }

  async approveReport(
    actor: ActorRef,
    approvalId: string,
    input: ConfirmationInput & { readonly opinion: string | null; readonly reviewerId?: unknown; readonly reviewerReason?: unknown },
  ): Promise<CaseReviewHttpOutcome> {
    const loaded = await this.loadReport(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, APPROVE_OPCODE, 'case.review-report-approved', false);
    if ('status' in prepared) return prepared;
    if (!canTakeFilingStep('approve', loaded.status)) {
      return this.fail(prepared, 'case.review-report-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '呈批不在待审批',
        outlet: '先完成前面的审批步骤',
      });
    }
    const content = await this.validatedStoredReport(prepared, loaded, 'case.review-report-approved', APPROVE_OPCODE, true);
    if ('status' in content) return content;
    const reviewerId = text(input.reviewerId) || content.content.reviewerId;
    let designation: { readonly personnelId: string; readonly separation: boolean } | null = null;
    if (reviewerId) {
      const head = await this.isHandlingOrgHead(actor.personnelId, prepared.view.handlingOrgId);
      if (!head) {
        return this.fail(prepared, 'case.review-report-approved', APPROVE_OPCODE, {
          httpStatus: 409,
          reason: 'not-org-head',
          message: '只有承办机构负责人可以在批准时指定审理人',
          outlet: '批准后由承办机构负责人补指定',
        });
      }
      const checked = await this.checkCandidate(prepared, reviewerId, 'case.review-report-approved', APPROVE_OPCODE);
      if ('status' in checked) return checked;
      designation = { personnelId: reviewerId, separation: checked.separationWarning };
    }
    const designationGate = await this.separationGate(
      prepared,
      'case.review-report-approved',
      APPROVE_OPCODE,
      designation?.separation === true,
      input,
    );
    if ('status' in designationGate) return designationGate;
    const other = Math.max(0, (await this.cases.countInFlightApprovals(loaded.caseId)) - (loaded.approvalChainId ? 1 : 0));
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T08' },
      subject: await this.subjectOf(prepared.view, prepared.roles, other),
      confirmedRuleKeys: input.confirmedRuleKeys,
      confirmReasons: input.confirmReasons,
    });
    if (!decision.ok) {
      if (decision.httpStatus === 400) return { status: 400, body: ruleKeyBody(decision) };
      if (decision.httpStatus === 200) {
        return this.holdWarning(prepared, 'case.review-report-approved', APPROVE_OPCODE, decision);
      }
      return this.fail(prepared, 'case.review-report-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: decision.reason,
        message: decision.message,
        outlet: decision.outlet,
        basis: decision.citation,
      });
    }
    const confirmation = decision.confirmation ?? designationGate.confirmation;
    const effects = decision.effects;
    if (effects.kind !== 'advance' || !effects.currentStage || !effects.mainStatus || effects.stageEntrySeq === null || !effects.transitionCode) {
      return this.fail(prepared, 'case.review-report-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '该呈批没有可执行的去向',
        outlet: '请按当前环节重新提交',
      });
    }
    const at = this.clock.now();
    const caseId = loaded.caseId;
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyReviewReportStep({
        reportId: approvalId,
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
        return rejected<CaseReviewHttpOutcome>(
          blockBody('concurrent-change', '呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.review-report-approved',
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
          status: effects.mainStatus as string,
          suspended: effects.suspended ?? false,
        }));
      if (!moved) {
        return rejected<CaseReviewHttpOutcome>(
          blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.review-report-approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, APPROVE_OPCODE),
          },
        );
      }
      if (loaded.approvalChainId) {
        const closed = await tx.cases.closeApprovalChain(loaded.approvalChainId);
        if (!closed) {
          return rejected<CaseReviewHttpOutcome>(
            blockBody('concurrent-change', '审批链已被他人办结', null, '请重新读取后再试'),
            {
              action: 'case.review-report-approved',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, caseId, APPROVE_OPCODE),
            },
          );
        }
      }
      let designationId: string | null = null;
      if (designation) {
        designationId = newUlid();
        const inserted = await tx.cases.insertReviewerDesignation({
          id: designationId,
          caseId,
          entrySeq: effects.stageEntrySeq as number,
          personnelId: designation.personnelId,
          designatedBy: actor.personnelId,
          reason: null,
          replacesId: null,
          designatedAt: at,
          supersededAt: null,
        });
        if (!inserted) {
          return rejected<CaseReviewHttpOutcome>(
            blockBody('concurrent-change', '审理人已被他人指定', null, '请重新读取后再试'),
            {
              action: 'case.review-report-approved',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, caseId, APPROVE_OPCODE),
            },
          );
        }
        await tx.audit.append({
          action: 'case.reviewer-designated',
          ...this.parties(prepared, caseId, APPROVE_OPCODE),
          detail: JSON.stringify({ caseId, designationId, personnelId: designation.personnelId, entrySeq: effects.stageEntrySeq }),
        });
      }
      await tx.audit.append({
        action: 'case.review-report-approved',
        ...this.parties(prepared, caseId, APPROVE_OPCODE),
        detail: JSON.stringify({ caseId, approvalId, transitionId: effects.transitionCode }),
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
          step: 'review-report-approve:T08',
          confirmReasons: input.confirmReasons,
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'review-report-approved',
          approvalId,
          caseId,
          transitionId: effects.transitionCode,
          currentStage: effects.currentStage,
          stageEntrySeq: effects.stageEntrySeq,
          reviewerId: designation?.personnelId ?? null,
        },
      };
    });
  }

  async designate(
    actor: ActorRef,
    caseId: string,
    input: ConfirmationInput & { readonly personnelId?: unknown; readonly reason?: unknown },
  ): Promise<CaseReviewHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    const opcode = roles.includes('行政审批') ? APPROVE_OPCODE : REVIEW_OPCODE;
    const prepared: Prepared = { actorId: actor.personnelId, actorCode: account?.code ?? null, account, roles, view };
    const denied = await this.authorize(actor, opcode, view.handlingOrgId, caseId);
    if (denied) return this.denied(prepared, 'case.reviewer-designated', opcode, denied);
    const terminal = await this.terminalHit(prepared, 'case.reviewer-designated', opcode);
    if (terminal) return terminal;
    if (view.status !== 'in_progress' || view.currentStage !== 'E04') {
      return this.fail(prepared, 'case.reviewer-designated', opcode, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前不在审理环节',
        outlet: '调查报告批准后再指定审理人',
      });
    }
    const head = await this.isHandlingOrgHead(actor.personnelId, view.handlingOrgId);
    if (!head) {
      return this.fail(prepared, 'case.reviewer-designated', opcode, {
        httpStatus: 409,
        reason: 'not-org-head',
        message: '只有承办机构负责人可以指定审理人',
        outlet: '请由承办机构负责人操作',
      });
    }
    const opinions = await this.cases.listReviewOpinions(caseId);
    if (opinions.some((row) => row.entrySeq === view.stageEntrySeq && row.destinationCode !== 'T09')) {
      return this.fail(prepared, 'case.reviewer-designated', opcode, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '审理意见已签出，不能更换审理人',
        outlet: '重审回流后再指定',
      });
    }
    const personnelId = text(input.personnelId);
    if (personnelId === '') {
      return this.fail(prepared, 'case.reviewer-designated', opcode, {
        httpStatus: 400,
        reason: 'missing-reviewer',
        message: '被指定人必填',
        outlet: '选择审理人',
      });
    }
    const candidate = await this.directory.findById(personnelId);
    if (!candidate) return { status: 404, body: { result: 'not-found' } };
    const checked = await this.checkCandidate(prepared, personnelId, 'case.reviewer-designated', opcode);
    if ('status' in checked) return checked;
    const designations = await this.cases.listReviewerDesignations(caseId);
    const active = activeDesignation(designations, view.stageEntrySeq);
    const reasonRead = readDesignationReason({ isReplacement: active !== null, reason: text(input.reason) });
    if (!reasonRead.ok) return this.failContent(prepared, 'case.reviewer-designated', opcode, reasonRead.hit);
    const gate = await this.separationGate(
      prepared,
      'case.reviewer-designated',
      opcode,
      checked.separationWarning,
      input,
    );
    if ('status' in gate) return gate;
    const at = this.clock.now();
    const designationId = newUlid();
    return this.uow.run(async (tx) => {
      if (active) {
        const superseded = await tx.cases.supersedeReviewerDesignation({ id: active.id, caseId, at });
        if (!superseded) {
          return rejected<CaseReviewHttpOutcome>(
            blockBody('concurrent-change', '审理人指定已被他人更新', null, '请重新读取后再试'),
            {
              action: 'case.reviewer-designated',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, caseId, opcode),
            },
          );
        }
      }
      const inserted = await tx.cases.insertReviewerDesignation({
        id: designationId,
        caseId,
        entrySeq: view.stageEntrySeq,
        personnelId,
        designatedBy: actor.personnelId,
        reason: reasonRead.reason === '' ? null : reasonRead.reason,
        replacesId: active?.id ?? null,
        designatedAt: at,
        supersededAt: null,
      });
      if (!inserted) {
        return rejected<CaseReviewHttpOutcome>(
          blockBody('concurrent-change', '审理人指定已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.reviewer-designated',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, opcode),
          },
        );
      }
      const parties = this.parties(prepared, caseId, opcode);
      await tx.audit.append({
        action: 'case.reviewer-designated',
        ...parties,
        detail: JSON.stringify({
          caseId,
          designationId,
          personnelId,
          replacedId: active?.id ?? null,
          reason: reasonRead.reason,
        }),
      });
      if (gate.confirmation) {
        await appendRuleConfirmation(tx.audit, {
          parties,
          confirmation: gate.confirmation,
          at,
          step: 'reviewer-designation',
          confirmReasons: input.confirmReasons,
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'reviewer-designated',
          caseId,
          designationId,
          personnelId,
          replacedId: active?.id ?? null,
          reason: reasonRead.reason,
        },
      };
    });
  }

  async recordOpinion(
    actor: ActorRef,
    caseId: string,
    input: ConfirmationInput & { readonly kind?: unknown; readonly content?: unknown },
  ): Promise<CaseReviewHttpOutcome> {
    const initialView = await this.cases.readCaseView(caseId);
    if (!initialView) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    const initial: Prepared = { actorId: actor.personnelId, actorCode: account?.code ?? null, account, roles, view: initialView };
    if (!roles.includes('行政审核')) {
      return this.fail(initial, 'case.review-recorded', RECORD_OPCODE, {
        httpStatus: 409,
        reason: 'X23',
        message: '未持行政审核角色的人不能签出审理意见',
        outlet: findIllegal('X23')?.outlet ?? '由持行政审核角色的人签出',
      });
    }
    const denied = await this.authorize(actor, RECORD_OPCODE, initialView.handlingOrgId, caseId);
    if (denied) return this.denied(initial, 'case.review-recorded', RECORD_OPCODE, denied);
    await this.settleObjectionWindows(caseId);
    const view = (await this.cases.readCaseView(caseId)) ?? initialView;
    const prepared: Prepared = { ...initial, view };
    const terminal = await this.terminalHit(prepared, 'case.review-recorded', RECORD_OPCODE);
    if (terminal) return terminal;
    if (view.status !== 'in_progress' || view.currentStage !== 'E04') {
      return this.fail(prepared, 'case.review-recorded', RECORD_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前不在审理环节',
        outlet: '审理开始后才能签出审理意见',
      });
    }
    const opinions = await this.cases.listReviewOpinions(caseId);
    const sameEntry = opinions.filter((row) => row.entrySeq === view.stageEntrySeq);
    const leaderDecided = (await this.cases.listReviewObjections(caseId)).some(
      (row) => row.status === 'decided' && row.decision === 'support-handler' && row.entrySeq === view.stageEntrySeq,
    );
    if (sameEntry.some((row) => row.destinationCode !== 'T09') || leaderDecided) {
      return this.fail(prepared, 'case.review-recorded', RECORD_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '审理已通过，修改须回流',
        outlet: '经补充调查或修改纠正回流后再审理',
      });
    }
    if (sameEntry.length > 0) {
      return this.fail(prepared, 'case.review-recorded', RECORD_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '本次审理已签出审理意见',
        outlet: '等待异议窗口结束或负责人决定后再处理',
      });
    }
    const parsed = readReviewOpinionContent({ kind: input.kind, content: input.content });
    if (!parsed.ok) return this.failContent(prepared, 'case.review-recorded', RECORD_OPCODE, parsed.hit);
    const designations = await this.cases.listReviewerDesignations(caseId);
    const active = activeDesignation(designations, view.stageEntrySeq);
    const stints = await this.cases.listHandlerStints(caseId);
    const isHandlerEver = stints.some((row) => row.personnelId === actor.personnelId);
    const sign = checkReviewSign({
      roles,
      signerId: actor.personnelId,
      designatedReviewerId: active?.personnelId ?? null,
      isHandlerEver,
    });
    if (sign.block) {
      return this.fail(prepared, 'case.review-recorded', RECORD_OPCODE, {
        httpStatus: 409,
        reason: sign.block.code,
        message: sign.block.message,
        outlet: sign.block.outlet,
        basis: sign.block.citation,
      });
    }
    if (!active) {
      return this.fail(prepared, 'case.review-recorded', RECORD_OPCODE, {
        httpStatus: 409,
        reason: 'reviewer-not-designated',
        message: '尚未指定审理人',
        outlet: '先由承办机构负责人指定审理人',
      });
    }
    const conflict = await this.conflicts.assertCanSign(actor, caseId, actor.personnelId, 'trial-opinion');
    if (conflict.status === 400) return { status: 400, body: conflict.body as Record<string, unknown> };
    if (conflict.status === 403) return { status: 403, body: conflict.body as { reason: string } };
    if (conflict.status === 404) return { status: 404, body: { result: 'not-found' } };
    if (conflict.status === 409) return { status: 409, body: conflict.body as Record<string, unknown> };
    const gate = await this.warningGate(prepared, 'case.review-recorded', RECORD_OPCODE, sign.warnings, input);
    if ('status' in gate) return gate;
    const destination = opinionDestination(parsed.content.kind, this.limitationExit);
    const at = this.clock.now();
    const opinionId = newUlid();
    if (destination.transitionId === 'T09') {
      const windowDueAt = objectionWindowDueAt(at, this.objectionWindow);
      return this.uow.run(async (tx) => {
        await tx.cases.insertReviewOpinion({
          id: opinionId,
          caseId,
          entrySeq: view.stageEntrySeq,
          opinionKind: parsed.content.kind,
          content: parsed.content.content,
          signedBy: actor.personnelId,
          designationId: active.id,
          destinationCode: destination.transitionId,
          outcomeCode: destination.outcomeCode,
          outcomeLabel: destination.outcomeLabel,
          createdAt: at,
        });
        const opened = await tx.cases.insertReviewObjectionWindow({
          id: newUlid(),
          caseId,
          entrySeq: view.stageEntrySeq,
          opinionId,
          dueAt: windowDueAt,
          openedAt: at,
          at,
        });
        if (!opened) {
          return rejected<CaseReviewHttpOutcome>(
            blockBody('concurrent-change', '审理意见已被他人签出', null, '请重新读取后再试'),
            {
              action: 'case.review-recorded',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, caseId, RECORD_OPCODE),
            },
          );
        }
        const parties = this.parties(prepared, caseId, RECORD_OPCODE);
        await tx.audit.append({
          action: 'case.review-recorded',
          ...parties,
          detail: JSON.stringify({
            caseId,
            opinionId,
            kind: parsed.content.kind,
            destinationCode: destination.transitionId,
            entrySeq: view.stageEntrySeq,
            appliedInThisTicket: false,
            objectionWindowDueAt: windowDueAt.toISOString(),
            confirmationRuleKeys: gate.confirmation?.ruleKeys ?? [],
          }),
        });
        if (gate.confirmation) {
          await appendRuleConfirmation(tx.audit, {
            parties,
            confirmation: gate.confirmation,
            at,
            step: 'review-record:T09-window',
            confirmReasons: input.confirmReasons,
          });
        }
        return {
          status: 200 as const,
          body: {
            result: 'review-recorded',
            caseId,
            opinionId,
            kind: parsed.content.kind,
            destinationCode: destination.transitionId,
            currentStage: view.currentStage,
            stageEntrySeq: view.stageEntrySeq,
            outcomeCode: destination.outcomeCode,
            outcomeLabel: destination.outcomeLabel,
            frozen: false,
            objectionWindow: { status: 'open', dueAt: windowDueAt.toISOString() },
          },
        };
      });
    }
    const approved = await this.cases.readApprovedReviewReport(caseId);
    if (!approved) {
      return this.fail(prepared, 'case.review-recorded', RECORD_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '缺少已批准的调查报告',
        outlet: '先完成调查报告呈批',
      });
    }
    const reportRead = await this.validatedStoredReport(prepared, approved, 'case.review-recorded', RECORD_OPCODE, true);
    if ('status' in reportRead) return reportRead;
    const reportContent = reportRead.content;
    const summary = JSON.stringify({
      opinionId,
      kind: parsed.content.kind,
      destinationCode: destination.transitionId,
      outcomeCode: destination.outcomeCode,
      outcomeLabel: destination.outcomeLabel,
      violations: reportContent.suggestions.map(frozenViolation),
    });
    return this.uow.run(async (tx) => {
      await tx.cases.insertReviewOpinion({
        id: opinionId,
        caseId,
        entrySeq: view.stageEntrySeq,
        opinionKind: parsed.content.kind,
        content: parsed.content.content,
        signedBy: actor.personnelId,
        designationId: active?.id as string,
        destinationCode: destination.transitionId,
        outcomeCode: destination.outcomeCode,
        outcomeLabel: destination.outcomeLabel,
        createdAt: at,
      });
      const frozen = await tx.cases.insertFrozenDecision({
        id: newUlid(),
        caseId,
        opinionId,
        summaryJson: summary,
        createdAt: at,
      });
      if (!frozen) {
        return rejected<CaseReviewHttpOutcome>(
          blockBody('concurrent-change', '审理意见已被他人签出', null, '请重新读取后再试'),
          {
            action: 'case.review-recorded',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, RECORD_OPCODE),
          },
        );
      }
      const parties = this.parties(prepared, caseId, RECORD_OPCODE);
      await tx.audit.append({
        action: 'case.review-recorded',
        ...parties,
        detail: JSON.stringify({
          caseId,
          opinionId,
          kind: parsed.content.kind,
          destinationCode: destination.transitionId,
          outcomeCode: destination.outcomeCode,
          transitionId: destination.transitionId,
          applyInThisTicket: false,
          confirmationRuleKeys: gate.confirmation?.ruleKeys ?? [],
        }),
      });
      if (gate.confirmation) {
        await appendRuleConfirmation(tx.audit, {
          parties,
          confirmation: gate.confirmation,
          at,
          step: 'review-record:frozen',
          confirmReasons: input.confirmReasons,
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'review-recorded',
          caseId,
          opinionId,
          kind: parsed.content.kind,
          destinationCode: destination.transitionId,
          currentStage: view.currentStage,
          stageEntrySeq: view.stageEntrySeq,
          outcomeCode: destination.outcomeCode,
          outcomeLabel: destination.outcomeLabel,
          frozen: true,
        },
      };
    });
  }

  async saveObjection(
    actor: ActorRef,
    caseId: string,
    input: { readonly note?: unknown; readonly evidenceRefs?: unknown },
  ): Promise<CaseReviewHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.review-objection-drafted', true);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.review-objection-drafted', DRAFT_OPCODE);
    if (terminal) return terminal;
    const eligible = await this.objectionEligibility(prepared, 'case.review-objection-drafted', DRAFT_OPCODE);
    if ('status' in eligible) return eligible;
    const parsed = readReviewObjectionContent({ note: input.note, evidenceRefs: input.evidenceRefs });
    if (!parsed.ok) return this.failContent(prepared, 'case.review-objection-drafted', DRAFT_OPCODE, parsed.hit);
    const open = await this.cases.readOpenReviewObjection(caseId);
    if (open && open.status !== 'drafting') {
      return this.fail(prepared, 'case.review-objection-drafted', DRAFT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '已有在途异议呈批',
        outlet: '先办结当前异议呈批',
      });
    }
    if (open && open.drafterId !== actor.personnelId) return { status: 403, body: { reason: 'permission-denied' } };
    const at = this.clock.now();
    const objectionId = open?.id ?? newUlid();
    return this.uow.run(async (tx) => {
      const saved = await tx.cases.saveReviewObjectionDraft({
        objectionId,
        caseId,
        entrySeq: eligible.entrySeq,
        opinionId: eligible.opinionId,
        drafterId: actor.personnelId,
        isNew: open === null,
        contentJson: JSON.stringify(parsed.content),
        at,
      });
      if (!saved) {
        return rejected<CaseReviewHttpOutcome>(
          blockBody('concurrent-change', '异议呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.review-objection-drafted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, DRAFT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.review-objection-drafted',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({ caseId, objectionId, opinionId: eligible.opinionId }),
      });
      return {
        status: 200 as const,
        body: { result: 'review-objection-drafted', caseId, objectionId, status: 'drafting' },
      };
    });
  }

  async submitObjection(actor: ActorRef, objectionId: string): Promise<CaseReviewHttpOutcome> {
    const loaded = await this.cases.readReviewObjection(objectionId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, SUBMIT_OPCODE, 'case.review-objection-submitted', true);
    if ('status' in prepared) return prepared;
    if (loaded.drafterId !== actor.personnelId) return { status: 403, body: { reason: 'permission-denied' } };
    if (loaded.status !== 'drafting') {
      return this.fail(prepared, 'case.review-objection-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '异议呈批不在拟制中',
        outlet: '先保存异议呈批稿',
      });
    }
    const eligible = await this.objectionEligibility(prepared, 'case.review-objection-submitted', SUBMIT_OPCODE, objectionId);
    if ('status' in eligible) return eligible;
    const at = this.clock.now();
    const chainId = newUlid();
    return this.uow.run(async (tx) => {
      const opened = await tx.cases.openApprovalChain({
        id: chainId,
        caseId: loaded.caseId,
        kind: 'review-objection',
        openedBy: actor.personnelId,
        openedAt: at,
      });
      if (!opened) {
        return rejected<CaseReviewHttpOutcome>(
          blockBody('X18', '本案已有进行中的审批链', '同一案件同时只有一条进行中的审批链', '先办结或退回当前呈批'),
          {
            action: 'case.review-objection-submitted',
            outcome: 'failed',
            reason: 'X18',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      const stepped = await tx.cases.applyReviewObjectionStep({
        objectionId,
        expectedStatus: 'drafting',
        nextStatus: 'pending_approval',
        approvalChainId: chainId,
        at,
      });
      if (!stepped) {
        return rejected<CaseReviewHttpOutcome>(
          blockBody('concurrent-change', '异议呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.review-objection-submitted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.review-objection-submitted',
        ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
        detail: JSON.stringify({ caseId: loaded.caseId, objectionId, chainId }),
      });
      return {
        status: 200 as const,
        body: { result: 'review-objection-submitted', objectionId, caseId: loaded.caseId, status: 'pending_approval' },
      };
    });
  }

  async decideObjection(
    actor: ActorRef,
    objectionId: string,
    input: ConfirmationInput & {
      readonly decision?: unknown;
      readonly note?: unknown;
      readonly decisionTransition?: unknown;
    },
  ): Promise<CaseReviewHttpOutcome> {
    const loaded = await this.cases.readReviewObjection(objectionId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, APPROVE_OPCODE, 'case.review-objection-decided', false);
    if ('status' in prepared) return prepared;
    if (loaded.status !== 'pending_approval') {
      return this.fail(prepared, 'case.review-objection-decided', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '异议呈批不在待审批',
        outlet: '先提交异议呈批',
      });
    }
    const decision = text(input.decision);
    if (decision !== 'support-review' && decision !== 'support-handler') {
      return this.fail(prepared, 'case.review-objection-decided', APPROVE_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-decision',
        message: '负责人决定不在枚举内',
        outlet: '选择支持审理意见或支持承办人员',
      });
    }
    const note = text(input.note);
    if (decision === 'support-handler' && note === '') {
      return this.fail(prepared, 'case.review-objection-decided', APPROVE_OPCODE, {
        httpStatus: 400,
        reason: 'missing-note',
        message: '负责人决定须写明理由',
        outlet: '填写决定理由',
      });
    }
    const window = await this.cases.readOpenReviewObjectionWindow(loaded.opinionId);
    if (!window) {
      return this.fail(prepared, 'case.review-objection-decided', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '异议窗口已结束',
        outlet: '按已生效的审理意见继续办理',
      });
    }
    if (decision === 'support-handler') {
      const target = text(input.decisionTransition);
      if (target !== 'T10' && target !== 'T11' && target !== 'T12') {
        return this.fail(prepared, 'case.review-objection-decided', APPROVE_OPCODE, {
          httpStatus: 400,
          reason: 'invalid-decision-transition',
          message: '支持承办人员时须写明去向 T10、T11 或 T12',
          outlet: '按决定内容选择去向',
        });
      }
      const at = this.clock.now();
      return this.uow.run(async (tx) => {
        const stepped = await tx.cases.applyReviewObjectionStep({
          objectionId,
          expectedStatus: 'pending_approval',
          nextStatus: 'decided',
          decision: 'support-handler',
          decisionTransition: target,
          decidedBy: actor.personnelId,
          decidedAt: at,
          at,
        });
        const closed = stepped && loaded.approvalChainId
          ? await tx.cases.closeApprovalChain(loaded.approvalChainId)
          : stepped;
        if (!closed) {
          return rejected<CaseReviewHttpOutcome>(
            blockBody('concurrent-change', '异议呈批已被他人更新', null, '请重新读取后再试'),
            {
              action: 'case.review-objection-decided',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
            },
          );
        }
        const frozen = await tx.cases.insertFrozenDecision({
          id: newUlid(),
          caseId: loaded.caseId,
          opinionId: loaded.opinionId,
          summaryJson: JSON.stringify({
            concludedBy: 'leader-decision',
            opinionId: loaded.opinionId,
            decisionTransition: target,
            note,
          }),
          createdAt: at,
        });
        if (!frozen) {
          return rejected<CaseReviewHttpOutcome>(
            blockBody('concurrent-change', '该审理意见已有结论', null, '请重新读取后再试'),
            {
              action: 'case.review-objection-decided',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
            },
          );
        }
        const windowClosed = await tx.cases.closeReviewObjectionWindow({
          id: window.id,
          caseId: loaded.caseId,
          closeKind: 'support-handler',
          closedBy: actor.personnelId,
          at,
        });
        if (!windowClosed) {
          return rejected<CaseReviewHttpOutcome>(
            blockBody('concurrent-change', '异议窗口已被他人结束', null, '请重新读取后再试'),
            {
              action: 'case.review-objection-decided',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
            },
          );
        }
        await tx.audit.append({
          action: 'case.review-objection-decided',
          ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
          detail: JSON.stringify({
            caseId: loaded.caseId,
            objectionId,
            windowId: window.id,
            decision: 'support-handler',
            decisionTransition: target,
          }),
        });
        return {
          status: 200 as const,
          body: {
            result: 'review-objection-decided',
            objectionId,
            caseId: loaded.caseId,
            decision: 'support-handler',
            decisionTransition: target,
            currentStage: prepared.view.currentStage,
            stageEntrySeq: prepared.view.stageEntrySeq,
            concludedBy: 'leader-decision',
          },
        };
      });
    }
    const eligible = await this.objectionEligibility(prepared, 'case.review-objection-decided', APPROVE_OPCODE, objectionId);
    if ('status' in eligible) return eligible;
    const returnNote = note === '' ? '负责人支持审理意见，审理意见生效' : note;
    const other = await this.cases.countInFlightApprovals(loaded.caseId);
    const move = decideTransition({
      operation: { kind: 'transition', transitionId: 'T09' },
      subject: await this.subjectOf(prepared.view, prepared.roles, Math.max(0, other - (loaded.approvalChainId ? 1 : 0))),
    });
    if (!move.ok) {
      if (move.httpStatus === 400) return { status: 400, body: ruleKeyBody(move) };
      if (move.httpStatus === 200) return this.holdWarning(prepared, 'case.review-objection-decided', APPROVE_OPCODE, move);
      return this.fail(prepared, 'case.review-objection-decided', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: move.reason,
        message: move.message,
        outlet: move.outlet,
        basis: move.citation,
      });
    }
    const effects = move.effects;
    if (effects.kind !== 'advance' || !effects.currentStage || effects.stageEntrySeq === null || !effects.transitionCode) {
      return this.fail(prepared, 'case.review-objection-decided', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '该决定没有可执行的去向',
        outlet: '按决定内容重选',
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyReviewObjectionStep({
        objectionId,
        expectedStatus: 'pending_approval',
        nextStatus: 'decided',
        decision: 'support-review',
        decisionTransition: 'T09',
        decidedBy: actor.personnelId,
        decidedAt: at,
        at,
      });
      if (!stepped) {
        return rejected<CaseReviewHttpOutcome>(
          blockBody('concurrent-change', '异议呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.review-objection-decided',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
          },
        );
      }
      if (loaded.approvalChainId) {
        const closed = await tx.cases.closeApprovalChain(loaded.approvalChainId);
        if (!closed) {
          return rejected<CaseReviewHttpOutcome>(
            blockBody('concurrent-change', '审批链已被他人办结', null, '请重新读取后再试'),
            {
              action: 'case.review-objection-decided',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
            },
          );
        }
      }
      const windowClosed = await tx.cases.closeReviewObjectionWindow({
        id: window.id,
        caseId: loaded.caseId,
        closeKind: 'support-review',
        closedBy: actor.personnelId,
        at,
      });
      if (!windowClosed) {
        return rejected<CaseReviewHttpOutcome>(
          blockBody('concurrent-change', '异议窗口已被他人结束', null, '请重新读取后再试'),
          {
            action: 'case.review-objection-decided',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
          },
        );
      }
      const opinion = (await tx.cases.listReviewOpinions(loaded.caseId)).find((row) => row.id === loaded.opinionId);
      const moved = await this.commitT09(tx, {
        prepared,
        effects,
        actorId: actor.personnelId,
        at,
        opinionId: loaded.opinionId,
        opinion: { kind: (opinion?.opinionKind ?? 'supplementary-investigation') as ReviewOpinionKind, content: opinion?.content ?? '' },
        existingOpinion: true,
        destination: opinionDestination((opinion?.opinionKind ?? 'supplementary-investigation') as ReviewOpinionKind, this.limitationExit),
        designationId: opinion?.designationId ?? '',
        note: returnNote,
      });
      if (!moved.ok) {
        return rejected<CaseReviewHttpOutcome>(
          blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.review-objection-decided',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.review-objection-decided',
        ...this.parties(prepared, loaded.caseId, APPROVE_OPCODE),
        detail: JSON.stringify({
          caseId: loaded.caseId,
          objectionId,
          windowId: window.id,
          decision: 'support-review',
          decisionTransition: 'T09',
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'review-objection-decided',
          objectionId,
          caseId: loaded.caseId,
          decision: 'support-review',
          decisionTransition: 'T09',
          currentStage: effects.currentStage,
          stageEntrySeq: effects.stageEntrySeq,
        },
      };
    });
  }

  /** 明示放弃异议（#282 裁 B）：主办／协办在窗口内放弃，同一事务关闭窗口并执行 T09。 */
  async waiveObjection(
    actor: ActorRef,
    caseId: string,
    input: { readonly note?: unknown },
  ): Promise<CaseReviewHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, WAIVE_OPCODE, 'case.review-objection-waived', true);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.review-objection-waived', WAIVE_OPCODE);
    if (terminal) return terminal;
    if (prepared.view.status !== 'in_progress' || prepared.view.currentStage !== 'E04') {
      return this.fail(prepared, 'case.review-objection-waived', WAIVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前不在审理环节',
        outlet: '异议窗口开放期间才能放弃异议',
      });
    }
    const latest = (await this.cases.listReviewOpinions(caseId))
      .filter((row) => row.entrySeq === prepared.view.stageEntrySeq)
      .at(-1) ?? null;
    if (!latest || !allowsObjection(latest.opinionKind)) {
      return this.fail(prepared, 'case.review-objection-waived', WAIVE_OPCODE, {
        httpStatus: 409,
        reason: 'objection-not-allowed',
        message: '只有补充调查或修改纠正可以放弃异议',
        outlet: '审理意见为补充调查或修改纠正时再放弃',
      });
    }
    const window = await this.cases.readOpenReviewObjectionWindow(latest.id);
    if (!window) {
      return this.fail(prepared, 'case.review-objection-waived', WAIVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '没有进行中的异议窗口',
        outlet: '按审理意见的去向继续办理',
      });
    }
    const objections = await this.cases.listReviewObjections(caseId);
    if (objections.some((row) => row.opinionId === latest.id && row.status === 'pending_approval')) {
      return this.fail(prepared, 'case.review-objection-waived', WAIVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '异议呈批待负责人决定',
        outlet: '先由负责人决定异议呈批',
      });
    }
    const move = decideTransition({
      operation: { kind: 'transition', transitionId: 'T09' },
      subject: await this.subjectOf(prepared.view, prepared.roles, await this.cases.countInFlightApprovals(caseId)),
    });
    if (!move.ok) {
      if (move.httpStatus === 400) return { status: 400, body: ruleKeyBody(move) };
      if (move.httpStatus === 200) {
        return this.holdWarning(prepared, 'case.review-objection-waived', WAIVE_OPCODE, move);
      }
      return this.fail(prepared, 'case.review-objection-waived', WAIVE_OPCODE, {
        httpStatus: 409,
        reason: move.reason,
        message: move.message,
        outlet: move.outlet,
        basis: move.citation,
      });
    }
    const effects = move.effects;
    if (effects.kind !== 'advance' || !effects.currentStage || effects.stageEntrySeq === null || !effects.transitionCode) {
      return this.fail(prepared, 'case.review-objection-waived', WAIVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '该意见没有可执行的去向',
        outlet: '按意见类型重选',
      });
    }
    const at = this.clock.now();
    const note = text(input.note) || '主办／协办明示放弃异议，审理意见生效';
    const kind = latest.opinionKind as ReviewOpinionKind;
    return this.uow.run(async (tx) => {
      const windowClosed = await tx.cases.closeReviewObjectionWindow({
        id: window.id,
        caseId,
        closeKind: 'waived',
        closedBy: actor.personnelId,
        at,
      });
      if (!windowClosed) {
        return rejected<CaseReviewHttpOutcome>(
          blockBody('concurrent-change', '异议窗口已被他人结束', null, '请重新读取后再试'),
          {
            action: 'case.review-objection-waived',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, WAIVE_OPCODE),
          },
        );
      }
      const moved = await this.commitT09(tx, {
        prepared,
        effects,
        actorId: actor.personnelId,
        at,
        opinionId: latest.id,
        opinion: { kind, content: latest.content },
        existingOpinion: true,
        destination: opinionDestination(kind, this.limitationExit),
        designationId: latest.designationId,
        note,
      });
      if (!moved.ok) {
        return rejected<CaseReviewHttpOutcome>(
          blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.review-objection-waived',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, WAIVE_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.review-objection-waived',
        ...this.parties(prepared, caseId, WAIVE_OPCODE),
        detail: JSON.stringify({
          caseId,
          opinionId: latest.id,
          windowId: window.id,
          dueAt: window.dueAt.toISOString(),
          note,
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'review-objection-waived',
          caseId,
          opinionId: latest.id,
          destinationCode: 'T09',
          currentStage: effects.currentStage,
          stageEntrySeq: effects.stageEntrySeq,
        },
      };
    });
  }

  /**
   * 惰性结算到期窗口（#282 裁 B）。相关读写前调用。
   * 已提交待决定的异议不结算；中止或在途审批链导致 T09 不可执行时留窗，待下次。
   */
  private async settleObjectionWindows(caseId: string): Promise<void> {
    const windows = await this.cases.listReviewObjectionWindows(caseId);
    const at = this.clock.now();
    const due = windows.filter((row) => row.status === 'open' && row.dueAt.getTime() <= at.getTime());
    if (due.length === 0) return;
    const objections = await this.cases.listReviewObjections(caseId);
    for (const window of due) {
      const submitted = objections.some(
        (row) => row.opinionId === window.opinionId && row.status === 'pending_approval',
      );
      if (submitted) continue;
      await this.settleObjectionWindow(caseId, window, at);
    }
  }

  private async settleObjectionWindow(
    caseId: string,
    window: ReviewObjectionWindowRow,
    at: Date,
  ): Promise<void> {
    const view = await this.cases.readCaseView(caseId);
    if (!view || view.status !== 'in_progress' || view.currentStage !== 'E04' || view.stageEntrySeq !== window.entrySeq) {
      return;
    }
    const opinion = (await this.cases.listReviewOpinions(caseId)).find((row) => row.id === window.opinionId);
    if (!opinion) return;
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T09' },
      subject: await this.subjectOf(view, [], await this.cases.countInFlightApprovals(caseId)),
    });
    if (!decision.ok) return;
    const effects = decision.effects;
    if (effects.kind !== 'advance' || !effects.currentStage || effects.stageEntrySeq === null || !effects.transitionCode) {
      return;
    }
    const kind = opinion.opinionKind as ReviewOpinionKind;
    const prepared: Prepared = { actorId: opinion.signedBy, actorCode: null, account: null, roles: [], view };
    try {
      await this.uow.run(async (tx) => {
        const windowClosed = await tx.cases.closeReviewObjectionWindow({
          id: window.id,
          caseId,
          closeKind: 'expired',
          closedBy: null,
          at,
        });
        if (!windowClosed) return;
        const moved = await this.commitT09(tx, {
          prepared,
          effects,
          actorId: opinion.signedBy,
          at,
          opinionId: opinion.id,
          opinion: { kind, content: opinion.content },
          existingOpinion: true,
          destination: opinionDestination(kind, this.limitationExit),
          designationId: opinion.designationId,
          note: '异议窗口到期，审理意见生效',
        });
        if (!moved.ok) throw new ObjectionWindowSettleAbort();
        await tx.audit.append({
          action: 'case.review-objection-expired',
          ...this.partiesFor(opinion.signedBy, null, view.handlingOrgId, caseId, RECORD_OPCODE),
          detail: JSON.stringify({
            caseId,
            opinionId: opinion.id,
            windowId: window.id,
            dueAt: window.dueAt.toISOString(),
            settledAt: at.toISOString(),
          }),
        });
      });
    } catch (error) {
      if (!(error instanceof ObjectionWindowSettleAbort)) throw error;
    }
  }

  /** T09 同一事务：意见（首次签出时）、环节实例、迁移历史、R2 退回记录、期限锚点、旧实例失效。 */
  private async commitT09(
    tx: TxScope,
    input: {
      readonly prepared: Prepared;
      readonly effects: NonNullable<Extract<TransitionDecision, { ok: true }>['effects']>;
      readonly actorId: string;
      readonly at: Date;
      readonly opinionId: string;
      readonly opinion: { readonly kind: ReviewOpinionKind; readonly content: string };
      readonly destination: OpinionDestination;
      readonly designationId: string;
      readonly note: string;
      readonly existingOpinion?: boolean;
    },
  ): Promise<{ readonly ok: true } | { readonly ok: false }> {
    const view = input.prepared.view;
    const caseId = view.id;
    const effects = input.effects;
    if (!input.existingOpinion) {
      await tx.cases.insertReviewOpinion({
        id: input.opinionId,
        caseId,
        entrySeq: view.stageEntrySeq,
        opinionKind: input.opinion.kind,
        content: input.opinion.content,
        signedBy: input.actorId,
        designationId: input.designationId,
        destinationCode: input.destination.transitionId,
        outcomeCode: input.destination.outcomeCode,
        outcomeLabel: input.destination.outcomeLabel,
        createdAt: input.at,
      });
    }
    const wrote = await persistTransitionEffects(tx.cases, {
      effects,
      caseId,
      clueId: view.sourceClueIds[0] ?? null,
      actorId: input.actorId,
      at: input.at,
      fromJson: JSON.stringify({
        stage: view.currentStage,
        status: view.status,
        stageEntrySeq: view.stageEntrySeq,
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
        expectedStage: view.currentStage,
        expectedSeq: view.stageEntrySeq,
        stage: effects.currentStage as string,
        stageEntrySeq: effects.stageEntrySeq as number,
        status: effects.mainStatus as string,
        suspended: effects.suspended ?? false,
      }));
    if (!moved) return { ok: false };
    const main = view.handlers.find((row) => row.role === 'main');
    const opinionId = newUlid();
    const returnId = newUlid();
    await tx.cases.appendApprovalOpinion({
      id: opinionId,
      caseId,
      reasonCode: REVIEW_RETURN_REASON,
      note: input.note,
      targetKey: 'stage:E02',
      actorId: input.actorId,
      createdAt: input.at,
    });
    await tx.cases.appendCaseReturn({
      id: returnId,
      caseId,
      opinionId,
      reasonCode: REVIEW_RETURN_REASON,
      inheritedCode: null,
      targetKey: 'stage:E02',
      receiverId: main?.personnelId ?? input.actorId,
      reflow: true,
      n5: false,
      entrySeqBefore: view.stageEntrySeq,
      entrySeqAfter: effects.stageEntrySeq,
      exitCode: null,
      rehearingRequired: true,
      revokeNotice: false,
      actorId: input.actorId,
      createdAt: input.at,
    });
    const invalidated = await tx.cases.listInvalidatedInstanceIds(caseId);
    const downstream = view.instances
      .filter((row) => stageIndex(row.stage) >= stageIndex('E04') && !invalidated.includes(row.id))
      .map((row) => row.id);
    for (const instanceId of downstream) {
      await tx.cases.appendStageInvalidation({
        id: newUlid(),
        caseId,
        instanceId,
        returnId,
        createdAt: input.at,
      });
    }
    const anchored = await this.writeT09Anchor(tx, {
      caseId,
      entrySeq: effects.stageEntrySeq as number,
      actorId: input.actorId,
      at: input.at,
      openedAt: view.openedAt,
      handlingOrgId: view.handlingOrgId,
    });
    if (!anchored) return { ok: false };
    return { ok: true };
  }

  /** 以新进入次序号写 case.handle 锚点。起算日取最早锚点（立案日），90 日到期日不变。 */
  private async writeT09Anchor(
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
    const calendar = await this.calendarOf(tx);
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
      ...this.partiesFor(input.actorId, null, input.handlingOrgId, input.caseId, RECORD_OPCODE),
      detail: JSON.stringify({
        caseId: input.caseId,
        ruleKey: 'case.handle',
        entrySeq: input.entrySeq,
        procedureNode: 'E02',
        startedOn,
        dueOn: planned.plan.due.dueOn,
        trace: planned.plan.due.trace,
      }),
    });
    return true;
  }

  private async calendarOf(tx: TxScope): Promise<WorkCalendar> {
    return mergeCalendars(WORK_CALENDAR_V1, await tx.cases.listCalendarInstalls());
  }

  /**
   * 异议对象：本案最近一条审理意见，且该意见的异议窗口仍在开放。
   * 窗口已结束（到期、放弃或负责人决定）时不能再提 T09a。
   */
  private async objectionEligibility(
    prepared: Prepared,
    action: CaseReviewAction,
    opcode: string,
    ignoreObjectionId: string | null = null,
  ): Promise<{ readonly opinionId: string; readonly entrySeq: number } | CaseReviewHttpOutcome> {
    const latest = (await this.cases.listReviewOpinions(prepared.view.id)).at(-1);
    if (!latest || !allowsObjection(latest.opinionKind)) {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: 'objection-not-allowed',
        message: '只有补充调查或修改纠正可以提审理异议',
        outlet: '审理意见为补充调查或修改纠正时再提',
      });
    }
    if (
      prepared.view.status !== 'in_progress' ||
      prepared.view.currentStage !== 'E04' ||
      prepared.view.stageEntrySeq !== latest.entrySeq
    ) {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前不在该审理意见所在环节',
        outlet: '等待补充调查或修改纠正回流后再审理',
      });
    }
    const window = await this.cases.readOpenReviewObjectionWindow(latest.id);
    if (!window) {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '异议窗口已结束',
        outlet: '按审理意见的去向继续办理',
      });
    }
    const objections = await this.cases.listReviewObjections(prepared.view.id);
    if (objections.some((row) => row.id !== ignoreObjectionId && row.opinionId === latest.id && row.status !== 'decided')) {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '该审理意见已有在途或已决定的异议呈批',
        outlet: '读取现有异议呈批',
      });
    }
    return { opinionId: latest.id, entrySeq: latest.entrySeq };
  }

  private async requireReportDraftStage(prepared: Prepared): Promise<CaseReviewHttpOutcome | null> {
    if (prepared.view.status !== 'in_progress' || prepared.view.currentStage !== 'E02') {
      return this.fail(prepared, 'case.review-report-drafted', DRAFT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前环节不能拟制调查报告',
        outlet: '在调查环节拟制',
      });
    }
    return null;
  }

  private async activeViolationIds(caseId: string): Promise<readonly string[]> {
    const rows = await this.cases.listViolationRecords(caseId);
    return rows.filter((row) => row.status === 'active').map((row) => row.id);
  }

  private async validatedStoredReport(
    prepared: Prepared,
    report: { readonly contentJson: string | null },
    action: CaseReviewAction,
    opcode: string,
    requireCoverage: boolean,
  ): Promise<{ readonly content: ReviewReportContent } | CaseReviewHttpOutcome> {
    const parsed = this.parseStoredReport(report.contentJson);
    const active = await this.activeViolationIds(prepared.view.id);
    const read = readReviewReportContent(parsed, active, { requireCoverage });
    if (!read.ok) return this.failContent(prepared, action, opcode, read.hit);
    return { content: read.content };
  }

  private parseStoredReport(contentJson: string | null): unknown {
    if (!contentJson) return null;
    return parseJson(contentJson);
  }

  private async checkCandidate(
    prepared: Prepared,
    personnelId: string,
    action: CaseReviewAction,
    opcode: string,
  ): Promise<{ readonly separationWarning: boolean } | CaseReviewHttpOutcome> {
    const candidate = await this.directory.findById(personnelId);
    if (!candidate) return { status: 404, body: { result: 'not-found' } };
    const roles = await this.identity.listActiveRoleNames(personnelId);
    const path = await this.identity.findOrgUnitPathToRoot(prepared.view.handlingOrgId);
    const orgCoversCase = candidate.orgUnitId !== null && path.includes(candidate.orgUnitId);
    const events = await this.cases.listPersonConflictEvents(prepared.view.id, personnelId);
    const hasActiveConflict = activeConflicts(events.map(toConflictFact), personnelId).length > 0;
    const stints = await this.cases.listHandlerStints(prepared.view.id);
    const isHandlerEver = stints.some((row) => row.personnelId === personnelId);
    const facts: ReviewCandidateFacts = { roles, orgCoversCase, hasActiveConflict, isHandlerEver };
    const checked = checkReviewerCandidate(facts);
    if (!checked.ok) {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: checked.hit.reason,
        message: checked.hit.message,
        outlet: checked.hit.outlet,
      });
    }
    return { separationWarning: checked.separationWarning };
  }

  private async separationGate(
    prepared: Prepared,
    action: CaseReviewAction,
    opcode: string,
    hit: boolean,
    input: ConfirmationInput,
  ): Promise<{ confirmation: RuleConfirmation | null } | CaseReviewHttpOutcome> {
    if (!hit) return { confirmation: null };
    return this.warningGate(prepared, action, opcode, [separationWarning()], input);
  }

  private async warningGate(
    prepared: Prepared,
    action: CaseReviewAction,
    opcode: string,
    warnings: readonly GuardResult[],
    input: ConfirmationInput,
  ): Promise<{ confirmation: RuleConfirmation | null } | CaseReviewHttpOutcome> {
    const gate = applyWarningGate({
      notes: warnings,
      confirmedRuleKeys: input.confirmedRuleKeys,
      confirmReasons: input.confirmReasons,
    });
    if (gate.kind === 'reject') return { status: 400, body: ruleKeyBody(gate.decision) };
    if (gate.kind === 'hold') return this.holdWarning(prepared, action, opcode, gate.decision);
    return { confirmation: gate.confirmation };
  }

  private async isHandlingOrgHead(personnelId: string, handlingOrgId: string): Promise<boolean> {
    const account = await this.directory.findById(personnelId);
    const orgUnitId = account?.orgUnitId ?? null;
    const path = orgUnitId === null ? [] : await this.identity.findOrgUnitPathToRoot(handlingOrgId);
    return transitionalDeciderSeats({
      roles: account?.roles ?? [],
      orgUnitId,
      handlingOrgId,
      orgPathToRoot: path,
    }).isHandlingOrgHead;
  }

  private async prepare(
    actor: ActorRef,
    caseId: string,
    opcode: string,
    action: CaseReviewAction,
    mustBeHandler: boolean,
  ): Promise<Prepared | CaseReviewHttpOutcome> {
    const initialView = await this.cases.readCaseView(caseId);
    if (!initialView) return { status: 404, body: { result: 'not-found' } };
    const account = await this.directory.findById(actor.personnelId);
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    const initial: Prepared = { actorId: actor.personnelId, actorCode: account?.code ?? null, account, roles, view: initialView };
    const denied = await this.authorize(actor, opcode, initialView.handlingOrgId, caseId);
    if (denied) return this.denied(initial, action, opcode, denied);
    await this.settleObjectionWindows(caseId);
    const view = (await this.cases.readCaseView(caseId)) ?? initialView;
    const prepared: Prepared = { ...initial, view };
    if (mustBeHandler && !view.handlers.some((row) => row.personnelId === actor.personnelId && HANDLER_ROLES.has(row.role))) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    return prepared;
  }

  private async loadReport(approvalId: string): Promise<ReviewReportRow | null> {
    return this.cases.readReviewReport(approvalId);
  }

  private async terminalHit(prepared: Prepared, action: CaseReviewAction, opcode: string): Promise<CaseReviewHttpOutcome | null> {
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

  private async subjectOf(
    view: CaseView,
    roles: readonly string[],
    otherInFlightChains: number,
  ): Promise<TransitionSubject> {
    const clueId = view.sourceClueIds[0];
    const clue = clueId ? await this.clues.readDispatchContext(clueId) : null;
    return {
      caseId: view.id,
      mainStatus: view.status,
      stage: view.currentStage,
      stageEntrySeq: view.stageEntrySeq,
      suspended: view.suspended,
      markers: [],
      clueStatus: clue?.status ?? null,
      handlingOrgId: view.handlingOrgId,
      proposedHandlingOrgId: null,
      actorRoles: [...roles],
      otherInFlightChains,
      instances: view.instances.map((row) => ({ stage: row.stage, entrySeq: row.entrySeq, status: row.status })),
    };
  }

  private holdWarning(
    prepared: Prepared,
    action: CaseReviewAction,
    opcode: string,
    decision: Extract<TransitionDecision, { httpStatus: 200 }>,
  ): Promise<CaseReviewHttpOutcome> {
    const reason = (FAIL_REASONS.has(decision.reason) ? decision.reason : 'invalid-state') as CaseReviewFailedReason;
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
    action: CaseReviewAction,
    opcode: string,
    hit: { readonly httpStatus: 400 | 409; readonly reason: string; readonly message: string; readonly outlet: string; readonly missingViolationIds?: readonly string[] },
  ): Promise<CaseReviewHttpOutcome> {
    return this.fail(prepared, action, opcode, {
      httpStatus: hit.httpStatus,
      reason: hit.reason,
      message: hit.message,
      outlet: hit.outlet,
      ...(hit.missingViolationIds ? { missingViolationIds: hit.missingViolationIds } : {}),
    });
  }

  private async fail(
    prepared: Prepared,
    action: CaseReviewAction,
    opcode: string,
    fail: {
      readonly httpStatus: 400 | 409;
      readonly reason: string;
      readonly message: string;
      readonly outlet: string;
      readonly basis?: string | null;
      readonly missingViolationIds?: readonly string[];
    },
  ): Promise<CaseReviewHttpOutcome> {
    const reason = (FAIL_REASONS.has(fail.reason) ? fail.reason : 'invalid-state') as CaseReviewFailedReason;
    const outcome: CaseReviewHttpOutcome =
      fail.httpStatus === 400
        ? {
            status: 400,
            body: {
              result: 'non-compliant',
              reason: fail.reason,
              message: fail.message,
              outlet: fail.outlet,
              ...(fail.missingViolationIds ? { missingViolationIds: fail.missingViolationIds } : {}),
            },
          }
        : {
            status: 409,
            body: {
              result: fail.reason,
              reason: fail.reason,
              message: fail.message,
              basis: fail.basis ?? null,
              outlet: fail.outlet,
              ...(fail.missingViolationIds ? { missingViolationIds: fail.missingViolationIds } : {}),
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

  private async denied(prepared: Prepared, action: CaseReviewAction, opcode: string, denial: string): Promise<CaseReviewHttpOutcome> {
    const onlySupervision =
      prepared.roles.length > 0 && prepared.roles.every((role) => role === CASE_SUPERVISION_ROLE);
    if (denial === 'permission-denied' && onlySupervision) {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: 'X17',
        message: '监督角色不能推进案件',
        outlet: '请由有权办理人操作，监督不能推进主状态',
        basis: 'GLOSSARY「监督」',
      });
    }
    return { status: 403, body: { reason: denial } };
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
    return this.partiesFor(prepared.actorId, prepared.actorCode, prepared.view.handlingOrgId, caseId, opcode);
  }

  private partiesFor(
    actorId: string,
    actorCode: string | null,
    orgUnitId: string | null,
    caseId: string,
    opcode: string,
  ) {
    return {
      actorId,
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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function mergeReviewerId(content: unknown, reviewerId: unknown): unknown {
  const reviewer = text(reviewerId);
  if (reviewer === '') return content;
  if (typeof content !== 'object' || content === null || Array.isArray(content)) return content;
  return { ...(content as Record<string, unknown>), reviewerId: reviewer };
}

function activeDesignation(
  rows: readonly ReviewerDesignationRow[],
  entrySeq: number,
): ReviewerDesignationRow | null {
  return rows.find((row) => row.entrySeq === entrySeq && row.supersededAt === null) ?? null;
}

function latestOpinionOf(rows: readonly ReviewOpinionRow[], entrySeq: number): ReviewOpinionRow | null {
  return rows.filter((row) => row.entrySeq === entrySeq).at(-1) ?? null;
}

function objectionWindowView(row: ReviewObjectionWindowRow | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    opinionId: row.opinionId,
    status: row.status,
    dueAt: row.dueAt.toISOString(),
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    closeKind: row.closeKind,
    closedBy: row.closedBy,
  };
}

class ObjectionWindowSettleAbort extends Error {}

function latestHearingEntry(view: CaseView): number | null {
  const rows = view.instances.filter((row) => row.stage === 'E04');
  if (rows.length === 0) return null;
  return Math.max(...rows.map((row) => row.entrySeq));
}

function toConflictFact(row: {
  readonly id: string;
  readonly lineageId: string;
  readonly caseId: string;
  readonly personId: string;
  readonly source: string;
  readonly reason: string;
  readonly status: string;
  readonly seq: number;
  readonly createdAt: Date;
}): ConflictEventFact {
  return row;
}

function frozenViolation(suggestion: HandlingSuggestion): Record<string, unknown> {
  return {
    violationRecordId: suggestion.violationRecordId,
    kind: suggestion.kind,
    penaltyCodes: [...suggestion.penaltyCodes],
    fineAmount: suggestion.fineAmount,
    discretionReason: suggestion.discretionReason,
    fineBases: [...suggestion.fineBases],
    comparisonReason: suggestion.comparisonReason,
    basisText: suggestion.basisText,
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

function blockBody(reason: string, message: string, citation: string | null, outlet: string): CaseReviewHttpOutcome {
  return { status: 409, body: { result: reason, reason, message, basis: citation, outlet } };
}