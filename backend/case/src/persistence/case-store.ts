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
  /** 本案机关层利害关系勾选。没有勾选时为空。 */
  listAgencyConflictMarks(caseId: string): Promise<readonly AgencyConflictMarkRow[]>;
  /**
   * 追加机关层勾选。本案已有一行时返回 false，不插入第二行。
   */
  appendAgencyConflictMark(write: AgencyConflictMarkRow): Promise<boolean>;
  /** 办结一条进行中的审批链。不是进行中则返回 false。 */
  closeApprovalChain(id: string): Promise<boolean>;
  listViolationRecords(caseId: string): Promise<readonly ViolationRecordRow[]>;
  insertViolationRecord(write: ViolationRecordWrite): Promise<void>;
  /** 只把有效记录标成作废。不是有效或不属于本案时返回 false。 */
  voidViolationRecord(write: ViolationVoidWrite): Promise<boolean>;
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
  listCalendarInstalls(): Promise<readonly CalendarInstallRow[]>;
  insertCalendarInstall(write: CalendarInstallWrite): Promise<void>;
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
