// 有效性确认、加重来源、重新告知与决定呈批闸口（#248；#28 A／B／C、Q13／Q14／Q18）。
// A 类（含 B1b）系统判失效，阻断决定呈批直到重新告知；B 类须主办确认并经审理／法审复核；
// Q14 在陈述申辩后加重时须写明来源。重新告知撤销原告知（served → revoked），T32 再进入 E05，
// 进入次序号加 1；新告知送达时生成新陈述申辩期与听证申请期，旧期限行与旧基线保留；
// 90 日办案期限不重置（Q18）。阻断不设绕过通道（Q22）。

import { Inject, Injectable } from '@nestjs/common';
import {
  CASE_VALIDITY_FAILED_REASONS,
  rejected,
  type CaseValidityAction,
  type CaseValidityFailedReason,
} from '@natural-enforcement/audit';
import {
  CASE_STORE,
  CASE_SUPERVISION_ROLE,
  aggravationSourceValid,
  assertValidityGate,
  assessValidity,
  decideTransition,
  decisionDigest,
  isAggravationSourceKind,
  isNoticeKind,
  isSystemValidityReason,
  isTerminalCaseStatus,
  isValidityReissueReason,
  readActiveCaseMarkers,
  readDecisionSummary,
  readNoticeContent,
  stageIndex,
  type CaseStore,
  type CaseView,
  type DecisionSummary,
  type NoticeRow,
  type NoticeValidityBaselineRow,
  type PartySubmissionRow,
  type TransitionDecision,
  type TransitionSubject,
  type ValidityAssessment,
  type ValidityBaseline,
  type ValidityConfirmationFact,
  type ValidityConfirmationRow,
  type ValidityGateCheck,
  type ValidityGateFacts,
  type ValidityHit,
  type ValidityReviewRow,
} from '@natural-enforcement/case';
import {
  AccessControlService,
  IDENTITY_STORE,
  isAccessDenied,
  newUlid,
  type ActorRef,
  type IdentityStore,
} from '@natural-enforcement/identity';

import { persistTransitionEffects } from './case-transition-write.ts';
import { CLOCK, type Clock } from './clock.ts';
import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const READ_OPCODE = 'case.read';
const CONFIRM_OPCODE = 'doc.submit';
const REISSUE_OPCODE = 'doc.submit';
const GATE_OPCODE = 'doc.approve';
const REVIEW_OPCODES = ['doc.admin.review', 'legal.opinion.submit'] as const;
const HANDLER_ROLES = new Set(['main', 'assist']);
const REVIEWER_ROLES = new Set(['行政审核', '法制审核']);
const FAIL_REASONS = new Set<string>(CASE_VALIDITY_FAILED_REASONS);

export type CaseValidityHttpOutcome =
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

interface CurrentDecision {
  readonly frozenId: string;
  readonly opinionId: string;
  readonly summary: DecisionSummary;
  readonly digest: string;
}

interface Q14Fact {
  readonly noticeId: string;
  readonly hitCodes: readonly ('A4' | 'A5')[];
  readonly satisfied: boolean;
  readonly latestStatementAt: Date;
  readonly confirmationId: string | null;
}

interface Evaluation {
  readonly notices: readonly NoticeRow[];
  readonly latestNotice: NoticeRow | null;
  readonly baselineRow: NoticeValidityBaselineRow | null;
  readonly baseline: ValidityBaseline | null;
  readonly current: CurrentDecision | null;
  readonly assessment: ValidityAssessment | null;
  readonly confirmations: readonly ValidityConfirmationRow[];
  readonly reviews: readonly ValidityReviewRow[];
  readonly confirmation: ValidityConfirmationRow | null;
  readonly confirmationFact: ValidityConfirmationFact | null;
  readonly statements: readonly PartySubmissionRow[];
  readonly q14: readonly Q14Fact[];
  readonly gateFacts: ValidityGateFacts;
  readonly gate: ValidityGateCheck;
}

