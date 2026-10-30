// 立案呈批与案件最小模型的 Prisma 适配（#234）。
// 与 prisma-clue-store.ts 同理：模块内 import 生成客户端的文件，被根 tsconfig 排除在
// unit 层类型检查之外，由 integration 层承载其编译。调用方在交互式事务里调用本适配器。

import type { Prisma, PrismaClient } from '../../../prisma/generated/prisma/client.ts';

import type { ComparisonBasis, ComparisonBenchmark } from '../comparison/rules.ts';
import type { CaseOpening } from '../filing/rules.ts';
import type {
  ApprovalChainRow,
  ApprovalChainWrite,
  ApprovalOpinionWrite,
  CasePointerWrite,
  CaseMarkerRow,
  CaseMarkerWrite,
  CaseReturnWrite,
  HearingRow,
  HearingStepWrite,
  HearingWrite,
  NoticeDraftWrite,
  NoticeRow,
  NoticeRevokeWrite,
  NoticeServedWrite,
  NoticeStepWrite,
  NoticeValidityBaselineRow,
  NoticeValidityBaselineWrite,
  PartySubmissionRow,
  PartySubmissionWrite,
  CaseRow,
  CaseStageSignatureRow,
  CaseStore,
  CaseReassignmentApprovalWrite,
  CaseReassignmentRow,
  CaseReassignmentWrite,
  CaseView,
  CalendarInstallRow,
  CalendarInstallWrite,
  DeadlineApprovalRow,
  DeadlineDraftWrite,
  DeadlineEventRow,
  DeadlineEventWrite,
  DeadlineRow,
  DeadlineRowWrite,
  DeadlineStepWrite,
  PeriodEventRow,
  PeriodEventWrite,
  ComparisonJudgmentRow,
  ComparisonJudgmentWrite,
  DiscussionMarkRow,
  DiscussionMarkWrite,
  DiscussionRecordRow,
  DiscussionRecordWrite,
  HandlerReplacementWrite,
  HandlerStintRow,
  LegalReviewHeaderWrite,
  LegalReviewOpinionRow,
  LegalReviewOpinionSignWrite,
  LegalReviewOpinionWrite,
  LegalReviewReceiverWrite,
  LegalReviewRow,
  LegalReviewWrite,
  MaterialEffectivenessRow,
  MaterialEffectivenessWrite,
  FilingApprovalRow,
  FilingApprovalStepRow,
  FilingApprovalVersionRow,
  FilingDraftWrite,
  FilingStepWrite,
  FilingTodoRow,
  AgencyConflictMarkRow,
  InvestigationEntryWrite,
  PersonConflictDecisionRow,
  PersonConflictDecisionWrite,
  PersonConflictEventRow,
  PersonConflictEventWrite,
  InquiryRecordRow,
  InquiryRecordWrite,
  PartyNoticeRow,
  PartyNoticeWrite,
  ProcedureApprovalRow,
  ProcedureChainReturnWrite,
  ProcedureDraftWrite,
  ProcedureStepWrite,
  FrozenDecisionRow,
  FrozenDecisionWrite,
  ReviewObjectionDraftWrite,
  ReviewObjectionRow,
  ReviewObjectionStepWrite,
  ReviewObjectionWindowCloseWrite,
  ReviewObjectionWindowRow,
  ReviewObjectionWindowWrite,
  ReviewOpinionRow,
  ReviewOpinionWrite,
  ReviewReportDraftWrite,
  ReviewReportRow,
  ReviewReportStepWrite,
  ReviewerDesignationRow,
  ReviewerDesignationWrite,
  ReassignmentSettlementWrite,
  StageInstanceRow,
  StageInstanceWrite,
  StageInvalidationWrite,
  TransitionHistoryRow,
  TransitionHistoryWrite,
  ViolationRecordRow,
  ViolationRecordWrite,
  ViolationVoidWrite,
  ValidityConfirmationRow,
  ValidityConfirmationWrite,
  ValidityReviewRow,
  ValidityReviewWrite,
  TransferApprovalDraftWrite,
  TransferApprovalRow,
  TransferApprovalStepWrite,
  TransferFileRow,
  TransferFileWrite,
  TransferRow,
  TransferWrite,
  CriminalDecisionRow,
  CriminalDecisionWrite,
  CriminalOutletRow,
  CriminalOutletStepWrite,
  CriminalOutletWrite,
  DossierMaterialRow,
  DossierMaterialWrite,
  FinalizeApprovalDraftWrite,
  FinalizeApprovalRow,
  FinalizeApprovalStepWrite,
  FinalizeRecordRow,
  FinalizeRecordWrite,
  DecisionApprovalDraftWrite,
  DecisionApprovalRow,
  DecisionApprovalStepWrite,
  DeliveryRow,
  DeliveryWrite,
  ExecutionRecordRow,
  ExecutionRecordWrite,
  ClosureApprovalDraftWrite,
  ClosureApprovalRow,
  ClosureApprovalStepWrite,
  ClosureRecordRow,
  ClosureRecordWrite,
} from './case-store.ts';

type Db = PrismaClient | Prisma.TransactionClient;

const PENDING = ['pending_review', 'pending_approval'];

export class PrismaCaseStore implements CaseStore {
  constructor(private readonly prisma: Db) {}

