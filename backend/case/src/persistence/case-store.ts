// 立案呈批与案件最小模型的持久化端口（#234）。
//
// 形态同 clue-store.ts：端口是纯类型（不引 Prisma），可注入（CASE_STORE 令牌）；
// Prisma 适配器在 prisma-case-store.ts（被根 tsconfig 排除在 unit 层之外，由 integration 层承载编译）。
// 事务纪律：调用方在交互式事务里调本端口，业务行与留痕同成同败（#119）。

import type { ComparisonBasis, ComparisonBenchmark } from '../comparison/rules.ts';
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
  readonly reasonCode: string | null;
  readonly returnTarget: string | null;
  readonly receiverId: string | null;
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
  /** 退回步骤写入。其他步骤为空。 */
  readonly reasonCode?: string | null;
  readonly returnTarget?: string | null;
  readonly receiverId?: string | null;
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

/** 环节实例一行（只追加）。invalidated 由失效记录派生，不写在实例行上。 */
export interface StageInstanceRow {
  readonly id: string;
  readonly stage: string;
  readonly entrySeq: number;
  readonly status: string;
  readonly enteredAt: Date;
  readonly enteredBy: string;
  readonly transitionCode: string;
  readonly invalidated: boolean;
}

/** 迁移历史一行（只追加）。 */
export interface TransitionHistoryRow {
  readonly id: string;
  readonly transitionCode: string;
  readonly actorId: string;
  readonly fromJson: string;
  readonly toJson: string;
  readonly createdAt: Date;
}

/** 案件详情：主状态、当前环节、进入次序号、实例、迁移历史、材料与退回。 */
export interface CaseView extends CaseRow {
  readonly instances: readonly StageInstanceRow[];
  readonly history: readonly TransitionHistoryRow[];
  readonly materials: readonly CaseMaterialRow[];
  readonly opinions: readonly CaseApprovalOpinionRow[];
  readonly returns: readonly CaseReturnRow[];
}

export interface CaseMaterialRow {
  readonly id: string;
  readonly kind: string;
  readonly body: string;
  readonly createdAt: Date;
}

export interface CaseApprovalOpinionRow {
  readonly id: string;
  readonly reasonCode: string;
  readonly note: string;
  readonly targetKey: string;
  readonly actorId: string;
  readonly createdAt: Date;
}

export interface CaseReturnRow {
  readonly id: string;
  readonly opinionId: string;
  readonly reasonCode: string;
  readonly inheritedCode: string | null;
  readonly targetKey: string;
  readonly receiverId: string;
  readonly reflow: boolean;
  readonly n5: boolean;
  readonly entrySeqBefore: number | null;
  readonly entrySeqAfter: number | null;
  readonly exitCode: string | null;
  readonly actorId: string;
  readonly createdAt: Date;
}

export interface CaseStageSignatureRow {
  readonly id: string;
  readonly caseId: string;
  readonly instanceId: string;
  readonly actorId: string;
}

export interface StageInstanceWrite {
  readonly id: string;
  readonly caseId: string;
  readonly stage: string;
  readonly entrySeq: number;
  readonly status: string;
  readonly enteredAt: Date;
  readonly enteredBy: string;
  readonly transitionCode: string;
}

export interface TransitionHistoryWrite {
  readonly id: string;
  readonly caseId: string | null;
  readonly clueId: string | null;
  readonly transitionCode: string;
  readonly actorId: string;
  readonly fromJson: string;
  readonly toJson: string;
  readonly createdAt: Date;
}

/** 已有案件上推进环节指针。不改承办机构。乐观条件不符返回 false。 */
export interface CasePointerWrite {
  readonly caseId: string;
  readonly expectedStage: string;
  readonly expectedSeq: number;
  readonly stage: string;
  readonly stageEntrySeq: number;
  readonly status: string;
  readonly suspended: boolean;
}

export interface ApprovalChainWrite {
  readonly id: string;
  readonly caseId: string;
  readonly kind: string;
  readonly openedBy: string;
  readonly openedAt: Date;
}

/** 案件审批链的一行（#235 X18）。 */
export interface ApprovalChainRow {
  readonly id: string;
  readonly caseId: string;
  readonly kind: string;
}

