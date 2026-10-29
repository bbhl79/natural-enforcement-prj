// 法制审核与集体讨论（E07、E08；#269）。
// 两级签字：审核人（持法制审核）签，法制审核负责人（持行政审核、带岗位标记、任职在归属那一级）再签。
// 告知前法审走 T10a／T10b；决定前法审记录轮次，不改环节（T19–T22 的审批链挂起／恢复归 #270）。
// 法审不通过不是退回；不通过且不接受时，集体讨论统一意见后回法审补出通过并引用讨论记录。
// 接收人由提交人指定，系统不自动选；改派复用 case.reassign.submit（G5），理由必填留痕。
// 期限 5＋10 个工作日走 #246 的 legal-review.round；缺日历时提示人工确认并留痕，不静默按日历日算。
// 决定闸口 X08／X09／X27 在 doc.approve 时再查；X33 由 assertCanSign 执行，不接进引擎。
// 警告不阻断、不改业务行，只写留痕；X26 仍为警告。

import { Inject, Injectable } from '@nestjs/common';
import {
  rejected,
  CASE_LEGAL_REVIEW_FAILED_REASONS,
  type CaseLegalReviewAction,
  type CaseLegalReviewFailedReason,
} from '@natural-enforcement/audit';
import {
  CASE_STORE,
  CASE_SUPERVISION_ROLE,
  activeConflicts,
  applyWarningGate,
  assessMandatoryReview,
  assertDecisionGate,
  checkDiscussionReference,
  checkLegalReviewHead,
  checkLegalReviewReceiver,
  decideTransition,
  isManualReviewItemCode,
  legalQualificationHint,
  legalReviewAttributionOrgId,
  readActiveCaseMarkers,
  readDiscussionMarkContent,
  readDiscussionRecordContent,
  readLegalReviewOpinionContent,
  samePersonWarning,
  summaryCoversDecision,
  type CaseStore,
  type CaseView,
  type ConflictEventFact,
  type DecisionGateFacts,
  type DiscussionRecordRow,
  type GuardResult,
  type LegalReviewOpinionRow,
  type LegalReviewRow,
  type MandatoryReviewAssessment,
  type PersonConflictEventRow,
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

import { CLOCK, type Clock } from './clock.ts';
import { appendRuleConfirmation, ruleKeyBody, warningBody } from './case-rule-confirmation.ts';
import { persistTransitionEffects } from './case-transition-write.ts';
import { CaseConflictService } from './case-conflict.service.ts';
import { LOGIN_DIRECTORY, type LoginAccount, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const READ_OPCODE = 'case.read';
const REQUEST_OPCODE = 'legal.review.request';
const OPINION_OPCODE = 'legal.opinion.submit';
const HEAD_OPCODE = 'doc.admin.review';
const APPROVE_OPCODE = 'doc.approve';
const REASSIGN_OPCODE = 'case.reassign.submit';
const MARK_OPCODE = 'doc.draft';
const DISCUSSION_OPCODE = 'case.discussion.record';
const HANDLER_ROLES = new Set(['main', 'assist']);
const FAIL_REASONS = new Set<string>(CASE_LEGAL_REVIEW_FAILED_REASONS);

/** 法审 5＋10 个工作日的规则键（#246 已登记）。 */
export const LEGAL_REVIEW_DEADLINE_RULE_KEY = 'legal-review.round';

export type CaseLegalReviewHttpOutcome =
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

interface FrozenFact {
  readonly id: string;
  readonly opinionId: string;
  readonly kind: string;
  readonly penaltyCodes: readonly string[];
  readonly fineAmount: number | null;
}

@Injectable()
export class CaseLegalReviewService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly conflicts: CaseConflictService,
    private readonly access: AccessControlService,
  ) {}

  /** 法审页签：必审判定、候选接收人、轮次与意见、期限、集体讨论。 */
  async read(actor: ActorRef, caseId: string): Promise<CaseLegalReviewHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const denied = await this.authorize(actor, READ_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    const frozen = await this.latestFrozen(caseId);
    const reviews = await this.cases.listLegalReviews(caseId);
    const opinions = await this.cases.listLegalReviewOpinions(caseId);
    const markers = await readActiveCaseMarkers(this.cases, caseId);
    const attendance = await this.attributionOrgId(view);
    const manualItems = this.manualItemsOf(reviews);
    const assessment = this.assessmentOf({
      decisionKind: frozen?.kind ?? 'penalty',
      penaltyCodes: frozen?.penaltyCodes ?? [],
      markers,
      hearings: await this.cases.listHearings(caseId),
      manualItems,
      criminalTransfer: false,
    });
    const candidates = await this.candidateRows(caseId, attendance.attributionOrgId);
    const deadlines = (await this.cases.listDeadlineRows(caseId)).filter(
      (row) => row.ruleKey === LEGAL_REVIEW_DEADLINE_RULE_KEY,
    );
    const marks = await this.cases.listDiscussionMarks(caseId);
    const records = await this.cases.listDiscussionRecords(caseId);
    const latestConcluded = latestConcludedOpinion(opinions);
    const reviewViews = reviews.map((row) => ({
      id: row.id,
      roundNo: row.roundNo,
      phase: row.phase,
      status: row.status,
      receiverId: row.receiverId,
      designatedBy: row.designatedBy,
      determination: parseJson(row.determinationJson),
      conclusion: row.conclusion,
      headId: row.headId,
      headSignedAt: row.headSignedAt?.toISOString() ?? null,
      concludedAt: row.concludedAt?.toISOString() ?? null,
      opinions: opinions
        .filter((opinion) => opinion.legalReviewId === row.id)
        .map((opinion) => presentOpinion(opinion)),
    }));
    return {
      status: 200,
      body: {
        caseId,
        currentStage: view.currentStage,
        stageEntrySeq: view.stageEntrySeq,
        handlingOrgId: view.handlingOrgId,
        attributionOrgId: attendance.attributionOrgId,
        hearingEntered: assessment.autoReasons.includes('hearing-entered') || markers.includes('hearing-entered'),
        mandatoryReview: assessment,
        frozenDecisionId: frozen?.id ?? null,
        latestConcluded: latestConcluded
          ? {
              opinionId: latestConcluded.id,
              conclusion: latestConcluded.conclusion,
              headSignedAt: latestConcluded.headSignedAt?.toISOString() ?? null,
            }
          : null,
        reviews: reviewViews,
        candidates,
        excludedCandidates: candidates.filter((row) => !row.eligible),
        deadlines: deadlines.map((row) => ({
          roundNo: row.entrySeq,
          startedOn: row.startedOn,
          dueOn: row.dueOn,
          needsManualConfirmation: row.needsManualConfirmation,
          confirmationTrace: row.confirmationTrace,
          ruleVersion: row.ruleVersion,
        })),
        discussion: {
          required: marks.length > 0,
          marks: marks.map((row) => ({
            id: row.id,
            criteria: parseJsonArray(row.criteriaJson),
            reason: row.reason,
            markedBy: row.markedBy,
            createdAt: row.createdAt.toISOString(),
          })),
          records: records.map(presentDiscussionRecord),
        },
        hints: [legalQualificationHint(null)].filter((item): item is GuardResult => item !== null),
        actor: { personnelId: actor.personnelId, roles },
      },
    };
  }

  /** 发起一轮法审：告知前走 T10a 进 E07；决定前只登记轮次（T19 的审批链挂起归 #270）。 */
  async start(
    actor: ActorRef,
    caseId: string,
    input: {
      readonly receiverId?: unknown;
      readonly manualItems?: unknown;
      readonly criminalTransfer?: unknown;
      readonly listId?: unknown;
      readonly listVersion?: unknown;
      readonly listLevel?: unknown;
    },
  ): Promise<CaseLegalReviewHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, REQUEST_OPCODE, 'case.legal-review-started', false);
    if ('status' in prepared) return prepared;
    const { view, roles } = prepared;
    const isAdminOrApprover = roles.includes('行政审核') || roles.includes('行政审批');
    if (!isAdminOrApprover && !this.isHandler(view, actor.personnelId)) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    if (view.status !== 'in_progress' || (view.currentStage !== 'E04' && view.currentStage !== 'E09')) {
      return this.fail(prepared, 'case.legal-review-started', REQUEST_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前环节不能发起法制审核',
        outlet: '审理通过或决定拟制时发起',
      });
    }
    const frozen = await this.latestFrozen(caseId);
    if (!frozen) {
      return this.fail(prepared, 'case.legal-review-started', REQUEST_OPCODE, {
        httpStatus: 409,
        reason: 'no-frozen-decision',
        message: '缺少已冻结的拟决定摘要',
        outlet: '先完成审理意见签出',
      });
    }
    const receiverId = text(input.receiverId);
    if (receiverId === '') {
      return this.fail(prepared, 'case.legal-review-started', REQUEST_OPCODE, {
        httpStatus: 400,
        reason: 'missing-receiver',
        message: '法审接收人必填，系统不自动选',
        outlet: '从候选名单指定接收人',
      });
    }
    const manualItems = stringList(input.manualItems);
    if (!manualItems || manualItems.some((item) => !isManualReviewItemCode(item))) {
      return this.fail(prepared, 'case.legal-review-started', REQUEST_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-content',
        message: '人工必审勾选不合规',
        outlet: '按清单第 1、3、4、6 项与条例第 37 条（三）勾选',
      });
    }
    const listLevel = text(input.listLevel);
    if (listLevel !== '' && listLevel !== 'city' && listLevel !== 'district') {
      return this.fail(prepared, 'case.legal-review-started', REQUEST_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-list-level',
        message: '清单层级取值不合规',
        outlet: '按市局或区分局选择',
      });
    }
    const attendance = await this.attributionOrgId(view);
    const attributionOrgId = attendance.attributionOrgId;
    if (!attributionOrgId) {
      return this.fail(prepared, 'case.legal-review-started', REQUEST_OPCODE, {
        httpStatus: 409,
        reason: 'no-legal-review-org',
        message: '无法确定该案的法制审核归属机构',
        outlet: '核对承办机构层级与上级机构',
      });
    }
    const receiver = await this.receiverFacts(caseId, receiverId, attributionOrgId);
    if (!receiver.check.ok) {
      return this.fail(prepared, 'case.legal-review-started', REQUEST_OPCODE, {
        httpStatus: 409,
        reason: receiver.check.reason,
        message: receiver.check.message,
        outlet: receiver.check.outlet,
      });
    }
    const markers = await readActiveCaseMarkers(this.cases, caseId);
    const hearings = await this.cases.listHearings(caseId);
    const assessment = assessMandatoryReview(
      {
        decisionKind: frozen.kind,
        hearingHeld: hearings.some((row) => row.endKind === 'concluded'),
        hearingEntered: markers.includes('hearing-entered') || hearings.some((row) => row.acceptedAt !== null || row.scheduledAt !== null),
        penaltyCodes: frozen.penaltyCodes,
        criminalTransfer: input.criminalTransfer === true,
        manualItems,
      },
      {
        ...(text(input.listId) !== '' ? { listId: text(input.listId) } : {}),
        ...(text(input.listVersion) !== '' ? { listVersion: text(input.listVersion) } : {}),
        ...(listLevel !== '' ? { listLevel: listLevel as 'city' | 'district' } : {}),
      },
    );
    const phase = view.currentStage === 'E04' ? 'pre-notice' : 'pre-decision';
    const reviews = await this.cases.listLegalReviews(caseId);
    const roundNo = reviews.length === 0 ? 1 : Math.max(...reviews.map((row) => row.roundNo)) + 1;
    const other = await this.cases.countInFlightApprovals(caseId);
    let decision: TransitionDecision | null = null;
    if (phase === 'pre-notice') {
      decision = decideTransition({
        operation: { kind: 'transition', transitionId: 'T10a' },
        subject: await this.subjectOf(view, roles, other),
      });
      if (!decision.ok) return this.settle(prepared, 'case.legal-review-started', REQUEST_OPCODE, decision);
      if (
        decision.effects.kind !== 'advance'
        || decision.effects.currentStage !== 'E07'
        || decision.effects.stageEntrySeq === null
      ) {
        return this.fail(prepared, 'case.legal-review-started', REQUEST_OPCODE, {
          httpStatus: 409,
          reason: 'invalid-state',
          message: '该法审没有可执行的单一去向',
          outlet: '按当前环节重新提交',
        });
      }
    }
    const at = this.clock.now();
    const legalReviewId = newUlid();
    const hints = [legalQualificationHint(null)].filter((item): item is GuardResult => item !== null);
    return this.uow.run(async (tx) => {
      let currentStage = view.currentStage;
      let stageEntrySeq = view.stageEntrySeq;
      if (decision && decision.ok && decision.effects.kind === 'advance') {
        const effects = decision.effects;
        if (effects.currentStage !== 'E07' || effects.stageEntrySeq === null) {
          return rejected<CaseLegalReviewHttpOutcome>(
            blockBody('invalid-state', '该法审没有可执行的单一去向', '按当前环节重新提交'),
            {
              action: 'case.legal-review-started',
              outcome: 'failed',
              reason: 'invalid-state',
              ...this.parties(prepared, caseId, REQUEST_OPCODE),
            },
          );
        }
        const wrote = await persistTransitionEffects(tx.cases, {
          effects,
          caseId,
          clueId: view.sourceClueIds[0] ?? null,
          actorId: actor.personnelId,
          at,
          fromJson: JSON.stringify({ stage: view.currentStage, status: view.status, stageEntrySeq: view.stageEntrySeq }),
          toJson: JSON.stringify({ stage: effects.currentStage, status: effects.mainStatus, stageEntrySeq: effects.stageEntrySeq }),
          newId: () => newUlid(),
        });
        const moved =
          wrote &&
          (await tx.cases.advanceCasePointer({
            caseId,
            expectedStage: view.currentStage,
            expectedSeq: view.stageEntrySeq,
            stage: effects.currentStage,
            stageEntrySeq: effects.stageEntrySeq,
            status: effects.mainStatus as string,
            suspended: effects.suspended ?? false,
          }));
        if (!moved) {
          return rejected<CaseLegalReviewHttpOutcome>(
            blockBody('concurrent-change', '案件已被他人更新', '请重新读取后再试'),
            {
              action: 'case.legal-review-started',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, caseId, REQUEST_OPCODE),
            },
          );
        }
        currentStage = effects.currentStage;
        stageEntrySeq = effects.stageEntrySeq;
        await tx.audit.append({
          action: 'case.transitioned',
          ...this.parties(prepared, caseId, REQUEST_OPCODE),
          detail: JSON.stringify({ caseId, transitionId: effects.transitionCode }),
        });
      }
      const inserted = await tx.cases.insertLegalReview({
        id: legalReviewId,
        caseId,
        roundNo,
        phase,
        status: 'drafting',
        receiverId,
        designatedBy: actor.personnelId,
        determinationJson: JSON.stringify({ ...assessment, decisionKind: frozen.kind, frozenDecisionId: frozen.id }),
        latestOpinionId: null,
        conclusion: null,
        headId: null,
        headSignedAt: null,
        concludedAt: null,
        createdAt: at,
        updatedAt: at,
      });
      if (!inserted) {
        return rejected<CaseLegalReviewHttpOutcome>(
          blockBody('concurrent-change', '法审轮次已被他人创建', '请重新读取后再试'),
          {
            action: 'case.legal-review-started',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, REQUEST_OPCODE),
          },
        );
      }
      const calendar = mergeCalendars(WORK_CALENDAR_V1, await tx.cases.listCalendarInstalls());
      const planned = this.planDeadline(caseId, legalReviewId, roundNo, at, calendar);
      if (planned) {
        const ok = await tx.cases.insertDeadlineRow({ id: newUlid(), caseId, ...planned });
        if (!ok) {
          return rejected<CaseLegalReviewHttpOutcome>(
            blockBody('concurrent-change', '期限行已被他人写入', '请重新读取后再试'),
            {
              action: 'case.legal-review-started',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, caseId, REQUEST_OPCODE),
            },
          );
        }
      }
      await tx.audit.append({
        action: 'case.legal-review-started',
        ...this.parties(prepared, caseId, REQUEST_OPCODE),
        detail: JSON.stringify({
          caseId,
          legalReviewId,
          roundNo,
          phase,
          receiverId,
          determination: assessment,
          frozenDecisionId: frozen.id,
          deadline: planned
            ? {
                ruleKey: legalReviewDeadlineKey(),
                startedOn: planned.startedOn,
                dueOn: planned.dueOn,
                needsManualConfirmation: planned.needsManualConfirmation,
              }
            : null,
          hints: hints.map((item) => ({ code: item.code, level: item.level })),
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'legal-review-started',
          caseId,
          legalReviewId,
          roundNo,
          phase,
          receiverId,
          determination: assessment,
          currentStage,
          stageEntrySeq,
          deadline: planned
            ? {
                ruleKey: legalReviewDeadlineKey(),
                startedOn: planned.startedOn,
                dueOn: planned.dueOn,
                needsManualConfirmation: planned.needsManualConfirmation,
                confirmationTrace: planned.confirmationTrace,
              }
            : null,
          hints,
        },
      };
    });
  }

  /** 审核人签出法审意见。审理人与法审人为同一人时警告，确认后留痕。 */
  async signOpinion(
    actor: ActorRef,
    legalReviewId: string,
    input: ConfirmationInput & { readonly conclusion?: unknown; readonly content?: unknown; readonly failRoute?: unknown; readonly discussionRecordId?: unknown },
  ): Promise<CaseLegalReviewHttpOutcome> {
    const row = await this.cases.readLegalReview(legalReviewId);
    if (!row) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, row.caseId, OPINION_OPCODE, 'case.legal-review-opinion-signed', false);
    if ('status' in prepared) return prepared;
    if (!prepared.roles.includes('法制审核')) {
      return this.fail(prepared, 'case.legal-review-opinion-signed', OPINION_OPCODE, {
        httpStatus: 409,
        reason: 'reviewer-not-legal-reviewer',
        message: '签出人须持法制审核角色',
        outlet: '由持法制审核角色的接收人签出',
      });
    }
    if (row.receiverId !== actor.personnelId) {
      return this.fail(prepared, 'case.legal-review-opinion-signed', OPINION_OPCODE, {
        httpStatus: 409,
        reason: 'reviewer-not-receiver',
        message: '只有被指定的法审接收人能签出',
        outlet: '由接收人签出，或由法制审核负责人改派接收人',
      });
    }
    if (row.status === 'pending_head') {
      return this.fail(prepared, 'case.legal-review-opinion-signed', OPINION_OPCODE, {
        httpStatus: 409,
        reason: 'opinion-not-pending',
        message: '法审意见已签出，等待负责人签出',
        outlet: '等负责人签出后再处理',
      });
    }
    if (row.status === 'concluded' && row.conclusion === 'pass') {
      return this.fail(prepared, 'case.legal-review-opinion-signed', OPINION_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '本轮法审已通过定稿',
        outlet: '需要再审时另起一轮',
      });
    }
    const expectedStage = row.phase === 'pre-notice' ? 'E07' : 'E09';
    if (prepared.view.currentStage !== expectedStage) {
      return this.fail(prepared, 'case.legal-review-opinion-signed', OPINION_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '当前环节不能签出法审意见',
        outlet: row.phase === 'pre-notice' ? '在法制审核环节签出' : '在决定拟制环节签出',
      });
    }
    const parsed = readLegalReviewOpinionContent({
      conclusion: input.conclusion,
      content: input.content,
      failRoute: input.failRoute,
      discussionRecordId: input.discussionRecordId,
    });
    if (!parsed.ok) {
      return this.fail(prepared, 'case.legal-review-opinion-signed', OPINION_OPCODE, {
        httpStatus: 400,
        reason: parsed.hit.reason,
        message: parsed.hit.message,
        outlet: parsed.hit.outlet,
      });
    }
    const conflict = await this.conflicts.assertCanSign(actor, row.caseId, actor.personnelId, 'legal-opinion');
    if (conflict.status === 400) return { status: 400, body: conflict.body as Record<string, unknown> };
    if (conflict.status === 403) return { status: 403, body: conflict.body as { reason: string } };
    if (conflict.status === 404) return { status: 404, body: { result: 'not-found' } };
    if (conflict.status === 409) return { status: 409, body: conflict.body as Record<string, unknown> };
    const reviewOpinions = await this.cases.listReviewOpinions(row.caseId);
    const samePerson = reviewOpinions.at(-1)?.signedBy === actor.personnelId;
    const warning = samePersonWarning(samePerson);
    const gate = applyWarningGate({
      notes: warning ? [warning] : [],
      confirmedRuleKeys: input.confirmedRuleKeys,
      confirmReasons: input.confirmReasons,
    });
    if (gate.kind === 'reject') return { status: 400, body: ruleKeyBody(gate.decision) };
    if (gate.kind === 'hold') {
      return this.uow.run(async () =>
        rejected(
          { status: 200 as const, body: warningBody(gate.decision.warnings) },
          {
            action: 'case.legal-review-opinion-signed',
            outcome: 'failed',
            reason: 'LEGAL-SAME-PERSON' as CaseLegalReviewFailedReason,
            ...this.parties(prepared, row.caseId, OPINION_OPCODE),
          },
        ),
      );
    }
    const confirmation = gate.kind === 'clear' ? gate.confirmation : null;
    const frozen = await this.latestFrozen(row.caseId);
    const opinions = await this.cases.listLegalReviewOpinions(row.caseId);
    const latestFail = [...opinions]
      .filter((item) => item.legalReviewId === legalReviewId && item.conclusion === 'fail' && item.headSignedAt !== null)
      .sort(byHeadSignedAt)
      .at(-1) ?? null;
    if (parsed.content.conclusion === 'pass' && latestFail?.failRoute === 'collective-discussion') {
      const recordId = parsed.content.discussionRecordId;
      if (!recordId) {
        return this.fail(prepared, 'case.legal-review-opinion-signed', OPINION_OPCODE, {
          httpStatus: 409,
          reason: 'discussion-reference-required',
          message: '前一次不通过提请集体讨论，本次通过须引用讨论记录',
          outlet: '录入集体讨论记录并引用',
        });
      }
      const records = await this.cases.listDiscussionRecords(row.caseId);
      const record = records.find((item) => item.id === recordId) ?? null;
      const checked = checkDiscussionReference({
        record: record ? discussionFacts(record) : null,
        caseId: row.caseId,
        latestFailAt: latestFail.headSignedAt,
      });
      if (!checked.ok) {
        return this.fail(prepared, 'case.legal-review-opinion-signed', OPINION_OPCODE, {
          httpStatus: 409,
          reason: checked.reason,
          message: checked.message,
          outlet: checked.outlet,
        });
      }
    }
    const at = this.clock.now();
    const opinionId = newUlid();
    return this.uow.run(async (tx) => {
      await tx.cases.insertLegalReviewOpinion({
        id: opinionId,
        legalReviewId,
        caseId: row.caseId,
        roundNo: row.roundNo,
        conclusion: parsed.content.conclusion,
        failRoute: parsed.content.failRoute,
        content: parsed.content.content,
        signedBy: actor.personnelId,
        signedAt: at,
        frozenDecisionId: frozen?.id ?? null,
        discussionRecordId: parsed.content.discussionRecordId,
      });
      const updated = await tx.cases.applyLegalReviewHeader({
        legalReviewId,
        expectedStatuses: ['drafting', 'concluded'],
        status: 'pending_head',
        latestOpinionId: opinionId,
        conclusion: null,
        headId: null,
        headSignedAt: null,
        concludedAt: null,
        at,
      });
      if (!updated) {
        return rejected<CaseLegalReviewHttpOutcome>(
          blockBody('concurrent-change', '法审意见已被他人签出', '请重新读取后再试'),
          {
            action: 'case.legal-review-opinion-signed',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, row.caseId, OPINION_OPCODE),
          },
        );
      }
      const parties = this.parties(prepared, row.caseId, OPINION_OPCODE);
      await tx.audit.append({
        action: 'case.legal-review-opinion-signed',
        ...parties,
        detail: JSON.stringify({
          caseId: row.caseId,
          legalReviewId,
          roundNo: row.roundNo,
          opinionId,
          conclusion: parsed.content.conclusion,
          failRoute: parsed.content.failRoute,
          discussionRecordId: parsed.content.discussionRecordId,
          confirmationRuleKeys: confirmation?.ruleKeys ?? [],
        }),
      });
      if (confirmation) {
        await appendRuleConfirmation(tx.audit, {
          parties,
          confirmation,
          at,
          step: 'legal-review-opinion:LEGAL-SAME-PERSON',
          confirmReasons: input.confirmReasons,
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'legal-review-opinion-signed',
          caseId: row.caseId,
          legalReviewId,
          roundNo: row.roundNo,
          opinionId,
          conclusion: parsed.content.conclusion,
          status: 'pending_head',
        },
      };
    });
  }

  /** 法制审核负责人签出。两级签完后定稿；告知前通过时执行 T10b 进入 E05。 */
  async signConclusion(
    actor: ActorRef,
    legalReviewId: string,
    input: { readonly opinion?: unknown },
  ): Promise<CaseLegalReviewHttpOutcome> {
    const row = await this.cases.readLegalReview(legalReviewId);
    if (!row) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, row.caseId, HEAD_OPCODE, 'case.legal-review-concluded', false);
    if ('status' in prepared) return prepared;
    const attendance = await this.attributionOrgId(prepared.view);
    const headCheck = await this.headCheck(actor.personnelId, attendance.attributionOrgId);
    if (!headCheck.ok) {
      return this.fail(prepared, 'case.legal-review-concluded', HEAD_OPCODE, {
        httpStatus: 409,
        reason: headCheck.reason,
        message: headCheck.message,
        outlet: headCheck.outlet,
      });
    }
    if (row.status !== 'pending_head' || !row.latestOpinionId) {
      return this.fail(prepared, 'case.legal-review-concluded', HEAD_OPCODE, {
        httpStatus: 409,
        reason: 'no-pending-opinion',
        message: '没有待负责人签出的法审意见',
        outlet: '等审核人签出后再签',
      });
    }
    const opinion = await this.cases.readLegalReviewOpinion(row.latestOpinionId);
    if (!opinion || opinion.headSignedAt !== null) {
      return this.fail(prepared, 'case.legal-review-concluded', HEAD_OPCODE, {
        httpStatus: 409,
        reason: 'no-pending-opinion',
        message: '没有待负责人签出的法审意见',
        outlet: '等审核人签出后再签',
      });
    }
    const conflict = await this.conflicts.assertCanSign(actor, row.caseId, actor.personnelId, 'legal-opinion');
    if (conflict.status === 400) return { status: 400, body: conflict.body as Record<string, unknown> };
    if (conflict.status === 403) return { status: 403, body: conflict.body as { reason: string } };
    if (conflict.status === 404) return { status: 404, body: { result: 'not-found' } };
    if (conflict.status === 409) return { status: 409, body: conflict.body as Record<string, unknown> };
    const at = this.clock.now();
    const pass = opinion.conclusion === 'pass';
    const other = await this.cases.countInFlightApprovals(row.caseId);
    const subject = await this.subjectOf(prepared.view, prepared.roles, other);
    let decision: TransitionDecision | null = null;
    if (pass && row.phase === 'pre-notice') {
      if (prepared.view.currentStage !== 'E07') {
        return this.fail(prepared, 'case.legal-review-concluded', HEAD_OPCODE, {
          httpStatus: 409,
          reason: 'invalid-state',
          message: '当前环节不能完成告知前法审',
          outlet: '在法制审核环节签出',
        });
      }
      decision = decideTransition({ operation: { kind: 'transition', transitionId: 'T10b' }, subject });
      if (!decision.ok) return this.settle(prepared, 'case.legal-review-concluded', HEAD_OPCODE, decision);
    }
    const headOpinion = text(input.opinion);
    return this.uow.run(async (tx) => {
      const signed = await tx.cases.signLegalReviewOpinion({
        opinionId: opinion.id,
        headId: actor.personnelId,
        headSignedAt: at,
        headOpinion: headOpinion === '' ? null : headOpinion,
      });
      if (!signed) {
        return rejected<CaseLegalReviewHttpOutcome>(
          blockBody('concurrent-change', '法审意见已被他人签出', '请重新读取后再试'),
          {
            action: 'case.legal-review-concluded',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, row.caseId, HEAD_OPCODE),
          },
        );
      }
      const updated = await tx.cases.applyLegalReviewHeader({
        legalReviewId,
        expectedStatuses: ['pending_head'],
        status: 'concluded',
        latestOpinionId: opinion.id,
        conclusion: opinion.conclusion,
        headId: actor.personnelId,
        headSignedAt: at,
        concludedAt: at,
        at,
      });
      if (!updated) {
        return rejected<CaseLegalReviewHttpOutcome>(
          blockBody('concurrent-change', '法审轮次已被他人更新', '请重新读取后再试'),
          {
            action: 'case.legal-review-concluded',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, row.caseId, HEAD_OPCODE),
          },
        );
      }
      let currentStage = prepared.view.currentStage;
      let stageEntrySeq = prepared.view.stageEntrySeq;
      if (decision && decision.ok && decision.effects.kind === 'advance') {
        const effects = decision.effects;
        if (effects.currentStage !== 'E05' || effects.stageEntrySeq === null) {
          return rejected<CaseLegalReviewHttpOutcome>(
            blockBody('invalid-state', '法审通过没有可执行的单一去向', '按当前环节重新提交'),
            {
              action: 'case.legal-review-concluded',
              outcome: 'failed',
              reason: 'invalid-state',
              ...this.parties(prepared, row.caseId, HEAD_OPCODE),
            },
          );
        }
        const wrote = await persistTransitionEffects(tx.cases, {
          effects,
          caseId: row.caseId,
          clueId: prepared.view.sourceClueIds[0] ?? null,
          actorId: actor.personnelId,
          at,
          fromJson: JSON.stringify({
            stage: prepared.view.currentStage,
            status: prepared.view.status,
            stageEntrySeq: prepared.view.stageEntrySeq,
          }),
          toJson: JSON.stringify({ stage: effects.currentStage, status: effects.mainStatus, stageEntrySeq: effects.stageEntrySeq }),
          newId: () => newUlid(),
        });
        const moved =
          wrote &&
          (await tx.cases.advanceCasePointer({
            caseId: row.caseId,
            expectedStage: prepared.view.currentStage,
            expectedSeq: prepared.view.stageEntrySeq,
            stage: effects.currentStage as string,
            stageEntrySeq: effects.stageEntrySeq as number,
            status: effects.mainStatus as string,
            suspended: effects.suspended ?? false,
          }));
        if (!moved) {
          return rejected<CaseLegalReviewHttpOutcome>(
            blockBody('concurrent-change', '案件已被他人更新', '请重新读取后再试'),
            {
              action: 'case.legal-review-concluded',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, row.caseId, HEAD_OPCODE),
            },
          );
        }
        currentStage = effects.currentStage;
        stageEntrySeq = effects.stageEntrySeq;
        await tx.audit.append({
          action: 'case.transitioned',
          ...this.parties(prepared, row.caseId, HEAD_OPCODE),
          detail: JSON.stringify({ caseId: row.caseId, transitionId: effects.transitionCode }),
        });
      }
      await tx.audit.append({
        action: 'case.legal-review-concluded',
        ...this.parties(prepared, row.caseId, HEAD_OPCODE),
        detail: JSON.stringify({
          caseId: row.caseId,
          legalReviewId,
          roundNo: row.roundNo,
          opinionId: opinion.id,
          conclusion: opinion.conclusion,
          failRoute: opinion.failRoute,
          headOpinion,
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'legal-review-concluded',
          caseId: row.caseId,
          legalReviewId,
          roundNo: row.roundNo,
          opinionId: opinion.id,
          conclusion: opinion.conclusion,
          failRoute: opinion.failRoute,
          currentStage,
          stageEntrySeq,
        },
      };
    });
  }

  /** G5：法制审核负责人改派接收人。复用改派码，理由必填留痕；原接收人已签内容保留。 */
  async reassignReceiver(
    actor: ActorRef,
    legalReviewId: string,
    input: { readonly receiverId?: unknown; readonly reason?: unknown },
  ): Promise<CaseLegalReviewHttpOutcome> {
    const row = await this.cases.readLegalReview(legalReviewId);
    if (!row) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, row.caseId, REASSIGN_OPCODE, 'case.legal-review-receiver-changed', false);
    if ('status' in prepared) return prepared;
    const attendance = await this.attributionOrgId(prepared.view);
    const headCheck = await this.headCheck(actor.personnelId, attendance.attributionOrgId);
    if (!headCheck.ok) {
      return this.fail(prepared, 'case.legal-review-receiver-changed', REASSIGN_OPCODE, {
        httpStatus: 409,
        reason: headCheck.reason,
        message: headCheck.message,
        outlet: headCheck.outlet,
      });
    }
    if (row.status === 'concluded') {
      return this.fail(prepared, 'case.legal-review-receiver-changed', REASSIGN_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '本轮法审已定稿，不能改派接收人',
        outlet: '需要再审时另起一轮',
      });
    }
    const reason = text(input.reason);
    if (reason === '') {
      return this.fail(prepared, 'case.legal-review-receiver-changed', REASSIGN_OPCODE, {
        httpStatus: 400,
        reason: 'missing-reason',
        message: '改派理由必填',
        outlet: '填写改派理由',
      });
    }
    const receiverId = text(input.receiverId);
    if (receiverId === '') {
      return this.fail(prepared, 'case.legal-review-receiver-changed', REASSIGN_OPCODE, {
        httpStatus: 400,
        reason: 'missing-receiver',
        message: '法审接收人必填，系统不自动选',
        outlet: '从候选名单指定接收人',
      });
    }
    const attributionOrgId = attendance.attributionOrgId;
    if (!attributionOrgId) {
      return this.fail(prepared, 'case.legal-review-receiver-changed', REASSIGN_OPCODE, {
        httpStatus: 409,
        reason: 'no-legal-review-org',
        message: '无法确定该案的法制审核归属机构',
        outlet: '核对承办机构层级与上级机构',
      });
    }
    const receiver = await this.receiverFacts(row.caseId, receiverId, attributionOrgId);
    if (!receiver.check.ok) {
      return this.fail(prepared, 'case.legal-review-receiver-changed', REASSIGN_OPCODE, {
        httpStatus: 409,
        reason: receiver.check.reason,
        message: receiver.check.message,
        outlet: receiver.check.outlet,
      });
    }
    const at = this.clock.now();
    const previousReceiverId = row.receiverId;
    return this.uow.run(async (tx) => {
      const changed = await tx.cases.replaceLegalReviewReceiver({ legalReviewId, receiverId, at });
      if (!changed) {
        return rejected<CaseLegalReviewHttpOutcome>(
          blockBody('concurrent-change', '法审轮次已被他人更新', '请重新读取后再试'),
          {
            action: 'case.legal-review-receiver-changed',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, row.caseId, REASSIGN_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.legal-review-receiver-changed',
        ...this.parties(prepared, row.caseId, REASSIGN_OPCODE),
        previousValue: previousReceiverId,
        detail: JSON.stringify({
          caseId: row.caseId,
          legalReviewId,
          roundNo: row.roundNo,
          previousReceiverId,
          receiverId,
          reason,
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'legal-review-receiver-changed',
          caseId: row.caseId,
          legalReviewId,
          roundNo: row.roundNo,
          previousReceiverId,
          receiverId,
          reason,
          hint: legalQualificationHint(null),
        },
      };
    });
  }

  /** 决定审批链领导审批前的闸口：X27 → X08 → X09。X33 由 assertCanSign 执行。 */
  async assertDecisionGate(actor: ActorRef, caseId: string): Promise<CaseLegalReviewHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, APPROVE_OPCODE, 'case.decision-gate-checked', false);
    if ('status' in prepared) return prepared;
    const conflict = await this.conflicts.assertCanSign(actor, caseId, actor.personnelId, 'decision');
    if (conflict.status === 400) return { status: 400, body: conflict.body as Record<string, unknown> };
    if (conflict.status === 403) return { status: 403, body: conflict.body as { reason: string } };
    if (conflict.status === 404) return { status: 404, body: { result: 'not-found' } };
    if (conflict.status === 409) return { status: 409, body: conflict.body as Record<string, unknown> };
    const facts = await this.decisionGateFacts(caseId);
    const checked = assertDecisionGate(facts);
    if (!checked.ok) {
      return this.uow.run(async () =>
        rejected(
          blockBody(checked.block.code, checked.block.message, checked.block.outlet, checked.block.citation),
          {
            action: 'case.decision-gate-checked',
            outcome: 'failed',
            reason: checked.block.code,
            ...this.parties(prepared, caseId, APPROVE_OPCODE),
          },
        ),
      );
    }
    return this.uow.run(async (tx) => {
      await tx.audit.append({
        action: 'case.decision-gate-checked',
        ...this.parties(prepared, caseId, APPROVE_OPCODE),
        detail: JSON.stringify({ caseId, gate: 'passed', facts: gateFactSnapshot(facts) }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'decision-gate-passed',
          caseId,
          mandatoryReview: facts.mandatory,
          hearingEntered: facts.hearingEntered,
          discussionRequired: facts.discussionRequired,
          latestConclusion: facts.latestConclusion,
        },
      };
    });
  }

  /** 经办勾选集体讨论标准并写理由。 */
  async markDiscussion(
    actor: ActorRef,
    caseId: string,
    input: { readonly criteriaCodes?: unknown; readonly reason?: unknown },
  ): Promise<CaseLegalReviewHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, MARK_OPCODE, 'case.discussion-marked', true);
    if ('status' in prepared) return prepared;
    const stageHit = this.discussionStageHit(prepared, 'case.discussion-marked', MARK_OPCODE);
    if (stageHit) return stageHit;
    const parsed = readDiscussionMarkContent(input);
    if (!parsed.ok) {
      return this.fail(prepared, 'case.discussion-marked', MARK_OPCODE, {
        httpStatus: 400,
        reason: parsed.hit.reason,
        message: parsed.hit.message,
        outlet: parsed.hit.outlet,
      });
    }
    const at = this.clock.now();
    const id = newUlid();
    return this.uow.run(async (tx) => {
      await tx.cases.insertDiscussionMark({
        id,
        caseId,
        criteriaJson: JSON.stringify(parsed.content.criteriaCodes),
        reason: parsed.content.reason,
        markedBy: actor.personnelId,
        createdAt: at,
      });
      await tx.audit.append({
        action: 'case.discussion-marked',
        ...this.parties(prepared, caseId, MARK_OPCODE),
        detail: JSON.stringify({
          caseId,
          markId: id,
          criteriaCodes: parsed.content.criteriaCodes,
          reason: parsed.content.reason,
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'discussion-marked',
          caseId,
          markId: id,
          criteriaCodes: parsed.content.criteriaCodes,
          discussionRequired: true,
        },
      };
    });
  }

  /** 主办或协办录入集体讨论记录（case.discussion.record）。入卷，只追加。 */
  async recordDiscussion(
    actor: ActorRef,
    caseId: string,
    input: { readonly purposes?: unknown; readonly criteriaCodes?: unknown; readonly note?: unknown },
  ): Promise<CaseLegalReviewHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DISCUSSION_OPCODE, 'case.discussion-recorded', true);
    if ('status' in prepared) return prepared;
    const stageHit = this.discussionStageHit(prepared, 'case.discussion-recorded', DISCUSSION_OPCODE);
    if (stageHit) return stageHit;
    const parsed = readDiscussionRecordContent(input);
    if (!parsed.ok) {
      return this.fail(prepared, 'case.discussion-recorded', DISCUSSION_OPCODE, {
        httpStatus: 400,
        reason: parsed.hit.reason,
        message: parsed.hit.message,
        outlet: parsed.hit.outlet,
      });
    }
    const at = this.clock.now();
    const id = newUlid();
    return this.uow.run(async (tx) => {
      await tx.cases.insertDiscussionRecord({
        id,
        caseId,
        purposesJson: JSON.stringify(parsed.content.purposes),
        criteriaJson: JSON.stringify(parsed.content.criteriaCodes),
        note: parsed.content.note,
        recordedBy: actor.personnelId,
        recordedAt: at,
        createdAt: at,
      });
      await tx.audit.append({
        action: 'case.discussion-recorded',
        ...this.parties(prepared, caseId, DISCUSSION_OPCODE),
        detail: JSON.stringify({
          caseId,
          discussionRecordId: id,
          purposes: parsed.content.purposes,
          criteriaCodes: parsed.content.criteriaCodes,
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'discussion-recorded',
          caseId,
          discussionRecordId: id,
          purposes: parsed.content.purposes,
          criteriaCodes: parsed.content.criteriaCodes,
        },
      };
    });
  }

  private async prepare(
    actor: ActorRef,
    caseId: string,
    opcode: string,
    action: CaseLegalReviewAction,
    mustBeHandler: boolean,
  ): Promise<Prepared | CaseLegalReviewHttpOutcome> {
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
        });
      }
      return { status: 403, body: { reason: denied } };
    }
    if (mustBeHandler && !this.isHandler(view, actor.personnelId)) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    return prepared;
  }

  private isHandler(view: CaseView, personnelId: string): boolean {
    return view.handlers.some((row) => row.personnelId === personnelId && HANDLER_ROLES.has(row.role));
  }

  /** 集体讨论勾选与记录只在法审或决定拟制环节发生。 */
  private discussionStageHit(
    prepared: Prepared,
    action: CaseLegalReviewAction,
    opcode: string,
  ): Promise<CaseLegalReviewHttpOutcome> | null {
    const { view } = prepared;
    if (view.status === 'in_progress' && (view.currentStage === 'E07' || view.currentStage === 'E09')) return null;
    return this.fail(prepared, action, opcode, {
      httpStatus: 409,
      reason: 'invalid-state',
      message: '当前环节不能登记集体讨论',
      outlet: '在法制审核或决定拟制环节办理',
    });
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

  /** 该案的法制审核归属机构。市承办归市局；区承办归该区；所承办归所在区分局。 */
  private async attributionOrgId(view: CaseView): Promise<{ attributionOrgId: string | null }> {
    const handling = await this.identity.findOrgUnitById(view.handlingOrgId);
    if (!handling) return { attributionOrgId: null };
    const parent = handling.parentId ? await this.identity.findOrgUnitById(handling.parentId) : null;
    const attributionOrgId = legalReviewAttributionOrgId(
      { id: handling.id, level: handling.level, parentId: handling.parentId },
      parent ? { id: parent.id, level: parent.level, parentId: parent.parentId } : null,
    );
    return { attributionOrgId };
  }

  private async headCheck(
    personnelId: string,
    attributionOrgId: string | null,
  ): Promise<{ ok: true } | { ok: false; reason: string; message: string; outlet: string }> {
    const person = await this.identity.findPersonnelById(personnelId);
    if (!person) {
      return { ok: false, reason: 'head-deactivated', message: '签出人不存在或已停用', outlet: '改由归属那一级的法制审核负责人签出' };
    }
    const roles = await this.identity.listActiveRoleNames(personnelId);
    const posts = await this.identity.listActivePosts(personnelId);
    const assignment = await this.identity.findCurrentAssignment(personnelId);
    const checked = checkLegalReviewHead({
      roles,
      posts,
      attributedOrgMatches: attributionOrgId !== null && assignment?.orgUnitId === attributionOrgId,
      deactivated: person.deactivatedAt !== null,
    });
    return checked.ok ? { ok: true } : checked;
  }

  private async receiverFacts(
    caseId: string,
    personnelId: string,
    attributionOrgId: string,
  ): Promise<{ check: { ok: true } | { ok: false; reason: string; message: string; outlet: string } }> {
    const person = await this.identity.findPersonnelById(personnelId);
    const roles = person ? await this.identity.listActiveRoleNames(personnelId) : [];
    const assignment = await this.identity.findCurrentAssignment(personnelId);
    const stints = await this.cases.listHandlerStints(caseId);
    const events = await this.cases.listPersonConflictEvents(caseId);
    const check = checkLegalReviewReceiver({
      roles,
      attributedOrgMatches: assignment?.orgUnitId === attributionOrgId,
      isHandlerEver: stints.some((row) => row.personnelId === personnelId),
      hasActiveConflict: activeConflicts(events.map(toConflictFact), personnelId).length > 0,
      deactivated: person === null || person.deactivatedAt !== null,
    });
    return { check };
  }

  private async candidateRows(
    caseId: string,
    attributionOrgId: string | null,
  ): Promise<Array<{ personnelId: string; code: string; name: string; eligible: boolean; reason: string | null }>> {
    if (!attributionOrgId) return [];
    const people = await this.identity.listActivePersonnelOfOrgUnit(attributionOrgId);
    const stints = await this.cases.listHandlerStints(caseId);
    const events = await this.cases.listPersonConflictEvents(caseId);
    const handlerEver = new Set(stints.map((row) => row.personnelId));
    const conflicted = new Set(activeConflicts(events.map(toConflictFact)).map((row) => row.personId));
    const rows: Array<{ personnelId: string; code: string; name: string; eligible: boolean; reason: string | null }> = [];
    for (const person of people) {
      const roles = await this.identity.listActiveRoleNames(person.id);
      if (!roles.includes('法制审核')) continue;
      const check = checkLegalReviewReceiver({
        roles,
        attributedOrgMatches: true,
        isHandlerEver: handlerEver.has(person.id),
        hasActiveConflict: conflicted.has(person.id),
        deactivated: person.deactivatedAt !== null,
      });
      rows.push({
        personnelId: person.id,
        code: person.code,
        name: person.name,
        eligible: check.ok,
        reason: check.ok ? null : check.reason,
      });
    }
    return rows;
  }

  private async latestFrozen(caseId: string): Promise<FrozenFact | null> {
    const rows = await this.cases.listFrozenDecisions(caseId);
    const latest = rows.at(-1);
    if (!latest) return null;
    const parsed = parseJson(latest.summaryJson);
    const violations = Array.isArray(parsed?.violations) ? parsed.violations : [];
    const penaltyCodes: string[] = [];
    let fineAmount = 0;
    for (const item of violations) {
      const row = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
      if (Array.isArray(row.penaltyCodes)) {
        for (const code of row.penaltyCodes) {
          if (typeof code === 'string' && !penaltyCodes.includes(code)) penaltyCodes.push(code);
        }
      }
      if (typeof row.fineAmount === 'number') fineAmount += row.fineAmount;
    }
    return {
      id: latest.id,
      opinionId: latest.opinionId,
      kind: typeof parsed?.kind === 'string' ? parsed.kind : 'penalty',
      penaltyCodes,
      fineAmount,
    };
  }

  private manualItemsOf(reviews: readonly LegalReviewRow[]): string[] {
    const latest = [...reviews].sort((left, right) => left.roundNo - right.roundNo).at(-1);
    if (!latest) return [];
    const parsed = parseJson(latest.determinationJson);
    const items = Array.isArray(parsed?.manualItems) ? parsed.manualItems : [];
    return items.filter((item): item is string => typeof item === 'string');
  }

  private assessmentOf(input: {
    readonly decisionKind: string;
    readonly penaltyCodes: readonly string[];
    readonly markers: readonly string[];
    readonly hearings: readonly { readonly endKind: string | null; readonly acceptedAt: Date | null; readonly scheduledAt: Date | null }[];
    readonly manualItems: readonly string[];
    readonly criminalTransfer: boolean;
  }): MandatoryReviewAssessment {
    return assessMandatoryReview({
      decisionKind: input.decisionKind,
      hearingHeld: input.hearings.some((row) => row.endKind === 'concluded'),
      hearingEntered:
        input.markers.includes('hearing-entered')
        || input.hearings.some((row) => row.acceptedAt !== null || row.scheduledAt !== null),
      penaltyCodes: input.penaltyCodes,
      criminalTransfer: input.criminalTransfer,
      manualItems: input.manualItems,
    });
  }

  private async decisionGateFacts(caseId: string): Promise<DecisionGateFacts> {
    const frozen = await this.latestFrozen(caseId);
    const reviews = await this.cases.listLegalReviews(caseId);
    const opinions = await this.cases.listLegalReviewOpinions(caseId);
    const hearings = await this.cases.listHearings(caseId);
    const markers = await readActiveCaseMarkers(this.cases, caseId);
    const notices = await this.cases.listNotices(caseId);
    const marks = await this.cases.listDiscussionMarks(caseId);
    const records = await this.cases.listDiscussionRecords(caseId);
    const assessment = this.assessmentOf({
      decisionKind: frozen?.kind ?? 'penalty',
      penaltyCodes: frozen?.penaltyCodes ?? [],
      markers,
      hearings,
      manualItems: this.manualItemsOf(reviews),
      criminalTransfer: false,
    });
    let noticeMandatory = false;
    const notice = notices.at(-1);
    if (notice) {
      const parsed = parseJson(notice.contentJson);
      noticeMandatory = parsed?.mandatoryReview === true;
    }
    const concluded = opinions
      .filter((opinion) => opinion.headSignedAt !== null)
      .sort(byHeadSignedAt);
    const latest = concluded.at(-1) ?? null;
    const passes = concluded.filter((opinion) => opinion.conclusion === 'pass');
    const latestPass = passes.at(-1) ?? null;
    const latestMark = marks.at(-1) ?? null;
    const latestPassAt = latestPass?.headSignedAt ?? null;
    const latestHearingEntryAt = latestHearingEntry(hearings);
    const discussionSatisfied =
      latestMark === null
        ? true
        : records.some(
            (record) =>
              (parseJsonArray(record.purposesJson) ?? []).includes('penalty-decision')
              && record.createdAt.getTime() >= latestMark.createdAt.getTime()
              && (latestPassAt === null || record.createdAt.getTime() > latestPassAt.getTime()),
          );
    return {
      mandatory: assessment.required || noticeMandatory,
      latestConclusion: latest && (latest.conclusion === 'pass' || latest.conclusion === 'fail') ? latest.conclusion : null,
      latestPassCovered: summaryCoversDecision({
        reviewedFrozenDecisionId: latestPass?.frozenDecisionId ?? null,
        currentFrozenDecisionId: frozen?.id ?? null,
      }),
      hearingEntered: markers.includes('hearing-entered') || latestHearingEntryAt !== null,
      latestHearingEntryAt,
      latestPassAt,
      discussionRequired: marks.length > 0,
      discussionSatisfied,
    };
  }

  private planDeadline(
    caseId: string,
    legalReviewId: string,
    roundNo: number,
    at: Date,
    calendar: WorkCalendar,
  ): {
    ruleKey: string;
    entrySeq: number;
    procedureNode: string;
    startingDocument: string | null;
    consumption: string;
    ruleVersion: string;
    dayCount: number;
    dayBasis: string;
    partyFacing: boolean;
    extensionAllowance: number | null;
    startedOn: string;
    dueOn: string | null;
    needsManualConfirmation: boolean;
    confirmationTrace: string | null;
    rowStatus: string;
    revisionNo: number;
    calendarVersion: string;
    clamped: boolean;
  } | null {
    const planned = planAnchor({
      caseId,
      ruleKey: LEGAL_REVIEW_DEADLINE_RULE_KEY,
      entrySeq: roundNo,
      procedureNode: 'E07',
      startingDocument: legalReviewId,
      startedOn: civilDate(at),
      exclusions: [],
      extensionDays: 0,
      paused: false,
      calendar,
    });
    if (!planned.ok) return null;
    return deadlineRowFromPlan(planned.plan);
  }

  private settle(
    prepared: Prepared,
    action: CaseLegalReviewAction,
    opcode: string,
    decision: Exclude<TransitionDecision, { ok: true }>,
  ): Promise<CaseLegalReviewHttpOutcome> {
    if (decision.httpStatus === 400) return Promise.resolve({ status: 400, body: ruleKeyBody(decision) });
    if (decision.level === 'block') {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: decision.reason,
        message: decision.message,
        outlet: decision.outlet,
        citation: decision.citation,
      });
    }
    return this.holdWarning(prepared, action, opcode, decision);
  }

  private holdWarning(
    prepared: Prepared,
    action: CaseLegalReviewAction,
    opcode: string,
    decision: Extract<TransitionDecision, { httpStatus: 200 }>,
  ): Promise<CaseLegalReviewHttpOutcome> {
    const reason = (FAIL_REASONS.has(decision.reason) ? decision.reason : 'invalid-state') as CaseLegalReviewFailedReason;
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

  private fail(
    prepared: Prepared,
    action: CaseLegalReviewAction,
    opcode: string,
    fail: {
      readonly httpStatus: 400 | 409;
      readonly reason: string;
      readonly message: string;
      readonly outlet: string;
      readonly citation?: string | null;
    },
  ): Promise<CaseLegalReviewHttpOutcome> {
    const reason = (FAIL_REASONS.has(fail.reason) ? fail.reason : 'invalid-state') as CaseLegalReviewFailedReason;
    const outcome: CaseLegalReviewHttpOutcome =
      fail.httpStatus === 400
        ? { status: 400, body: { result: 'non-compliant', reason: fail.reason, message: fail.message } }
        : blockBody(fail.reason, fail.message, fail.outlet, fail.citation ?? null);
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

  private parties(actor: Prepared, caseId: string, opcode: string) {
    return {
      actorId: actor.actorId,
      actorCode: actor.actorCode,
      subjectPersonnelId: null,
      subjectCode: null,
      orgUnitId: actor.view.handlingOrgId,
      sourceIp: null,
      opcode,
      resourceType: 'case' as const,
      resourceId: caseId,
    };
  }
}

function legalReviewDeadlineKey(): string {
  return LEGAL_REVIEW_DEADLINE_RULE_KEY;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown): string[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return (value as string[]).map((item) => item.trim()).filter((item) => item !== '');
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseJsonArray(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
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

function byHeadSignedAt(left: LegalReviewOpinionRow, right: LegalReviewOpinionRow): number {
  const delta = (left.headSignedAt?.getTime() ?? 0) - (right.headSignedAt?.getTime() ?? 0);
  return delta !== 0 ? delta : left.id.localeCompare(right.id);
}

function latestConcludedOpinion(opinions: readonly LegalReviewOpinionRow[]): LegalReviewOpinionRow | null {
  return opinions.filter((opinion) => opinion.headSignedAt !== null).sort(byHeadSignedAt).at(-1) ?? null;
}

function latestHearingEntry(
  hearings: readonly { readonly acceptedAt: Date | null; readonly scheduledAt: Date | null }[],
): Date | null {
  let latest: Date | null = null;
  for (const hearing of hearings) {
    for (const at of [hearing.acceptedAt, hearing.scheduledAt]) {
      if (at && (latest === null || at.getTime() > latest.getTime())) latest = at;
    }
  }
  return latest;
}

function discussionFacts(record: DiscussionRecordRow) {
  return {
    id: record.id,
    caseId: record.caseId,
    purposes: (parseJsonArray(record.purposesJson) ?? []).filter(
      (item): item is string => typeof item === 'string',
    ),
    createdAt: record.createdAt,
  };
}

function presentOpinion(opinion: LegalReviewOpinionRow) {
  return {
    id: opinion.id,
    conclusion: opinion.conclusion,
    failRoute: opinion.failRoute,
    content: opinion.content,
    signedBy: opinion.signedBy,
    signedAt: opinion.signedAt.toISOString(),
    frozenDecisionId: opinion.frozenDecisionId,
    discussionRecordId: opinion.discussionRecordId,
    headId: opinion.headId,
    headSignedAt: opinion.headSignedAt?.toISOString() ?? null,
    headOpinion: opinion.headOpinion,
  };
}

function presentDiscussionRecord(record: DiscussionRecordRow) {
  return {
    id: record.id,
    purposes: parseJsonArray(record.purposesJson),
    criteria: parseJsonArray(record.criteriaJson),
    note: record.note,
    recordedBy: record.recordedBy,
    recordedAt: record.recordedAt.toISOString(),
  };
}

function gateFactSnapshot(facts: DecisionGateFacts) {
  return {
    mandatory: facts.mandatory,
    latestConclusion: facts.latestConclusion,
    latestPassCovered: facts.latestPassCovered,
    hearingEntered: facts.hearingEntered,
    latestHearingEntryAt: facts.latestHearingEntryAt?.toISOString() ?? null,
    latestPassAt: facts.latestPassAt?.toISOString() ?? null,
    discussionRequired: facts.discussionRequired,
    discussionSatisfied: facts.discussionSatisfied,
  };
}

function deadlineRowFromPlan(plan: AnchorPlan) {
  return {
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

function blockBody(
  reason: string,
  message: string,
  outlet: string,
  citation: string | null = null,
): CaseLegalReviewHttpOutcome {
  return { status: 409, body: { result: reason, reason, message, basis: citation, outlet } };
}