// 用途：案件持久化端口，声明立案呈批、状态机、退回、审批链与各环节数据的读写契约。
// 调用方：backend/server 下的案件服务，例如 backend/server/src/case-state.service.ts 与 backend/server/src/case-filing.service.ts。
// 边界：端口是纯类型，不引 Prisma；实现见同目录 prisma-case-store.ts。调用方在交互式事务里调用，业务行与留痕同成同败。
// 依据：#234、#119。
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

// 案件材料的一行，body 为材料正文。
export interface CaseMaterialRow {
  readonly id: string;
  readonly kind: string;
  readonly body: string;
  readonly createdAt: Date;
}

// 案件审批意见的一行，含退回原因与退回点。
export interface CaseApprovalOpinionRow {
  readonly id: string;
  readonly reasonCode: string;
  readonly note: string;
  readonly targetKey: string;
  readonly actorId: string;
  readonly createdAt: Date;
}

// 案件退回记录的一行，含回流标记、N5 与进入次序号变化。
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

// 环节签字的一行，绑定案件、实例与签字人。
export interface CaseStageSignatureRow {
  readonly id: string;
  readonly caseId: string;
  readonly instanceId: string;
  readonly actorId: string;
}

// 追加环节实例的写入参数。
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

// 追加迁移历史的写入参数；案件与线索至少一边有值。
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

// 打开案件审批链的写入参数。
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

// 追加人员层利害关系事件的写入参数。
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

// 追加回避决定的写入参数，附带同时写入的下一条状态事件。
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

// 追加改派呈批的写入参数，含原承办人员快照。
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

// 批准改派呈批的写入参数。
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

// 追加材料效力认定的写入参数。
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

// 追加案件审批意见的写入参数。
export interface ApprovalOpinionWrite {
  readonly id: string;
  readonly caseId: string;
  readonly reasonCode: string;
  readonly note: string;
  readonly targetKey: string;
  readonly actorId: string;
  readonly createdAt: Date;
}

// 追加案件退回记录的写入参数，含是否重审与是否撤销告知。
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

// 追加环节失效记录的写入参数，指向退回记录。
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

// 保存调查报告呈批拟制稿的写入参数。
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

// 推进调查报告呈批一步的写入参数；approvalChainId 省略时不改。
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

// 追加审理人指定的写入参数，字段与行同形。
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

// 追加审理意见的写入参数，字段与行同形。
export type ReviewOpinionWrite = ReviewOpinionRow;

/** 拟决定摘要冻结的一行（#240）。一条意见至多一行。 */
export interface FrozenDecisionRow {
  readonly id: string;
  readonly caseId: string;
  readonly opinionId: string;
  readonly summaryJson: string;
  readonly createdAt: Date;
}

// 冻结拟决定摘要的写入参数，字段与行同形。
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

// 保存审理异议拟制稿的写入参数。
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

// 推进审理异议呈批一步的写入参数；可选项省略时不改对应字段。
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

// 追加审理异议窗口的写入参数。
export interface ReviewObjectionWindowWrite {
  readonly id: string;
  readonly caseId: string;
  readonly entrySeq: number;
  readonly opinionId: string;
  readonly dueAt: Date;
  readonly openedAt: Date;
  readonly at: Date;
}

// 关闭审理异议窗口的写入参数。
export interface ReviewObjectionWindowCloseWrite {
  readonly id: string;
  readonly caseId: string;
  readonly closeKind: string;
  readonly closedBy: string | null;
  readonly at: Date;
}