@Injectable()
export class CaseValidityService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly access: AccessControlService,
  ) {}

  /** 读差异清单、确认与复核记录、Q14 状态与闸口预览。 */
  async read(actor: ActorRef, caseId: string): Promise<CaseValidityHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const denied = await this.authorize(actor, READ_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };
    const evaluation = await this.evaluate(view);
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    const isHandler = view.handlers.some((row) => row.personnelId === actor.personnelId && HANDLER_ROLES.has(row.role));
    const openHearing = await this.cases.readOpenHearing(caseId);
    const inSpan = view.currentStage !== null
      && stageIndex(view.currentStage) >= stageIndex('E05')
      && stageIndex(view.currentStage) <= stageIndex('E09');
    return {
      status: 200,
      body: {
        caseId,
        status: view.status,
        currentStage: view.currentStage,
        stageEntrySeq: view.stageEntrySeq,
        notice: evaluation.latestNotice
          ? {
              id: evaluation.latestNotice.id,
              entrySeq: evaluation.latestNotice.entrySeq,
              kind: evaluation.latestNotice.kind,
              servedOn: evaluation.latestNotice.servedOn,
            }
          : null,
        baseline: evaluation.baselineRow
          ? {
              id: evaluation.baselineRow.id,
              noticeId: evaluation.baselineRow.noticeId,
              entrySeq: evaluation.baselineRow.entrySeq,
              capturedAt: evaluation.baselineRow.capturedAt.toISOString(),
              digest: evaluation.baselineRow.summaryDigest,
              hearingNoticeAttached: evaluation.baselineRow.hearingNoticeAttached,
              partyType: evaluation.baselineRow.partyType,
            }
          : null,
        current: evaluation.current
          ? {
              frozenId: evaluation.current.frozenId,
              opinionId: evaluation.current.opinionId,
              kind: evaluation.current.summary.kind,
              digest: evaluation.current.digest,
              parties: evaluation.current.summary.parties,
              violations: evaluation.current.summary.violations,
            }
          : null,
        systemHits: evaluation.assessment?.hits ?? [],
        differences: evaluation.assessment?.differences ?? [],
        groups: evaluation.assessment?.groups ?? [],
        conclusion: evaluation.assessment?.conclusion ?? null,
        renoticeRequired: evaluation.assessment?.renoticeRequired ?? false,
        q14: evaluation.q14.map((row) => ({
          noticeId: row.noticeId,
          hitCodes: row.hitCodes,
          satisfied: row.satisfied,
          latestStatementAt: row.latestStatementAt.toISOString(),
          confirmationId: row.confirmationId,
        })),
        confirmation: evaluation.confirmation ? confirmationView(evaluation.confirmation, evaluation.reviews) : null,
        confirmations: evaluation.confirmations.map((row) => confirmationView(row, evaluation.reviews)),
        gate: evaluation.gate.ok ? { ok: true } : { ok: false, block: evaluation.gate.block },
        entries: {
          confirm: isHandler && evaluation.baselineRow !== null && evaluation.current !== null,
          review: roles.some((role) => REVIEWER_ROLES.has(role))
            && evaluation.confirmations.some((row) => !evaluation.reviews.some((review) => review.confirmationId === row.id)),
          aggravation: isHandler && evaluation.q14.some((row) => row.hitCodes.length > 0 && !row.satisfied),
          reissue: isHandler && evaluation.baselineRow !== null && inSpan && openHearing === null,
        },
      },
    };
  }

  /** 主办作有效性确认。系统判失效的 A 类命中不能被确认为有效。 */
  async confirm(
    actor: ActorRef,
    caseId: string,
    input: {
      readonly noticeId?: unknown;
      readonly conclusion?: unknown;
      readonly reason?: unknown;
      readonly reasonChanged?: unknown;
      readonly aggravationSource?: unknown;
      readonly aggravationReference?: unknown;
      readonly aggravationReason?: unknown;
    },
  ): Promise<CaseValidityHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, CONFIRM_OPCODE, 'case.validity-confirmed', true);
    if ('status' in prepared) return prepared;
    const conclusion = text(input.conclusion);
    if (conclusion !== 'valid' && conclusion !== 'invalid') {
      return this.fail(prepared, 'case.validity-confirmed', CONFIRM_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-conclusion',
        message: '确认结论只能是有效或失效',
        outlet: '按有效或失效选择',
      });
    }
    const reason = text(input.reason);
    if (reason === '') {
      return this.fail(prepared, 'case.validity-confirmed', CONFIRM_OPCODE, {
        httpStatus: 400,
        reason: 'missing-reason',
        message: '有效性确认理由必填',
        outlet: '填写确认理由',
      });
    }
    const reasonChanged = input.reasonChanged === true;
    const aggravation = readAggravation(input);
    if (aggravation.kind === 'invalid') {
      return this.fail(prepared, 'case.validity-confirmed', CONFIRM_OPCODE, {
        httpStatus: 400,
        reason: aggravation.reason,
        message: aggravation.message,
        outlet: aggravation.outlet,
      });
    }
    const evaluation = await this.evaluate(prepared.view);
    const noticeId = text(input.noticeId) === '' ? evaluation.latestNotice?.id ?? '' : text(input.noticeId);
    const baselineRow = noticeId === '' ? null : await this.cases.readNoticeValidityBaseline(noticeId);
    if (!baselineRow || baselineRow.caseId !== caseId) {
      return this.fail(prepared, 'case.validity-confirmed', CONFIRM_OPCODE, {
        httpStatus: 409,
        reason: 'no-baseline',
        message: '该告知没有有效性基线',
        outlet: '先送达告知书',
      });
    }
    if (!evaluation.current) {
      return this.fail(prepared, 'case.validity-confirmed', CONFIRM_OPCODE, {
        httpStatus: 409,
        reason: 'no-frozen-decision',
        message: '缺少当前拟决定摘要',
        outlet: '先完成审理意见签出',
      });
    }
    const baseline = toBaselineOrNull(baselineRow);
    if (!baseline) {
      return this.fail(prepared, 'case.validity-confirmed', CONFIRM_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-summary',
        message: '告知有效性基线不合规',
        outlet: '补充送达基线后再作确认',
      });
    }
    const current = evaluation.current;
    const assessment = assessValidity({
      baseline,
      current: current.summary,
      reasonChanged,
    });
    if (conclusion === 'valid' && assessment.hits.length > 0) {
      return this.fail(prepared, 'case.validity-confirmed', CONFIRM_OPCODE, {
        httpStatus: 409,
        reason: 'validity-system-invalid',
        message: '系统判定告知失效，不能确认有效',
        outlet: '先重新告知，或按失效确认',
        basis: '行政处罚法第44条；#28 第四节',
      });
    }
    let aggravationFields: {
      readonly source: string | null;
      readonly reference: string | null;
      readonly note: string | null;
    } = { source: null, reference: null, note: null };
    if (aggravation.kind === 'set') {
      const latestStatementAt = await this.latestStatementAt(noticeId);
      const reference = prepared.view.returns.find((row) => row.id === aggravation.reference);
      const valid = aggravationSourceValid({
        sourceKind: aggravation.source,
        reference: reference
          ? {
              reasonCode: reference.reasonCode,
              inheritedCode: reference.inheritedCode,
              reflow: reference.reflow,
              createdAt: reference.createdAt,
            }
          : null,
        afterAt: latestStatementAt,
      });
      if (!valid) {
        return this.fail(prepared, 'case.validity-confirmed', CONFIRM_OPCODE, {
          httpStatus: 409,
          reason: 'aggravation-reference-invalid',
          message: '加重来源须是本案的 R4 退回或陈述申辩后的回流记录',
          outlet: '改选本案的回流或 R4 退回记录',
          basis: '行政处罚法第45条第2款；规程8.2',
        });
      }
      aggravationFields = { source: aggravation.source, reference: aggravation.reference, note: aggravation.note };
    }
    const at = this.clock.now();
    const confirmationId = newUlid();
    return this.uow.run(async (tx) => {
      await tx.cases.insertValidityConfirmation({
        id: confirmationId,
        caseId,
        noticeId,
        decisionDigest: current.digest,
        systemHitsJson: JSON.stringify(assessment.hits),
        differencesJson: JSON.stringify(assessment.groups),
        conclusion,
        reason,
        reasonChanged,
        aggravationSource: aggravationFields.source,
        aggravationReference: aggravationFields.reference,
        aggravationReason: aggravationFields.note,
        confirmedBy: actor.personnelId,
        confirmedAt: at,
      });
      await tx.audit.append({
        action: 'case.validity-confirmed',
        ...this.parties(prepared, caseId, CONFIRM_OPCODE),
        detail: JSON.stringify({
          caseId,
          confirmationId,
          noticeId,
          decisionDigest: current.digest,
          conclusion,
          reason,
          reasonChanged,
          systemHits: assessment.hits.map((row) => row.code),
          aggravationSource: aggravationFields.source,
          aggravationReference: aggravationFields.reference,
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'validity-confirmed',
          caseId,
          confirmationId,
          noticeId,
          conclusion,
          systemHits: assessment.hits,
          differences: assessment.groups,
          decisionDigest: current.digest,
        },
      };
    });
  }

  /** 审理或法审复核有效性确认。复核人不得是确认人。 */
  async review(
    actor: ActorRef,
    confirmationId: string,
    input: { readonly conclusion?: unknown; readonly opinion?: unknown },
  ): Promise<CaseValidityHttpOutcome> {
    const confirmation = await this.cases.readValidityConfirmation(confirmationId);
    if (!confirmation) return { status: 404, body: { result: 'not-found' } };
    const view = await this.cases.readCaseView(confirmation.caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const roles = await this.identity.listActiveRoleNames(actor.personnelId);
    if (!roles.some((role) => REVIEWER_ROLES.has(role))) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    const opcode = await this.grantedOpcode(actor, view, REVIEW_OPCODES);
    if (!opcode) return { status: 403, body: { reason: 'permission-denied' } };
    const prepared: Prepared = {
      actorId: actor.personnelId,
      actorCode: (await this.directory.findById(actor.personnelId))?.code ?? null,
      roles,
      view,
    };
    if (isTerminalCaseStatus(view.status)) {
      return this.fail(prepared, 'case.validity-reviewed', opcode, {
        httpStatus: 409,
        reason: 'X12',
        message: '案件已终态，该业务写操作不能继续',
        outlet: '终态后仅可阅读、导出',
      });
    }
    if (confirmation.confirmedBy === actor.personnelId) {
      return this.fail(prepared, 'case.validity-reviewed', opcode, {
        httpStatus: 409,
        reason: 'same-reviewer',
        message: '复核人不得是确认人',
        outlet: '由另一名审理人或法制审核人员复核',
      });
    }
    const conclusion = text(input.conclusion);
    if (conclusion !== 'pass' && conclusion !== 'fail') {
      return this.fail(prepared, 'case.validity-reviewed', opcode, {
        httpStatus: 400,
        reason: 'invalid-conclusion',
        message: '复核结论只能是通过或不通过',
        outlet: '按通过或不通过选择',
      });
    }
    const reviews = await this.cases.listValidityReviews(confirmation.caseId);
    if (reviews.some((row) => row.confirmationId === confirmationId)) {
      return this.fail(prepared, 'case.validity-reviewed', opcode, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '该有效性确认已复核',
        outlet: '按当前复核结论处理',
      });
    }
    const at = this.clock.now();
    const reviewId = newUlid();
    const opinion = text(input.opinion);
    return this.uow.run(async (tx) => {
      await tx.cases.insertValidityReview({
        id: reviewId,
        caseId: confirmation.caseId,
        confirmationId,
        conclusion,
        opinion: opinion === '' ? null : opinion,
        reviewedBy: actor.personnelId,
        reviewedAt: at,
      });
      await tx.audit.append({
        action: 'case.validity-reviewed',
        ...this.parties(prepared, confirmation.caseId, opcode),
        detail: JSON.stringify({ caseId: confirmation.caseId, confirmationId, reviewId, conclusion }),
      });
      return {
        status: 200 as const,
        body: { result: 'validity-reviewed', caseId: confirmation.caseId, confirmationId, reviewId, conclusion },
      };
    });
  }

  /** 重新告知：撤销原告知，T32 再进入 E05（次序号加 1），生成新告知拟制稿。 */
  async reissue(
    actor: ActorRef,
    caseId: string,
    input: { readonly reason?: unknown; readonly note?: unknown; readonly confirmedRuleKeys?: unknown; readonly confirmReasons?: unknown },
  ): Promise<CaseValidityHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, REISSUE_OPCODE, 'case.notice-reissued', true);
    if ('status' in prepared) return prepared;
    const reason = text(input.reason);
    if (!isValidityReissueReason(reason)) {
      return this.fail(prepared, 'case.notice-reissued', REISSUE_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-state',
        message: '没有这类重新告知原因',
        outlet: '按 A 类、B1b、理由已变化或 R7 选择',
      });
    }
    const note = text(input.note);
    if (note === '') {
      return this.fail(prepared, 'case.notice-reissued', REISSUE_OPCODE, {
        httpStatus: 400,
        reason: 'missing-note',
        message: '重新告知说明必填',
        outlet: '填写重新告知的原因说明',
      });
    }
    const evaluation = await this.evaluate(prepared.view);
    const notice = evaluation.latestNotice;
    if (!notice || !evaluation.baselineRow || !evaluation.baseline) {
      return this.fail(prepared, 'case.notice-reissued', REISSUE_OPCODE, {
        httpStatus: 409,
        reason: 'no-baseline',
        message: '没有已送达的告知书',
        outlet: '先送达告知书',
      });
    }
    if (!evaluation.current) {
      return this.fail(prepared, 'case.notice-reissued', REISSUE_OPCODE, {
        httpStatus: 409,
        reason: 'no-frozen-decision',
        message: '缺少当前拟决定摘要',
        outlet: '先完成审理意见签出',
      });
    }
    const openHearing = await this.cases.readOpenHearing(caseId);
    if (openHearing) {
      return this.fail(prepared, 'case.notice-reissued', REISSUE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '听证尚未结束，不能重新告知',
        outlet: '先办结当前听证',
      });
    }
    const openNotice = await this.cases.readOpenNotice(caseId);
    if (openNotice) {
      return this.fail(prepared, 'case.notice-reissued', REISSUE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '已有未送达的告知，不能再次重新告知',
        outlet: '先送达或办结当前告知',
      });
    }
    if (isSystemValidityReason(reason)) {
      const matched = (evaluation.assessment?.hits ?? []).some((row) => row.code === reason);
      if (!matched) {
        return this.fail(prepared, 'case.notice-reissued', REISSUE_OPCODE, {
          httpStatus: 409,
          reason: 'validity-reason-mismatch',
          message: '所选重新告知原因与系统判定的失效项不一致',
          outlet: '按系统判定的 A 类项选择',
        });
      }
    }
    const oldContent = readNoticeContent(parseJson(notice.contentJson));
    if (!oldContent.ok) {
      return this.fail(prepared, 'case.notice-reissued', REISSUE_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-content',
        message: '原告知正文不合规',
        outlet: '先核对原告知正文',
      });
    }
    const kind = isNoticeKind(evaluation.current.summary.kind) ? evaluation.current.summary.kind : notice.kind;
    const contentJson = JSON.stringify({ ...oldContent.content, kind });
    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: 'T32' },
      subject: await this.subjectOf(prepared.view, prepared.roles, await this.cases.countInFlightApprovals(caseId)),
      confirmedRuleKeys: asStringList(input.confirmedRuleKeys),
      confirmReasons: asReasonMap(input.confirmReasons),
    });
    if (!decision.ok) return this.settle(prepared, 'case.notice-reissued', REISSUE_OPCODE, decision);
    const effects = decision.effects;
    if (
      effects.kind !== 'advance'
      || effects.currentStage !== 'E05'
      || effects.stageEntrySeq === null
      || !effects.transitionCode
    ) {
      return this.fail(prepared, 'case.notice-reissued', REISSUE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '重新告知没有可执行的去向',
        outlet: '按当前环节处理',
      });
    }
    const at = this.clock.now();
    const newNoticeId = newUlid();
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
        return rejected<CaseValidityHttpOutcome>(
          blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.notice-reissued',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, REISSUE_OPCODE),
          },
        );
      }
      const revoked = await tx.cases.revokeNotice({
        noticeId: notice.id,
        stepId: newUlid(),
        versionNo: notice.currentVersionNo,
        actorId: actor.personnelId,
        opinion: `${reason}：${note}`,
        at,
      });
      if (!revoked) {
        return rejected<CaseValidityHttpOutcome>(
          blockBody('concurrent-change', '告知已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.notice-reissued',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, REISSUE_OPCODE),
          },
        );
      }
      const saved = await tx.cases.saveNoticeDraft({
        noticeId: newNoticeId,
        caseId,
        entrySeq: effects.stageEntrySeq as number,
        kind,
        drafterId: actor.personnelId,
        isNew: true,
        expectedVersionNo: 0,
        versionId: newUlid(),
        contentJson,
        at,
      });
      if (!saved) {
        return rejected<CaseValidityHttpOutcome>(
          blockBody('concurrent-change', '告知已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.notice-reissued',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, REISSUE_OPCODE),
          },
        );
      }
      const active = await readActiveCaseMarkers(tx.cases, caseId);
      for (const marker of ['notice-waiting', 'deemed-waived', 'hearing-terminated'] as const) {
        if (!active.includes(marker)) continue;
        await tx.cases.appendCaseMarker({
          id: newUlid(),
          caseId,
          marker,
          state: 'cleared',
          note: newNoticeId,
          actorId: actor.personnelId,
          changedAt: at,
        });
      }
      const parties = this.parties(prepared, caseId, REISSUE_OPCODE);
      await tx.audit.append({
        action: 'case.notice-reissued',
        ...parties,
        previousValue: notice.id,
        detail: JSON.stringify({
          caseId,
          reason,
          note,
          oldNoticeId: notice.id,
          newNoticeId,
          entrySeqBefore: notice.entrySeq,
          entrySeqAfter: effects.stageEntrySeq,
          transitionId: 'T32',
        }),
      });
      await tx.audit.append({
        action: 'case.transitioned',
        ...parties,
        detail: JSON.stringify({ caseId, transitionId: 'T32', oldNoticeId: notice.id, newNoticeId }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'notice-reissued',
          caseId,
          oldNoticeId: notice.id,
          noticeId: newNoticeId,
          entrySeq: effects.stageEntrySeq,
          currentStage: effects.currentStage,
          reason,
        },
      };
    });
  }

  /**
   * 决定呈批闸口。供决定票 doc.approve 调用（#270）。
   * 入参可带决定书摘要；缺省用最近一次冻结的拟决定摘要。
   */
  async assertValidityGate(
    actor: ActorRef,
    caseId: string,
    input: { readonly summary?: unknown } = {},
  ): Promise<CaseValidityHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, GATE_OPCODE, 'case.validity-gate-checked', false);
    if ('status' in prepared) return prepared;
    let evaluation: Evaluation;
    if (input.summary !== undefined) {
      const current = await this.currentOf(prepared.view, input.summary);
      if (!current) {
        return this.fail(prepared, 'case.validity-gate-checked', GATE_OPCODE, {
          httpStatus: 400,
          reason: 'invalid-summary',
          message: '决定书摘要不合规',
          outlet: '按决定书摘要格式提交',
        });
      }
      evaluation = await this.evaluate(prepared.view, current);
    } else {
      evaluation = await this.evaluate(prepared.view);
    }
    if (!evaluation.gate.ok) {
      const block = evaluation.gate.block;
      return this.fail(prepared, 'case.validity-gate-checked', GATE_OPCODE, {
        httpStatus: 409,
        reason: FAIL_REASONS.has(block.code) ? block.code : 'validity-invalid',
        message: block.message,
        outlet: block.outlet,
        basis: block.citation,
      });
    }
    return this.uow.run(async (tx) => {
      await tx.audit.append({
        action: 'case.validity-gate-checked',
        ...this.parties(prepared, caseId, GATE_OPCODE),
        detail: JSON.stringify({
          caseId,
          gate: 'passed',
          noticeId: evaluation.latestNotice?.id ?? null,
          decisionDigest: evaluation.current?.digest ?? null,
          systemHits: evaluation.assessment?.hits.map((row) => row.code) ?? [],
          differences: evaluation.assessment?.differences.length ?? 0,
          q14: evaluation.q14.map((row) => ({ noticeId: row.noticeId, hitCodes: row.hitCodes, satisfied: row.satisfied })),
        }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'validity-gate-passed',
          caseId,
          noticeId: evaluation.latestNotice?.id ?? null,
          decisionDigest: evaluation.current?.digest ?? null,
          systemHits: evaluation.assessment?.hits ?? [],
          differences: evaluation.assessment?.groups ?? [],
        },
      };
    });
  }

  private async evaluate(view: CaseView, override?: CurrentDecision): Promise<Evaluation> {
    const notices = await this.cases.listNotices(view.id);
    const latestNotice = [...notices].reverse().find((row) => row.status === 'served') ?? null;
    const baselineRow = latestNotice ? await this.cases.readNoticeValidityBaseline(latestNotice.id) : null;
    const baseline = baselineRow ? toBaselineOrNull(baselineRow) : null;
    const current = override ?? (await this.currentOf(view));
    const confirmations = await this.cases.listValidityConfirmations(view.id);
    const reviews = await this.cases.listValidityReviews(view.id);
    const confirmation = baselineRow
      ? [...confirmations].reverse().find((row) => row.noticeId === baselineRow.noticeId) ?? null
      : null;
    const confirmationFact = confirmation && current
      ? {
          conclusion: confirmation.conclusion === 'invalid' ? 'invalid' as const : 'valid' as const,
          digestMatches: confirmation.decisionDigest === current.digest,
          reviewedPass: reviews.some((row) => row.confirmationId === confirmation.id && row.conclusion === 'pass'),
          reasonChanged: confirmation.reasonChanged,
        }
      : null;
    const assessment = baseline && current
      ? assessValidity({ baseline, current: current.summary, reasonChanged: confirmation?.reasonChanged === true })
      : null;
    const statements = await this.cases.listPartySubmissions(view.id);
    const q14 = await this.q14Facts(view, statements, current, confirmations);
    const gateFacts: ValidityGateFacts = {
      noticeExists: notices.length > 0,
      baselinePresent: baseline !== null,
      currentPresent: current !== null,
      hits: assessment?.hits ?? [],
      differences: assessment?.differences ?? [],
      confirmation: confirmationFact,
      q14: q14.map((row) => ({ noticeId: row.noticeId, hitCodes: row.hitCodes, satisfied: row.satisfied })),
    };
    return {
      notices,
      latestNotice,
      baselineRow,
      baseline,
      current,
      assessment,
      confirmations,
      reviews,
      confirmation,
      confirmationFact,
      statements,
      q14,
      gateFacts,
      gate: assertValidityGate(gateFacts),
    };
  }

  /** 当前拟决定摘要。默认取最近一次冻结摘要；当事人与没收等价值按案件与原告知补齐。 */
  private async currentOf(view: CaseView, raw?: unknown): Promise<CurrentDecision | null> {
    const notices = await this.cases.listNotices(view.id);
    const latestServed = [...notices].reverse().find((row) => row.status === 'served') ?? null;
    const baselineRow = latestServed ? await this.cases.readNoticeValidityBaseline(latestServed.id) : null;
    if (raw !== undefined) {
      const parsed = readDecisionSummary(raw, {
        parties: view.partyNames,
        confiscationValue: baselineRow?.confiscationValue ?? null,
      });
      if (!parsed.ok) return null;
      return {
        frozenId: '',
        opinionId: '',
        summary: parsed.summary,
        digest: decisionDigest(parsed.summary),
      };
    }
    const rows = await this.cases.listFrozenDecisions(view.id);
    const latest = rows.at(-1);
    if (!latest) return null;
    const parsed = readDecisionSummary(parseJson(latest.summaryJson), {
      parties: view.partyNames,
      confiscationValue: baselineRow?.confiscationValue ?? null,
    });
    if (!parsed.ok) return null;
    return {
      frozenId: latest.id,
      opinionId: latest.opinionId,
      summary: parsed.summary,
      digest: decisionDigest(parsed.summary),
    };
  }

  /** Q14：原告知下已有陈述申辩，且相对该告知书命中 A4／A5 的，须有可追溯的加重来源。 */
  private async q14Facts(
    view: CaseView,
    statements: readonly PartySubmissionRow[],
    current: CurrentDecision | null,
    confirmations: readonly ValidityConfirmationRow[],
  ): Promise<Q14Fact[]> {
    const byNotice = new Map<string, Date>();
    for (const row of statements) {
      if (row.kind !== 'statement') continue;
      const known = byNotice.get(row.noticeId);
      if (!known || row.recordedAt.getTime() > known.getTime()) byNotice.set(row.noticeId, row.recordedAt);
    }
    const facts: Q14Fact[] = [];
    for (const [noticeId, latestStatementAt] of byNotice) {
      if (!current) {
        facts.push({ noticeId, hitCodes: [], satisfied: false, latestStatementAt, confirmationId: null });
        continue;
      }
      const baselineRow = await this.cases.readNoticeValidityBaseline(noticeId);
      const baseline = baselineRow ? toBaselineOrNull(baselineRow) : null;
      if (!baseline) {
        facts.push({ noticeId, hitCodes: [], satisfied: false, latestStatementAt, confirmationId: null });
        continue;
      }
      const comparison = assessValidity({ baseline, current: current.summary });
      const hitCodes = comparison.hits
        .filter((row): row is ValidityHit & { readonly code: 'A4' | 'A5' } => row.code === 'A4' || row.code === 'A5')
        .map((row) => row.code);
      const candidates = confirmations.filter(
        (row) => row.noticeId === noticeId
          && row.decisionDigest === current.digest
          && row.aggravationSource !== null
          && row.aggravationReference !== null,
      );
      const satisfied = candidates.some((row) => {
        const reference = view.returns.find((item) => item.id === row.aggravationReference);
        return aggravationSourceValid({
          sourceKind: row.aggravationSource as string,
          reference: reference
            ? {
                reasonCode: reference.reasonCode,
                inheritedCode: reference.inheritedCode,
                reflow: reference.reflow,
                createdAt: reference.createdAt,
              }
            : null,
          afterAt: latestStatementAt,
        });
      });
      facts.push({
        noticeId,
        hitCodes,
        satisfied,
        latestStatementAt,
        confirmationId: candidates.at(-1)?.id ?? null,
      });
    }
    return facts;
  }

  private async latestStatementAt(noticeId: string): Promise<Date | null> {
    const confirmation = await this.cases.readNoticeValidityBaseline(noticeId);
    if (!confirmation) return null;
    const rows = await this.cases.listPartySubmissions(confirmation.caseId);
    const stamps = rows.filter((row) => row.noticeId === noticeId && row.kind === 'statement').map((row) => row.recordedAt.getTime());
    return stamps.length === 0 ? null : new Date(Math.max(...stamps));
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
    action: CaseValidityAction,
    mustBeHandler: boolean,
  ): Promise<Prepared | CaseValidityHttpOutcome> {
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
    if (mustBeHandler && !initialView.handlers.some((row) => row.personnelId === actor.personnelId && HANDLER_ROLES.has(row.role))) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    if (mustBeHandler && isTerminalCaseStatus(initialView.status)) {
      return this.fail(initial, action, opcode, {
        httpStatus: 409,
        reason: 'X12',
        message: '案件已终态，该业务写操作不能继续',
        outlet: '终态后仅可阅读、导出',
      });
    }
    return initial;
  }

  private async grantedOpcode(
    actor: ActorRef,
    view: CaseView,
    opcodes: readonly string[],
  ): Promise<string | null> {
    for (const opcode of opcodes) {
      const denied = await this.authorize(actor, opcode, view.handlingOrgId, view.id);
      if (denied === null) return opcode;
    }
    return null;
  }

  private async settle(
    prepared: Prepared,
    action: CaseValidityAction,
    opcode: string,
    decision: Exclude<TransitionDecision, { ok: true }>,
  ): Promise<CaseValidityHttpOutcome> {
    if (decision.httpStatus === 400) {
      return { status: 400, body: { result: 'non-compliant', reason: decision.reason, message: decision.message, outlet: decision.outlet } };
    }
    if (decision.level === 'block') {
      return this.fail(prepared, action, opcode, {
        httpStatus: 409,
        reason: decision.reason,
        message: decision.message,
        outlet: decision.outlet,
        basis: decision.citation,
      });
    }
    return this.uow.run(async () =>
      rejected(
        { status: 200 as const, body: { result: 'warnings', warnings: decision.warnings } },
        {
          action,
          outcome: 'failed',
          reason: 'invalid-state',
          ...this.parties(prepared, prepared.view.id, opcode),
        },
      ),
    );
  }

  private async fail(
    prepared: Prepared,
    action: CaseValidityAction,
    opcode: string,
    fail: {
      readonly httpStatus: 400 | 409;
      readonly reason: string;
      readonly message: string;
      readonly outlet: string;
      readonly basis?: string | null;
    },
  ): Promise<CaseValidityHttpOutcome> {
    const reason = (FAIL_REASONS.has(fail.reason) ? fail.reason : 'invalid-state') as CaseValidityFailedReason;
    const outcome: CaseValidityHttpOutcome =
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
}

type AggravationRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'set'; readonly source: string; readonly reference: string; readonly note: string }
  | { readonly kind: 'invalid'; readonly reason: string; readonly message: string; readonly outlet: string };

function readAggravation(input: {
  readonly aggravationSource?: unknown;
  readonly aggravationReference?: unknown;
  readonly aggravationReason?: unknown;
}): AggravationRead {
  const source = text(input.aggravationSource);
  const reference = text(input.aggravationReference);
  const note = text(input.aggravationReason);
  if (source === '' && reference === '' && note === '') return { kind: 'none' };
  if (source === '' || reference === '' || note === '') {
    return {
      kind: 'invalid',
      reason: 'missing-aggravation',
      message: '加重来源、记录标识与理由须同时填写',
      outlet: '补齐加重来源三栏',
    };
  }
  if (!isAggravationSourceKind(source)) {
    return {
      kind: 'invalid',
      reason: 'invalid-aggravation',
      message: '没有这类加重来源',
      outlet: '按回流新证据或 R4 定性纠正选择',
    };
  }
  return { kind: 'set', source, reference, note };
}

function toBaselineOrNull(row: NoticeValidityBaselineRow): ValidityBaseline | null {
  const parsed = readDecisionSummary(parseJson(row.summaryJson), {
    parties: [],
    confiscationValue: row.confiscationValue,
  });
  if (!parsed.ok) return null;
  return {
    noticeId: row.noticeId,
    entrySeq: row.entrySeq,
    kind: row.kind,
    partyType: row.partyType === 'legal-person' ? 'legal-person' : 'citizen',
    hearingNoticeAttached: row.hearingNoticeAttached,
    confiscationValue: row.confiscationValue,
    summary: parsed.summary,
  };
}

