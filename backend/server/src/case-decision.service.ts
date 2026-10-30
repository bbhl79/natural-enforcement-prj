// 决定（E09／T23）的读写（#270）。判定在 case 包的纯规则里，这里只喂事实、落库、写留痕。
// 决定呈批沿用 doc.draft / doc.submit / doc.admin.review / doc.approve。
// 批准时依次过：新旧比对（#271）、法审与集体讨论闸口（#269）、有效性闸口（#248）、
// X05／X06／X16（本服务喂事实，引擎按 #255 层级映射）。X10 不在本环节。
// T23 只在本服务的批准事务里落库；通用迁移入口拒绝直接套用。
// 「领导审批」是本条呈批的最后一步，服务把该事实作为引擎 subject 的临时标记传入，不另写标记行。

import { Inject, Injectable } from '@nestjs/common';
import {
  rejected,
  CASE_DECISION_FAILED_REASONS,
  type CaseDecisionAction,
  type CaseDecisionFailedReason,
} from '@natural-enforcement/audit';
import {
  CASE_STORE,
  CASE_SUPERVISION_ROLE,
  DECISION_DOCUMENT_NAMES,
  DECISION_KIND_NAMES,
  DOSSIER_MATERIALS_RULE_ID,
  DOSSIER_MATERIALS_VERSION,
  beijingDateOf,
  canTakeFilingStep,
  decideTransition,
  decisionDocumentTypeOf,
  deriveDecisionKind,
  deriveDecisionSignature,
  dossierInstanceKey,
  filingStatusAfter,
  fineBaseHint,
  fineBaseMissing,
  hasFine,
  hearingWindowState,
  invalidMaterialIds,
  isTerminalCaseStatus,
  missingEvidenceRefs,
  readActiveCaseMarkers,
  readDecisionContent,
  readFrozenViolations,
  readNoticeContent,
  x05Guard,
  x06Guard,
  x16Guard,
  type CaseStore,
  type CaseView,
  type DecisionContent,
  type DecisionDocumentType,
  type DecisionKind,
  type DecisionNoticeWindow,
  type DecisionSignature,
  type FrozenViolationFact,
  type FilingAdminReview,
  type GuardResult,
  type NoticeRow,
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
import { CaseComparisonService } from './case-comparison.service.ts';
import { CaseLegalReviewService } from './case-legal-review.service.ts';
import { CaseValidityService } from './case-validity.service.ts';
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
const DECISION_TRANSITION = 'T23';
const HANDLER_ROLES = new Set(['main', 'assist']);
const FAIL_REASONS = new Set<string>(CASE_DECISION_FAILED_REASONS);

export type CaseDecisionHttpOutcome =
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

interface FrozenFacts {
  readonly id: string | null;
  readonly violations: readonly FrozenViolationFact[];
  readonly kind: DecisionKind;
  readonly hasFine: boolean;
  readonly fineMissing: boolean;
}

interface NoticeFacts {
  readonly served: boolean;
  readonly notice: NoticeRow | null;
  readonly window: DecisionNoticeWindow | null;
  readonly waiverRecorded: boolean;
}

interface EvidenceFacts {
  readonly inDossierIds: readonly string[];
  readonly materialIds: readonly string[];
  readonly invalidMaterialIds: readonly string[];
}

interface DecisionFacts {
  readonly frozen: FrozenFacts;
  readonly notice: NoticeFacts;
  readonly evidence: EvidenceFacts;
  readonly signature: DecisionSignature;
}

interface StoredDecisionContent extends DecisionContent {
  readonly kind: DecisionKind;
  readonly hasFine: boolean;
  readonly documentType: DecisionDocumentType;
  readonly frozenDecisionId: string | null;
}

@Injectable()
export class CaseDecisionService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILING_ADMIN_REVIEW) private readonly adminReview: FilingAdminReview,
    private readonly access: AccessControlService,
    private readonly comparison: CaseComparisonService,
    private readonly legalReview: CaseLegalReviewService,
    private readonly validity: CaseValidityService,
  ) {}

  async read(actor: ActorRef, caseId: string): Promise<CaseDecisionHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const denied = await this.authorize(actor, READ_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };
    const [facts, open, approved] = await Promise.all([
      this.factsOf(view),
      this.cases.readOpenDecisionApproval(caseId),
      this.cases.readApprovedDecisionApproval(caseId),
    ]);
    const content = open ? this.parseStored(open.contentJson) : null;
    const documentType = content?.documentType ?? this.documentTypeOf(facts, content);
    return {
      status: 200,
      body: {
        caseId,
        status: view.status,
        currentStage: view.currentStage,
        stageEntrySeq: view.stageEntrySeq,
        decision: {
          kind: facts.frozen.kind,
          kindName: DECISION_KIND_NAMES[facts.frozen.kind],
          frozenDecisionId: facts.frozen.id,
          violations: facts.frozen.violations,
          documentType,
          documentName: DECISION_DOCUMENT_NAMES[documentType],
          correctionOrdered: content?.correctionOrdered ?? false,
          evidenceRefs: content?.evidenceRefs ?? [],
          note: content?.note ?? null,
          missingEvidenceRefs: content
            ? missingEvidenceRefs({
                evidenceRefs: content.evidenceRefs,
                inDossierIds: facts.evidence.inDossierIds,
                materialIds: facts.evidence.materialIds,
                invalidMaterialIds: facts.evidence.invalidMaterialIds,
              })
            : [],
        },
        signature: facts.signature,
        notice: {
          served: facts.notice.served,
          noticeId: facts.notice.notice?.id ?? null,
          window: facts.notice.window,
          waiverRecorded: facts.notice.waiverRecorded,
        },
        hints: facts.frozen.fineMissing ? [fineBaseHint()] : [],
        dossiers: {
          materialsRuleId: DOSSIER_MATERIALS_RULE_ID,
          materialsRuleVersion: DOSSIER_MATERIALS_VERSION,
        },
        approval: open
          ? {
              id: open.id,
              status: open.status,
              currentVersionNo: open.currentVersionNo,
              drafterId: open.drafterId,
              documentType,
            }
          : null,
        approved: approved
          ? { id: approved.id, documentType: this.parseStored(approved.contentJson)?.documentType ?? null }
          : null,
      },
    };
  }

  async draft(
    actor: ActorRef,
    caseId: string,
    input: { readonly content: unknown } & ConfirmationInput,
  ): Promise<CaseDecisionHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.decision-drafted', true);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.decision-drafted', DRAFT_OPCODE);
    if (terminal) return terminal;
    const stageHit = this.stageHit(prepared, 'case.decision-drafted', DRAFT_OPCODE);
    if (stageHit) return stageHit;
    const parsed = readDecisionContent(input.content);
    if (!parsed.ok) return this.failContent(prepared, 'case.decision-drafted', DRAFT_OPCODE, parsed.hit);
    const facts = await this.factsOf(prepared.view);
    if (facts.frozen.id === null) {
      return this.fail(prepared, 'case.decision-drafted', DRAFT_OPCODE, {
        httpStatus: 409,
        reason: 'no-frozen-decision',
        message: '缺少已冻结的拟决定摘要',
        outlet: '先完成审理意见签出并冻结拟决定',
      });
    }
    const open = await this.cases.readOpenDecisionApproval(caseId);
    if (open && open.status !== 'drafting') {
      return this.fail(prepared, 'case.decision-drafted', DRAFT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '决定呈批已提交，不能再拟制',
        outlet: '等待审核或批准',
      });
    }
    if (open && open.drafterId !== actor.personnelId) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    const documentType = this.documentTypeOf(facts, parsed.content);
    const stored: StoredDecisionContent = {
      ...parsed.content,
      kind: facts.frozen.kind,
      hasFine: facts.frozen.hasFine,
      documentType,
      frozenDecisionId: facts.frozen.id,
    };
    const approvalId = open?.id ?? newUlid();
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const saved = await tx.cases.saveDecisionDraft({
        approvalId,
        caseId,
        drafterId: actor.personnelId,
        isNew: open === null,
        expectedVersionNo: open?.currentVersionNo ?? 0,
        versionId: newUlid(),
        contentJson: JSON.stringify(stored),
        at,
      });
      if (!saved) {
        return rejected<CaseDecisionHttpOutcome>(
          this.blockBody('concurrent-change', '决定呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.decision-drafted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, DRAFT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.decision-drafted',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({ caseId, approvalId, documentType, kind: facts.frozen.kind }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'decision-drafted',
          approvalId,
          caseId,
          status: 'drafting',
          kind: facts.frozen.kind,
          documentType,
          documentName: DECISION_DOCUMENT_NAMES[documentType],
          signature: facts.signature,
          hints: facts.frozen.fineMissing ? [fineBaseHint()] : [],
        },
      };
    });
  }

  async submit(actor: ActorRef, approvalId: string): Promise<CaseDecisionHttpOutcome> {
    const loaded = await this.cases.readDecisionApproval(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, SUBMIT_OPCODE, 'case.decision-submitted', true);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.decision-submitted', SUBMIT_OPCODE);
    if (terminal) return terminal;
    const stageHit = this.stageHit(prepared, 'case.decision-submitted', SUBMIT_OPCODE);
    if (stageHit) return stageHit;
    if (loaded.drafterId !== actor.personnelId) {
      return this.fail(prepared, 'case.decision-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'not-drafter',
        message: '只有拟制人可以提交决定呈批',
        outlet: '由拟制人提交',
      });
    }
    if (!canTakeFilingStep('submit', loaded.status)) {
      return this.fail(prepared, 'case.decision-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '决定呈批不在拟制中',
        outlet: '先保存决定呈批稿',
      });
    }
    const content = this.parseStored(loaded.contentJson);
    if (!content) {
      return this.fail(prepared, 'case.decision-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-content',
        message: '决定呈批稿不合规',
        outlet: '重新保存决定呈批稿',
      });
    }
    const facts = await this.factsOf(prepared.view);
    if (content.frozenDecisionId === null || content.frozenDecisionId !== facts.frozen.id) {
      return this.fail(prepared, 'case.decision-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '拟决定已变化，须重新拟制决定',
        outlet: '重新读取并保存决定呈批稿',
      });
    }
    const compared = await this.comparison.assertComparisonComplete(loaded.caseId, actor);
    if (!this.passthrough(compared)) {
      return this.relay(prepared, 'case.decision-submitted', SUBMIT_OPCODE, compared);
    }
    const nextStatus = filingStatusAfter('submit', this.adminReview);
    const at = this.clock.now();
    const chainId = newUlid();
    return this.uow.run(async (tx) => {
      const opened = await tx.cases.openApprovalChain({
        id: chainId,
        caseId: loaded.caseId,
        kind: 'decision',
        openedBy: actor.personnelId,
        openedAt: at,
      });
      if (!opened) {
        return rejected<CaseDecisionHttpOutcome>(
          this.blockBody('X18', '本案已有进行中的审批链', '同一案件同时只有一条进行中的审批链', '先办结或撤回当前审批链'),
          {
            action: 'case.decision-submitted',
            outcome: 'failed',
            reason: 'X18',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      const stepped = await tx.cases.applyDecisionStep({
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
        return rejected<CaseDecisionHttpOutcome>(
          this.blockBody('concurrent-change', '决定呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.decision-submitted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.decision-submitted',
        ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
        detail: JSON.stringify({ caseId: loaded.caseId, approvalId, chainId }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'decision-submitted',
          approvalId,
          caseId: loaded.caseId,
          status: nextStatus,
          hints: facts.frozen.fineMissing ? [fineBaseHint()] : [],
        },
      };
    });
  }

  async review(
    actor: ActorRef,
    approvalId: string,
    input: { readonly opinion: string | null },
  ): Promise<CaseDecisionHttpOutcome> {
    const loaded = await this.cases.readDecisionApproval(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, REVIEW_OPCODE, 'case.decision-reviewed', false);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.decision-reviewed', REVIEW_OPCODE);
    if (terminal) return terminal;
    const stageHit = this.stageHit(prepared, 'case.decision-reviewed', REVIEW_OPCODE);
    if (stageHit) return stageHit;
    if (!canTakeFilingStep('review', loaded.status)) {
      return this.fail(prepared, 'case.decision-reviewed', REVIEW_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '决定呈批不在待审核',
        outlet: '先提交决定呈批',
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyDecisionStep({
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
        return rejected<CaseDecisionHttpOutcome>(
          this.blockBody('concurrent-change', '决定呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.decision-reviewed',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, REVIEW_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.decision-reviewed',
        ...this.parties(prepared, loaded.caseId, REVIEW_OPCODE),
        detail: JSON.stringify({ caseId: loaded.caseId, approvalId }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'decision-reviewed',
          approvalId,
          caseId: loaded.caseId,
          status: filingStatusAfter('review', this.adminReview),
        },
      };
    });
  }

  async approve(
    actor: ActorRef,
    approvalId: string,
    input: ConfirmationInput & { readonly opinion: string | null },
  ): Promise<CaseDecisionHttpOutcome> {
    const loaded = await this.cases.readDecisionApproval(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, APPROVE_OPCODE, 'case.decision-approved', false);
    if ('status' in prepared) return prepared;
    const terminal = await this.terminalHit(prepared, 'case.decision-approved', APPROVE_OPCODE);
    if (terminal) return terminal;
    const stageHit = this.stageHit(prepared, 'case.decision-approved', APPROVE_OPCODE);
    if (stageHit) return stageHit;
    if (!canTakeFilingStep('approve', loaded.status)) {
      return this.fail(prepared, 'case.decision-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '决定呈批不在待审批',
        outlet: '先完成审核',
      });
    }
    const content = this.parseStored(loaded.contentJson);
    if (!content) {
      return this.fail(prepared, 'case.decision-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-content',
        message: '决定呈批稿不合规',
        outlet: '重新保存决定呈批稿',
      });
    }
    const facts = await this.factsOf(prepared.view);
    if (content.frozenDecisionId === null || content.frozenDecisionId !== facts.frozen.id) {
      return this.fail(prepared, 'case.decision-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '拟决定已变化，须重新拟制决定',
        outlet: '重新读取并保存决定呈批稿',
      });
    }
    const at = this.clock.now();

    const hardAdvisories: GuardResult[] = [];
    const x05 = x05Guard({ kind: facts.frozen.kind, noticeServed: facts.notice.served });
    if (x05) hardAdvisories.push(x05);
    const x06 = x06Guard({
      kind: facts.frozen.kind,
      noticeServed: facts.notice.served,
      window: facts.notice.window,
      waiverRecorded: facts.notice.waiverRecorded,
    });
    if (x06) hardAdvisories.push(x06);
    const missing = missingEvidenceRefs({
      evidenceRefs: content.evidenceRefs,
      inDossierIds: facts.evidence.inDossierIds,
      materialIds: facts.evidence.materialIds,
      invalidMaterialIds: facts.evidence.invalidMaterialIds,
    });
    const x16 = x16Guard(missing);
    if (x16) hardAdvisories.push(x16);

    const other = Math.max(
      0,
      (await this.cases.countInFlightApprovals(loaded.caseId)) - (loaded.approvalChainId ? 1 : 0),
    );
    if (hardAdvisories.length > 0) {
      const blocked = decideTransition({
        operation: { kind: 'transition', transitionId: DECISION_TRANSITION },
        subject: await this.subjectOf(prepared.view, prepared.roles, other, true),
        advisories: hardAdvisories,
        confirmedRuleKeys: input.confirmedRuleKeys,
        confirmReasons: input.confirmReasons,
      });
      if (blocked.ok) {
        return this.fail(prepared, 'case.decision-approved', APPROVE_OPCODE, {
          httpStatus: 409,
          reason: 'invalid-state',
          message: '决定硬闸口未被引擎阻断',
          outlet: '按闸口提示处理',
        });
      }
      return this.settle(prepared, 'case.decision-approved', APPROVE_OPCODE, blocked);
    }

    const compared = await this.comparison.assertComparisonFresh(loaded.caseId, at, actor);
    if (!this.passthrough(compared)) {
      return this.relay(prepared, 'case.decision-approved', APPROVE_OPCODE, compared);
    }
    const comparisonBody = compared.body as Record<string, unknown>;
    const comparisonWarnings = warningGuards(comparisonBody.warnings);
    const comparisonHints = Array.isArray(comparisonBody.hints) ? comparisonBody.hints : [];

    const legalGate = await this.legalReview.assertDecisionGate(actor, loaded.caseId);
    if (!this.passthrough(legalGate)) {
      return this.relay(prepared, 'case.decision-approved', APPROVE_OPCODE, legalGate);
    }
    const validityGate = await this.validity.assertValidityGate(actor, loaded.caseId);
    if (!this.passthrough(validityGate)) {
      return this.relay(prepared, 'case.decision-approved', APPROVE_OPCODE, validityGate);
    }

    const decision = decideTransition({
      operation: { kind: 'transition', transitionId: DECISION_TRANSITION },
      subject: await this.subjectOf(prepared.view, prepared.roles, other, true),
      advisories: comparisonWarnings,
      confirmedRuleKeys: input.confirmedRuleKeys,
      confirmReasons: input.confirmReasons,
    });
    if (!decision.ok) {
      if (decision.httpStatus === 400) return { status: 400, body: ruleKeyBody(decision) };
      if (decision.httpStatus === 200) {
        return this.holdWarning(prepared, 'case.decision-approved', APPROVE_OPCODE, decision);
      }
      return this.fail(prepared, 'case.decision-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: decision.reason,
        message: decision.message,
        outlet: decision.outlet,
        basis: decision.citation,
      });
    }
    const effects = decision.effects;
    if (
      effects.kind !== 'advance'
      || effects.transitionCode !== DECISION_TRANSITION
      || !effects.currentStage
      || effects.stageEntrySeq === null
    ) {
      return this.fail(prepared, 'case.decision-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '决定呈批没有可执行的去向',
        outlet: '按当前环节重新提交',
      });
    }
    const caseId = loaded.caseId;
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyDecisionStep({
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
        return rejected<CaseDecisionHttpOutcome>(
          this.blockBody('concurrent-change', '决定呈批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.decision-approved',
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
        return rejected<CaseDecisionHttpOutcome>(
          this.blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.decision-approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, APPROVE_OPCODE),
          },
        );
      }
      if (loaded.approvalChainId) {
        const closed = await tx.cases.closeApprovalChain(loaded.approvalChainId);
        if (!closed) {
          return rejected<CaseDecisionHttpOutcome>(
            this.blockBody('concurrent-change', '审批链已被他人办结', null, '请重新读取后再试'),
            {
              action: 'case.decision-approved',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, caseId, APPROVE_OPCODE),
            },
          );
        }
      }
      const parties = this.parties(prepared, caseId, APPROVE_OPCODE);
      await tx.audit.append({
        action: 'case.decision-approved',
        ...parties,
        detail: JSON.stringify({
          caseId,
          approvalId,
          documentType: content.documentType,
          kind: facts.frozen.kind,
          evidenceRefs: content.evidenceRefs.length,
        }),
      });
      await tx.audit.append({
        action: 'case.transitioned',
        ...parties,
        detail: JSON.stringify({ caseId, transitionId: DECISION_TRANSITION, approvalId }),
      });
      if (decision.confirmation) {
        await appendRuleConfirmation(tx.audit, {
          parties,
          confirmation: decision.confirmation,
          at,
          step: 'decision-approve:T23',
          confirmReasons: input.confirmReasons,
        });
      }
      return {
        status: 200 as const,
        body: {
          result: 'decision-approved',
          approvalId,
          caseId,
          transitionId: DECISION_TRANSITION,
          currentStage: effects.currentStage,
          stageEntrySeq: effects.stageEntrySeq,
          kind: facts.frozen.kind,
          documentType: content.documentType,
          documentName: DECISION_DOCUMENT_NAMES[content.documentType],
          signature: facts.signature,
          hints: [...(facts.frozen.fineMissing ? [fineBaseHint()] : []), ...comparisonHints],
        },
      };
    });
  }

  private async factsOf(view: CaseView): Promise<DecisionFacts> {
    const [frozenRows, notices, submissions, deadlines, markers, materials, invalidated, effectivity, org] =
      await Promise.all([
        this.cases.listFrozenDecisions(view.id),
        this.cases.listNotices(view.id),
        this.cases.listPartySubmissions(view.id),
        this.cases.listDeadlineRows(view.id),
        readActiveCaseMarkers(this.cases, view.id),
        this.cases.listDossierMaterials(view.id),
        this.cases.listInvalidatedInstanceIds(view.id),
        this.cases.listMaterialEffectiveness(view.id),
        this.identity.findOrgUnitById(view.handlingOrgId),
      ]);
    const latestFrozen = frozenRows.at(-1) ?? null;
    const violations = readFrozenViolations(latestFrozen ? parseJson(latestFrozen.summaryJson) : null);
    const hasFrozen = latestFrozen !== null;
    const kind = hasFrozen ? deriveDecisionKind(violations) : 'no-penalty';
    const notice = latestServedNotice(notices);
    const noticeServed = notice !== null || markers.includes('notice-served');
    const window = notice ? windowOf(notice, deadlines, this.clock.now()) : null;
    const waiverRecorded = notice
      ? submissions.some((row) => row.noticeId === notice.id && row.kind === 'notice-waiver')
      : false;
    const invalidatedKeys = new Set(invalidated);
    const inDossierIds = materials
      .filter(
        (row) =>
          row.itemCode === 5
          && (row.stage === null
            || row.entrySeq === null
            || !invalidatedKeys.has(dossierInstanceKey(row.stage, row.entrySeq))),
      )
      .map((row) => row.id);
    const invalidIds = invalidMaterialIds(
      effectivity.map((row) => ({
        id: row.id,
        materialId: row.materialId,
        conclusion: row.conclusion,
        reason: row.reason,
        determinedBy: row.determinedBy,
        determinedAt: row.determinedAt,
      })),
    );
    return {
      frozen: {
        id: latestFrozen?.id ?? null,
        violations,
        kind,
        hasFine: hasFrozen && hasFine(violations),
        fineMissing: hasFrozen && fineBaseMissing(violations),
      },
      notice: { served: noticeServed, notice, window, waiverRecorded },
      evidence: {
        inDossierIds,
        materialIds: view.materials.map((row) => row.id),
        invalidMaterialIds: invalidIds,
      },
      signature: deriveDecisionSignature({
        level: org?.level ?? 'station',
        handlingOrgName: org?.name ?? '',
      }),
    };
  }

  private documentTypeOf(facts: DecisionFacts, content: DecisionContent | null): DecisionDocumentType {
    return decisionDocumentTypeOf({
      kind: facts.frozen.kind,
      correctionOrdered: content?.correctionOrdered ?? false,
      hasFine: facts.frozen.hasFine,
    });
  }

  private parseStored(contentJson: string | null): StoredDecisionContent | null {
    if (contentJson === null) return null;
    const parsed = parseJson(contentJson);
    const content = readDecisionContent(parsed);
    if (!content.ok) return null;
    const body = parsed as Record<string, unknown>;
    const kind = body.kind === 'penalty' || body.kind === 'no-penalty' ? body.kind : 'no-penalty';
    const documentType =
      body.documentType === 'penalty-decision'
      || body.documentType === 'no-penalty-decision'
      || body.documentType === 'order-correction-notice'
        ? body.documentType
        : decisionDocumentTypeOf({
            kind,
            correctionOrdered: content.content.correctionOrdered,
            hasFine: body.hasFine === true,
          });
    return {
      ...content.content,
      kind: kind as DecisionKind,
      hasFine: body.hasFine === true,
      documentType,
      frozenDecisionId: typeof body.frozenDecisionId === 'string' ? body.frozenDecisionId : null,
    };
  }

  private async subjectOf(
    view: CaseView,
    roles: readonly string[],
    otherInFlightChains: number,
    leadership: boolean,
  ): Promise<TransitionSubject> {
    const markers = await readActiveCaseMarkers(this.cases, view.id);
    return {
      caseId: view.id,
      mainStatus: view.status,
      stage: view.currentStage,
      stageEntrySeq: view.stageEntrySeq,
      suspended: view.suspended,
      // 领导审批是决定呈批的最后一步；该事实只作引擎起点判定，不写标记行。
      markers: [...markers, ...(leadership ? ['leadership'] : [])],
      clueStatus: null,
      handlingOrgId: view.handlingOrgId,
      proposedHandlingOrgId: null,
      actorRoles: [...roles],
      otherInFlightChains,
      instances: view.instances.map((row) => ({ stage: row.stage, entrySeq: row.entrySeq, status: row.status })),
    };
  }

  private stageHit(
    prepared: Prepared,
    action: CaseDecisionAction,
    opcode: string,
  ): Promise<CaseDecisionHttpOutcome> | null {
    if (prepared.view.status === 'in_progress' && prepared.view.currentStage === 'E09') return null;
    return this.fail(prepared, action, opcode, {
      httpStatus: 409,
      reason: 'invalid-state',
      message: '当前不在决定环节',
      outlet: '审理通过并进入决定后再拟制',
    });
  }

  private async prepare(
    actor: ActorRef,
    caseId: string,
    opcode: string,
    action: CaseDecisionAction,
    mustBeHandler: boolean,
  ): Promise<Prepared | CaseDecisionHttpOutcome> {
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

  private passthrough(outcome: { readonly status: number }): boolean {
    return outcome.status === 200;
  }

  private relay(
    prepared: Prepared,
    action: CaseDecisionAction,
    opcode: string,
    outcome: { readonly status: number; readonly body: unknown },
  ): Promise<CaseDecisionHttpOutcome> | CaseDecisionHttpOutcome {
    const body = (typeof outcome.body === 'object' && outcome.body !== null)
      ? (outcome.body as Record<string, unknown>)
      : {};
    if (outcome.status === 403) return { status: 403, body: { reason: typeof body.reason === 'string' ? body.reason : 'permission-denied' } };
    if (outcome.status === 404) return { status: 404, body: { result: 'not-found' } };
    const reason = typeof body.reason === 'string' ? body.reason : 'invalid-state';
    return this.fail(prepared, action, opcode, {
      httpStatus: outcome.status === 400 ? 400 : 409,
      reason,
      message: typeof body.message === 'string' ? body.message : '决定批准被拒',
      outlet: typeof body.outlet === 'string' ? body.outlet : '按闸口提示处理',
      basis: typeof body.basis === 'string' ? body.basis : null,
    });
  }

  private async terminalHit(
    prepared: Prepared,
    action: CaseDecisionAction,
    opcode: string,
  ): Promise<CaseDecisionHttpOutcome | null> {
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
    action: CaseDecisionAction,
    opcode: string,
    decision: Exclude<TransitionDecision, { ok: true }>,
  ): Promise<CaseDecisionHttpOutcome> {
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
    action: CaseDecisionAction,
    opcode: string,
    decision: Extract<TransitionDecision, { httpStatus: 200 }>,
  ): Promise<CaseDecisionHttpOutcome> {
    const reason = (FAIL_REASONS.has(decision.reason) ? decision.reason : 'invalid-state') as CaseDecisionFailedReason;
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
    action: CaseDecisionAction,
    opcode: string,
    hit: { readonly httpStatus: 400; readonly reason: string; readonly message: string; readonly outlet: string },
  ): Promise<CaseDecisionHttpOutcome> {
    return this.fail(prepared, action, opcode, {
      httpStatus: hit.httpStatus,
      reason: hit.reason,
      message: hit.message,
      outlet: hit.outlet,
    });
  }

  private fail(
    prepared: Prepared,
    action: CaseDecisionAction,
    opcode: string,
    fail: {
      readonly httpStatus: 400 | 409;
      readonly reason: string;
      readonly message: string;
      readonly outlet: string;
      readonly basis?: string | null;
    },
  ): Promise<CaseDecisionHttpOutcome> {
    const reason = (FAIL_REASONS.has(fail.reason) ? fail.reason : 'invalid-state') as CaseDecisionFailedReason;
    const outcome: CaseDecisionHttpOutcome =
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

  private blockBody(reason: string, message: string, citation: string | null, outlet: string): CaseDecisionHttpOutcome {
    return { status: 409, body: { result: reason, reason, message, basis: citation, outlet } };
  }
}

/** 比对服务的 Q31 警告转成引擎可读的警告项；层级按 normative 处理，不升阻断。 */
function warningGuards(raw: unknown): GuardResult[] {
  if (!Array.isArray(raw)) return [];
  const rows: GuardResult[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const body = item as Record<string, unknown>;
    if (typeof body.code !== 'string' || typeof body.message !== 'string') continue;
    rows.push({
      level: 'warn',
      code: body.code,
      message: body.message,
      authority: 'normative',
      ...(typeof body.citation === 'string' ? { citation: body.citation } : {}),
    });
  }
  return rows;
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function latestServedNotice(notices: readonly NoticeRow[]): NoticeRow | null {
  return [...notices].reverse().find((row) => row.status === 'served') ?? null;
}

function windowOf(
  notice: NoticeRow,
  deadlines: readonly { readonly ruleKey: string; readonly entrySeq: number; readonly dueOn: string | null; readonly needsManualConfirmation: boolean }[],
  now: Date,
): DecisionNoticeWindow | null {
  const content = readNoticeContent(parseJson(notice.contentJson));
  if (!content.ok) return null;
  const ruleKey = content.content.hearingNoticeAttached ? 'hearing.apply' : 'notice.statement';
  const row = deadlines.find((item) => item.ruleKey === ruleKey && item.entrySeq === notice.entrySeq);
  if (!row) return null;
  return hearingWindowState({
    dueOn: row.dueOn,
    needsManualConfirmation: row.needsManualConfirmation,
    today: beijingDateOf(now),
  });
}