/** 法审轮次（#269）。一案同一轮次号至多一行。 */
export interface LegalReviewRow {
  readonly id: string;
  readonly caseId: string;
  readonly roundNo: number;
  /** pre-notice 告知前 | pre-decision 决定前 */
  readonly phase: string;
  /** drafting | pending_head | concluded */
  readonly status: string;
  readonly receiverId: string;
  readonly designatedBy: string;
  readonly determinationJson: string;
  readonly latestOpinionId: string | null;
  /** pass | fail；未定稿为 null */
  readonly conclusion: string | null;
  readonly headId: string | null;
  readonly headSignedAt: Date | null;
  readonly concludedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// 追加法审轮次的写入参数，字段与行同形。
export type LegalReviewWrite = LegalReviewRow;

/** 法审轮次表头的条件推进（#269）。 */
export interface LegalReviewHeaderWrite {
  readonly legalReviewId: string;
  readonly expectedStatuses: readonly string[];
  readonly status: string;
  readonly latestOpinionId?: string | null;
  readonly conclusion?: string | null;
  readonly headId?: string | null;
  readonly headSignedAt?: Date | null;
  readonly concludedAt?: Date | null;
  readonly at: Date;
}

/** 法审接收人改派（#269 G5）。不是已定稿时生效。 */
export interface LegalReviewReceiverWrite {
  readonly legalReviewId: string;
  readonly receiverId: string;
  readonly at: Date;
}

/** 法审意见（#269）。只追加；负责人签出只更新 head 字段。 */
export interface LegalReviewOpinionRow {
  readonly id: string;
  readonly legalReviewId: string;
  readonly caseId: string;
  readonly roundNo: number;
  /** pass | fail */
  readonly conclusion: string;
  /** accept-revise | collective-discussion；通过为 null */
  readonly failRoute: string | null;
  readonly content: string;
  readonly signedBy: string;
  readonly signedAt: Date;
  readonly frozenDecisionId: string | null;
  readonly discussionRecordId: string | null;
  readonly headId: string | null;
  readonly headSignedAt: Date | null;
  readonly headOpinion: string | null;
  readonly createdAt: Date;
}

// 追加法审意见的写入参数；负责人签出字段与创建时间由写入方法补齐。
export type LegalReviewOpinionWrite = Omit<LegalReviewOpinionRow, 'headId' | 'headSignedAt' | 'headOpinion' | 'createdAt'>;

/** 负责人签出（#269）。未签出时生效。 */
export interface LegalReviewOpinionSignWrite {
  readonly opinionId: string;
  readonly headId: string;
  readonly headSignedAt: Date;
  readonly headOpinion: string | null;
}

/** 集体讨论触发勾选（#269）。只追加。 */
export interface DiscussionMarkRow {
  readonly id: string;
  readonly caseId: string;
  readonly criteriaJson: string;
  readonly reason: string;
  readonly markedBy: string;
  readonly createdAt: Date;
}

// 追加集体讨论触发勾选的写入参数，字段与行同形。
export type DiscussionMarkWrite = DiscussionMarkRow;

/** 集体讨论记录（#269）。只追加。 */
export interface DiscussionRecordRow {
  readonly id: string;
  readonly caseId: string;
  readonly purposesJson: string;
  readonly criteriaJson: string;
  readonly note: string;
  readonly recordedBy: string;
  readonly recordedAt: Date;
  readonly createdAt: Date;
}

// 追加集体讨论记录的写入参数，字段与行同形。
export type DiscussionRecordWrite = DiscussionRecordRow;

/** 移送呈批表头，带当前版本正文（#242）。 */
export interface TransferApprovalRow {
  readonly id: string;
  readonly caseId: string;
  readonly kind: string;
  readonly status: string;
  readonly currentVersionNo: number;
  readonly drafterId: string;
  readonly approvalChainId: string | null;
  readonly contentJson: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** 保存移送呈批拟制稿（#242）。 */
export interface TransferApprovalDraftWrite {
  readonly approvalId: string;
  readonly caseId: string;
  readonly kind: string;
  readonly drafterId: string;
  /** true＝新建表头；false＝在既有拟制中的表头上追加版本。 */
  readonly isNew: boolean;
  readonly expectedVersionNo: number;
  readonly versionId: string;
  readonly contentJson: string;
  readonly at: Date;
}

/** 推进移送呈批一步（#242）。状态不符返回 false。 */
export interface TransferApprovalStepWrite {
  readonly approvalId: string;
  readonly expectedStatus: string;
  readonly nextStatus: string;
  /** undefined 不改；null 清空；字符串写入。 */
  readonly approvalChainId?: string | null;
  readonly stepId: string;
  readonly step: string;
  readonly versionNo: number;
  readonly actorId: string;
  readonly opinion: string | null;
  readonly at: Date;
}

/** 移送记载（#242）。只追加。 */
export interface TransferRow {
  readonly id: string;
  readonly caseId: string;
  readonly kind: string;
  readonly receivingOrg: string;
  readonly documentNo: string;
  readonly letterDate: string;
  readonly reason: string;
  readonly approvalId: string;
  readonly recordedBy: string;
  readonly recordedAt: Date;
}

// 追加移送记载的写入参数，字段与行同形。
export type TransferWrite = TransferRow;

/** 移送附件与回证（#242）。只追加。 */
export interface TransferFileRow {
  readonly id: string;
  readonly caseId: string;
  readonly approvalId: string | null;
  readonly transferId: string | null;
  readonly kind: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly uploadedBy: string;
  readonly uploadedAt: Date;
}

// 追加移送附件的写入参数，在行基础上补文件键、版本与摘要。
export interface TransferFileWrite extends TransferFileRow {
  readonly fileKey: string;
  readonly versionId: string;
  readonly digest: string;
}

/** 公安、检察决定记载（#242 T30）。只追加。 */
export interface CriminalDecisionRow {
  readonly id: string;
  readonly caseId: string;
  readonly source: string;
  readonly notifiedOn: string;
  readonly reason: string;
  readonly caseReturned: boolean;
  readonly returnedListJson: string;
  readonly reviewJson: string;
  readonly partyNoticeJson: string;
  readonly recordedBy: string;
  readonly recordedAt: Date;
}

// 追加外部决定记载的写入参数，字段与行同形。
export type CriminalDecisionWrite = CriminalDecisionRow;

/** 人工出口（#242 T30）。表头随提交、批准推进。 */
export interface CriminalOutletRow {
  readonly id: string;
  readonly caseId: string;
  readonly decisionId: string;
  readonly outlet: string;
  readonly status: string;
  readonly contentJson: string;
  readonly drafterId: string;
  readonly approvalChainId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// 追加人工出口拟制稿的写入参数。
export interface CriminalOutletWrite {
  readonly id: string;
  readonly caseId: string;
  readonly decisionId: string;
  readonly outlet: string;
  readonly contentJson: string;
  readonly drafterId: string;
  readonly at: Date;
}

// 推进人工出口一步的写入参数。
export interface CriminalOutletStepWrite {
  readonly outletId: string;
  readonly expectedStatus: string;
  readonly nextStatus: string;
  readonly approvalChainId?: string | null;
  readonly stepId: string;
  readonly step: string;
  readonly actorId: string;
  readonly opinion: string | null;
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

/**
 * 案件存储端口：立案呈批、状态机、退回、审批链与各环节的读写契约。
 * 实现见 prisma-case-store.ts；CASE_STORE 令牌注入。
 * 事务语义：调用方在交互式事务内调用，业务行与留痕同成同败。
 * 返回 false 表示条件写入未命中（状态或版本已变），调用方据此回滚或重读；本端口不自开事务。
 */
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
  /** 本案全部法审轮次（轮次号升序）。 */
  listLegalReviews(caseId: string): Promise<readonly LegalReviewRow[]>;
  /** 按主键读法审轮次。 */
  readLegalReview(legalReviewId: string): Promise<LegalReviewRow | null>;
  /** 追加一轮法审。同案同轮次号已存在时返回 false。 */
  insertLegalReview(write: LegalReviewWrite): Promise<boolean>;
  /** 推进法审表头。状态不符返回 false。 */
  applyLegalReviewHeader(write: LegalReviewHeaderWrite): Promise<boolean>;
  /** 改派法审接收人。已定稿时返回 false。 */
  replaceLegalReviewReceiver(write: LegalReviewReceiverWrite): Promise<boolean>;
  /** 追加一条法审意见。 */
  insertLegalReviewOpinion(write: LegalReviewOpinionWrite): Promise<void>;
  /** 本案全部法审意见（签出时间升序）。 */
  listLegalReviewOpinions(caseId: string): Promise<readonly LegalReviewOpinionRow[]>;
  /** 按主键读法审意见。 */
  readLegalReviewOpinion(opinionId: string): Promise<LegalReviewOpinionRow | null>;
  /** 负责人签出。该意见已签出时返回 false。 */
  signLegalReviewOpinion(write: LegalReviewOpinionSignWrite): Promise<boolean>;
  /** 本案集体讨论触发勾选（时间升序）。 */
  listDiscussionMarks(caseId: string): Promise<readonly DiscussionMarkRow[]>;
  /** 追加一条集体讨论触发勾选。 */
  insertDiscussionMark(write: DiscussionMarkWrite): Promise<void>;
  /** 本案集体讨论记录（时间升序）。 */
  listDiscussionRecords(caseId: string): Promise<readonly DiscussionRecordRow[]>;
  /** 追加一条集体讨论记录。 */
  insertDiscussionRecord(write: DiscussionRecordWrite): Promise<void>;
  /** 按 E05 进入次序号读告知。没有为 null。 */
  readNotice(caseId: string, entrySeq: number): Promise<NoticeRow | null>;
  /** 按主键读告知。 */
  readNoticeById(noticeId: string): Promise<NoticeRow | null>;
  /** 本案未送达的告知（status 不是 served 或 revoked，按进入次序号降序）。没有为 null。 */
  readOpenNotice(caseId: string): Promise<NoticeRow | null>;
  /** 本案全部告知（进入次序号升序）。 */
  listNotices(caseId: string): Promise<readonly NoticeRow[]>;
  /** 保存告知拟制稿。同案同次序号已有告知或版本号不符返回 false。 */
  saveNoticeDraft(write: NoticeDraftWrite): Promise<boolean>;
  /** 推进告知呈批一步。状态不符返回 false。 */
  applyNoticeStep(write: NoticeStepWrite): Promise<boolean>;
  /** 已批准的告知置为已送达。不是已批准时返回 false。 */
  markNoticeServed(write: NoticeServedWrite): Promise<boolean>;
  /** 本案当事人提交（只追加，时间升序）。 */
  listPartySubmissions(caseId: string): Promise<readonly PartySubmissionRow[]>;
  /** 追加一条当事人提交。 */
  insertPartySubmission(write: PartySubmissionWrite): Promise<void>;
  /** 本案全部听证（进入次序号升序）。 */
  listHearings(caseId: string): Promise<readonly HearingRow[]>;
  /** 按主键读听证。没有为 null。 */
  readHearing(hearingId: string): Promise<HearingRow | null>;
  /** 本案未结束的听证。没有为 null。 */
  readOpenHearing(caseId: string): Promise<HearingRow | null>;
  /** 追加一条听证。同案同次序号已有听证或已有未结束听证时返回 false。 */
  insertHearing(write: HearingWrite): Promise<boolean>;
  /** 推进听证状态。状态不符返回 false。 */
  applyHearingStep(write: HearingStepWrite): Promise<boolean>;
  /** 撤销已送达的告知（#248）：served → revoked，并追加 revoke 步骤。其他状态返回 false。 */
  revokeNotice(write: NoticeRevokeWrite): Promise<boolean>;
  /** 写入告知有效性基线（#248）。该告知已有基线时返回 false。 */
  insertNoticeValidityBaseline(write: NoticeValidityBaselineWrite): Promise<boolean>;
  /** 按告知读有效性基线。没有为 null。 */
  readNoticeValidityBaseline(noticeId: string): Promise<NoticeValidityBaselineRow | null>;
  /** 本案全部有效性基线（按送达先后升序）。 */
  listNoticeValidityBaselines(caseId: string): Promise<readonly NoticeValidityBaselineRow[]>;
  /** 追加一条有效性确认。只追加。 */
  insertValidityConfirmation(write: ValidityConfirmationWrite): Promise<void>;
  /** 本案全部有效性确认（按确认时间升序）。 */
  listValidityConfirmations(caseId: string): Promise<readonly ValidityConfirmationRow[]>;
  /** 按主键读有效性确认。没有为 null。 */
  readValidityConfirmation(confirmationId: string): Promise<ValidityConfirmationRow | null>;
  /** 追加一条有效性复核。只追加。 */
  insertValidityReview(write: ValidityReviewWrite): Promise<void>;
  /** 本案全部有效性复核（按复核时间升序）。 */
  listValidityReviews(caseId: string): Promise<readonly ValidityReviewRow[]>;
  /** 本案全部移送呈批，带当前版本正文（时间升序）。 */
  listTransferApprovals(caseId: string): Promise<readonly TransferApprovalRow[]>;
  /** 按主键读移送呈批。没有为 null。 */
  readTransferApproval(approvalId: string): Promise<TransferApprovalRow | null>;
  /** 保存移送呈批拟制稿。表头不在拟制中或版本号不符返回 false。 */
  saveTransferDraft(write: TransferApprovalDraftWrite): Promise<boolean>;
  /** 推进移送呈批一步。状态不符返回 false。 */
  applyTransferStep(write: TransferApprovalStepWrite): Promise<boolean>;
  /** 本案全部移送记载（时间升序）。 */
  listTransfers(caseId: string): Promise<readonly TransferRow[]>;
  /** 追加一条移送记载。同一呈批已有记载时返回 false。 */
  insertTransfer(write: TransferWrite): Promise<boolean>;
  /** 本案全部移送附件与回证（时间升序）。 */
  listTransferFiles(caseId: string): Promise<readonly TransferFileRow[]>;
  /** 追加一条移送附件或回证。 */
  insertTransferFile(write: TransferFileWrite): Promise<void>;
  /** 本案全部外部决定记载（时间升序）。 */
  listCriminalDecisions(caseId: string): Promise<readonly CriminalDecisionRow[]>;
  /** 追加一条外部决定记载。只追加。 */
  insertCriminalDecision(write: CriminalDecisionWrite): Promise<void>;
  /** 本案全部人工出口（时间升序）。 */
  listCriminalOutlets(caseId: string): Promise<readonly CriminalOutletRow[]>;
  /** 按主键读人工出口。没有为 null。 */
  readCriminalOutlet(outletId: string): Promise<CriminalOutletRow | null>;
  /** 追加一条人工出口拟制稿。 */
  insertCriminalOutlet(write: CriminalOutletWrite): Promise<void>;
  /** 推进人工出口一步。状态不符返回 false。 */
  applyCriminalOutletStep(write: CriminalOutletStepWrite): Promise<boolean>;
  /** 本案全部卷宗材料入卷登记（时间升序，只追加）。 */
  listDossierMaterials(caseId: string): Promise<readonly DossierMaterialRow[]>;
  /** 追加一条卷宗材料入卷登记。 */
  insertDossierMaterial(write: DossierMaterialWrite): Promise<void>;
  /** 本案未批准的归档呈批；没有为 null。 */
  readOpenFinalizeApproval(caseId: string): Promise<FinalizeApprovalRow | null>;
  /** 按主键读归档呈批。 */
  readFinalizeApproval(approvalId: string): Promise<FinalizeApprovalRow | null>;
  /** 保存归档呈批拟制稿。状态或版本号不符返回 false。 */
  saveFinalizeDraft(write: FinalizeApprovalDraftWrite): Promise<boolean>;
  /** 推进归档呈批一步。状态不符返回 false。 */
  applyFinalizeStep(write: FinalizeApprovalStepWrite): Promise<boolean>;
  /** 本案全部定型记录（代次升序）。 */
  listFinalizes(caseId: string): Promise<readonly FinalizeRecordRow[]>;
  /** 追加一条定型记录。同一呈批或同一代次已存在时返回 false。 */
  insertFinalize(write: FinalizeRecordWrite): Promise<boolean>;
  /** 本案未批准的决定呈批；没有为 null。 */
  readOpenDecisionApproval(caseId: string): Promise<DecisionApprovalRow | null>;
  /** 按主键读决定呈批。 */
  readDecisionApproval(approvalId: string): Promise<DecisionApprovalRow | null>;
  /** 本案最近一张已批准的决定呈批；没有为 null。 */
  readApprovedDecisionApproval(caseId: string): Promise<DecisionApprovalRow | null>;
  /** 保存决定呈批拟制稿。状态或版本号不符返回 false。 */
  saveDecisionDraft(write: DecisionApprovalDraftWrite): Promise<boolean>;
  /** 推进决定呈批一步。状态不符返回 false。 */
  applyDecisionStep(write: DecisionApprovalStepWrite): Promise<boolean>;
  /** 本案全部送达记载（时间升序）。 */
  listDeliveries(caseId: string): Promise<readonly DeliveryRow[]>;
  /** 追加一条送达记载。 */
  insertDelivery(write: DeliveryWrite): Promise<void>;
  /** 本案全部执行记载（时间升序）。 */
  listExecutionRecords(caseId: string): Promise<readonly ExecutionRecordRow[]>;
  /** 追加一条执行记载。 */
  insertExecutionRecord(write: ExecutionRecordWrite): Promise<void>;
  /** 本案未批准的结案呈批；没有为 null。 */
  readOpenClosureApproval(caseId: string): Promise<ClosureApprovalRow | null>;
  /** 按主键读结案呈批。 */
  readClosureApproval(approvalId: string): Promise<ClosureApprovalRow | null>;
  /** 保存结案呈批拟制稿。状态或版本号不符返回 false。 */
  saveClosureDraft(write: ClosureApprovalDraftWrite): Promise<boolean>;
  /** 推进结案呈批一步。状态不符返回 false。 */
  applyClosureStep(write: ClosureApprovalStepWrite): Promise<boolean>;
  /** 本案结案记录；没有为 null。 */
  readClosure(caseId: string): Promise<ClosureRecordRow | null>;
  /** 追加一条结案记录。同一呈批已存在时返回 false。 */
  insertClosure(write: ClosureRecordWrite): Promise<boolean>;
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

// 追加违法记录的写入参数，创建人与创建时间由调用方给出。
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

// 作废违法记录的写入参数。
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

// 追加新旧比对判定的写入参数，字段与行同形。
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

// 追加调查取证笔录的写入参数。
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

// 保存调查收尾呈批拟制稿的写入参数。
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

// 推进调查收尾呈批一步的写入参数；可选项省略时不改对应字段。
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

// 期限触发事件的一行，记录依据与所属环节。
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

// 追加期限触发事件的写入参数。
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

// 写入期限行的参数，字段与行同形。
export type DeadlineRowWrite = DeadlineRow;

// 期间事件的一行，记录中止、延期等起止与依据。
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

// 追加期间事件的写入参数。
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

// 期限事项呈批表头，带当前版本正文。
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

// 保存期限事项呈批拟制稿的写入参数。
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

// 推进期限事项呈批一步的写入参数。
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

// 日历安装记录的一行：版本、年度与节假日安排。
export interface CalendarInstallRow {
  readonly version: string;
  readonly year: number;
  readonly holidays: readonly string[];
  readonly makeupWorkdays: readonly string[];
  readonly sourceUrl: string;
}

// 安装日历的写入参数，在行基础上补主键、安装人与安装时间。
export interface CalendarInstallWrite extends CalendarInstallRow {
  readonly id: string;
  readonly installedBy: string;
  readonly createdAt: Date;
}

// 期限当事人告知记载的一行，用于期限扣除或顺延。
export interface PartyNoticeRow {
  readonly id: string;
  readonly occasion: string;
  readonly note: string;
  readonly recordedAt: Date;
}

// 追加期限当事人告知的写入参数。
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

// 追加案件标记的写入参数，字段与行同形。
export type CaseMarkerWrite = {
  readonly id: string;
  readonly caseId: string;
  readonly marker: string;
  readonly state: 'set' | 'cleared';
  readonly note: string | null;
  readonly actorId: string;
  readonly changedAt: Date;
};

/** 告知书表头（#272）。servedOn 是北京日期的公历日文本。 */
export interface NoticeRow {
  readonly id: string;
  readonly caseId: string;
  readonly entrySeq: number;
  readonly kind: string;
  readonly status: string;
  readonly adminReview: string | null;
  readonly currentVersionNo: number;
  readonly drafterId: string;
  readonly approvalChainId: string | null;
  readonly contentJson: string;
  readonly servedBy: string | null;
  readonly servedAt: Date | null;
  readonly servedOn: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// 保存告知拟制稿的写入参数。
export interface NoticeDraftWrite {
  readonly noticeId: string;
  readonly caseId: string;
  readonly entrySeq: number;
  readonly kind: string;
  readonly drafterId: string;
  readonly isNew: boolean;
  readonly expectedVersionNo: number;
  readonly versionId: string;
  readonly contentJson: string;
  readonly at: Date;
}

// 推进告知呈批一步的写入参数。
export interface NoticeStepWrite {
  readonly noticeId: string;
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

// 告知送达的写入参数：送达人、时刻与北京日期。
export interface NoticeServedWrite {
  readonly noticeId: string;
  readonly servedBy: string;
  readonly servedAt: Date;
  readonly servedOn: string;
}

/** 当事人陈述申辩或书面放弃（#272，只追加）。 */
export interface PartySubmissionRow {
  readonly id: string;
  readonly caseId: string;
  readonly noticeId: string;
  readonly kind: string;
  readonly note: string;
  readonly recordedBy: string;
  readonly recordedAt: Date;
}

// 追加当事人提交的写入参数，字段与行同形。
export type PartySubmissionWrite = PartySubmissionRow;

/** 听证（#272）。 */
export interface HearingRow {
  readonly id: string;
  readonly caseId: string;
  readonly noticeId: string;
  readonly entrySeq: number;
  readonly status: string;
  readonly hostPersonnelId: string | null;
  readonly appliedAt: Date;
  readonly acceptedAt: Date | null;
  readonly scheduledAt: Date | null;
  readonly scheduledFor: Date | null;
  readonly endedAt: Date | null;
  readonly endKind: string | null;
  readonly note: string | null;
  readonly recordedBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// 追加听证的写入参数，状态只允许登记的四态。
export interface HearingWrite {
  readonly id: string;
  readonly caseId: string;
  readonly noticeId: string;
  readonly entrySeq: number;
  /** applied | accepted | scheduled | ended */
  readonly status: string;
  readonly hostPersonnelId: string | null;
  readonly appliedAt: Date;
  readonly acceptedAt: Date | null;
  readonly scheduledAt: Date | null;
  readonly scheduledFor: Date | null;
  readonly endedAt: Date | null;
  readonly endKind: string | null;
  readonly note: string | null;
  readonly recordedBy: string;
}

// 推进听证状态的写入参数；可选项省略时不改对应字段。
export interface HearingStepWrite {
  readonly hearingId: string;
  readonly expectedStatuses: readonly string[];
  /** accepted | scheduled | ended */
  readonly nextStatus: string;
  readonly hostPersonnelId?: string | null;
  readonly acceptedAt?: Date | null;
  readonly scheduledAt?: Date | null;
  readonly scheduledFor?: Date | null;
  readonly endedAt?: Date | null;
  readonly endKind?: string | null;
  readonly note?: string | null;
  readonly at: Date;
}

/** 撤销告知（#248）。只允许 served → revoked。 */
// 撤销告知的写入参数，附带审批步骤与版本号。
export interface NoticeRevokeWrite {
  readonly noticeId: string;
  readonly stepId: string;
  readonly versionNo: number;
  readonly actorId: string;
  readonly opinion: string | null;
  readonly at: Date;
}

/** 告知有效性基线（#248）。summaryJson 是送达时冻结的拟决定摘要。 */
export interface NoticeValidityBaselineRow {
  readonly id: string;
  readonly caseId: string;
  readonly noticeId: string;
  readonly entrySeq: number;
  readonly kind: string;
  readonly partyType: string;
  readonly hearingNoticeAttached: boolean;
  readonly confiscationValue: number | null;
  readonly summaryJson: string;
  readonly summaryDigest: string;
  readonly capturedBy: string;
  readonly capturedAt: Date;
  readonly createdAt: Date;
}

// 写入告知有效性基线的参数；创建时间由存储补齐。
export type NoticeValidityBaselineWrite = Omit<NoticeValidityBaselineRow, 'createdAt'>;

/** 有效性确认（#248）。只追加。 */
export interface ValidityConfirmationRow {
  readonly id: string;
  readonly caseId: string;
  readonly noticeId: string;
  readonly decisionDigest: string;
  readonly systemHitsJson: string;
  readonly differencesJson: string;
  /** valid | invalid */
  readonly conclusion: string;
  readonly reason: string;
  readonly reasonChanged: boolean;
  /** reflow-new-evidence | r4-qualification-correction */
  readonly aggravationSource: string | null;
  readonly aggravationReference: string | null;
  readonly aggravationReason: string | null;
  readonly confirmedBy: string;
  readonly confirmedAt: Date;
  readonly createdAt: Date;
}

// 追加有效性确认的写入参数；创建时间由存储补齐。
export type ValidityConfirmationWrite = Omit<ValidityConfirmationRow, 'createdAt'>;

/** 有效性确认复核（#248）。只追加。 */
export interface ValidityReviewRow {
  readonly id: string;
  readonly caseId: string;
  readonly confirmationId: string;
  /** pass | fail */
  readonly conclusion: string;
  readonly opinion: string | null;
  readonly reviewedBy: string;
  readonly reviewedAt: Date;
  readonly createdAt: Date;
}

// 追加有效性复核的写入参数；创建时间由存储补齐。
export type ValidityReviewWrite = Omit<ValidityReviewRow, 'createdAt'>;

/** 卷宗材料入卷登记的一行（#243）。只追加。 */
export interface DossierMaterialRow {
  readonly id: string;
  readonly caseId: string;
  readonly itemCode: number;
  readonly title: string;
  readonly note: string | null;
  readonly stage: string | null;
  readonly entrySeq: number | null;
  readonly evidenceJson: string | null;
  readonly recordedBy: string;
  readonly recordedAt: Date;
}

// 追加卷宗材料入卷登记的写入参数，字段与行同形。
export type DossierMaterialWrite = DossierMaterialRow;

/** 归档呈批表头，带当前版本正文（#243）。 */
export interface FinalizeApprovalRow {
  readonly id: string;
  readonly caseId: string;
  /** drafting | pending_review | pending_approval | approved */
  readonly status: string;
  readonly currentVersionNo: number;
  readonly drafterId: string;
  readonly approvalChainId: string | null;
  readonly contentJson: string | null;
}

// 保存归档呈批拟制稿的写入参数。
export interface FinalizeApprovalDraftWrite {
  readonly approvalId: string;
  readonly caseId: string;
  readonly drafterId: string;
  /** true＝新建表头；false＝在既有拟制中的表头上追加版本。 */
  readonly isNew: boolean;
  readonly expectedVersionNo: number;
  readonly versionId: string;
  readonly contentJson: string;
  readonly at: Date;
}

// 推进归档呈批一步的写入参数。
export interface FinalizeApprovalStepWrite {
  readonly approvalId: string;
  readonly expectedStatus: string;
  readonly nextStatus: string;
  /** undefined 不改；null 清空；字符串写入。 */
  readonly approvalChainId?: string | null;
  readonly stepId: string;
  readonly step: string;
  readonly versionNo: number;
  readonly actorId: string;
  readonly opinion: string | null;
  readonly at: Date;
}

/** 定型记录的一行（#243）。每个归档代次一行，只追加。 */
export interface FinalizeRecordRow {
  readonly id: string;
  readonly caseId: string;
  readonly approvalId: string;
  readonly generationNo: number;
  /** complete | approved-missing */
  readonly conclusion: string;
  readonly checklistJson: string;
  readonly missingReason: string | null;
  readonly receiptDeficient: boolean;
  readonly materialsRuleId: string;
  readonly materialsRuleVersion: string;
  readonly exemptionsRuleId: string;
  readonly exemptionsRuleVersion: string;
  readonly finalizedBy: string;
  readonly finalizedAt: Date;
}

// 追加定型记录的写入参数，字段与行同形。
export type FinalizeRecordWrite = FinalizeRecordRow;

/** 决定呈批表头，带当前版本正文（#270）。 */
export interface DecisionApprovalRow {
  readonly id: string;
  readonly caseId: string;
  /** drafting | pending_review | pending_approval | approved */
  readonly status: string;
  readonly currentVersionNo: number;
  readonly drafterId: string;
  readonly approvalChainId: string | null;
  readonly contentJson: string | null;
}

// 保存决定呈批拟制稿的写入参数。
export interface DecisionApprovalDraftWrite {
  readonly approvalId: string;
  readonly caseId: string;
  readonly drafterId: string;
  readonly isNew: boolean;
  readonly expectedVersionNo: number;
  readonly versionId: string;
  readonly contentJson: string;
  readonly at: Date;
}

// 推进决定呈批一步的写入参数。
export interface DecisionApprovalStepWrite {
  readonly approvalId: string;
  readonly expectedStatus: string;
  readonly nextStatus: string;
  readonly approvalChainId?: string | null;
  readonly stepId: string;
  /** submit | review | approve */
  readonly step: string;
  readonly versionNo: number;
  readonly actorId: string;
  readonly opinion: string | null;
  readonly at: Date;
}

/** 送达记载（T24， #270）。只追加。 */
export interface DeliveryRow {
  readonly id: string;
  readonly caseId: string;
  /** receipt | announcement */
  readonly kind: string;
  /** penalty-decision | no-penalty-decision | order-correction-notice */
  readonly documentKind: string | null;
  readonly deliveredOn: string;
  readonly deliverers: readonly string[];
  readonly reasonRecord: string | null;
  readonly announcementMaterials: readonly string[];
  readonly note: string | null;
  readonly decisionApprovalId: string | null;
  readonly recordedBy: string;
  readonly recordedAt: Date;
}

// 追加送达记载的写入参数，字段与行同形。
export type DeliveryWrite = DeliveryRow;

/** 执行记载（T25， #270）。只追加。 */
export interface ExecutionRecordRow {
  readonly id: string;
  readonly caseId: string;
  /** court-enforcement | fulfilled | other */
  readonly kind: string;
  readonly note: string | null;
  readonly attachments: readonly string[];
  readonly recordedBy: string;
  readonly recordedAt: Date;
}

// 追加执行记载的写入参数，字段与行同形。
export type ExecutionRecordWrite = ExecutionRecordRow;

/** 结案呈批表头，带当前版本正文（#270）。 */
export interface ClosureApprovalRow {
  readonly id: string;
  readonly caseId: string;
  /** drafting | pending_review | pending_approval | approved */
  readonly status: string;
  readonly currentVersionNo: number;
  readonly drafterId: string;
  readonly approvalChainId: string | null;
  readonly contentJson: string | null;
}

// 保存结案呈批拟制稿的写入参数。
export interface ClosureApprovalDraftWrite {
  readonly approvalId: string;
  readonly caseId: string;
  readonly drafterId: string;
  readonly isNew: boolean;
  readonly expectedVersionNo: number;
  readonly versionId: string;
  readonly contentJson: string;
  readonly at: Date;
}

// 推进结案呈批一步的写入参数。
export interface ClosureApprovalStepWrite {
  readonly approvalId: string;
  readonly expectedStatus: string;
  readonly nextStatus: string;
  readonly approvalChainId?: string | null;
  readonly stepId: string;
  /** submit | review | approve */
  readonly step: string;
  readonly versionNo: number;
  readonly actorId: string;
  readonly opinion: string | null;
  readonly at: Date;
}

/** 结案记录（T26， #270）。一案一行，只追加。 */
export interface ClosureRecordRow {
  readonly id: string;
  readonly caseId: string;
  readonly approvalId: string;
  /** penalty | no-penalty */
  readonly branch: string;
  readonly checklistJson: string;
  readonly materialsRuleId: string;
  readonly materialsRuleVersion: string;
  readonly closedBy: string;
  readonly closedAt: Date;
}

// 追加结案记录的写入参数，字段与行同形。
export type ClosureRecordWrite = ClosureRecordRow;