function confirmationView(row: ValidityConfirmationRow, reviews: readonly ValidityReviewRow[]): Record<string, unknown> {
  const related = reviews.filter((review) => review.confirmationId === row.id);
  const latest = related.at(-1) ?? null;
  return {
    id: row.id,
    noticeId: row.noticeId,
    decisionDigest: row.decisionDigest,
    conclusion: row.conclusion,
    reason: row.reason,
    reasonChanged: row.reasonChanged,
    systemHits: parseJson(row.systemHitsJson),
    differences: parseJson(row.differencesJson),
    aggravation: row.aggravationSource === null
      ? null
      : {
          source: row.aggravationSource,
          reference: row.aggravationReference,
          reason: row.aggravationReason,
        },
    confirmedBy: row.confirmedBy,
    confirmedAt: row.confirmedAt.toISOString(),
    review: latest
      ? {
          id: latest.id,
          conclusion: latest.conclusion,
          opinion: latest.opinion,
          reviewedBy: latest.reviewedBy,
          reviewedAt: latest.reviewedAt.toISOString(),
        }
      : null,
  };
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

function asStringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}

function asReasonMap(value: unknown): Readonly<Record<string, string>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item;
  }
  return result;
}

function blockBody(reason: string, message: string, citation: string | null, outlet: string): CaseValidityHttpOutcome {
  return { status: 409, body: { result: reason, reason, message, basis: citation, outlet } };
}