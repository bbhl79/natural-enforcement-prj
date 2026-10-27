// 立案呈批与案件最小模型的 Prisma 适配（#234）。
// 与 prisma-clue-store.ts 同理：模块内 import 生成客户端的文件，被根 tsconfig 排除在
// unit 层类型检查之外，由 integration 层承载其编译。调用方在交互式事务里调用本适配器。

import type { Prisma, PrismaClient } from '../../../prisma/generated/prisma/client.ts';

import type { CaseOpening } from '../filing/rules.ts';
import type {
  CaseRow,
  CaseStore,
  FilingApprovalRow,
  FilingApprovalStepRow,
  FilingApprovalVersionRow,
  FilingDraftWrite,
  FilingStepWrite,
  FilingTodoRow,
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
      select: { id: true, versionNo: true, step: true, actorId: true, opinion: true, createdAt: true },
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
      sourceClueIds: sources.map((row) => row.clueId),
      handlers: handlers.map((row) => ({ personnelId: row.personnelId, role: row.role })),
      openedAt: record.openedAt,
    };
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
}