/** 改派呈批结案（#279）：待批准 → 已退回或已撤回。 */
export interface ReassignmentSettlementWrite {
  readonly id: string;
  readonly caseId: string;
  readonly toStatus: 'returned' | 'withdrawn';
}

/** 链外退回把该链上的呈批打回拟制中（#279）：状态回 drafting、清空链，并追加 return 步骤。 */
export interface ProcedureChainReturnWrite {
  readonly chainId: string;
  readonly actorId: string;
  readonly opinion: string | null;
  readonly at: Date;
  readonly newId: () => string;
}

/** 人员层利害关系的一行（只追加）。 */
export interface PersonConflictEventRow {
  readonly id: string;
  readonly lineageId: string;
  readonly caseId: string;
  readonly personId: string;
  readonly source: string;
  readonly reason: string;
  readonly status: string;
  readonly seq: number;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface PersonConflictEventWrite {
  readonly id: string;
  readonly caseId: string;
  readonly personId: string;
  readonly lineageId: string;
  readonly source: string;
  readonly reason: string;
  readonly status: string;
  readonly seq: number;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/** 回避决定的一行（只追加）。 */
export interface PersonConflictDecisionRow {
  readonly id: string;
  readonly caseId: string;
  readonly lineageId: string;
  readonly deciderId: string;
  readonly conclusion: string;
  readonly reason: string;
  readonly decidedAt: Date;
  readonly createdAt: Date;
}

export interface PersonConflictDecisionWrite {
  readonly id: string;
  readonly caseId: string;
  readonly lineageId: string;
  readonly deciderId: string;
  readonly conclusion: string;
  readonly reason: string;
  readonly decidedAt: Date;
  /** 决定同时追加的下一条状态事件。 */
  readonly nextEvent: PersonConflictEventWrite;
}

/** 改派呈批的一行（#239）。发起即待批准，批准后同行为已批准。 */
export interface CaseReassignmentRow {
  readonly id: string;
  readonly caseId: string;
  /** pending_approval | approved */
  readonly status: string;
  /** transfer | leave | recusal | other */
  readonly reasonCode: string;
  readonly note: string;
  readonly conflictLineageId: string | null;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly approvalChainId: string | null;
  /** 提交时的原承办人员快照与拟任承办人员。 */
  readonly proposedJson: string;
}

export interface CaseReassignmentWrite {
  readonly id: string;
  readonly caseId: string;
  readonly reasonCode: string;
  readonly note: string;
  readonly conflictLineageId: string | null;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly approvalChainId: string;
  readonly proposedJson: string;
}

export interface CaseReassignmentApprovalWrite {
  readonly id: string;
  readonly caseId: string;
  readonly approvedBy: string;
  readonly approvedAt: Date;
}

/** 承办人员的一行。endedAt 非空表示已换下。 */
export interface HandlerStintRow {
  readonly id: string;
  readonly personnelId: string;
  readonly role: string;
  readonly assignedAt: Date;
  readonly endedAt: Date | null;
}

/** 关闭全部未结束的承办人员行，并追加新名单（同一事务）。 */
export interface HandlerReplacementWrite {
  readonly caseId: string;
  readonly endedAt: Date;
  readonly next: readonly { readonly id: string; readonly personnelId: string; readonly role: string }[];
}

/** 材料效力认定的一行（只追加）。 */
export interface MaterialEffectivenessRow {
  readonly id: string;
  readonly caseId: string;
  readonly materialId: string;
  readonly reassignmentId: string;
  readonly conclusion: string;
  readonly reason: string;
  readonly determinedBy: string;
  readonly determinedAt: Date;
}

export interface MaterialEffectivenessWrite {
  readonly id: string;
  readonly caseId: string;
  readonly materialId: string;
  readonly reassignmentId: string;
  readonly conclusion: string;
  readonly reason: string;
  readonly determinedBy: string;
  readonly determinedAt: Date;
}

/** 机关层利害关系勾选的一行（只追加，一案至多一行）。 */
export interface AgencyConflictMarkRow {
  readonly id: string;
  readonly caseId: string;
  readonly orgUnitId: string;
  readonly markedBy: string;
  readonly createdAt: Date;
}

/** 调查继续登记的一行（只追加）。 */
export interface InvestigationEntryWrite {
  readonly id: string;
  readonly caseId: string;
  readonly personnelId: string;
  readonly kind: string;
  readonly summary: string;
  readonly createdAt: Date;
}

export interface ApprovalOpinionWrite {
  readonly id: string;
  readonly caseId: string;
  readonly reasonCode: string;
  readonly note: string;
  readonly targetKey: string;
  readonly actorId: string;
  readonly createdAt: Date;
}

export interface CaseReturnWrite {
  readonly id: string;
  readonly caseId: string;
  readonly opinionId: string;
  readonly reasonCode: string;
  readonly inheritedCode: string | null;
  readonly targetKey: string;
  readonly receiverId: string;
  readonly reflow: boolean;
  readonly n5: boolean;
  readonly entrySeqBefore: number | null;
  readonly entrySeqAfter: number | null;
  readonly exitCode: string | null;
  readonly rehearingRequired: boolean;
  readonly revokeNotice: boolean;
  readonly actorId: string;
  readonly createdAt: Date;
}

export interface StageInvalidationWrite {
  readonly id: string;
  readonly caseId: string;
  readonly instanceId: string;
  readonly returnId: string;
  readonly createdAt: Date;
}

/** 调查报告呈批表头，带当前版本正文（#240）。 */
export interface ReviewReportRow {
  readonly id: string;
  readonly caseId: string;
  /** drafting | pending_review | pending_approval | approved */
  readonly status: string;
  readonly adminReview: string | null;
  readonly currentVersionNo: number;
  readonly drafterId: string;
  readonly approvalChainId: string | null;
  readonly contentJson: string | null;
}

export interface ReviewReportDraftWrite {
  readonly approvalId: string;
  readonly caseId: string;
  readonly drafterId: string;
  readonly isNew: boolean;
  readonly expectedVersionNo: number;
  readonly versionId: string;
  readonly contentJson: string;
  readonly at: Date;
}

export interface ReviewReportStepWrite {
  readonly reportId: string;
  readonly expectedStatus: string;
  readonly nextStatus: string;
  readonly adminReview?: string;
  /** undefined 不改；null 清空；字符串写入。 */
  readonly approvalChainId?: string | null;
  readonly stepId: string;
  readonly step: string;
  readonly versionNo: number;
  readonly actorId: string;
  readonly opinion: string | null;
  readonly at: Date;
}

/** 审理人指定的一行（#240）。supersededAt 非空表示已被更换。 */
export interface ReviewerDesignationRow {
  readonly id: string;
  readonly caseId: string;
  readonly entrySeq: number;
  readonly personnelId: string;
  readonly designatedBy: string;
  readonly reason: string | null;
  readonly replacesId: string | null;
  readonly designatedAt: Date;
  readonly supersededAt: Date | null;
}

export type ReviewerDesignationWrite = ReviewerDesignationRow;

/** 审理意见的一行（#240）。只追加。 */
export interface ReviewOpinionRow {
  readonly id: string;
  readonly caseId: string;
  readonly entrySeq: number;
  readonly opinionKind: string;
  readonly content: string;
  readonly signedBy: string;
  readonly designationId: string;
  readonly destinationCode: string;
  readonly outcomeCode: string | null;
  readonly outcomeLabel: string | null;
  readonly createdAt: Date;
}

export type ReviewOpinionWrite = ReviewOpinionRow;

/** 拟决定摘要冻结的一行（#240）。一条意见至多一行。 */
export interface FrozenDecisionRow {
  readonly id: string;
  readonly caseId: string;
  readonly opinionId: string;
  readonly summaryJson: string;
  readonly createdAt: Date;
}

export type FrozenDecisionWrite = FrozenDecisionRow;

/** 审理异议呈批的一行（T09a，#240）。 */
export interface ReviewObjectionRow {
  readonly id: string;
  readonly caseId: string;
  readonly entrySeq: number;
  readonly opinionId: string;
  readonly drafterId: string;
  /** drafting | pending_approval | decided */
  readonly status: string;
  readonly contentJson: string;
  readonly decision: string | null;
  readonly decisionTransition: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly approvalChainId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ReviewObjectionDraftWrite {
  readonly objectionId: string;
  readonly caseId: string;
  readonly entrySeq: number;
  readonly opinionId: string;
  readonly drafterId: string;
  readonly isNew: boolean;
  readonly contentJson: string;
  readonly at: Date;
}

export interface ReviewObjectionStepWrite {
  readonly objectionId: string;
  readonly expectedStatus: string;
  readonly nextStatus: string;
  readonly decision?: string | null;
  readonly decisionTransition?: string | null;
  readonly decidedBy?: string | null;
  readonly decidedAt?: Date | null;
  readonly approvalChainId?: string | null;
  readonly contentJson?: string;
  readonly at: Date;
}

/** 审理异议窗口的一行（#282 裁 B）。一条审理意见至多一窗。 */
export interface ReviewObjectionWindowRow {
  readonly id: string;
  readonly caseId: string;
  readonly entrySeq: number;
  readonly opinionId: string;
  /** open | closed */
  readonly status: string;
  readonly dueAt: Date;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  /** expired | waived | support-review | support-handler */
  readonly closeKind: string | null;
  readonly closedBy: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ReviewObjectionWindowWrite {
  readonly id: string;
  readonly caseId: string;
  readonly entrySeq: number;
  readonly opinionId: string;
  readonly dueAt: Date;
  readonly openedAt: Date;
  readonly at: Date;
}

export interface ReviewObjectionWindowCloseWrite {
  readonly id: string;
  readonly caseId: string;
  readonly closeKind: string;
  readonly closedBy: string | null;
  readonly at: Date;
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
  readonly suspended: boolean;
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
  /** 按主键读案件，含环节实例与迁移历史。没有为 null。 */
  readCaseView(caseId: string): Promise<CaseView | null>;
  /** 追加环节实例。同一案件、同一环节、同一次序号已存在时返回 false。 */
  appendStageInstance(write: StageInstanceWrite): Promise<boolean>;
  /** 追加迁移历史。 */
  appendTransition(write: TransitionHistoryWrite): Promise<void>;
  /** 推进已有案件的环节指针与主状态。条件不符返回 false，业务行不变。 */
  advanceCasePointer(write: CasePointerWrite): Promise<boolean>;
  /**
   * 本案进行中的审批链数：案件链 in_flight，加上来源线索上仍在途的立案呈批。
   * 调用方把正在收尾的那一条排除在外。
   */
  countInFlightApprovals(caseId: string): Promise<number>;
  /** 打开一条案件审批链。已有在途链时返回 false，不插入。 */
  openApprovalChain(write: ApprovalChainWrite): Promise<boolean>;
  /** 追加一条审批意见。 */
  appendApprovalOpinion(write: ApprovalOpinionWrite): Promise<void>;
  /** 追加一条退回记录。 */
  appendCaseReturn(write: CaseReturnWrite): Promise<void>;
  /** 追加一条环节失效。同一实例已失效时返回 false，不插入第二行。 */
  appendStageInvalidation(write: StageInvalidationWrite): Promise<boolean>;
  /** 本案已失效的环节实例主键。 */
  listInvalidatedInstanceIds(caseId: string): Promise<readonly string[]>;
  /** 按主键读签字。没有为 null。 */
  readStageSignature(signatureId: string): Promise<CaseStageSignatureRow | null>;
  /** 审批人待办：给定状态、线索当前承办机构在范围内的呈批。 */
  listFilingTodos(statuses: readonly string[], orgUnitIds: readonly string[]): Promise<readonly FilingTodoRow[]>;
  /** 本案人员层利害关系事件（只追加，时间升序）。personId 省略时返回全部。 */
  listPersonConflictEvents(caseId: string, personId?: string): Promise<readonly PersonConflictEventRow[]>;
  /** 本案回避决定（只追加，时间升序）。 */
  listPersonConflictDecisions(caseId: string): Promise<readonly PersonConflictDecisionRow[]>;
  /** 追加一条利害关系事件。 */
  appendPersonConflictEvent(write: PersonConflictEventWrite): Promise<void>;
  /**
   * 追加回避决定，并追加下一条状态事件。
   * 该声明链已有决定时返回 false，两行都不留。
   */
  appendPersonConflictDecision(write: PersonConflictDecisionWrite): Promise<boolean>;
  /** 追加一条调查登记（笔录或违法记录）。 */
  appendInvestigationEntry(write: InvestigationEntryWrite): Promise<void>;
  /** 本案改派呈批（时间升序）。 */
  listReassignments(caseId: string): Promise<readonly CaseReassignmentRow[]>;
  /** 按主键读改派呈批；没有为 null。 */
  readReassignment(reassignmentId: string): Promise<CaseReassignmentRow | null>;
  /** 追加一条改派呈批。本案已有待批准时返回 false，不插入。 */
  insertReassignment(write: CaseReassignmentWrite): Promise<boolean>;
  /** 把待批准改为已批准。不是待批准时返回 false。 */
  approveReassignment(write: CaseReassignmentApprovalWrite): Promise<boolean>;
  /** 本案全部承办人员行，含已结束（时间升序）。 */
  listHandlerStints(caseId: string): Promise<readonly HandlerStintRow[]>;
  /** 关闭全部未结束的承办人员行，并追加新名单。 */
  replaceHandlers(write: HandlerReplacementWrite): Promise<void>;
  /** 本案全部材料效力认定（时间升序）。 */
  listMaterialEffectiveness(caseId: string): Promise<readonly MaterialEffectivenessRow[]>;
  /** 追加一条材料效力认定。 */
  insertMaterialEffectiveness(write: MaterialEffectivenessWrite): Promise<void>;
  /** 本案机关层利害关系勾选。没有勾选时为空。 */
  listAgencyConflictMarks(caseId: string): Promise<readonly AgencyConflictMarkRow[]>;
  /**
   * 追加机关层勾选。本案已有一行时返回 false，不插入第二行。
   */
  appendAgencyConflictMark(write: AgencyConflictMarkRow): Promise<boolean>;
  /** 办结一条进行中的审批链。不是进行中则返回 false。 */
  closeApprovalChain(id: string): Promise<boolean>;
  /** 本案进行中的审批链（按打开时间升序）。 */
  listInFlightApprovalChains(caseId: string): Promise<readonly ApprovalChainRow[]>;
  /** 把待批准改派改为已退回或已撤回。不是待批准时返回 false。 */
  settleReassignment(write: ReassignmentSettlementWrite): Promise<boolean>;
  /**
   * 链外退回（#279）：该链上待审核／待审批的呈批打回拟制中，追加 return 步骤。
   * 覆盖调查收尾呈批与调查报告呈批（#240）。任一条状态不符返回 false；本方法不自开事务。
   */
  returnProcedureApprovalsByChain(write: ProcedureChainReturnWrite): Promise<boolean>;
  listViolationRecords(caseId: string): Promise<readonly ViolationRecordRow[]>;
  insertViolationRecord(write: ViolationRecordWrite): Promise<void>;
  /** 只把有效记录标成作废。不是有效或不属于本案时返回 false。 */
  voidViolationRecord(write: ViolationVoidWrite): Promise<boolean>;
  /** 本案新旧比对判定（只追加，时间升序）。 */
  listComparisonJudgments(caseId: string): Promise<readonly ComparisonJudgmentRow[]>;
  /** 追加一条新旧比对判定。只追加，不改旧行。 */
  insertComparisonJudgment(write: ComparisonJudgmentWrite): Promise<void>;
  listInquiryRecords(caseId: string): Promise<readonly InquiryRecordRow[]>;
  insertInquiryRecord(write: InquiryRecordWrite): Promise<void>;
  readOpenProcedure(caseId: string): Promise<ProcedureApprovalRow | null>;
  readProcedure(approvalId: string): Promise<ProcedureApprovalRow | null>;
  saveProcedureDraft(write: ProcedureDraftWrite): Promise<boolean>;
  applyProcedureStep(write: ProcedureStepWrite): Promise<boolean>;
  listDeadlineEvents(caseId: string): Promise<readonly DeadlineEventRow[]>;
  insertDeadlineEvent(write: DeadlineEventWrite): Promise<void>;
  listPartyNotices(caseId: string): Promise<readonly PartyNoticeRow[]>;
  insertPartyNotice(write: PartyNoticeWrite): Promise<void>;
  /** 本案期限行，按修订号升序。 */
  listDeadlineRows(caseId: string): Promise<readonly DeadlineRow[]>;
  /** 全部期限行。换日历时修订未届满的工作日期限。 */
  listAllDeadlineRows(): Promise<readonly DeadlineRow[]>;
  /** 四维加修订号已存在时返回 false，不插入。 */
  insertDeadlineRow(write: DeadlineRowWrite): Promise<boolean>;
  listPeriodEvents(caseId: string): Promise<readonly PeriodEventRow[]>;
  insertPeriodEvent(write: PeriodEventWrite): Promise<void>;
  readOpenDeadlineApproval(caseId: string): Promise<DeadlineApprovalRow | null>;
  readDeadlineApproval(approvalId: string): Promise<DeadlineApprovalRow | null>;
  saveDeadlineDraft(write: DeadlineDraftWrite): Promise<boolean>;
  applyDeadlineStep(write: DeadlineStepWrite): Promise<boolean>;
  /** 本案未批准的调查报告呈批（#240）；没有为 null。 */
  readOpenReviewReport(caseId: string): Promise<ReviewReportRow | null>;
  /** 本案最近一张已批准的调查报告呈批（#240）；没有为 null。 */
  readApprovedReviewReport(caseId: string): Promise<ReviewReportRow | null>;
  /** 按主键读调查报告呈批。 */
  readReviewReport(reportId: string): Promise<ReviewReportRow | null>;
  /** 保存报告拟制稿。同一条案件至多一张未批准呈批；版本号不符返回 false。 */
  saveReviewReportDraft(write: ReviewReportDraftWrite): Promise<boolean>;
  /** 推进报告呈批一步。状态不符返回 false。 */
  applyReviewReportStep(write: ReviewReportStepWrite): Promise<boolean>;
  /** 本案全部审理人指定（含已更换，时间升序）。 */
  listReviewerDesignations(caseId: string): Promise<readonly ReviewerDesignationRow[]>;
  /** 追加一条审理人指定。本案已有在任指定时返回 false。 */
  insertReviewerDesignation(write: ReviewerDesignationWrite): Promise<boolean>;
  /** 把在任指定置为已更换。不是在任指定时返回 false。 */
  supersedeReviewerDesignation(write: { readonly id: string; readonly caseId: string; readonly at: Date }): Promise<boolean>;
  /** 追加一条审理意见。 */
  insertReviewOpinion(write: ReviewOpinionWrite): Promise<void>;
  /** 本案全部审理意见（时间升序）。 */
  listReviewOpinions(caseId: string): Promise<readonly ReviewOpinionRow[]>;
  /** 冻结一条意见的拟决定摘要。该意见已冻结时返回 false。 */
  insertFrozenDecision(write: FrozenDecisionWrite): Promise<boolean>;
  /** 本案全部冻结摘要（时间升序）。 */
  listFrozenDecisions(caseId: string): Promise<readonly FrozenDecisionRow[]>;
  /** 本案未决定的审理异议呈批；没有为 null。 */
  readOpenReviewObjection(caseId: string): Promise<ReviewObjectionRow | null>;
  /** 按主键读审理异议呈批。 */
  readReviewObjection(objectionId: string): Promise<ReviewObjectionRow | null>;
  /** 保存异议呈批拟制稿。已提交或已决定时返回 false。 */
  saveReviewObjectionDraft(write: ReviewObjectionDraftWrite): Promise<boolean>;
  /** 推进异议呈批一步。状态不符返回 false。 */
  applyReviewObjectionStep(write: ReviewObjectionStepWrite): Promise<boolean>;
  /** 本案全部异议呈批（时间升序）。 */
  listReviewObjections(caseId: string): Promise<readonly ReviewObjectionRow[]>;
  /** 追加一条异议窗口。本案同一进入次序号已有未关闭窗口时返回 false。 */
  insertReviewObjectionWindow(write: ReviewObjectionWindowWrite): Promise<boolean>;
  /** 本案全部异议窗口（时间升序）。 */
  listReviewObjectionWindows(caseId: string): Promise<readonly ReviewObjectionWindowRow[]>;
  /** 某条审理意见未关闭的异议窗口；没有为 null。 */
  readOpenReviewObjectionWindow(opinionId: string): Promise<ReviewObjectionWindowRow | null>;
  /** 关闭异议窗口。窗口已关闭时返回 false。 */
  closeReviewObjectionWindow(write: ReviewObjectionWindowCloseWrite): Promise<boolean>;
  listCalendarInstalls(): Promise<readonly CalendarInstallRow[]>;
  insertCalendarInstall(write: CalendarInstallWrite): Promise<void>;
  /** 本案全部案件标记行（只追加，时间升序）。 */
  listCaseMarkers(caseId: string): Promise<readonly CaseMarkerRow[]>;
  /** 追加一条标记置位或清除。不清除旧行。 */
  appendCaseMarker(write: CaseMarkerWrite): Promise<void>;
}

/** 违法记录。作废只改状态和作废字段，不删行。 */
export interface ViolationRecordRow {
  readonly id: string;
  readonly behaviorDescription: string;
  readonly parties: readonly string[];
  readonly startedOn: Date;
  readonly endedOn: Date;
  readonly recognition: string;
  readonly status: string;
  readonly voidReason: string | null;
  readonly voidedAt: Date | null;
}

export interface ViolationRecordWrite {
  readonly id: string;
  readonly caseId: string;
  readonly behaviorDescription: string;
  readonly parties: readonly string[];
  readonly startedOn: Date;
  readonly endedOn: Date;
  readonly recognition: string;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface ViolationVoidWrite {
  readonly id: string;
  readonly caseId: string;
  readonly reason: string;
  readonly actorId: string;
  readonly at: Date;
}

/** 新旧比对判定（#271）。只追加。 */
export interface ComparisonJudgmentRow {
  readonly id: string;
  readonly caseId: string;
  readonly violationRecordId: string;
  readonly behaviorBases: readonly ComparisonBasis[];
  readonly decisionBases: readonly ComparisonBasis[];
  readonly behaviorBenchmarks: readonly ComparisonBenchmark[];
  readonly decisionBenchmarks: readonly ComparisonBenchmark[];
  readonly adoptedVersion: string;
  readonly reason: string;
  readonly noticeRef: string;
  readonly zeroDifference: boolean;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export type ComparisonJudgmentWrite = ComparisonJudgmentRow;

/** 调查取证笔录。只追加。 */
export interface InquiryRecordRow {
  readonly id: string;
  readonly occurredAt: Date;
  readonly place: string;
  readonly interviewee: string;
  readonly officerIds: readonly string[];
  readonly attachmentName: string;
  readonly createdAt: Date;
}

export interface InquiryRecordWrite {
  readonly id: string;
  readonly caseId: string;
  readonly occurredAt: Date;
  readonly place: string;
  readonly interviewee: string;
  readonly officerIds: readonly string[];
  readonly attachmentName: string;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/** 调查收尾呈批表头，带当前版本正文。 */
export interface ProcedureApprovalRow {
  readonly id: string;
  readonly caseId: string;
  readonly kind: string;
  readonly status: string;
  readonly adminReview: string | null;
  readonly currentVersionNo: number;
  readonly drafterId: string;
  readonly approvalChainId: string | null;
  readonly contentJson: string | null;
}

export interface ProcedureDraftWrite {
  readonly approvalId: string;
  readonly caseId: string;
  readonly kind: string;
  readonly drafterId: string;
  readonly isNew: boolean;
  readonly expectedVersionNo: number;
  readonly versionId: string;
  readonly contentJson: string;
  readonly at: Date;
}

export interface ProcedureStepWrite {
  readonly approvalId: string;
  readonly expectedStatus: string;
  readonly nextStatus: string;
  readonly adminReview?: string;
  /** undefined 不改；null 清空；字符串写入。 */
  readonly approvalChainId?: string | null;
  readonly stepId: string;
  readonly step: string;
  readonly versionNo: number;
  readonly actorId: string;
  readonly opinion: string | null;
  readonly at: Date;
}

export interface DeadlineEventRow {
  readonly id: string;
  readonly eventKind: string;
  readonly basisLabel: string;
  readonly basisNote: string;
  readonly stage: string;
  readonly entrySeq: number;
  readonly transitionCode: string;
  readonly createdAt: Date;
}

export interface DeadlineEventWrite {
  readonly id: string;
  readonly caseId: string;
  readonly eventKind: string;
  readonly basisLabel: string;
  readonly basisNote: string;
  readonly stage: string;
  readonly entrySeq: number;
  readonly transitionCode: string;
  readonly actorId: string;
  readonly createdAt: Date;
}

/** 期限行。日期是公历日文本。 */
export interface DeadlineRow {
  readonly id: string;
  readonly caseId: string;
  readonly ruleKey: string;
  readonly entrySeq: number;
  readonly procedureNode: string;
  readonly startingDocument: string | null;
  readonly consumption: string;
  readonly ruleVersion: string;
  readonly dayCount: number;
  readonly dayBasis: string;
  readonly partyFacing: boolean;
  readonly extensionAllowance: number | null;
  readonly startedOn: string;
  readonly dueOn: string | null;
  readonly needsManualConfirmation: boolean;
  readonly confirmationTrace: string | null;
  readonly rowStatus: string;
  readonly revisionNo: number;
  readonly calendarVersion: string;
  readonly clamped: boolean;
}

export type DeadlineRowWrite = DeadlineRow;

export interface PeriodEventRow {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
  readonly basisLabel: string;
  readonly basisNote: string;
  readonly reason: string | null;
  readonly startedOn: string | null;
  readonly endedOn: string | null;
  readonly extensionDays: number | null;
  readonly backfill: boolean;
  readonly status: string;
  readonly approvalId: string | null;
}

export interface PeriodEventWrite {
  readonly id: string;
  readonly caseId: string;
  readonly kind: string;
  readonly source: string;
  readonly basisLabel: string;
  readonly basisNote: string;
  readonly reason: string | null;
  readonly startedOn: string | null;
  readonly endedOn: string | null;
  readonly extensionDays: number | null;
  readonly backfill: boolean;
  readonly status: string;
  readonly approvalId: string | null;
  readonly actorId: string;
  readonly createdAt: Date;
}

export interface DeadlineApprovalRow {
  readonly id: string;
  readonly caseId: string;
  readonly kind: string;
  readonly status: string;
  readonly adminReview: string | null;
  readonly currentVersionNo: number;
  readonly drafterId: string;
  readonly approvalChainId: string | null;
  readonly contentJson: string | null;
}

export interface DeadlineDraftWrite {
  readonly approvalId: string;
  readonly caseId: string;
  readonly kind: string;
  readonly drafterId: string;
  readonly isNew: boolean;
  readonly expectedVersionNo: number;
  readonly versionId: string;
  readonly contentJson: string;
  readonly at: Date;
}

export interface DeadlineStepWrite {
  readonly approvalId: string;
  readonly expectedStatus: string;
  readonly nextStatus: string;
  readonly adminReview?: string;
  readonly approvalChainId?: string | null;
  readonly stepId: string;
  readonly step: string;
  readonly versionNo: number;
  readonly actorId: string;
  readonly opinion: string | null;
  readonly at: Date;
}

export interface CalendarInstallRow {
  readonly version: string;
  readonly year: number;
  readonly holidays: readonly string[];
  readonly makeupWorkdays: readonly string[];
  readonly sourceUrl: string;
}

export interface CalendarInstallWrite extends CalendarInstallRow {
  readonly id: string;
  readonly installedBy: string;
  readonly createdAt: Date;
}

export interface PartyNoticeRow {
  readonly id: string;
  readonly occasion: string;
  readonly note: string;
  readonly recordedAt: Date;
}

export interface PartyNoticeWrite {
  readonly id: string;
  readonly caseId: string;
  readonly occasion: string;
  readonly note: string;
  readonly recordedBy: string;
  readonly recordedAt: Date;
}

/** 案件标记的一行（#272 R-02）。只追加；当前状态取每键最后一行。 */
export interface CaseMarkerRow {
  readonly id: string;
  readonly caseId: string;
  readonly marker: string;
  /** set 置位 | cleared 清除 */
  readonly state: 'set' | 'cleared';
  readonly note: string | null;
  readonly actorId: string;
  readonly changedAt: Date;
  readonly createdAt: Date;
}

export type CaseMarkerWrite = {
  readonly id: string;
  readonly caseId: string;
  readonly marker: string;
  readonly state: 'set' | 'cleared';
  readonly note: string | null;
  readonly actorId: string;
  readonly changedAt: Date;
};
