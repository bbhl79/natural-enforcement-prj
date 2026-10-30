// 定型（E13／T27）的读写（#243）。判定在 case 包的纯规则里，这里只喂事实、落库、写留痕。
// 归档审批沿用 doc.draft / doc.submit / doc.admin.review / doc.approve，不新增操作码。
// 完整性检查：必需材料按事件推导（Q25）；缺件或移送回证缺失时须写明理由，经批准后结论记「经批准缺项」。
// 送达事项接受回证或公告替代（Q27）。定型后业务写由引擎与各服务按 X12 拒绝。
// T27 只在本服务的批准事务里落库；通用迁移入口拒绝直接套用。

import { Inject, Injectable } from '@nestjs/common';
import {
  rejected,
  CASE_FINALIZE_FAILED_REASONS,
  type CaseFinalizeAction,
  type CaseFinalizeFailedReason,
} from '@natural-enforcement/audit';
import {
  CASE_STORE,
  CASE_SUPERVISION_ROLE,
  DOSSIER_CONCLUSION_NAMES,
  DOSSIER_DELIVERY_ITEM,
  DOSSIER_EXEMPTIONS,
  DOSSIER_EXEMPTIONS_RULE_ID,
  DOSSIER_EXEMPTIONS_VERSION,
  DOSSIER_MATERIALS_BASIS,
  DOSSIER_MATERIALS_RULE_ID,
  DOSSIER_MATERIALS_VERSION,
  FINALIZE_CONTENT_RULE_ID,
  FINALIZE_CONTENT_VERSION,
  FINALIZE_INVALID_CONTENT_MESSAGE,
  FINALIZE_INVALID_CONTENT_OUTLET,
  classifyIllegal,
  canTakeFilingStep,
  decideTransition,
  dossierEventsOf,
  dossierInstanceKey,
  dossierMaterialName,
  evaluateDossierCompleteness,
  filingStatusAfter,
  finalizeBlockOf,
  isDossierMaterialCode,
  readActiveCaseMarkers,
  readDeliveryEvidence,
  readFinalizeContent,
  receiptsCompleteOf,
  requiredDossierItems,
  type CaseStore,
  type CaseView,
  type DossierCompleteness,
  type DossierMaterialFact,
  type FilingAdminReview,
  type FinalizeContent,
  type FinalizeRecordRow,
  type TransferRow,
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
import { ruleKeyBody, warningBody } from './case-rule-confirmation.ts';
import { persistTransitionEffects } from './case-transition-write.ts';
import { CLOCK, type Clock } from './clock.ts';
import { LOGIN_DIRECTORY, type LoginDirectory } from './login-directory.ts';
import { UNIT_OF_WORK, type UnitOfWork } from './unit-of-work.ts';

const READ_OPCODE = 'case.read';
const DRAFT_OPCODE = 'doc.draft';
const SUBMIT_OPCODE = 'doc.submit';
const REVIEW_OPCODE = 'doc.admin.review';
const APPROVE_OPCODE = 'doc.approve';

const FINALIZE_TRANSITION = 'T27';

const FAIL_REASONS = new Set<string>(CASE_FINALIZE_FAILED_REASONS);

export type CaseFinalizeHttpOutcome =
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

interface Evaluation {
  readonly requirement: ReturnType<typeof requiredDossierItems>;
  readonly materials: readonly DossierMaterialFact[];
  readonly transfers: readonly TransferRow[];
  readonly receiptsComplete: boolean;
  readonly completeness: DossierCompleteness;
}

export interface DossierMaterialInput {
  readonly itemCode: unknown;
  readonly title?: unknown;
  readonly note?: unknown;
  /** 仅送达项（20）使用：{kind:'receipt'} 或 {kind:'announcement', reasonRecord, announcementMaterials}。 */
  readonly delivery?: unknown;
}

@Injectable()
export class CaseFinalizeService {
  constructor(
    @Inject(LOGIN_DIRECTORY) private readonly directory: LoginDirectory,
    @Inject(CASE_STORE) private readonly cases: CaseStore,
    @Inject(IDENTITY_STORE) private readonly identity: IdentityStore,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILING_ADMIN_REVIEW) private readonly adminReview: FilingAdminReview,
    private readonly access: AccessControlService,
  ) {}

  async read(actor: ActorRef, caseId: string): Promise<CaseFinalizeHttpOutcome> {
    const view = await this.cases.readCaseView(caseId);
    if (!view) return { status: 404, body: { result: 'not-found' } };
    const denied = await this.authorize(actor, READ_OPCODE, view.handlingOrgId, caseId);
    if (denied) return { status: 403, body: { reason: denied } };
    const [open, finalizes] = await Promise.all([
      this.cases.readOpenFinalizeApproval(caseId),
      this.cases.listFinalizes(caseId),
    ]);
    const content = open ? this.parseStored(open.contentJson) : null;
    const last: FinalizeRecordRow | null = finalizes.length > 0 ? (finalizes[finalizes.length - 1] as FinalizeRecordRow) : null;
    const evaluated = await this.evaluate(view, content?.missingReason ?? last?.missingReason ?? null);
    return {
      status: 200,
      body: {
        caseId,
        status: view.status,
        currentStage: view.currentStage,
        materialsRule: {
          ruleId: DOSSIER_MATERIALS_RULE_ID,
          version: DOSSIER_MATERIALS_VERSION,
          basis: DOSSIER_MATERIALS_BASIS,
        },
        contentRule: { ruleId: FINALIZE_CONTENT_RULE_ID, version: FINALIZE_CONTENT_VERSION },
        exemptions: {
          ruleId: DOSSIER_EXEMPTIONS_RULE_ID,
          version: DOSSIER_EXEMPTIONS_VERSION,
          items: DOSSIER_EXEMPTIONS.map((entry) => ({
            itemCode: entry.itemCode,
            itemName: dossierMaterialName(entry.itemCode),
            basis: entry.basis,
            effective: entry.basis.trim() !== '',
          })),
        },
        requirement: {
          requiredItems: [...evaluated.requirement.requiredItems],
          exemptItems: [...evaluated.requirement.exemptItems],
          deliveryRequired: evaluated.requirement.deliveryRequired,
        },
        checklist: evaluated.completeness.checklist,
        missingItems: [...evaluated.completeness.missingItems],
        receipt: {
          complete: evaluated.receiptsComplete,
          transfers: evaluated.transfers.map((row) => ({
            id: row.id,
            kind: row.kind,
            documentNo: row.documentNo,
          })),
        },
        readiness: {
          reasonRequired: evaluated.completeness.reasonRequired,
          blocked: evaluated.completeness.blocked,
          conclusion: evaluated.completeness.conclusion,
          conclusionName: evaluated.completeness.conclusion
            ? DOSSIER_CONCLUSION_NAMES[evaluated.completeness.conclusion]
            : null,
        },
        approval: open
          ? {
              id: open.id,
              status: open.status,
              currentVersionNo: open.currentVersionNo,
              drafterId: open.drafterId,
              missingReason: content?.missingReason ?? null,
              note: content?.note ?? null,
            }
          : null,
        finalize: last ? this.presentFinalize(last) : null,
      },
    };
  }

  /** 材料入卷登记。定型后是 X12；已结案、已撤案的卷宗在定型前仍可整理入卷。 */
  async addMaterial(
    actor: ActorRef,
    caseId: string,
    input: DossierMaterialInput,
  ): Promise<CaseFinalizeHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.dossier-material-recorded', true);
    if ('status' in prepared) return prepared;
    if (prepared.view.status === 'finalized') {
      const deny = classifyIllegal('X12', '案件已定型，卷宗不能改动');
      if (!deny.ok) return this.settle(prepared, 'case.dossier-material-recorded', DRAFT_OPCODE, deny);
    }
    const itemCode = typeof input.itemCode === 'number' ? input.itemCode : Number(input.itemCode);
    if (!Number.isInteger(itemCode) || !isDossierMaterialCode(itemCode)) {
      return this.fail(prepared, 'case.dossier-material-recorded', DRAFT_OPCODE, {
        httpStatus: 400,
        reason: 'invalid-item',
        message: '材料项号须在 1 到 21 之间',
        outlet: '按规程 13.1 的材料项号选择',
      });
    }
    let evidenceJson: string | null = null;
    if (itemCode === DOSSIER_DELIVERY_ITEM) {
      const evidence = readDeliveryEvidence(input.delivery);
      if (!evidence) {
        return this.fail(prepared, 'case.dossier-material-recorded', DRAFT_OPCODE, {
          httpStatus: 400,
          reason: 'invalid-delivery-evidence',
          message: '送达事项须上传送达回证，或记录公告原因经过并附公告材料',
          outlet: '按送达回证或公告送达替代材料登记',
        });
      }
      evidenceJson = JSON.stringify(evidence);
    }
    const title = text(input.title) === '' ? (dossierMaterialName(itemCode) ?? '') : text(input.title);
    const id = newUlid();
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      await tx.cases.insertDossierMaterial({
        id,
        caseId,
        itemCode,
        title,
        note: optionalText(input.note),
        stage: prepared.view.currentStage,
        entrySeq: prepared.view.stageEntrySeq,
        evidenceJson,
        recordedBy: actor.personnelId,
        recordedAt: at,
      });
      await tx.audit.append({
        action: 'case.dossier-material-recorded',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({ caseId, itemCode, deliveryKind: evidenceJson ? (JSON.parse(evidenceJson) as { kind: string }).kind : null }),
      });
      return {
        status: 200 as const,
        body: { result: 'dossier-material-recorded', id, caseId, itemCode, current: true },
      };
    });
  }

  /** 保存归档审批稿。一案同时只有一张未批准的归档审批。 */
  async draft(
    actor: ActorRef,
    caseId: string,
    input: { readonly content: unknown } & ConfirmationInput,
  ): Promise<CaseFinalizeHttpOutcome> {
    const prepared = await this.prepare(actor, caseId, DRAFT_OPCODE, 'case.finalize-drafted', true);
    if ('status' in prepared) return prepared;
    const notFinalizable = this.notFinalizable(prepared, 'case.finalize-drafted', DRAFT_OPCODE);
    if (notFinalizable) return notFinalizable;
    const parsed = readFinalizeContent(input.content);
    if (!parsed.ok) {
      return this.fail(prepared, 'case.finalize-drafted', DRAFT_OPCODE, {
        httpStatus: 400,
        reason: parsed.hit.reason,
        message: parsed.hit.message,
        outlet: parsed.hit.outlet,
      });
    }
    const open = await this.cases.readOpenFinalizeApproval(caseId);
    if (open && open.status !== 'drafting') {
      return this.fail(prepared, 'case.finalize-drafted', DRAFT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '归档审批已提交，不能再拟制',
        outlet: '等待审核或批准',
      });
    }
    if (open && open.drafterId !== actor.personnelId) {
      return { status: 403, body: { reason: 'permission-denied' } };
    }
    const decision = await this.decide(prepared, await this.cases.countInFlightApprovals(caseId), input);
    if (!decision.ok) return this.settle(prepared, 'case.finalize-drafted', DRAFT_OPCODE, decision);
    const approvalId = open?.id ?? newUlid();
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const saved = await tx.cases.saveFinalizeDraft({
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
        return rejected<CaseFinalizeHttpOutcome>(
          this.blockBody('concurrent-change', '归档审批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.finalize-drafted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, DRAFT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.finalize-drafted',
        ...this.parties(prepared, caseId, DRAFT_OPCODE),
        detail: JSON.stringify({ caseId, approvalId }),
      });
      return {
        status: 200 as const,
        body: { result: 'finalize-drafted', approvalId, caseId, status: 'drafting' },
      };
    });
  }

  async submit(
    actor: ActorRef,
    approvalId: string,
    input: ConfirmationInput = {},
  ): Promise<CaseFinalizeHttpOutcome> {
    const loaded = await this.cases.readFinalizeApproval(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, SUBMIT_OPCODE, 'case.finalize-submitted', false);
    if ('status' in prepared) return prepared;
    const notFinalizable = this.notFinalizable(prepared, 'case.finalize-submitted', SUBMIT_OPCODE);
    if (notFinalizable) return notFinalizable;
    if (loaded.drafterId !== actor.personnelId) return { status: 403, body: { reason: 'permission-denied' } };
    if (!canTakeFilingStep('submit', loaded.status)) {
      return this.fail(prepared, 'case.finalize-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '归档审批不在拟制中',
        outlet: '先保存归档审批稿',
      });
    }
    const content = this.parseStored(loaded.contentJson);
    if (!content) {
      return this.fail(prepared, 'case.finalize-submitted', SUBMIT_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-content',
        message: FINALIZE_INVALID_CONTENT_MESSAGE,
        outlet: FINALIZE_INVALID_CONTENT_OUTLET,
      });
    }
    const evaluated = await this.evaluate(prepared.view, content.missingReason);
    const block = finalizeBlockOf(evaluated.completeness);
    if (block) return this.blockFinalize(prepared, 'case.finalize-submitted', SUBMIT_OPCODE, block);
    const decision = await this.decide(prepared, await this.cases.countInFlightApprovals(loaded.caseId), input);
    if (!decision.ok) return this.settle(prepared, 'case.finalize-submitted', SUBMIT_OPCODE, decision);
    const nextStatus = filingStatusAfter('submit', this.adminReview);
    const at = this.clock.now();
    const chainId = newUlid();
    return this.uow.run(async (tx) => {
      const opened = await tx.cases.openApprovalChain({
        id: chainId,
        caseId: loaded.caseId,
        kind: 'finalize',
        openedBy: actor.personnelId,
        openedAt: at,
      });
      if (!opened) {
        return rejected<CaseFinalizeHttpOutcome>(
          this.blockBody('X18', '本案已有进行中的审批链', '同一案件同时只有一条进行中的审批链', '先办结或撤回当前审批链'),
          {
            action: 'case.finalize-submitted',
            outcome: 'failed',
            reason: 'X18',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      const stepped = await tx.cases.applyFinalizeStep({
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
        return rejected<CaseFinalizeHttpOutcome>(
          this.blockBody('concurrent-change', '归档审批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.finalize-submitted',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.finalize-submitted',
        ...this.parties(prepared, loaded.caseId, SUBMIT_OPCODE),
        detail: JSON.stringify({ caseId: loaded.caseId, approvalId, chainId }),
      });
      return {
        status: 200 as const,
        body: { result: 'finalize-submitted', approvalId, caseId: loaded.caseId, status: nextStatus },
      };
    });
  }

  async review(
    actor: ActorRef,
    approvalId: string,
    input: { readonly opinion: string | null },
  ): Promise<CaseFinalizeHttpOutcome> {
    const loaded = await this.cases.readFinalizeApproval(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, REVIEW_OPCODE, 'case.finalize-reviewed', false);
    if ('status' in prepared) return prepared;
    if (!canTakeFilingStep('review', loaded.status)) {
      return this.fail(prepared, 'case.finalize-reviewed', REVIEW_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '归档审批不在待审核',
        outlet: '先提交归档审批',
      });
    }
    const at = this.clock.now();
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyFinalizeStep({
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
        return rejected<CaseFinalizeHttpOutcome>(
          this.blockBody('concurrent-change', '归档审批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.finalize-reviewed',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, loaded.caseId, REVIEW_OPCODE),
          },
        );
      }
      await tx.audit.append({
        action: 'case.finalize-reviewed',
        ...this.parties(prepared, loaded.caseId, REVIEW_OPCODE),
        detail: JSON.stringify({ caseId: loaded.caseId, approvalId }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'finalize-reviewed',
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
  ): Promise<CaseFinalizeHttpOutcome> {
    const loaded = await this.cases.readFinalizeApproval(approvalId);
    if (!loaded) return { status: 404, body: { result: 'not-found' } };
    const prepared = await this.prepare(actor, loaded.caseId, APPROVE_OPCODE, 'case.finalize-approved', false);
    if ('status' in prepared) return prepared;
    const notFinalizable = this.notFinalizable(prepared, 'case.finalize-approved', APPROVE_OPCODE);
    if (notFinalizable) return notFinalizable;
    if (!canTakeFilingStep('approve', loaded.status)) {
      return this.fail(prepared, 'case.finalize-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '归档审批不在待审批',
        outlet: '先完成审核',
      });
    }
    const content = this.parseStored(loaded.contentJson);
    if (!content) {
      return this.fail(prepared, 'case.finalize-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-content',
        message: FINALIZE_INVALID_CONTENT_MESSAGE,
        outlet: FINALIZE_INVALID_CONTENT_OUTLET,
      });
    }
    const evaluated = await this.evaluate(prepared.view, content.missingReason);
    const block = finalizeBlockOf(evaluated.completeness);
    if (block) return this.blockFinalize(prepared, 'case.finalize-approved', APPROVE_OPCODE, block);
    const other = Math.max(
      0,
      (await this.cases.countInFlightApprovals(loaded.caseId)) - (loaded.approvalChainId ? 1 : 0),
    );
    const decision = await this.decide(prepared, other, input);
    if (!decision.ok) return this.settle(prepared, 'case.finalize-approved', APPROVE_OPCODE, decision);
    const effects = decision.effects;
    if (
      effects.kind !== 'advance'
      || effects.transitionCode !== FINALIZE_TRANSITION
      || effects.mainStatus !== 'finalized'
      || !effects.currentStage
      || effects.stageEntrySeq === null
    ) {
      return this.fail(prepared, 'case.finalize-approved', APPROVE_OPCODE, {
        httpStatus: 409,
        reason: 'invalid-state',
        message: '归档审批没有可执行的去向',
        outlet: '按已结案或已撤案案件发起归档审批',
      });
    }
    const at = this.clock.now();
    const caseId = loaded.caseId;
    return this.uow.run(async (tx) => {
      const stepped = await tx.cases.applyFinalizeStep({
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
        return rejected<CaseFinalizeHttpOutcome>(
          this.blockBody('concurrent-change', '归档审批已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.finalize-approved',
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
      if (!wrote) {
        return rejected<CaseFinalizeHttpOutcome>(
          this.blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.finalize-approved',
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
        status: 'finalized',
        suspended: false,
      });
      if (!moved) {
        return rejected<CaseFinalizeHttpOutcome>(
          this.blockBody('concurrent-change', '案件已被他人更新', null, '请重新读取后再试'),
          {
            action: 'case.finalize-approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, APPROVE_OPCODE),
          },
        );
      }
      const existing = await tx.cases.listFinalizes(caseId);
      const generationNo = (existing.length > 0 ? (existing[existing.length - 1] as FinalizeRecordRow).generationNo : 0) + 1;
      const inserted = await tx.cases.insertFinalize({
        id: newUlid(),
        caseId,
        approvalId,
        generationNo,
        conclusion: evaluated.completeness.conclusion ?? 'complete',
        checklistJson: JSON.stringify(evaluated.completeness.checklist),
        missingReason: content.missingReason,
        receiptDeficient: evaluated.completeness.receiptDeficient,
        materialsRuleId: DOSSIER_MATERIALS_RULE_ID,
        materialsRuleVersion: DOSSIER_MATERIALS_VERSION,
        exemptionsRuleId: DOSSIER_EXEMPTIONS_RULE_ID,
        exemptionsRuleVersion: DOSSIER_EXEMPTIONS_VERSION,
        finalizedBy: actor.personnelId,
        finalizedAt: at,
      });
      if (!inserted) {
        return rejected<CaseFinalizeHttpOutcome>(
          this.blockBody('concurrent-change', '定型记录已存在', null, '请重新读取后再试'),
          {
            action: 'case.finalize-approved',
            outcome: 'failed',
            reason: 'concurrent-change',
            ...this.parties(prepared, caseId, APPROVE_OPCODE),
          },
        );
      }
      if (loaded.approvalChainId) {
        const closed = await tx.cases.closeApprovalChain(loaded.approvalChainId);
        if (!closed) {
          return rejected<CaseFinalizeHttpOutcome>(
            this.blockBody('concurrent-change', '审批链已被他人办结', null, '请重新读取后再试'),
            {
              action: 'case.finalize-approved',
              outcome: 'failed',
              reason: 'concurrent-change',
              ...this.parties(prepared, caseId, APPROVE_OPCODE),
            },
          );
        }
      }
      await tx.audit.append({
        action: 'case.finalize-approved',
        ...this.parties(prepared, caseId, APPROVE_OPCODE),
        detail: JSON.stringify({
          caseId,
          approvalId,
          generationNo,
          conclusion: evaluated.completeness.conclusion,
          missingItems: evaluated.completeness.missingItems,
          receiptDeficient: evaluated.completeness.receiptDeficient,
        }),
      });
      await tx.audit.append({
        action: 'case.transitioned',
        ...this.parties(prepared, caseId, APPROVE_OPCODE),
        detail: JSON.stringify({ caseId, transitionId: FINALIZE_TRANSITION, approvalId }),
      });
      return {
        status: 200 as const,
        body: {
          result: 'finalize-approved',
          approvalId,
          caseId,
          status: 'finalized',
          generationNo,
          conclusion: evaluated.completeness.conclusion,
          conclusionName: evaluated.completeness.conclusion
            ? DOSSIER_CONCLUSION_NAMES[evaluated.completeness.conclusion]
            : null,
          missingItems: evaluated.completeness.missingItems,
          receiptDeficient: evaluated.completeness.receiptDeficient,
        },
      };
    });
  }

  /**
   * T27 的起点是已结案或已撤案。引擎对「待收尾」先给 X03 警告（#258 两段式），
   * 不落到 invalid-state；定型按验收要求在这里硬拦，起点不符一律 409。
   */
  private notFinalizable(
    prepared: Prepared,
    action: CaseFinalizeAction,
    opcode: string,
  ): Promise<CaseFinalizeHttpOutcome> | null {
    if (prepared.view.status === 'closed' || prepared.view.status === 'withdrawn') return null;
    return this.fail(prepared, action, opcode, {
      httpStatus: 409,
      reason: 'invalid-state',
      message: '只有已结案或已撤案的案件可以定型',
      outlet: '先完成结案或撤案',
    });
  }

  private async evaluate(view: CaseView, missingReason: string | null): Promise<Evaluation> {
    const [materialRows, invalidated, transfers, files] = await Promise.all([
      this.cases.listDossierMaterials(view.id),
      this.cases.listInvalidatedInstanceIds(view.id),
      this.cases.listTransfers(view.id),
      this.cases.listTransferFiles(view.id),
    ]);
    const invalidatedKeys = new Set(invalidated);
    const materials: DossierMaterialFact[] = materialRows.map((row) => ({
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
    const receiptsComplete = receiptsCompleteOf(transfers, receipts);
    const completeness = evaluateDossierCompleteness({
      requirement,
      materials,
      receiptsComplete,
      missingReason,
    });
    return { requirement, materials, transfers, receiptsComplete, completeness };
  }

  private async decide(
    prepared: Prepared,
    otherInFlightChains: number,
    input: ConfirmationInput,
  ): Promise<TransitionDecision> {
    return decideTransition({
      operation: { kind: 'transition', transitionId: FINALIZE_TRANSITION },
      subject: await this.subjectOf(prepared.view, prepared.roles, otherInFlightChains),
      confirmedRuleKeys: input.confirmedRuleKeys,
      confirmReasons: input.confirmReasons,
    });
  }

  private async prepare(
    actor: ActorRef,
    caseId: string,
    opcode: string,
    action: CaseFinalizeAction,
    mustBeHandler: boolean,
  ): Promise<Prepared | CaseFinalizeHttpOutcome> {
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

  private parseStored(contentJson: string | null): FinalizeContent | null {
    if (contentJson === null) return null;
    try {
      const parsed = readFinalizeContent(JSON.parse(contentJson) as unknown);
      return parsed.ok ? parsed.content : null;
    } catch {
      return null;
    }
  }

  private presentFinalize(row: FinalizeRecordRow): Record<string, unknown> {
    let checklist: unknown = [];
    try {
      checklist = JSON.parse(row.checklistJson) as unknown;
    } catch {
      checklist = [];
    }
    return {
      id: row.id,
      generationNo: row.generationNo,
      conclusion: row.conclusion,
      conclusionName: conclusionNameOf(row.conclusion),
      missingReason: row.missingReason,
      receiptDeficient: row.receiptDeficient,
      checklist,
      materialsRule: { ruleId: row.materialsRuleId, version: row.materialsRuleVersion },
      exemptionsRule: { ruleId: row.exemptionsRuleId, version: row.exemptionsRuleVersion },
      finalizedAt: row.finalizedAt.toISOString(),
    };
  }

  private blockFinalize(
    prepared: Prepared,
    action: CaseFinalizeAction,
    opcode: string,
    block: { readonly reason: string; readonly message: string; readonly outlet: string },
  ): Promise<CaseFinalizeHttpOutcome> {
    return this.fail(prepared, action, opcode, {
      httpStatus: 409,
      reason: block.reason,
      message: block.message,
      outlet: block.outlet,
    });
  }

  private settle(
    prepared: Prepared,
    action: CaseFinalizeAction,
    opcode: string,
    decision: Exclude<TransitionDecision, { ok: true }>,
  ): Promise<CaseFinalizeHttpOutcome> {
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
    action: CaseFinalizeAction,
    opcode: string,
    decision: Extract<TransitionDecision, { httpStatus: 200 }>,
  ): Promise<CaseFinalizeHttpOutcome> {
    const reason = (FAIL_REASONS.has(decision.reason) ? decision.reason : 'invalid-state') as CaseFinalizeFailedReason;
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
    action: CaseFinalizeAction,
    opcode: string,
    fail: {
      readonly httpStatus: 400 | 409;
      readonly reason: string;
      readonly message: string;
      readonly outlet: string;
      readonly basis?: string | null;
    },
  ): Promise<CaseFinalizeHttpOutcome> {
    const reason = (FAIL_REASONS.has(fail.reason) ? fail.reason : 'invalid-state') as CaseFinalizeFailedReason;
    const outcome: CaseFinalizeHttpOutcome =
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

  private blockBody(reason: string, message: string, citation: string | null, outlet: string): CaseFinalizeHttpOutcome {
    return { status: 409, body: { result: reason, reason, message, basis: citation, outlet } };
  }
}

function conclusionNameOf(conclusion: string): string {
  if (conclusion === 'complete') return DOSSIER_CONCLUSION_NAMES.complete;
  if (conclusion === 'approved-missing') return DOSSIER_CONCLUSION_NAMES['approved-missing'];
  return conclusion;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown): string | null {
  const parsed = text(value);
  return parsed === '' ? null : parsed;
}