// 立案呈批与案件最小模型的持久化端口（#234）。
//
// 形态同 clue-store.ts：端口是纯类型（不引 Prisma），可注入（CASE_STORE 令牌）；
// Prisma 适配器在 prisma-case-store.ts（被根 tsconfig 排除在 unit 层之外，由 integration 层承载编译）。
// 事务纪律：调用方在交互式事务里调本端口，业务行与留痕同成同败（#119）。

import type { CaseOpening } from '../filing/rules.ts';

/** 注入令牌。 */
export const CASE_STORE = Symbol('CASE_STORE');

/** 呈批表头。 */
export interface FilingApprovalRow {
  readonly id: string;
  readonly clueId: string;
  readonly drafterId: string;
  /** drafting | pending_review | pending_approval | approved */
  readonly status: string;
  /** 提交时取用的行政审核配置：skip | one-level（未提交过为空）。 */
  readonly adminReview: string | null;
  readonly currentVersionNo: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** 呈批正文的一个版本。 */
export interface FilingApprovalVersionRow {
  readonly versionNo: number;
  /** file | no-case */
  readonly conclusion: string;
  readonly contentJson: string;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/** 一条审批步骤（提交、审核、审批、退回、撤回）。 */
export interface FilingApprovalStepRow {
  readonly id: string;
  readonly versionNo: number;
  readonly step: string;
  readonly actorId: string;
  readonly opinion: string | null;
  readonly createdAt: Date;
}

/** 保存拟制稿：表头不存在时新建，并追加一个正文版本。 */
export interface FilingDraftWrite {
  readonly approvalId: string;
  readonly clueId: string;
  readonly drafterId: string;
  /** true＝新建表头；false＝在既有拟制中的表头上追加版本。 */
  readonly isNew: boolean;
  /** 追加版本前表头的当前版本号（乐观并发）。 */
  readonly expectedVersionNo: number;
  readonly versionId: string;
  readonly conclusion: string;
  readonly contentJson: string;
  readonly at: Date;
}

/** 推进一步：表头状态条件更新，并追加一条审批步骤。 */
export interface FilingStepWrite {
  readonly approvalId: string;
  readonly expectedStatus: string;
  readonly nextStatus: string;
  /** 提交时写入行政审核配置；其余步骤不改。 */
  readonly adminReview?: string;
  readonly stepId: string;
  readonly step: string;
  readonly versionNo: number;
  readonly actorId: string;
  readonly opinion: string | null;
  readonly at: Date;
}

/** 审批人待办的一行。 */
export interface FilingTodoRow {
  readonly approvalId: string;
  readonly clueId: string;
  readonly clueCode: string;
  readonly status: string;
  readonly conclusion: string;
  /** 线索当前承办机构。 */
  readonly orgUnitId: string;
  readonly drafterId: string;
  readonly updatedAt: Date;
}

/** 案件行（最小模型）。 */
export interface CaseRow {
  readonly id: string;
  readonly handlingOrgId: string;
  readonly status: string;
  readonly currentStage: string;
  readonly stageEntrySeq: number;
  readonly partyNames: readonly string[];
  readonly filingApprovalId: string;
  readonly sourceClueIds: readonly string[];
  readonly handlers: readonly { readonly personnelId: string; readonly role: string }[];
  readonly openedAt: Date;
}

export interface CaseStore {
  /** 线索上未批准（拟制中或在途）的呈批；没有为 null。 */
  readOpenFilingApproval(clueId: string): Promise<FilingApprovalRow | null>;
  /** 按主键读呈批表头。 */
  readFilingApproval(approvalId: string): Promise<FilingApprovalRow | null>;
  /** 读呈批的某一版本正文。 */
  readFilingVersion(approvalId: string, versionNo: number): Promise<FilingApprovalVersionRow | null>;
  /** 读呈批的全部审批步骤（时间升序）。 */
  listFilingSteps(approvalId: string): Promise<readonly FilingApprovalStepRow[]>;
  /** X31：线索上是否有在途（待审核或待审批）的呈批。 */
  hasPendingFilingApproval(clueId: string): Promise<boolean>;
  /**
   * 保存拟制稿。新建时撞上「一条线索至多一张未批准呈批」返回 false；
   * 追加时表头不在拟制中或版本号已变返回 false。业务行不变。
   */
  saveFilingDraft(write: FilingDraftWrite): Promise<boolean>;
  /** 推进一步。表头状态与 expectedStatus 不符返回 false，业务行不变。 */
  applyFilingStep(write: FilingStepWrite): Promise<boolean>;
  /** 写入案件最小模型、来源线索与承办人员（批准·立案，同一事务）。 */
  insertCase(opening: CaseOpening, openedBy: string, newId: () => string): Promise<void>;
  /** 按来源线索读案件。 */
  readCaseBySourceClue(clueId: string): Promise<CaseRow | null>;
  /** 审批人待办：给定状态、线索当前承办机构在范围内的呈批。 */
  listFilingTodos(statuses: readonly string[], orgUnitIds: readonly string[]): Promise<readonly FilingTodoRow[]>;
}
