// 立案呈批与案件最小模型的 Prisma 适配（#234）。
// 与 prisma-clue-store.ts 同理：模块内 import 生成客户端的文件，被根 tsconfig 排除在
// unit 层类型检查之外，由 integration 层承载其编译。调用方在交互式事务里调用本适配器。

import type { Prisma, PrismaClient } from '../../../prisma/generated/prisma/client.ts';

import type { ComparisonBasis, ComparisonBenchmark } from '../comparison/rules.ts';
import type { CaseOpening } from '../filing/rules.ts';
import type {
  ApprovalChainWrite,
  ApprovalOpinionWrite,
  CasePointerWrite,
  CaseReturnWrite,
  CaseRow,
  CaseStageSignatureRow,
  CaseStore,
  CaseReassignmentApprovalWrite,
  CaseReassignmentRow,
  CaseReassignmentWrite,
  CaseView,
  ComparisonJudgmentRow,
  ComparisonJudgmentWrite,
  DeadlineEventRow,
  DeadlineEventWrite,
  HandlerReplacementWrite,
  HandlerStintRow,
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
  ProcedureDraftWrite,
  ProcedureStepWrite,
  StageInstanceRow,
  StageInstanceWrite,
  StageInvalidationWrite,
  TransitionHistoryRow,
  TransitionHistoryWrite,
  ViolationRecordRow,
  ViolationRecordWrite,
  ViolationVoidWrite,
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

function parseComparisonBases(value: string): ComparisonBasis[] {
  return JSON.parse(value) as ComparisonBasis[];
}

function parseComparisonBenchmarks(value: string): ComparisonBenchmark[] {
  return JSON.parse(value) as ComparisonBenchmark[];
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002';
}