  async readOpenFilingApproval(clueId: string): Promise<FilingApprovalRow | null> {
    return this.prisma.filingApproval.findFirst({
      where: { clueId, status: { not: 'approved' } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async readFilingApproval(approvalId: string): Promise<FilingApprovalRow | null> {
    return this.prisma.filingApproval.findUnique({ where: { id: approvalId } });
  }

  async readFilingVersion(approvalId: string, versionNo: number): Promise<FilingApprovalVersionRow | null> {
    return this.prisma.filingApprovalVersion.findUnique({
      where: { approvalId_versionNo: { approvalId, versionNo } },
      select: { versionNo: true, conclusion: true, contentJson: true, createdBy: true, createdAt: true },
    });
  }

  async listFilingSteps(approvalId: string): Promise<readonly FilingApprovalStepRow[]> {
    return this.prisma.filingApprovalStep.findMany({
      where: { approvalId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        versionNo: true,
        step: true,
        actorId: true,
        opinion: true,
        reasonCode: true,
        returnTarget: true,
        receiverId: true,
        createdAt: true,
      },
    });
  }

  async hasPendingFilingApproval(clueId: string): Promise<boolean> {
    const row = await this.prisma.filingApproval.findFirst({
      where: { clueId, status: { in: PENDING } },
      select: { id: true },
    });
    return row !== null;
  }

  async saveFilingDraft(write: FilingDraftWrite): Promise<boolean> {
    if (write.isNew) {
      // 部分唯一索引挡下同一线索第二张未批准呈批（并发新建同理）。
      const inserted = await this.prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO filing_approval (id, clue_id, drafter_id, status, current_version_no, created_at, updated_at)
        VALUES (${write.approvalId}, ${write.clueId}, ${write.drafterId}, 'drafting', 1, ${write.at}, ${write.at})
        ON CONFLICT (clue_id) WHERE status <> 'approved' DO NOTHING
        RETURNING id
      `;
      if (inserted.length === 0) return false;
    } else {
      const updated = await this.prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE filing_approval
        SET current_version_no = current_version_no + 1, updated_at = ${write.at}
        WHERE id = ${write.approvalId}
          AND status = 'drafting'
          AND current_version_no = ${write.expectedVersionNo}
        RETURNING id
      `;
      if (updated.length === 0) return false;
    }
    await this.prisma.filingApprovalVersion.create({
      data: {
        id: write.versionId,
        approvalId: write.approvalId,
        versionNo: write.isNew ? 1 : write.expectedVersionNo + 1,
        conclusion: write.conclusion,
        contentJson: write.contentJson,
        createdBy: write.drafterId,
        createdAt: write.at,
      },
    });
    return true;
  }

  async applyFilingStep(write: FilingStepWrite): Promise<boolean> {
    const updated = await this.prisma.filingApproval.updateMany({
      where: { id: write.approvalId, status: write.expectedStatus },
      data: {
        status: write.nextStatus,
        updatedAt: write.at,
        ...(write.adminReview === undefined ? {} : { adminReview: write.adminReview }),
      },
    });
    if (updated.count === 0) return false;
    await this.prisma.filingApprovalStep.create({
      data: {
        id: write.stepId,
        approvalId: write.approvalId,
        versionNo: write.versionNo,
        step: write.step,
        actorId: write.actorId,
        opinion: write.opinion,
        reasonCode: write.reasonCode ?? null,
        returnTarget: write.returnTarget ?? null,
        receiverId: write.receiverId ?? null,
        createdAt: write.at,
      },
    });
    return true;
  }

  async insertCase(opening: CaseOpening, openedBy: string, newId: () => string): Promise<void> {
    await this.prisma.caseRecord.create({
      data: {
        id: opening.caseId,
        handlingOrgId: opening.handlingOrgId,
        status: opening.status,
        currentStage: opening.currentStage,
        stageEntrySeq: opening.stageEntrySeq,
        partyNames: [...opening.partyNames],
        filingApprovalId: opening.filingApprovalId,
        openedBy,
        openedAt: opening.openedAt,
      },
    });
    await this.prisma.caseSourceClue.createMany({
      data: opening.sourceClueIds.map((clueId) => ({ id: newId(), caseId: opening.caseId, clueId })),
    });
    await this.prisma.caseHandler.createMany({
      data: opening.handlers.map((handler) => ({
        id: newId(),
        caseId: opening.caseId,
        personnelId: handler.personnelId,
        role: handler.role,
        assignedAt: opening.openedAt,
      })),
    });
  }

  async readCaseBySourceClue(clueId: string): Promise<CaseRow | null> {
    const link = await this.prisma.caseSourceClue.findUnique({ where: { clueId } });
    if (!link) return null;
    const record = await this.prisma.caseRecord.findUnique({ where: { id: link.caseId } });
    if (!record) return null;
    const sources = await this.prisma.caseSourceClue.findMany({ where: { caseId: record.id } });
    const handlers = await this.prisma.caseHandler.findMany({
      where: { caseId: record.id, endedAt: null },
      orderBy: { assignedAt: 'asc' },
    });
    return {
      id: record.id,
      handlingOrgId: record.handlingOrgId,
      status: record.status,
      currentStage: record.currentStage,
      stageEntrySeq: record.stageEntrySeq,
      partyNames: record.partyNames,
      filingApprovalId: record.filingApprovalId,
      suspended: record.suspended,
      sourceClueIds: sources.map((row) => row.clueId),
      handlers: handlers.map((row) => ({ personnelId: row.personnelId, role: row.role })),
      openedAt: record.openedAt,
    };
  }

  async readCaseView(caseId: string): Promise<CaseView | null> {
    const record = await this.prisma.caseRecord.findUnique({ where: { id: caseId } });
    if (!record) return null;
    const sources = await this.prisma.caseSourceClue.findMany({ where: { caseId } });
    const handlers = await this.prisma.caseHandler.findMany({
      where: { caseId, endedAt: null },
      orderBy: { assignedAt: 'asc' },
    });
    const instances = await this.prisma.caseStageInstance.findMany({
      where: { caseId },
      orderBy: [{ enteredAt: 'asc' }, { stage: 'asc' }, { entrySeq: 'asc' }],
    });
    const history = await this.prisma.caseTransition.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const invalidated = new Set(await this.listInvalidatedInstanceIds(caseId));
    const materials = await this.prisma.caseMaterial.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const opinions = await this.prisma.caseApprovalOpinion.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const returns = await this.prisma.caseReturn.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      id: record.id,
      handlingOrgId: record.handlingOrgId,
      status: record.status,
      currentStage: record.currentStage,
      stageEntrySeq: record.stageEntrySeq,
      partyNames: record.partyNames,
      filingApprovalId: record.filingApprovalId,
      suspended: record.suspended,
      sourceClueIds: sources.map((row) => row.clueId),
      handlers: handlers.map((row) => ({ personnelId: row.personnelId, role: row.role })),
      openedAt: record.openedAt,
      instances: instances.map((row) => toInstance(row, invalidated.has(row.id))),
      history: history.map(toHistory),
      materials: materials.map((row) => ({
        id: row.id,
        kind: row.kind,
        body: row.body,
        createdAt: row.createdAt,
      })),
      opinions: opinions.map((row) => ({
        id: row.id,
        reasonCode: row.reasonCode,
        note: row.note,
        targetKey: row.targetKey,
        actorId: row.actorId,
        createdAt: row.createdAt,
      })),
      returns: returns.map((row) => ({
        id: row.id,
        opinionId: row.opinionId,
        reasonCode: row.reasonCode,
        inheritedCode: row.inheritedCode,
        targetKey: row.targetKey,
        receiverId: row.receiverId,
        reflow: row.reflow,
        n5: row.n5,
        entrySeqBefore: row.entrySeqBefore,
        entrySeqAfter: row.entrySeqAfter,
        exitCode: row.exitCode,
        actorId: row.actorId,
        createdAt: row.createdAt,
      })),
    };
  }

  async appendStageInstance(write: StageInstanceWrite): Promise<boolean> {
    try {
      await this.prisma.caseStageInstance.create({
        data: {
          id: write.id,
          caseId: write.caseId,
          stage: write.stage,
          entrySeq: write.entrySeq,
          status: write.status,
          enteredAt: write.enteredAt,
          enteredBy: write.enteredBy,
          transitionCode: write.transitionCode,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueConflict(error)) return false;
      throw error;
    }
  }

  async appendTransition(write: TransitionHistoryWrite): Promise<void> {
    await this.prisma.caseTransition.create({
      data: {
        id: write.id,
        caseId: write.caseId,
        clueId: write.clueId,
        transitionCode: write.transitionCode,
        actorId: write.actorId,
        fromJson: write.fromJson,
        toJson: write.toJson,
        createdAt: write.createdAt,
      },
    });
  }

  async advanceCasePointer(write: CasePointerWrite): Promise<boolean> {
    const updated = await this.prisma.caseRecord.updateMany({
      where: { id: write.caseId, currentStage: write.expectedStage, stageEntrySeq: write.expectedSeq },
      data: {
        currentStage: write.stage,
        stageEntrySeq: write.stageEntrySeq,
        status: write.status,
        suspended: write.suspended,
      },
    });
    return updated.count === 1;
  }

  async countInFlightApprovals(caseId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: number }>>`
      SELECT (
        (SELECT COUNT(*) FROM case_approval_chain WHERE case_id = ${caseId} AND status = 'in_flight')
        +
        (SELECT COUNT(*) FROM filing_approval f
          JOIN case_source_clue s ON s.clue_id = f.clue_id
          WHERE s.case_id = ${caseId} AND f.status IN ('pending_review', 'pending_approval'))
      )::int AS n
    `;
    return rows[0]?.n ?? 0;
  }

  async openApprovalChain(write: ApprovalChainWrite): Promise<boolean> {
    const existing = await this.countInFlightApprovals(write.caseId);
    if (existing > 0) return false;
    try {
      await this.prisma.caseApprovalChain.create({
        data: {
          id: write.id,
          caseId: write.caseId,
          kind: write.kind,
          status: 'in_flight',
          openedBy: write.openedBy,
          openedAt: write.openedAt,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueConflict(error)) return false;
      throw error;
    }
  }

  async appendApprovalOpinion(write: ApprovalOpinionWrite): Promise<void> {
    await this.prisma.caseApprovalOpinion.create({
      data: {
        id: write.id,
        caseId: write.caseId,
        reasonCode: write.reasonCode,
        note: write.note,
        targetKey: write.targetKey,
        actorId: write.actorId,
        createdAt: write.createdAt,
      },
    });
  }

  async appendCaseReturn(write: CaseReturnWrite): Promise<void> {
    await this.prisma.caseReturn.create({
      data: {
        id: write.id,
        caseId: write.caseId,
        opinionId: write.opinionId,
        reasonCode: write.reasonCode,
        inheritedCode: write.inheritedCode,
        targetKey: write.targetKey,
        receiverId: write.receiverId,
        reflow: write.reflow,
        n5: write.n5,
        entrySeqBefore: write.entrySeqBefore,
        entrySeqAfter: write.entrySeqAfter,
        exitCode: write.exitCode,
        rehearingRequired: write.rehearingRequired,
        revokeNotice: write.revokeNotice,
        actorId: write.actorId,
        createdAt: write.createdAt,
      },
    });
  }

  async appendStageInvalidation(write: StageInvalidationWrite): Promise<boolean> {
    try {
      await this.prisma.caseStageInvalidation.create({
        data: {
          id: write.id,
          caseId: write.caseId,
          instanceId: write.instanceId,
          returnId: write.returnId,
          createdAt: write.createdAt,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueConflict(error)) return false;
      throw error;
    }
  }

  async listInvalidatedInstanceIds(caseId: string): Promise<readonly string[]> {
    const rows = await this.prisma.caseStageInvalidation.findMany({
      where: { caseId },
      select: { instanceId: true },
    });
    return rows.map((row) => row.instanceId);
  }

  async readStageSignature(signatureId: string): Promise<CaseStageSignatureRow | null> {
    const row = await this.prisma.caseStageSignature.findUnique({ where: { id: signatureId } });
    if (!row) return null;
    return { id: row.id, caseId: row.caseId, instanceId: row.instanceId, actorId: row.actorId };
  }

  async listFilingTodos(
    statuses: readonly string[],
    orgUnitIds: readonly string[],
  ): Promise<readonly FilingTodoRow[]> {
    if (statuses.length === 0 || orgUnitIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      Array<{
        approval_id: string;
        clue_id: string;
        clue_code: string;
        status: string;
        conclusion: string;
        org_unit_id: string;
        drafter_id: string;
        updated_at: Date;
      }>
    >`
      SELECT f.id AS approval_id, f.clue_id, c.code AS clue_code, f.status,
             v.conclusion, a.org_unit_id, f.drafter_id, f.updated_at
      FROM filing_approval f
      JOIN clue c ON c.id = f.clue_id
      JOIN clue_assignment a ON a.clue_id = f.clue_id AND a.ended_at IS NULL
      JOIN filing_approval_version v ON v.approval_id = f.id AND v.version_no = f.current_version_no
      WHERE f.status = ANY(${[...statuses]}::text[])
        AND a.org_unit_id = ANY(${[...orgUnitIds]}::text[])
      ORDER BY f.updated_at ASC, f.id ASC
    `;
    return rows.map((row) => ({
      approvalId: row.approval_id,
      clueId: row.clue_id,
      clueCode: row.clue_code,
      status: row.status,
      conclusion: row.conclusion,
      orgUnitId: row.org_unit_id,
      drafterId: row.drafter_id,
      updatedAt: row.updated_at,
    }));
  }

  async listPersonConflictEvents(caseId: string, personId?: string): Promise<readonly PersonConflictEventRow[]> {
    return this.prisma.personConflictEvent.findMany({
      where: personId ? { caseId, personId } : { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async listPersonConflictDecisions(caseId: string): Promise<readonly PersonConflictDecisionRow[]> {
    return this.prisma.personConflictDecision.findMany({
      where: { caseId },
      orderBy: [{ decidedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async appendPersonConflictEvent(write: PersonConflictEventWrite): Promise<void> {
    await this.prisma.personConflictEvent.create({ data: { ...write } });
  }

  async appendPersonConflictDecision(write: PersonConflictDecisionWrite): Promise<boolean> {
    try {
      await this.prisma.personConflictDecision.create({
        data: {
          id: write.id,
          caseId: write.caseId,
          lineageId: write.lineageId,
          deciderId: write.deciderId,
          conclusion: write.conclusion,
          reason: write.reason,
          decidedAt: write.decidedAt,
        },
      });
      await this.prisma.personConflictEvent.create({ data: { ...write.nextEvent } });
    } catch (error) {
      if (isUniqueConflict(error)) return false;
      throw error;
    }
    return true;
  }

  async appendInvestigationEntry(write: InvestigationEntryWrite): Promise<void> {
    await this.prisma.caseInvestigationEntry.create({ data: { ...write } });
  }

  async listReassignments(caseId: string): Promise<readonly CaseReassignmentRow[]> {
    return this.prisma.caseReassignment.findMany({
      where: { caseId },
      orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async readReassignment(reassignmentId: string): Promise<CaseReassignmentRow | null> {
    return this.prisma.caseReassignment.findUnique({ where: { id: reassignmentId } });
  }

  async insertReassignment(write: CaseReassignmentWrite): Promise<boolean> {
    try {
      await this.prisma.caseReassignment.create({ data: { ...write, status: 'pending_approval' } });
    } catch (error) {
      if (isUniqueConflict(error)) return false;
      throw error;
    }
    return true;
  }

  async approveReassignment(write: CaseReassignmentApprovalWrite): Promise<boolean> {
    const updated = await this.prisma.caseReassignment.updateMany({
      where: { id: write.id, caseId: write.caseId, status: 'pending_approval' },
      data: { status: 'approved', approvedBy: write.approvedBy, approvedAt: write.approvedAt },
    });
    return updated.count === 1;
  }

  async listHandlerStints(caseId: string): Promise<readonly HandlerStintRow[]> {
    return this.prisma.caseHandler.findMany({
      where: { caseId },
      orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, personnelId: true, role: true, assignedAt: true, endedAt: true },
    });
  }

  async replaceHandlers(write: HandlerReplacementWrite): Promise<void> {
    await this.prisma.caseHandler.updateMany({
      where: { caseId: write.caseId, endedAt: null },
      data: { endedAt: write.endedAt },
    });
    if (write.next.length === 0) return;
    await this.prisma.caseHandler.createMany({
      data: write.next.map((row) => ({
        id: row.id,
        caseId: write.caseId,
        personnelId: row.personnelId,
        role: row.role,
        assignedAt: write.endedAt,
      })),
    });
  }

  async listMaterialEffectiveness(caseId: string): Promise<readonly MaterialEffectivenessRow[]> {
    return this.prisma.caseMaterialEffectiveness.findMany({
      where: { caseId },
      orderBy: [{ determinedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        caseId: true,
        materialId: true,
        reassignmentId: true,
        conclusion: true,
        reason: true,
        determinedBy: true,
        determinedAt: true,
      },
    });
  }

  async insertMaterialEffectiveness(write: MaterialEffectivenessWrite): Promise<void> {
    await this.prisma.caseMaterialEffectiveness.create({ data: { ...write } });
  }

  async listAgencyConflictMarks(caseId: string): Promise<readonly AgencyConflictMarkRow[]> {
    return this.prisma.caseAgencyConflict.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async appendAgencyConflictMark(write: AgencyConflictMarkRow): Promise<boolean> {
    try {
      await this.prisma.caseAgencyConflict.create({ data: { ...write } });
    } catch (error) {
      if (isUniqueConflict(error)) return false;
      throw error;
    }
    return true;
  }

  async closeApprovalChain(id: string): Promise<boolean> {
    const updated = await this.prisma.caseApprovalChain.updateMany({
      where: { id, status: 'in_flight' },
      data: { status: 'closed' },
    });
    return updated.count === 1;
  }

  async listInFlightApprovalChains(caseId: string): Promise<readonly ApprovalChainRow[]> {
    return this.prisma.caseApprovalChain.findMany({
      where: { caseId, status: 'in_flight' },
      orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, caseId: true, kind: true },
    });
  }

  async settleReassignment(write: ReassignmentSettlementWrite): Promise<boolean> {
    const updated = await this.prisma.caseReassignment.updateMany({
      where: { id: write.id, caseId: write.caseId, status: 'pending_approval' },
      data: { status: write.toStatus },
    });
    return updated.count === 1;
  }

  async returnProcedureApprovalsByChain(write: ProcedureChainReturnWrite): Promise<boolean> {
    const rows = await this.prisma.caseProcedureApproval.findMany({
      where: { approvalChainId: write.chainId, status: { in: ['pending_review', 'pending_approval'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const row of rows) {
      const stepped = await this.applyProcedureStep({
        approvalId: row.id,
        expectedStatus: row.status,
        nextStatus: 'drafting',
        approvalChainId: null,
        stepId: write.newId(),
        step: 'return',
        versionNo: row.currentVersionNo,
        actorId: write.actorId,
        opinion: write.opinion,
        at: write.at,
      });
      if (!stepped) return false;
    }
    const reports = await this.prisma.caseReviewReport.findMany({
      where: { approvalChainId: write.chainId, status: { in: ['pending_review', 'pending_approval'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const row of reports) {
      const stepped = await this.applyReviewReportStep({
        reportId: row.id,
        expectedStatus: row.status,
        nextStatus: 'drafting',
        approvalChainId: null,
        stepId: write.newId(),
        step: 'return',
        versionNo: row.currentVersionNo,
        actorId: write.actorId,
        opinion: write.opinion,
        at: write.at,
      });
      if (!stepped) return false;
    }
    const notices = await this.prisma.caseNotice.findMany({
      where: { approvalChainId: write.chainId, status: { in: ['pending_review', 'pending_approval'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const row of notices) {
      const stepped = await this.applyNoticeStep({
        noticeId: row.id,
        expectedStatus: row.status,
        nextStatus: 'drafting',
        approvalChainId: null,
        stepId: write.newId(),
        step: 'return',
        versionNo: row.currentVersionNo,
        actorId: write.actorId,
        opinion: write.opinion,
        at: write.at,
      });
      if (!stepped) return false;
    }
    return true;
  }

  async listViolationRecords(caseId: string): Promise<readonly ViolationRecordRow[]> {
    const rows = await this.prisma.caseViolationRecord.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      behaviorDescription: row.behaviorDescription,
      parties: row.parties,
      startedOn: row.startedOn,
      endedOn: row.endedOn,
      recognition: row.recognition,
      status: row.status,
      voidReason: row.voidReason,
      voidedAt: row.voidedAt,
    }));
  }

  async insertViolationRecord(write: ViolationRecordWrite): Promise<void> {
    await this.prisma.caseViolationRecord.create({
      data: {
        id: write.id,
        caseId: write.caseId,
        behaviorDescription: write.behaviorDescription,
        parties: [...write.parties],
        startedOn: write.startedOn,
        endedOn: write.endedOn,
        recognition: write.recognition,
        status: 'active',
        createdBy: write.createdBy,
        createdAt: write.createdAt,
      },
    });
  }

  async voidViolationRecord(write: ViolationVoidWrite): Promise<boolean> {
    const updated = await this.prisma.caseViolationRecord.updateMany({
      where: { id: write.id, caseId: write.caseId, status: 'active' },
      data: { status: 'voided', voidReason: write.reason, voidedBy: write.actorId, voidedAt: write.at },
    });
    return updated.count === 1;
  }

  async listComparisonJudgments(caseId: string): Promise<readonly ComparisonJudgmentRow[]> {
    const rows = await this.prisma.caseComparisonJudgment.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      caseId: row.caseId,
      violationRecordId: row.violationRecordId,
      behaviorBases: parseComparisonBases(row.behaviorBasesJson),
      decisionBases: parseComparisonBases(row.decisionBasesJson),
      behaviorBenchmarks: parseComparisonBenchmarks(row.behaviorBenchmarksJson),
      decisionBenchmarks: parseComparisonBenchmarks(row.decisionBenchmarksJson),
      adoptedVersion: row.adoptedVersion,
      reason: row.reason,
      noticeRef: row.noticeRef,
      zeroDifference: row.zeroDifference,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    }));
  }

  async insertComparisonJudgment(write: ComparisonJudgmentWrite): Promise<void> {
    await this.prisma.caseComparisonJudgment.create({
      data: {
        id: write.id,
        caseId: write.caseId,
        violationRecordId: write.violationRecordId,
        behaviorBasesJson: JSON.stringify(write.behaviorBases),
        decisionBasesJson: JSON.stringify(write.decisionBases),
        behaviorBenchmarksJson: JSON.stringify(write.behaviorBenchmarks),
        decisionBenchmarksJson: JSON.stringify(write.decisionBenchmarks),
        adoptedVersion: write.adoptedVersion,
        reason: write.reason,
        noticeRef: write.noticeRef,
        zeroDifference: write.zeroDifference,
        createdBy: write.createdBy,
        createdAt: write.createdAt,
      },
    });
  }

  async listInquiryRecords(caseId: string): Promise<readonly InquiryRecordRow[]> {
    const rows = await this.prisma.caseInquiryRecord.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt,
      place: row.place,
      interviewee: row.interviewee,
      officerIds: row.officerIds,
      attachmentName: row.attachmentName,
      createdAt: row.createdAt,
    }));
  }

  async insertInquiryRecord(write: InquiryRecordWrite): Promise<void> {
    await this.prisma.caseInquiryRecord.create({
      data: {
        id: write.id,
        caseId: write.caseId,
        occurredAt: write.occurredAt,
        place: write.place,
        interviewee: write.interviewee,
        officerIds: [...write.officerIds],
        attachmentName: write.attachmentName,
        createdBy: write.createdBy,
        createdAt: write.createdAt,
      },
    });
  }

  async readOpenProcedure(caseId: string): Promise<ProcedureApprovalRow | null> {
    const row = await this.prisma.caseProcedureApproval.findFirst({
      where: { caseId, status: { not: 'approved' } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    return this.withProcedureContent(row);
  }

  async readProcedure(approvalId: string): Promise<ProcedureApprovalRow | null> {
    const row = await this.prisma.caseProcedureApproval.findUnique({ where: { id: approvalId } });
    if (!row) return null;
    return this.withProcedureContent(row);
  }

  async saveProcedureDraft(write: ProcedureDraftWrite): Promise<boolean> {
    const versionNo = write.isNew ? 1 : write.expectedVersionNo + 1;
    if (write.isNew) {
      const inserted = await this.prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO case_procedure_approval (
          id, case_id, kind, drafter_id, status, current_version_no, created_at, updated_at
        )
        VALUES (
          ${write.approvalId}, ${write.caseId}, ${write.kind}, ${write.drafterId},
          'drafting', 1, ${write.at}, ${write.at}
        )
        ON CONFLICT (case_id) WHERE status <> 'approved' DO NOTHING
        RETURNING id
      `;
      if (inserted.length === 0) return false;
    } else {
      const updated = await this.prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE case_procedure_approval
        SET kind = ${write.kind},
            current_version_no = current_version_no + 1,
            updated_at = ${write.at}
        WHERE id = ${write.approvalId}
          AND status = 'drafting'
          AND current_version_no = ${write.expectedVersionNo}
        RETURNING id
      `;
      if (updated.length === 0) return false;
    }
    await this.prisma.caseProcedureVersion.create({
      data: {
        id: write.versionId,
        approvalId: write.approvalId,
        versionNo,
        contentJson: write.contentJson,
        createdBy: write.drafterId,
        createdAt: write.at,
      },
    });
    return true;
  }

  async applyProcedureStep(write: ProcedureStepWrite): Promise<boolean> {
    const data: {
      status: string;
      updatedAt: Date;
      adminReview?: string;
      approvalChainId?: string | null;
    } = { status: write.nextStatus, updatedAt: write.at };
    if (write.adminReview !== undefined) data.adminReview = write.adminReview;
    if (write.approvalChainId !== undefined) data.approvalChainId = write.approvalChainId;
    const updated = await this.prisma.caseProcedureApproval.updateMany({
      where: { id: write.approvalId, status: write.expectedStatus },
      data,
    });
    if (updated.count === 0) return false;
    await this.prisma.caseProcedureStep.create({
      data: {
        id: write.stepId,
        approvalId: write.approvalId,
        versionNo: write.versionNo,
        step: write.step,
        actorId: write.actorId,
        opinion: write.opinion,
        createdAt: write.at,
      },
    });
    return true;
  }

  async listDeadlineEvents(caseId: string): Promise<readonly DeadlineEventRow[]> {
    const rows = await this.prisma.caseDeadlineEvent.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      eventKind: row.eventKind,
      basisLabel: row.basisLabel,
      basisNote: row.basisNote,
      stage: row.stage,
      entrySeq: row.entrySeq,
      transitionCode: row.transitionCode,
      createdAt: row.createdAt,
    }));
  }

  async insertDeadlineEvent(write: DeadlineEventWrite): Promise<void> {
    await this.prisma.caseDeadlineEvent.create({
      data: {
        id: write.id,
        caseId: write.caseId,
        eventKind: write.eventKind,
        basisLabel: write.basisLabel,
        basisNote: write.basisNote,
        stage: write.stage,
        entrySeq: write.entrySeq,
        transitionCode: write.transitionCode,
        actorId: write.actorId,
        createdAt: write.createdAt,
      },
    });
  }

  async listPartyNotices(caseId: string): Promise<readonly PartyNoticeRow[]> {
    const rows = await this.prisma.casePartyNotice.findMany({
      where: { caseId },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      occasion: row.occasion,
      note: row.note,
      recordedAt: row.recordedAt,
    }));
  }

  async insertPartyNotice(write: PartyNoticeWrite): Promise<void> {
    await this.prisma.casePartyNotice.create({
      data: {
        id: write.id,
        caseId: write.caseId,
        occasion: write.occasion,
        note: write.note,
        recordedBy: write.recordedBy,
        recordedAt: write.recordedAt,
      },
    });
  }

  async listCaseMarkers(caseId: string): Promise<readonly CaseMarkerRow[]> {
    const rows = await this.prisma.caseMarker.findMany({
      where: { caseId },
      orderBy: [{ changedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({ ...row, state: row.state as 'set' | 'cleared' }));
  }

  async appendCaseMarker(write: CaseMarkerWrite): Promise<void> {
    await this.prisma.caseMarker.create({ data: { ...write } });
  }

  async listLegalReviews(caseId: string): Promise<readonly LegalReviewRow[]> {
    return this.prisma.caseLegalReview.findMany({
      where: { caseId },
      orderBy: [{ roundNo: 'asc' }, { id: 'asc' }],
    });
  }

  async readLegalReview(legalReviewId: string): Promise<LegalReviewRow | null> {
    return this.prisma.caseLegalReview.findUnique({ where: { id: legalReviewId } });
  }

  async insertLegalReview(write: LegalReviewWrite): Promise<boolean> {
    try {
      await this.prisma.caseLegalReview.create({ data: { ...write } });
      return true;
    } catch {
      return false;
    }
  }

  async applyLegalReviewHeader(write: LegalReviewHeaderWrite): Promise<boolean> {
    const updated = await this.prisma.caseLegalReview.updateMany({
      where: { id: write.legalReviewId, status: { in: [...write.expectedStatuses] } },
      data: {
        status: write.status,
        ...(write.latestOpinionId !== undefined ? { latestOpinionId: write.latestOpinionId } : {}),
        ...(write.conclusion !== undefined ? { conclusion: write.conclusion } : {}),
        ...(write.headId !== undefined ? { headId: write.headId } : {}),
        ...(write.headSignedAt !== undefined ? { headSignedAt: write.headSignedAt } : {}),
        ...(write.concludedAt !== undefined ? { concludedAt: write.concludedAt } : {}),
        updatedAt: write.at,
      },
    });
    return updated.count > 0;
  }

  async replaceLegalReviewReceiver(write: LegalReviewReceiverWrite): Promise<boolean> {
    const updated = await this.prisma.caseLegalReview.updateMany({
      where: { id: write.legalReviewId, status: { not: 'concluded' } },
      data: { receiverId: write.receiverId, updatedAt: write.at },
    });
    return updated.count > 0;
  }

  async insertLegalReviewOpinion(write: LegalReviewOpinionWrite): Promise<void> {
    await this.prisma.caseLegalReviewOpinion.create({ data: { ...write } });
  }

  async listLegalReviewOpinions(caseId: string): Promise<readonly LegalReviewOpinionRow[]> {
    return this.prisma.caseLegalReviewOpinion.findMany({
      where: { caseId },
      orderBy: [{ signedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async readLegalReviewOpinion(opinionId: string): Promise<LegalReviewOpinionRow | null> {
    return this.prisma.caseLegalReviewOpinion.findUnique({ where: { id: opinionId } });
  }

  async signLegalReviewOpinion(write: LegalReviewOpinionSignWrite): Promise<boolean> {
    const updated = await this.prisma.caseLegalReviewOpinion.updateMany({
      where: { id: write.opinionId, headSignedAt: null },
      data: {
        headId: write.headId,
        headSignedAt: write.headSignedAt,
        headOpinion: write.headOpinion,
      },
    });
    return updated.count > 0;
  }

  async listDiscussionMarks(caseId: string): Promise<readonly DiscussionMarkRow[]> {
    return this.prisma.caseDiscussionMark.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async insertDiscussionMark(write: DiscussionMarkWrite): Promise<void> {
    await this.prisma.caseDiscussionMark.create({ data: { ...write } });
  }

  async listDiscussionRecords(caseId: string): Promise<readonly DiscussionRecordRow[]> {
    return this.prisma.caseDiscussionRecord.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async insertDiscussionRecord(write: DiscussionRecordWrite): Promise<void> {
    await this.prisma.caseDiscussionRecord.create({ data: { ...write } });
  }

  async readNotice(caseId: string, entrySeq: number): Promise<NoticeRow | null> {
    const row = await this.prisma.caseNotice.findUnique({ where: { caseId_entrySeq: { caseId, entrySeq } } });
    return row ? toNoticeRow(row) : null;
  }

  async readNoticeById(noticeId: string): Promise<NoticeRow | null> {
    const row = await this.prisma.caseNotice.findUnique({ where: { id: noticeId } });
    return row ? toNoticeRow(row) : null;
  }

  async readOpenNotice(caseId: string): Promise<NoticeRow | null> {
    const row = await this.prisma.caseNotice.findFirst({
      where: { caseId, status: { notIn: ['served', 'revoked'] } },
      orderBy: { entrySeq: 'desc' },
    });
    return row ? toNoticeRow(row) : null;
  }

  async listNotices(caseId: string): Promise<readonly NoticeRow[]> {
    const rows = await this.prisma.caseNotice.findMany({ where: { caseId }, orderBy: { entrySeq: 'asc' } });
    return rows.map(toNoticeRow);
  }

  async saveNoticeDraft(write: NoticeDraftWrite): Promise<boolean> {
    if (write.isNew) {
      try {
        await this.prisma.caseNotice.create({
          data: {
            id: write.noticeId,
            caseId: write.caseId,
            entrySeq: write.entrySeq,
            kind: write.kind,
            status: 'drafting',
            currentVersionNo: 1,
            drafterId: write.drafterId,
            contentJson: write.contentJson,
            createdAt: write.at,
            updatedAt: write.at,
          },
        });
      } catch {
        return false;
      }
      await this.prisma.caseNoticeVersion.create({
        data: {
          id: write.versionId,
          noticeId: write.noticeId,
          versionNo: 1,
          contentJson: write.contentJson,
          createdBy: write.drafterId,
          createdAt: write.at,
        },
      });
      return true;
    }
    const updated = await this.prisma.caseNotice.updateMany({
      where: { id: write.noticeId, status: 'drafting', currentVersionNo: write.expectedVersionNo },
      data: {
        contentJson: write.contentJson,
        currentVersionNo: write.expectedVersionNo + 1,
        updatedAt: write.at,
      },
    });
    if (updated.count === 0) return false;
    await this.prisma.caseNoticeVersion.create({
      data: {
        id: write.versionId,
        noticeId: write.noticeId,
        versionNo: write.expectedVersionNo + 1,
        contentJson: write.contentJson,
        createdBy: write.drafterId,
        createdAt: write.at,
      },
    });
    return true;
  }

  async applyNoticeStep(write: NoticeStepWrite): Promise<boolean> {
    const updated = await this.prisma.caseNotice.updateMany({
      where: { id: write.noticeId, status: write.expectedStatus },
      data: {
        status: write.nextStatus,
        ...(write.adminReview !== undefined ? { adminReview: write.adminReview } : {}),
        ...(write.approvalChainId !== undefined ? { approvalChainId: write.approvalChainId } : {}),
        updatedAt: write.at,
      },
    });
    if (updated.count === 0) return false;
    await this.prisma.caseNoticeStep.create({
      data: {
        id: write.stepId,
        noticeId: write.noticeId,
        versionNo: write.versionNo,
        step: write.step,
        actorId: write.actorId,
        opinion: write.opinion,
        createdAt: write.at,
      },
    });
    return true;
  }

  async markNoticeServed(write: NoticeServedWrite): Promise<boolean> {
    const updated = await this.prisma.caseNotice.updateMany({
      where: { id: write.noticeId, status: 'approved' },
      data: {
        status: 'served',
        servedBy: write.servedBy,
        servedAt: write.servedAt,
        servedOn: civilToDate(write.servedOn),
        updatedAt: write.servedAt,
      },
    });
    return updated.count > 0;
  }

  async listPartySubmissions(caseId: string): Promise<readonly PartySubmissionRow[]> {
    return this.prisma.casePartySubmission.findMany({
      where: { caseId },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async insertPartySubmission(write: PartySubmissionWrite): Promise<void> {
    await this.prisma.casePartySubmission.create({ data: { ...write } });
  }

  async listHearings(caseId: string): Promise<readonly HearingRow[]> {
    return this.prisma.caseHearing.findMany({
      where: { caseId },
      orderBy: [{ entrySeq: 'asc' }, { id: 'asc' }],
    });
  }

  async readHearing(hearingId: string): Promise<HearingRow | null> {
    return this.prisma.caseHearing.findUnique({ where: { id: hearingId } });
  }

  async readOpenHearing(caseId: string): Promise<HearingRow | null> {
    return this.prisma.caseHearing.findFirst({
      where: { caseId, status: { not: 'ended' } },
      orderBy: { entrySeq: 'desc' },
    });
  }

  async insertHearing(write: HearingWrite): Promise<boolean> {
    try {
      await this.prisma.caseHearing.create({
        data: { ...write, createdAt: write.appliedAt, updatedAt: write.appliedAt },
      });
      return true;
    } catch {
      return false;
    }
  }

  async applyHearingStep(write: HearingStepWrite): Promise<boolean> {
    const updated = await this.prisma.caseHearing.updateMany({
      where: { id: write.hearingId, status: { in: [...write.expectedStatuses] } },
      data: {
        status: write.nextStatus,
        ...(write.hostPersonnelId !== undefined ? { hostPersonnelId: write.hostPersonnelId } : {}),
        ...(write.acceptedAt !== undefined ? { acceptedAt: write.acceptedAt } : {}),
        ...(write.scheduledAt !== undefined ? { scheduledAt: write.scheduledAt } : {}),
        ...(write.scheduledFor !== undefined ? { scheduledFor: write.scheduledFor } : {}),
        ...(write.endedAt !== undefined ? { endedAt: write.endedAt } : {}),
        ...(write.endKind !== undefined ? { endKind: write.endKind } : {}),
        ...(write.note !== undefined ? { note: write.note } : {}),
        updatedAt: write.at,
      },
    });
    return updated.count > 0;
  }

  async revokeNotice(write: NoticeRevokeWrite): Promise<boolean> {
    const updated = await this.prisma.caseNotice.updateMany({
      where: { id: write.noticeId, status: 'served' },
      data: { status: 'revoked', updatedAt: write.at },
    });
    if (updated.count === 0) return false;
    await this.prisma.caseNoticeStep.create({
      data: {
        id: write.stepId,
        noticeId: write.noticeId,
        versionNo: write.versionNo,
        step: 'revoke',
        actorId: write.actorId,
        opinion: write.opinion,
        createdAt: write.at,
      },
    });
    return true;
  }

  async insertNoticeValidityBaseline(write: NoticeValidityBaselineWrite): Promise<boolean> {
    try {
      await this.prisma.caseNoticeValidityBaseline.create({
        data: {
          id: write.id,
          caseId: write.caseId,
          noticeId: write.noticeId,
          entrySeq: write.entrySeq,
          kind: write.kind,
          partyType: write.partyType,
          hearingNoticeAttached: write.hearingNoticeAttached,
          confiscationValue: write.confiscationValue,
          summaryJson: write.summaryJson,
          summaryDigest: write.summaryDigest,
          capturedBy: write.capturedBy,
          capturedAt: write.capturedAt,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async readNoticeValidityBaseline(noticeId: string): Promise<NoticeValidityBaselineRow | null> {
    return this.prisma.caseNoticeValidityBaseline.findUnique({ where: { noticeId } });
  }

  async listNoticeValidityBaselines(caseId: string): Promise<readonly NoticeValidityBaselineRow[]> {
    return this.prisma.caseNoticeValidityBaseline.findMany({
      where: { caseId },
      orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async insertValidityConfirmation(write: ValidityConfirmationWrite): Promise<void> {
    await this.prisma.caseValidityConfirmation.create({ data: { ...write } });
  }

  async listValidityConfirmations(caseId: string): Promise<readonly ValidityConfirmationRow[]> {
    return this.prisma.caseValidityConfirmation.findMany({
      where: { caseId },
      orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async readValidityConfirmation(confirmationId: string): Promise<ValidityConfirmationRow | null> {
    return this.prisma.caseValidityConfirmation.findUnique({ where: { id: confirmationId } });
  }

  async insertValidityReview(write: ValidityReviewWrite): Promise<void> {
    await this.prisma.caseValidityReview.create({ data: { ...write } });
  }

  async listValidityReviews(caseId: string): Promise<readonly ValidityReviewRow[]> {
    return this.prisma.caseValidityReview.findMany({
      where: { caseId },
      orderBy: [{ reviewedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async listTransferApprovals(caseId: string): Promise<readonly TransferApprovalRow[]> {
    const rows = await this.prisma.caseTransferApproval.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return Promise.all(rows.map((row) => this.withTransferContent(row)));
  }

  async readTransferApproval(approvalId: string): Promise<TransferApprovalRow | null> {
    const row = await this.prisma.caseTransferApproval.findUnique({ where: { id: approvalId } });
    return row ? this.withTransferContent(row) : null;
  }

  async saveTransferDraft(write: TransferApprovalDraftWrite): Promise<boolean> {
    const versionNo = write.isNew ? 1 : write.expectedVersionNo + 1;
    if (write.isNew) {
      if (write.expectedVersionNo !== 0) return false;
      try {
        await this.prisma.caseTransferApproval.create({
          data: {
            id: write.approvalId,
            caseId: write.caseId,
            kind: write.kind,
            status: 'drafting',
            currentVersionNo: 1,
            drafterId: write.drafterId,
            createdAt: write.at,
            updatedAt: write.at,
          },
        });
      } catch (error) {
        if (isUniqueConflict(error)) return false;
        throw error;
      }
    } else {
      const updated = await this.prisma.caseTransferApproval.updateMany({
        where: { id: write.approvalId, status: 'drafting', currentVersionNo: write.expectedVersionNo },
        data: { currentVersionNo: versionNo, updatedAt: write.at },
      });
      if (updated.count === 0) return false;
    }
    await this.prisma.caseTransferApprovalVersion.create({
      data: {
        id: write.versionId,
        approvalId: write.approvalId,
        versionNo,
        contentJson: write.contentJson,
        createdBy: write.drafterId,
        createdAt: write.at,
      },
    });
    return true;
  }

  async applyTransferStep(write: TransferApprovalStepWrite): Promise<boolean> {
    const data: { status: string; updatedAt: Date; approvalChainId?: string | null } = {
      status: write.nextStatus,
      updatedAt: write.at,
    };
    if (write.approvalChainId !== undefined) data.approvalChainId = write.approvalChainId;
    const updated = await this.prisma.caseTransferApproval.updateMany({
      where: { id: write.approvalId, status: write.expectedStatus },
      data,
    });
    if (updated.count === 0) return false;
    await this.prisma.caseTransferApprovalStep.create({
      data: {
        id: write.stepId,
        approvalId: write.approvalId,
        versionNo: write.versionNo,
        step: write.step,
        actorId: write.actorId,
        opinion: write.opinion,
        createdAt: write.at,
      },
    });
    return true;
  }

  async listTransfers(caseId: string): Promise<readonly TransferRow[]> {
    const rows = await this.prisma.caseTransfer.findMany({
      where: { caseId },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      caseId: row.caseId,
      kind: row.kind,
      receivingOrg: row.receivingOrg,
      documentNo: row.documentNo,
      letterDate: row.letterDate,
      reason: row.reason,
      approvalId: row.approvalId,
      recordedBy: row.recordedBy,
      recordedAt: row.recordedAt,
    }));
  }

  async insertTransfer(write: TransferWrite): Promise<boolean> {
    try {
      await this.prisma.caseTransfer.create({
        data: {
          id: write.id,
          caseId: write.caseId,
          kind: write.kind,
          receivingOrg: write.receivingOrg,
          documentNo: write.documentNo,
          letterDate: write.letterDate,
          reason: write.reason,
          approvalId: write.approvalId,
          recordedBy: write.recordedBy,
          recordedAt: write.recordedAt,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueConflict(error)) return false;
      throw error;
    }
  }

  async listTransferFiles(caseId: string): Promise<readonly TransferFileRow[]> {
    const rows = await this.prisma.caseTransferFile.findMany({
      where: { caseId },
      orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      caseId: row.caseId,
      approvalId: row.approvalId,
      transferId: row.transferId,
      kind: row.kind,
      fileName: row.fileName,
      contentType: row.contentType,
      byteSize: row.byteSize,
      uploadedBy: row.uploadedBy,
      uploadedAt: row.uploadedAt,
    }));
  }

  async insertTransferFile(write: TransferFileWrite): Promise<void> {
    await this.prisma.caseTransferFile.create({
      data: {
        id: write.id,
        caseId: write.caseId,
        approvalId: write.approvalId,
        transferId: write.transferId,
        kind: write.kind,
        fileKey: write.fileKey,
        versionId: write.versionId,
        fileName: write.fileName,
        contentType: write.contentType,
        byteSize: write.byteSize,
        digest: write.digest,
        uploadedBy: write.uploadedBy,
        uploadedAt: write.uploadedAt,
      },
    });
  }

  async listCriminalDecisions(caseId: string): Promise<readonly CriminalDecisionRow[]> {
    const rows = await this.prisma.caseCriminalDecision.findMany({
      where: { caseId },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      caseId: row.caseId,
      source: row.source,
      notifiedOn: row.notifiedOn,
      reason: row.reason,
      caseReturned: row.caseReturned,
      returnedListJson: row.returnedListJson,
      reviewJson: row.reviewJson,
      partyNoticeJson: row.partyNoticeJson,
      recordedBy: row.recordedBy,
      recordedAt: row.recordedAt,
    }));
  }

  async insertCriminalDecision(write: CriminalDecisionWrite): Promise<void> {
    await this.prisma.caseCriminalDecision.create({
      data: {
        id: write.id,
        caseId: write.caseId,
        source: write.source,
        notifiedOn: write.notifiedOn,
        reason: write.reason,
        caseReturned: write.caseReturned,
        returnedListJson: write.returnedListJson,
        reviewJson: write.reviewJson,
        partyNoticeJson: write.partyNoticeJson,
        recordedBy: write.recordedBy,
        recordedAt: write.recordedAt,
      },
    });
  }

  async listCriminalOutlets(caseId: string): Promise<readonly CriminalOutletRow[]> {
    const rows = await this.prisma.caseCriminalOutlet.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      caseId: row.caseId,
      decisionId: row.decisionId,
      outlet: row.outlet,
      status: row.status,
      contentJson: row.contentJson,
      drafterId: row.drafterId,
      approvalChainId: row.approvalChainId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async readCriminalOutlet(outletId: string): Promise<CriminalOutletRow | null> {
    const row = await this.prisma.caseCriminalOutlet.findUnique({ where: { id: outletId } });
    if (!row) return null;
    return {
      id: row.id,
      caseId: row.caseId,
      decisionId: row.decisionId,
      outlet: row.outlet,
      status: row.status,
      contentJson: row.contentJson,
      drafterId: row.drafterId,
      approvalChainId: row.approvalChainId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async insertCriminalOutlet(write: CriminalOutletWrite): Promise<void> {
    await this.prisma.caseCriminalOutlet.create({
      data: {
        id: write.id,
        caseId: write.caseId,
        decisionId: write.decisionId,
        outlet: write.outlet,
        status: 'drafting',
        contentJson: write.contentJson,
        drafterId: write.drafterId,
        createdAt: write.at,
        updatedAt: write.at,
      },
    });
  }

  async applyCriminalOutletStep(write: CriminalOutletStepWrite): Promise<boolean> {
    const data: { status: string; updatedAt: Date; approvalChainId?: string | null } = {
      status: write.nextStatus,
      updatedAt: write.at,
    };
    if (write.approvalChainId !== undefined) data.approvalChainId = write.approvalChainId;
    const updated = await this.prisma.caseCriminalOutlet.updateMany({
      where: { id: write.outletId, status: write.expectedStatus },
      data,
    });
    if (updated.count === 0) return false;
    await this.prisma.caseCriminalOutletStep.create({
      data: {
        id: write.stepId,
        outletId: write.outletId,
        step: write.step,
        actorId: write.actorId,
        opinion: write.opinion,
        createdAt: write.at,
      },
    });
    return true;
  }

  async listDossierMaterials(caseId: string): Promise<readonly DossierMaterialRow[]> {
    const rows = await this.prisma.caseDossierMaterial.findMany({
      where: { caseId },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      caseId: row.caseId,
      itemCode: row.itemCode,
      title: row.title,
      note: row.note,
      stage: row.stage,
      entrySeq: row.entrySeq,
      evidenceJson: row.evidenceJson,
      recordedBy: row.recordedBy,
      recordedAt: row.recordedAt,
    }));
  }

  async insertDossierMaterial(write: DossierMaterialWrite): Promise<void> {
    await this.prisma.caseDossierMaterial.create({
      data: {
        id: write.id,
        caseId: write.caseId,
        itemCode: write.itemCode,
        title: write.title,
        note: write.note,
        stage: write.stage,
        entrySeq: write.entrySeq,
        evidenceJson: write.evidenceJson,
        recordedBy: write.recordedBy,
        recordedAt: write.recordedAt,
      },
    });
  }

  async readOpenFinalizeApproval(caseId: string): Promise<FinalizeApprovalRow | null> {
    const row = await this.prisma.caseFinalizeApproval.findFirst({
      where: { caseId, status: { not: 'approved' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return row ? this.withFinalizeContent(row) : null;
  }

  async readFinalizeApproval(approvalId: string): Promise<FinalizeApprovalRow | null> {
    const row = await this.prisma.caseFinalizeApproval.findUnique({ where: { id: approvalId } });
    return row ? this.withFinalizeContent(row) : null;
  }

  async saveFinalizeDraft(write: FinalizeApprovalDraftWrite): Promise<boolean> {
    const versionNo = write.isNew ? 1 : write.expectedVersionNo + 1;
    if (write.isNew) {
      if (write.expectedVersionNo !== 0) return false;
      try {
        await this.prisma.caseFinalizeApproval.create({
          data: {
            id: write.approvalId,
            caseId: write.caseId,
            status: 'drafting',
            currentVersionNo: 1,
            drafterId: write.drafterId,
            createdAt: write.at,
            updatedAt: write.at,
          },
        });
      } catch (error) {
        if (isUniqueConflict(error)) return false;
        throw error;
      }
    } else {
      const updated = await this.prisma.caseFinalizeApproval.updateMany({
        where: { id: write.approvalId, status: 'drafting', currentVersionNo: write.expectedVersionNo },
        data: { currentVersionNo: versionNo, updatedAt: write.at },
      });
      if (updated.count === 0) return false;
    }
    await this.prisma.caseFinalizeApprovalVersion.create({
      data: {
        id: write.versionId,
        approvalId: write.approvalId,
        versionNo,
        contentJson: write.contentJson,
        createdBy: write.drafterId,
        createdAt: write.at,
      },
    });
    return true;
  }

  async applyFinalizeStep(write: FinalizeApprovalStepWrite): Promise<boolean> {
    const data: { status: string; updatedAt: Date; approvalChainId?: string | null } = {
      status: write.nextStatus,
      updatedAt: write.at,
    };
    if (write.approvalChainId !== undefined) data.approvalChainId = write.approvalChainId;
    const updated = await this.prisma.caseFinalizeApproval.updateMany({
      where: { id: write.approvalId, status: write.expectedStatus },
      data,
    });
    if (updated.count === 0) return false;
    await this.prisma.caseFinalizeApprovalStep.create({
      data: {
        id: write.stepId,
        approvalId: write.approvalId,
        versionNo: write.versionNo,
        step: write.step,
        actorId: write.actorId,
        opinion: write.opinion,
        createdAt: write.at,
      },
    });
    return true;
  }

  async listFinalizes(caseId: string): Promise<readonly FinalizeRecordRow[]> {
    const rows = await this.prisma.caseFinalize.findMany({
      where: { caseId },
      orderBy: [{ generationNo: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      caseId: row.caseId,
      approvalId: row.approvalId,
      generationNo: row.generationNo,
      conclusion: row.conclusion,
      checklistJson: row.checklistJson,
      missingReason: row.missingReason,
      receiptDeficient: row.receiptDeficient,
      materialsRuleId: row.materialsRuleId,
      materialsRuleVersion: row.materialsRuleVersion,
      exemptionsRuleId: row.exemptionsRuleId,
      exemptionsRuleVersion: row.exemptionsRuleVersion,
      finalizedBy: row.finalizedBy,
      finalizedAt: row.finalizedAt,
    }));
  }

  async insertFinalize(write: FinalizeRecordWrite): Promise<boolean> {
    try {
      await this.prisma.caseFinalize.create({
        data: {
          id: write.id,
          caseId: write.caseId,
          approvalId: write.approvalId,
          generationNo: write.generationNo,
          conclusion: write.conclusion,
          checklistJson: write.checklistJson,
          missingReason: write.missingReason,
          receiptDeficient: write.receiptDeficient,
          materialsRuleId: write.materialsRuleId,
          materialsRuleVersion: write.materialsRuleVersion,
          exemptionsRuleId: write.exemptionsRuleId,
          exemptionsRuleVersion: write.exemptionsRuleVersion,
          finalizedBy: write.finalizedBy,
          finalizedAt: write.finalizedAt,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueConflict(error)) return false;
      throw error;
    }
  }

  private async withFinalizeContent(row: {
    id: string;
    caseId: string;
    status: string;
    currentVersionNo: number;
    drafterId: string;
    approvalChainId: string | null;
  }): Promise<FinalizeApprovalRow> {
    const version = row.currentVersionNo > 0
      ? await this.prisma.caseFinalizeApprovalVersion.findUnique({
          where: { approvalId_versionNo: { approvalId: row.id, versionNo: row.currentVersionNo } },
        })
      : null;
    return {
      id: row.id,
      caseId: row.caseId,
      status: row.status,
      currentVersionNo: row.currentVersionNo,
      drafterId: row.drafterId,
      approvalChainId: row.approvalChainId,
      contentJson: version?.contentJson ?? null,
    };
  }

  async listDeadlineRows(caseId: string): Promise<readonly DeadlineRow[]> {
    const rows = await this.prisma.caseDeadlineRow.findMany({
      where: { caseId },
      orderBy: [{ revisionNo: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDeadlineRow);
  }

  async listAllDeadlineRows(): Promise<readonly DeadlineRow[]> {
    const rows = await this.prisma.caseDeadlineRow.findMany({
      orderBy: [{ caseId: 'asc' }, { revisionNo: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDeadlineRow);
  }

  async insertDeadlineRow(write: DeadlineRowWrite): Promise<boolean> {
    try {
      await this.prisma.caseDeadlineRow.create({
        data: {
          id: write.id,
          caseId: write.caseId,
          ruleKey: write.ruleKey,
          entrySeq: write.entrySeq,
          procedureNode: write.procedureNode,
          startingDocument: write.startingDocument,
          consumption: write.consumption,
          ruleVersion: write.ruleVersion,
          dayCount: write.dayCount,
          dayBasis: write.dayBasis,
          partyFacing: write.partyFacing,
          extensionAllowance: write.extensionAllowance,
          startedOn: civilToDate(write.startedOn),
          dueOn: write.dueOn === null ? null : civilToDate(write.dueOn),
          needsManualConfirmation: write.needsManualConfirmation,
          confirmationTrace: write.confirmationTrace,
          rowStatus: write.rowStatus,
          revisionNo: write.revisionNo,
          calendarVersion: write.calendarVersion,
          clamped: write.clamped,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueConflict(error)) return false;
      throw error;
    }
  }

  async listPeriodEvents(caseId: string): Promise<readonly PeriodEventRow[]> {
    const rows = await this.prisma.casePeriodEvent.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      source: row.source,
      basisLabel: row.basisLabel,
      basisNote: row.basisNote,
      reason: row.reason,
      startedOn: row.startedOn === null ? null : dateToCivil(row.startedOn),
      endedOn: row.endedOn === null ? null : dateToCivil(row.endedOn),
      extensionDays: row.extensionDays,
      backfill: row.backfill,
      status: row.status,
      approvalId: row.approvalId,
    }));
  }

  async insertPeriodEvent(write: PeriodEventWrite): Promise<void> {
    await this.prisma.casePeriodEvent.create({
      data: {
        id: write.id,
        caseId: write.caseId,
        kind: write.kind,
        source: write.source,
        basisLabel: write.basisLabel,
        basisNote: write.basisNote,
        reason: write.reason,
        startedOn: write.startedOn === null ? null : civilToDate(write.startedOn),
        endedOn: write.endedOn === null ? null : civilToDate(write.endedOn),
        extensionDays: write.extensionDays,
        backfill: write.backfill,
        status: write.status,
        approvalId: write.approvalId,
        actorId: write.actorId,
        createdAt: write.createdAt,
      },
    });
  }

  async readOpenDeadlineApproval(caseId: string): Promise<DeadlineApprovalRow | null> {
    const row = await this.prisma.caseDeadlineApproval.findFirst({
      where: { caseId, status: { not: 'approved' } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    return this.withDeadlineContent(row);
  }

  async readDeadlineApproval(approvalId: string): Promise<DeadlineApprovalRow | null> {
    const row = await this.prisma.caseDeadlineApproval.findUnique({ where: { id: approvalId } });
    if (!row) return null;
    return this.withDeadlineContent(row);
  }

  async saveDeadlineDraft(write: DeadlineDraftWrite): Promise<boolean> {
    const versionNo = write.isNew ? 1 : write.expectedVersionNo + 1;
    if (write.isNew) {
      const inserted = await this.prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO case_deadline_approval (
          id, case_id, kind, drafter_id, status, current_version_no, created_at, updated_at
        )
        VALUES (
          ${write.approvalId}, ${write.caseId}, ${write.kind}, ${write.drafterId},
          'drafting', 1, ${write.at}, ${write.at}
        )
        ON CONFLICT (case_id) WHERE status <> 'approved' DO NOTHING
        RETURNING id
      `;
      if (inserted.length === 0) return false;
    } else {
      const updated = await this.prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE case_deadline_approval
        SET kind = ${write.kind},
            current_version_no = current_version_no + 1,
            updated_at = ${write.at}
        WHERE id = ${write.approvalId}
          AND status = 'drafting'
          AND current_version_no = ${write.expectedVersionNo}
        RETURNING id
      `;
      if (updated.length === 0) return false;
    }
    await this.prisma.caseDeadlineApprovalVersion.create({
      data: {
        id: write.versionId,
        approvalId: write.approvalId,
        versionNo,
        contentJson: write.contentJson,
        createdBy: write.drafterId,
        createdAt: write.at,
      },
    });
    return true;
  }

  async applyDeadlineStep(write: DeadlineStepWrite): Promise<boolean> {
    const data: {
      status: string;
      updatedAt: Date;
      adminReview?: string;
      approvalChainId?: string | null;
    } = { status: write.nextStatus, updatedAt: write.at };
    if (write.adminReview !== undefined) data.adminReview = write.adminReview;
    if (write.approvalChainId !== undefined) data.approvalChainId = write.approvalChainId;
    const updated = await this.prisma.caseDeadlineApproval.updateMany({
      where: { id: write.approvalId, status: write.expectedStatus },
      data,
    });
    if (updated.count === 0) return false;
    await this.prisma.caseDeadlineApprovalStep.create({
      data: {
        id: write.stepId,
        approvalId: write.approvalId,
        versionNo: write.versionNo,
        step: write.step,
        actorId: write.actorId,
        opinion: write.opinion,
        createdAt: write.at,
      },
    });
    return true;
  }

  async readOpenReviewReport(caseId: string): Promise<ReviewReportRow | null> {
    const row = await this.prisma.caseReviewReport.findFirst({
      where: { caseId, status: { not: 'approved' } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    return this.withReviewReportContent(row);
  }

  async readApprovedReviewReport(caseId: string): Promise<ReviewReportRow | null> {
    const row = await this.prisma.caseReviewReport.findFirst({
      where: { caseId, status: 'approved' },
      orderBy: { updatedAt: 'desc' },
    });
    if (!row) return null;
    return this.withReviewReportContent(row);
  }

  async readReviewReport(reportId: string): Promise<ReviewReportRow | null> {
    const row = await this.prisma.caseReviewReport.findUnique({ where: { id: reportId } });
    if (!row) return null;
    return this.withReviewReportContent(row);
  }

  async saveReviewReportDraft(write: ReviewReportDraftWrite): Promise<boolean> {
    const versionNo = write.isNew ? 1 : write.expectedVersionNo + 1;
    if (write.isNew) {
      const inserted = await this.prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO case_review_report (
          id, case_id, drafter_id, status, current_version_no, created_at, updated_at
        )
        VALUES (
          ${write.approvalId}, ${write.caseId}, ${write.drafterId},
          'drafting', 1, ${write.at}, ${write.at}
        )
        ON CONFLICT (case_id) WHERE status <> 'approved' DO NOTHING
        RETURNING id
      `;
      if (inserted.length === 0) return false;
    } else {
      const updated = await this.prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE case_review_report
        SET current_version_no = current_version_no + 1,
            updated_at = ${write.at}
        WHERE id = ${write.approvalId}
          AND status = 'drafting'
          AND current_version_no = ${write.expectedVersionNo}
        RETURNING id
      `;
      if (updated.length === 0) return false;
    }
    await this.prisma.caseReviewReportVersion.create({
      data: {
        id: write.versionId,
        reportId: write.approvalId,
        versionNo,
        contentJson: write.contentJson,
        createdBy: write.drafterId,
        createdAt: write.at,
      },
    });
    return true;
  }

  async applyReviewReportStep(write: ReviewReportStepWrite): Promise<boolean> {
    const data: {
      status: string;
      updatedAt: Date;
      adminReview?: string;
      approvalChainId?: string | null;
    } = { status: write.nextStatus, updatedAt: write.at };
    if (write.adminReview !== undefined) data.adminReview = write.adminReview;
    if (write.approvalChainId !== undefined) data.approvalChainId = write.approvalChainId;
    const updated = await this.prisma.caseReviewReport.updateMany({
      where: { id: write.reportId, status: write.expectedStatus },
      data,
    });
    if (updated.count === 0) return false;
    await this.prisma.caseReviewReportStep.create({
      data: {
        id: write.stepId,
        reportId: write.reportId,
        versionNo: write.versionNo,
        step: write.step,
        actorId: write.actorId,
        opinion: write.opinion,
        createdAt: write.at,
      },
    });
    return true;
  }

  async listReviewerDesignations(caseId: string): Promise<readonly ReviewerDesignationRow[]> {
    return this.prisma.caseReviewerDesignation.findMany({
      where: { caseId },
      orderBy: [{ designatedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async insertReviewerDesignation(write: ReviewerDesignationWrite): Promise<boolean> {
    try {
      await this.prisma.caseReviewerDesignation.create({ data: { ...write } });
      return true;
    } catch {
      return false;
    }
  }

  async supersedeReviewerDesignation(write: { readonly id: string; readonly caseId: string; readonly at: Date }): Promise<boolean> {
    const updated = await this.prisma.caseReviewerDesignation.updateMany({
      where: { id: write.id, caseId: write.caseId, supersededAt: null },
      data: { supersededAt: write.at },
    });
    return updated.count > 0;
  }

  async insertReviewOpinion(write: ReviewOpinionWrite): Promise<void> {
    await this.prisma.caseReviewOpinion.create({ data: { ...write } });
  }

  async listReviewOpinions(caseId: string): Promise<readonly ReviewOpinionRow[]> {
    return this.prisma.caseReviewOpinion.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async insertFrozenDecision(write: FrozenDecisionWrite): Promise<boolean> {
    try {
      await this.prisma.caseFrozenDecision.create({ data: { ...write } });
      return true;
    } catch {
      return false;
    }
  }

  async listFrozenDecisions(caseId: string): Promise<readonly FrozenDecisionRow[]> {
    return this.prisma.caseFrozenDecision.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async readOpenReviewObjection(caseId: string): Promise<ReviewObjectionRow | null> {
    return this.prisma.caseReviewObjection.findFirst({
      where: { caseId, status: { not: 'decided' } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async readReviewObjection(objectionId: string): Promise<ReviewObjectionRow | null> {
    return this.prisma.caseReviewObjection.findUnique({ where: { id: objectionId } });
  }

  async saveReviewObjectionDraft(write: ReviewObjectionDraftWrite): Promise<boolean> {
    if (write.isNew) {
      try {
        await this.prisma.caseReviewObjection.create({
          data: {
            id: write.objectionId,
            caseId: write.caseId,
            entrySeq: write.entrySeq,
            opinionId: write.opinionId,
            drafterId: write.drafterId,
            status: 'drafting',
            contentJson: write.contentJson,
            createdAt: write.at,
            updatedAt: write.at,
          },
        });
        return true;
      } catch {
        return false;
      }
    }
    const updated = await this.prisma.caseReviewObjection.updateMany({
      where: { id: write.objectionId, caseId: write.caseId, drafterId: write.drafterId, status: 'drafting' },
      data: { contentJson: write.contentJson, updatedAt: write.at },
    });
    return updated.count > 0;
  }

  async applyReviewObjectionStep(write: ReviewObjectionStepWrite): Promise<boolean> {
    const data: {
      status: string;
      updatedAt: Date;
      decision?: string | null;
      decisionTransition?: string | null;
      decidedBy?: string | null;
      decidedAt?: Date | null;
      approvalChainId?: string | null;
      contentJson?: string;
    } = { status: write.nextStatus, updatedAt: write.at };
    if (write.decision !== undefined) data.decision = write.decision;
    if (write.decisionTransition !== undefined) data.decisionTransition = write.decisionTransition;
    if (write.decidedBy !== undefined) data.decidedBy = write.decidedBy;
    if (write.decidedAt !== undefined) data.decidedAt = write.decidedAt;
    if (write.approvalChainId !== undefined) data.approvalChainId = write.approvalChainId;
    if (write.contentJson !== undefined) data.contentJson = write.contentJson;
    const updated = await this.prisma.caseReviewObjection.updateMany({
      where: { id: write.objectionId, status: write.expectedStatus },
      data,
    });
    return updated.count > 0;
  }

  async listReviewObjections(caseId: string): Promise<readonly ReviewObjectionRow[]> {
    return this.prisma.caseReviewObjection.findMany({
      where: { caseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async insertReviewObjectionWindow(write: ReviewObjectionWindowWrite): Promise<boolean> {
    try {
      await this.prisma.caseReviewObjectionWindow.create({
        data: {
          id: write.id,
          caseId: write.caseId,
          entrySeq: write.entrySeq,
          opinionId: write.opinionId,
          status: 'open',
          dueAt: write.dueAt,
          openedAt: write.openedAt,
          createdAt: write.at,
          updatedAt: write.at,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async listReviewObjectionWindows(caseId: string): Promise<readonly ReviewObjectionWindowRow[]> {
    return this.prisma.caseReviewObjectionWindow.findMany({
      where: { caseId },
      orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async readOpenReviewObjectionWindow(opinionId: string): Promise<ReviewObjectionWindowRow | null> {
    return this.prisma.caseReviewObjectionWindow.findFirst({
      where: { opinionId, status: 'open' },
    });
  }

  async closeReviewObjectionWindow(write: ReviewObjectionWindowCloseWrite): Promise<boolean> {
    const updated = await this.prisma.caseReviewObjectionWindow.updateMany({
      where: { id: write.id, caseId: write.caseId, status: 'open' },
      data: {
        status: 'closed',
        closeKind: write.closeKind,
        closedBy: write.closedBy,
        closedAt: write.at,
        updatedAt: write.at,
      },
    });
    return updated.count > 0;
  }

  async listCalendarInstalls(): Promise<readonly CalendarInstallRow[]> {
    const rows = await this.prisma.deadlineCalendarInstall.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      version: row.version,
      year: row.year,
      holidays: row.holidays,
      makeupWorkdays: row.makeupWorkdays,
      sourceUrl: row.sourceUrl,
    }));
  }

  async insertCalendarInstall(write: CalendarInstallWrite): Promise<void> {
    await this.prisma.deadlineCalendarInstall.create({
      data: {
        id: write.id,
        version: write.version,
        year: write.year,
        holidays: [...write.holidays],
        makeupWorkdays: [...write.makeupWorkdays],
        sourceUrl: write.sourceUrl,
        installedBy: write.installedBy,
        createdAt: write.createdAt,
      },
    });
  }

  private async withDeadlineContent(row: {
    id: string;
    caseId: string;
    kind: string;
    status: string;
    adminReview: string | null;
    currentVersionNo: number;
    drafterId: string;
    approvalChainId: string | null;
  }): Promise<DeadlineApprovalRow> {
    const version =
      row.currentVersionNo > 0
        ? await this.prisma.caseDeadlineApprovalVersion.findUnique({
            where: { approvalId_versionNo: { approvalId: row.id, versionNo: row.currentVersionNo } },
          })
        : null;
    return {
      id: row.id,
      caseId: row.caseId,
      kind: row.kind,
      status: row.status,
      adminReview: row.adminReview,
      currentVersionNo: row.currentVersionNo,
      drafterId: row.drafterId,
      approvalChainId: row.approvalChainId,
      contentJson: version?.contentJson ?? null,
    };
  }

  private async withProcedureContent(row: {
    id: string;
    caseId: string;
    kind: string;
    status: string;
    adminReview: string | null;
    currentVersionNo: number;
    drafterId: string;
    approvalChainId: string | null;
  }): Promise<ProcedureApprovalRow> {
    const version =
      row.currentVersionNo > 0
        ? await this.prisma.caseProcedureVersion.findUnique({
            where: { approvalId_versionNo: { approvalId: row.id, versionNo: row.currentVersionNo } },
          })
        : null;
    return {
      id: row.id,
      caseId: row.caseId,
      kind: row.kind,
      status: row.status,
      adminReview: row.adminReview,
      currentVersionNo: row.currentVersionNo,
      drafterId: row.drafterId,
      approvalChainId: row.approvalChainId,
      contentJson: version?.contentJson ?? null,
    };
  }

  private async withTransferContent(row: {
    id: string;
    caseId: string;
    kind: string;
    status: string;
    currentVersionNo: number;
    drafterId: string;
    approvalChainId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<TransferApprovalRow> {
    const version =
      row.currentVersionNo > 0
        ? await this.prisma.caseTransferApprovalVersion.findUnique({
            where: { approvalId_versionNo: { approvalId: row.id, versionNo: row.currentVersionNo } },
          })
        : null;
    return {
      id: row.id,
      caseId: row.caseId,
      kind: row.kind,
      status: row.status,
      currentVersionNo: row.currentVersionNo,
      drafterId: row.drafterId,
      approvalChainId: row.approvalChainId,
      contentJson: version?.contentJson ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async withReviewReportContent(row: {
    id: string;
    caseId: string;
    status: string;
    adminReview: string | null;
    currentVersionNo: number;
    drafterId: string;
    approvalChainId: string | null;
  }): Promise<ReviewReportRow> {
    const version =
      row.currentVersionNo > 0
        ? await this.prisma.caseReviewReportVersion.findUnique({
            where: { reportId_versionNo: { reportId: row.id, versionNo: row.currentVersionNo } },
          })
        : null;
    return {
      id: row.id,
      caseId: row.caseId,
      status: row.status,
      adminReview: row.adminReview,
      currentVersionNo: row.currentVersionNo,
      drafterId: row.drafterId,
      approvalChainId: row.approvalChainId,
      contentJson: version?.contentJson ?? null,
    };
  }

  async readOpenDecisionApproval(caseId: string): Promise<DecisionApprovalRow | null> {
    const row = await this.prisma.caseDecisionApproval.findFirst({
      where: { caseId, status: { not: 'approved' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return row ? this.withDecisionContent(row) : null;
  }

  async readDecisionApproval(approvalId: string): Promise<DecisionApprovalRow | null> {
    const row = await this.prisma.caseDecisionApproval.findUnique({ where: { id: approvalId } });
    return row ? this.withDecisionContent(row) : null;
  }

  async readApprovedDecisionApproval(caseId: string): Promise<DecisionApprovalRow | null> {
    const row = await this.prisma.caseDecisionApproval.findFirst({
      where: { caseId, status: 'approved' },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    return row ? this.withDecisionContent(row) : null;
  }

  async saveDecisionDraft(write: DecisionApprovalDraftWrite): Promise<boolean> {
    const versionNo = write.isNew ? 1 : write.expectedVersionNo + 1;
    if (write.isNew) {
      if (write.expectedVersionNo !== 0) return false;
      try {
        await this.prisma.caseDecisionApproval.create({
          data: {
            id: write.approvalId,
            caseId: write.caseId,
            status: 'drafting',
            currentVersionNo: 1,
            drafterId: write.drafterId,
            createdAt: write.at,
            updatedAt: write.at,
          },
        });
      } catch (error) {
        if (isUniqueConflict(error)) return false;
        throw error;
      }
    } else {
      const updated = await this.prisma.caseDecisionApproval.updateMany({
        where: { id: write.approvalId, status: 'drafting', currentVersionNo: write.expectedVersionNo },
        data: { currentVersionNo: versionNo, updatedAt: write.at },
      });
      if (updated.count === 0) return false;
    }
    await this.prisma.caseDecisionApprovalVersion.create({
      data: {
        id: write.versionId,
        approvalId: write.approvalId,
        versionNo,
        contentJson: write.contentJson,
        createdBy: write.drafterId,
        createdAt: write.at,
      },
    });
    return true;
  }

  async applyDecisionStep(write: DecisionApprovalStepWrite): Promise<boolean> {
    const data: { status: string; updatedAt: Date; approvalChainId?: string | null } = {
      status: write.nextStatus,
      updatedAt: write.at,
    };
    if (write.approvalChainId !== undefined) data.approvalChainId = write.approvalChainId;
    const updated = await this.prisma.caseDecisionApproval.updateMany({
      where: { id: write.approvalId, status: write.expectedStatus },
      data,
    });
    if (updated.count === 0) return false;
    await this.prisma.caseDecisionApprovalStep.create({
      data: {
        id: write.stepId,
        approvalId: write.approvalId,
        versionNo: write.versionNo,
        step: write.step,
        actorId: write.actorId,
        opinion: write.opinion,
        createdAt: write.at,
      },
    });
    return true;
  }

  async listDeliveries(caseId: string): Promise<readonly DeliveryRow[]> {
    const rows = await this.prisma.caseDelivery.findMany({
      where: { caseId },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      caseId: row.caseId,
      kind: row.kind,
      documentKind: row.documentKind,
      deliveredOn: row.deliveredOn,
      deliverers: JSON.parse(row.deliverersJson) as string[],
      reasonRecord: row.reasonRecord,
      announcementMaterials: JSON.parse(row.announcementMaterialsJson) as string[],
      note: row.note,
      decisionApprovalId: row.decisionApprovalId,
      recordedBy: row.recordedBy,
      recordedAt: row.recordedAt,
    }));
  }

  async insertDelivery(write: DeliveryWrite): Promise<void> {
    await this.prisma.caseDelivery.create({
      data: {
        id: write.id,
        caseId: write.caseId,
        kind: write.kind,
        documentKind: write.documentKind,
        deliveredOn: write.deliveredOn,
        deliverersJson: JSON.stringify(write.deliverers),
        reasonRecord: write.reasonRecord,
        announcementMaterialsJson: JSON.stringify(write.announcementMaterials),
        note: write.note,
        decisionApprovalId: write.decisionApprovalId,
        recordedBy: write.recordedBy,
        recordedAt: write.recordedAt,
      },
    });
  }

  async listExecutionRecords(caseId: string): Promise<readonly ExecutionRecordRow[]> {
    const rows = await this.prisma.caseExecutionRecord.findMany({
      where: { caseId },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      caseId: row.caseId,
      kind: row.kind,
      note: row.note,
      attachments: JSON.parse(row.attachmentsJson) as string[],
      recordedBy: row.recordedBy,
      recordedAt: row.recordedAt,
    }));
  }

  async insertExecutionRecord(write: ExecutionRecordWrite): Promise<void> {
    await this.prisma.caseExecutionRecord.create({
      data: {
        id: write.id,
        caseId: write.caseId,
        kind: write.kind,
        note: write.note,
        attachmentsJson: JSON.stringify(write.attachments),
        recordedBy: write.recordedBy,
        recordedAt: write.recordedAt,
      },
    });
  }

  async readOpenClosureApproval(caseId: string): Promise<ClosureApprovalRow | null> {
    const row = await this.prisma.caseClosureApproval.findFirst({
      where: { caseId, status: { not: 'approved' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return row ? this.withClosureContent(row) : null;
  }

  async readClosureApproval(approvalId: string): Promise<ClosureApprovalRow | null> {
    const row = await this.prisma.caseClosureApproval.findUnique({ where: { id: approvalId } });
    return row ? this.withClosureContent(row) : null;
  }

  async saveClosureDraft(write: ClosureApprovalDraftWrite): Promise<boolean> {
    const versionNo = write.isNew ? 1 : write.expectedVersionNo + 1;
    if (write.isNew) {
      if (write.expectedVersionNo !== 0) return false;
      try {
        await this.prisma.caseClosureApproval.create({
          data: {
            id: write.approvalId,
            caseId: write.caseId,
            status: 'drafting',
            currentVersionNo: 1,
            drafterId: write.drafterId,
            createdAt: write.at,
            updatedAt: write.at,
          },
        });
      } catch (error) {
        if (isUniqueConflict(error)) return false;
        throw error;
      }
    } else {
      const updated = await this.prisma.caseClosureApproval.updateMany({
        where: { id: write.approvalId, status: 'drafting', currentVersionNo: write.expectedVersionNo },
        data: { currentVersionNo: versionNo, updatedAt: write.at },
      });
      if (updated.count === 0) return false;
    }
    await this.prisma.caseClosureApprovalVersion.create({
      data: {
        id: write.versionId,
        approvalId: write.approvalId,
        versionNo,
        contentJson: write.contentJson,
        createdBy: write.drafterId,
        createdAt: write.at,
      },
    });
    return true;
  }

  async applyClosureStep(write: ClosureApprovalStepWrite): Promise<boolean> {
    const data: { status: string; updatedAt: Date; approvalChainId?: string | null } = {
      status: write.nextStatus,
      updatedAt: write.at,
    };
    if (write.approvalChainId !== undefined) data.approvalChainId = write.approvalChainId;
    const updated = await this.prisma.caseClosureApproval.updateMany({
      where: { id: write.approvalId, status: write.expectedStatus },
      data,
    });
    if (updated.count === 0) return false;
    await this.prisma.caseClosureApprovalStep.create({
      data: {
        id: write.stepId,
        approvalId: write.approvalId,
        versionNo: write.versionNo,
        step: write.step,
        actorId: write.actorId,
        opinion: write.opinion,
        createdAt: write.at,
      },
    });
    return true;
  }

  async readClosure(caseId: string): Promise<ClosureRecordRow | null> {
    const row = await this.prisma.caseClosure.findUnique({ where: { caseId } });
    if (!row) return null;
    return {
      id: row.id,
      caseId: row.caseId,
      approvalId: row.approvalId,
      branch: row.branch,
      checklistJson: row.checklistJson,
      materialsRuleId: row.materialsRuleId,
      materialsRuleVersion: row.materialsRuleVersion,
      closedBy: row.closedBy,
      closedAt: row.closedAt,
    };
  }

  async insertClosure(write: ClosureRecordWrite): Promise<boolean> {
    try {
      await this.prisma.caseClosure.create({
        data: {
          id: write.id,
          caseId: write.caseId,
          approvalId: write.approvalId,
          branch: write.branch,
          checklistJson: write.checklistJson,
          materialsRuleId: write.materialsRuleId,
          materialsRuleVersion: write.materialsRuleVersion,
          closedBy: write.closedBy,
          closedAt: write.closedAt,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueConflict(error)) return false;
      throw error;
    }
  }

  private async withDecisionContent(row: {
    id: string;
    caseId: string;
    status: string;
    currentVersionNo: number;
    drafterId: string;
    approvalChainId: string | null;
  }): Promise<DecisionApprovalRow> {
    const version = row.currentVersionNo > 0
      ? await this.prisma.caseDecisionApprovalVersion.findUnique({
          where: { approvalId_versionNo: { approvalId: row.id, versionNo: row.currentVersionNo } },
        })
      : null;
    return {
      id: row.id,
      caseId: row.caseId,
      status: row.status,
      currentVersionNo: row.currentVersionNo,
      drafterId: row.drafterId,
      approvalChainId: row.approvalChainId,
      contentJson: version?.contentJson ?? null,
    };
  }

  private async withClosureContent(row: {
    id: string;
    caseId: string;
    status: string;
    currentVersionNo: number;
    drafterId: string;
    approvalChainId: string | null;
  }): Promise<ClosureApprovalRow> {
    const version = row.currentVersionNo > 0
      ? await this.prisma.caseClosureApprovalVersion.findUnique({
          where: { approvalId_versionNo: { approvalId: row.id, versionNo: row.currentVersionNo } },
        })
      : null;
    return {
      id: row.id,
      caseId: row.caseId,
      status: row.status,
      currentVersionNo: row.currentVersionNo,
      drafterId: row.drafterId,
      approvalChainId: row.approvalChainId,
      contentJson: version?.contentJson ?? null,
    };
  }
}

function toInstance(
  row: {
    id: string;
    stage: string;
    entrySeq: number;
    status: string;
    enteredAt: Date;
    enteredBy: string;
    transitionCode: string;
  },
  invalidated: boolean,
): StageInstanceRow {
  return {
    id: row.id,
    stage: row.stage,
    entrySeq: row.entrySeq,
    status: row.status,
    enteredAt: row.enteredAt,
    enteredBy: row.enteredBy,
    transitionCode: row.transitionCode,
    invalidated,
  };
}

function toHistory(row: {
  id: string;
  transitionCode: string;
  actorId: string;
  fromJson: string;
  toJson: string;
  createdAt: Date;
}): TransitionHistoryRow {
  return {
    id: row.id,
    transitionCode: row.transitionCode,
    actorId: row.actorId,
    fromJson: row.fromJson,
    toJson: row.toJson,
    createdAt: row.createdAt,
  };
}

function civilToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function dateToCivil(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toNoticeRow(row: {
  id: string;
  caseId: string;
  entrySeq: number;
  kind: string;
  status: string;
  adminReview: string | null;
  currentVersionNo: number;
  drafterId: string;
  approvalChainId: string | null;
  contentJson: string;
  servedBy: string | null;
  servedAt: Date | null;
  servedOn: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): NoticeRow {
  return {
    ...row,
    servedOn: row.servedOn === null ? null : dateToCivil(row.servedOn),
  };
}

function toDeadlineRow(row: {
  id: string;
  caseId: string;
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
  startedOn: Date;
  dueOn: Date | null;
  needsManualConfirmation: boolean;
  confirmationTrace: string | null;
  rowStatus: string;
  revisionNo: number;
  calendarVersion: string;
  clamped: boolean;
}): DeadlineRow {
  return {
    id: row.id,
    caseId: row.caseId,
    ruleKey: row.ruleKey,
    entrySeq: row.entrySeq,
    procedureNode: row.procedureNode,
    startingDocument: row.startingDocument,
    consumption: row.consumption,
    ruleVersion: row.ruleVersion,
    dayCount: row.dayCount,
    dayBasis: row.dayBasis,
    partyFacing: row.partyFacing,
    extensionAllowance: row.extensionAllowance,
    startedOn: dateToCivil(row.startedOn),
    dueOn: row.dueOn === null ? null : dateToCivil(row.dueOn),
    needsManualConfirmation: row.needsManualConfirmation,
    confirmationTrace: row.confirmationTrace,
    rowStatus: row.rowStatus,
    revisionNo: row.revisionNo,
    calendarVersion: row.calendarVersion,
    clamped: row.clamped,
  };
}

function parseComparisonBases(value: string): ComparisonBasis[] {
  return JSON.parse(value) as ComparisonBasis[];
}

function parseComparisonBenchmarks(value: string): ComparisonBenchmark[] {
  return JSON.parse(value) as ComparisonBenchmark[];
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002';
}
