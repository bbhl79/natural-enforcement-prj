// 用途：案件聚合模块的公共出口，只转发现有消费方在用的符号。
// 案件聚合模块公共出口（#47/#51 定案：跨模块消费只许经本文件；内部路径导入由结构测试
// module-public-entry 拦截）。
//
// 本文件只转发现有消费方在用的符号。跨模块消费既经此处，就不必把 21 个子域的完整词表、
// 内部读写类型一并暴露成事实上的公共 API；子域要新增对外符号时在此显式加一行，由评审
// 决定要不要开这个口。
// #210：录入要件声明是本模块的常量（ADR 0018「case 常量是唯一要件声明源」）。
// #211：线索登记的领域规则（缺件判定、几何解析、附件校验、幂等摘要）也在本模块出。
export {
  ALLOWED_INPUT_SRID,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_SPATIAL_SOURCE_BYTES,
  assessGaps,
  contentDigest,
  isAnonymousValue,
  isBooleanValue,
  itemApplies,
  layerOf,
  missingRequiredItems,
  parseSpatialSource,
  requestDigest,
  validateAttachment,
  validateAttachmentSet,
} from './clue/registration/index.ts';
export type {
  ClueFormValues,
  ClueGap,
} from './clue/registration/index.ts';
export {
  CLUE_REQUIREMENT_DECLARATION_VERSION,
  DOMAINS,
  PUBLIC_GROUPS,
  PUBLIC_LAYER_ITEMS,
  REQUIREMENT_CONSEQUENCES,
  REQUIREMENT_TIMINGS,
  SOURCE_GROUPS,
  SOURCE_LAYER_GROUPS,
  TYPE_GROUPS,
  TYPE_LAYER_ITEMS,
  blockingItems,
  buildFormSchemaItems,
} from './clue/requirements/index.ts';
export type {
  Domain,
  RequirementAuthority,
  RequirementItem,
} from './clue/requirements/index.ts';
export {
  CaseModule,
} from './case.module.ts';
// #211：线索持久化端口（Prisma 适配器在模块内，不经公共出口出）。
export {
  CLUE_STORE,
  ClueIdempotencyConflictError,
  ClueVerificationRunningError,
} from './persistence/clue-store.ts';
export type {
  ClueDispatchContext,
  ClueHitSummary,
  ClueHitWrite,
  ClueItemGapRow,
  ClueListPage,
  ClueMaterialRow,
  SecrecyReportTicketRow,
  ClueRegistrationWrite,
  ClueStore,
  ClueDuplicateContext,
  ClueDetailRow,
  ClueVerificationContext,
  ClueVerificationRunRow,
  WorkbenchCardCounts,
} from './persistence/clue-store.ts';
// #213：内业核查的图层目录、状态口径、核查执行端口与报告组装。
export {
  ALL_LAYERS,
  AUTO_VERIFICATION_ATTEMPTS,
  AUTO_VERIFICATION_BACKOFF,
  CLUE_VERIFICATION_PORT,
  MANUAL_VERIFICATION_ATTEMPTS,
  VERIFICATION_LAYERS,
  VERIFICATION_STATUS_LABELS,
  buildVerificationAnalysis,
  buildVerificationReport,
  createLayerServiceVerificationPort,
  isTerminalClueStatus,
  layerStateOf,
  requiresVerification,
  spatialVersionOf,
  verificationReportText,
} from './clue/verification/index.ts';
export type {
  ClueVerificationPort,
  VerificationLayerResult,
  VerificationOutcome,
  VerificationRequest,
} from './clue/verification/index.ts';
// #212：疑似重复比对——逐面 60% 命中判定、比对范围、对方状态条、按对方线索分组、
// 决定步数据契约（已知晓／举报必派）与匿名对称脱敏口径。
export {
  CLUE_STATUS_LABELS,
  DISPOSITION_LABELS,
  POINT_NO_OVERLAP_NOTICE,
  doesSpatialOverlapJudgement,
  duplicateDecisionContract,
  formatRegisteredAtDay,
  formatRegisteredAtMonth,
  groupFacesByOtherClue,
  isComparableClueStatus,
  limitedLocation,
  maskReporterContact,
  maskReporterName,
} from './clue/duplicate/index.ts';
export type {
  FacePair,
} from './clue/duplicate/index.ts';
// #214：分派决定与两步分派的领域规则、街道镇边界查询端口（辖区建议）。
// #215：报请指定管辖的状态门槛、受理人候选链与失败原因封闭表。
export {
  DECIDE_FROM_STATUS,
  DESIGNATE_REQUEST_FROM_STATUSES,
  ORG_ASSIGN_FROM_STATUSES,
  PEOPLE_ASSIGN_FROM_STATUS,
  STREET_BOUNDARY_PORT,
  createStreetBoundaryPort,
  decideDispatch,
  hasCaseByCasePlanningType,
  isOpenHit,
  planOrgAssign,
  reviewerOrgCandidates,
} from './clue/dispatch/index.ts';
export type {
  StreetBoundaryPort,
} from './clue/dispatch/index.ts';
// #225：保密报告工单的领域规则（三态状态机、默认 24h 时限、提醒计算）。
export {
  SECRECY_REPORT_STATUS_LABELS,
  checkSecrecyReportTransition,
  secrecyReportDueAt,
  secrecyReportReminder,
} from './secrecy-report/index.ts';
export type {
  SecrecyReportStatus,
} from './secrecy-report/index.ts';
// #217：撤回不派与结案的领域规则（四项原因、说明必填、状态门槛）与提醒生成内部服务。
export {
  CLUE_WITHDRAW_REASONS,
  DISPOSITION_RECORD_FROM_STATUS,
  REMINDER_RESOLUTIONS,
  WITHDRAW_FROM_STATUS,
  checkDispositionNote,
  checkReminderResolve,
  checkWithdrawInput,
  generateClosureReminders,
  recordNoCaseFromFilingApproval,
} from './clue/closure/index.ts';

export type {
  ClueWithdrawContext,
} from './persistence/clue-store.ts';
// #216：移送与停用机构池重新指定的领域规则（规格 D 节、GLOSSARY）。
export {
  POOL_REASSIGN_FROM_STATUSES,
  TRANSFER_FROM_STATUSES,
  assessTransfer,
  beijingDateOf,
} from './clue/disposition/index.ts';

// #234：立案呈批（结论二选一、理由两类互斥、审批链最小固定形态、X31 在途锁、批准守卫）与案件最小模型。
export {
  FILING_GAP_OUTLET,
  FILING_GAP_REASON,
  buildCaseOpening,
  canTakeFilingStep,
  checkFilingContent,
  checkFilingGuards,
  checkFilingParty,
  classifyFilingGaps,
  filingGapWarnings,
  filingStatusAfter,
  isFilingApprovalPending,
} from './filing/index.ts';
export type {
  FilingAdminReview,
  FilingContent,
  FilingGapClassification,
} from './filing/index.ts';
// #234：立案呈批与案件最小模型的持久化端口（Prisma 适配器在模块内，不经公共出口出）。
export {
  CASE_STORE,
} from './persistence/case-store.ts';
export type {
  CaseStore,
  CaseView,
  ComparisonJudgmentRow,
  HearingRow,
  NoticeRow,
  NoticeValidityBaselineRow,
  PartySubmissionRow,
  ComparisonJudgmentWrite,
  CaseReassignmentRow,
  PersonConflictEventRow,
  StageInstanceRow,
  ValidityConfirmationRow,
  ValidityReviewRow,
  DeadlineEventRow,
  DeadlineRow,
  PeriodEventRow,
  DeadlineApprovalRow,
  DiscussionRecordRow,
  LegalReviewOpinionRow,
  LegalReviewRow,
  ReviewObjectionWindowRow,
  ReviewOpinionRow,
  ReviewReportRow,
  ReviewerDesignationRow,
  TransferApprovalRow,
  TransferRow,
  CriminalDecisionRow,
  FinalizeRecordRow,
} from './persistence/case-store.ts';
// #238：退回原因、退回点、接收人与退回计划。
export {
  FILING_DRAFT_TARGET,
  bothHandlersUnavailable,
  checkDocumentEdit,
  findReturnReason,
  legalReviewAttributionOrgId,
  planReturn,
  signatureReusable,
} from './return/index.ts';
export type {
  HandlerAvailability,
  LegalReviewOrgFact,
  ReceiverCandidate,
} from './return/index.ts';
export {
  CASE_INSTANCE_STATUS_NAMES,
  CASE_MAIN_STATUS_NAMES,
  CASE_STAGE_CODES,
  CASE_STAGE_NAMES,
  CASE_SUPERVISION_ROLE,
  X03_WARN_MESSAGE,
  applyWarningGate,
  buildTransitionEffects,
  classifyIllegal,
  confirmationGap,
  decideTransition,
  findIllegal,
  findRuleParameter,
  findTransition,
  isTerminalCaseStatus,
  nextEntrySeq,
  stageIndex,
} from './state-machine/index.ts';
export type {
  CaseMainStatus,
  CaseStageCode,
  GuardResult,
  RuleConfirmation,
  TransitionDecision,
  TransitionEffects,
  TransitionSubject,
  WarningItem,
} from './state-machine/index.ts';
// #237：人员层利害关系、回避决定人两级、签出暂停与法审候选过滤。
export {
  CONFLICT_SOURCE_NAMES,
  CONFLICT_STATUS_NAMES,
  DECISION_CONCLUSION_NAMES,
  INVESTIGATION_KIND_NAMES,
  SIGN_REFUSED_MESSAGE,
  SIGN_REFUSED_OUTLET,
  activeConflicts,
  deciderSeatMatches,
  excludeConflictedCandidates,
  isConflictSource,
  isDecisionConclusion,
  isInvestigationKind,
  isSignKind,
  latestConflictEvents,
  statusAfterDecision,
  transitionalDeciderSeats,
} from './conflict/index.ts';
export type {
  ConflictEventFact,
  ConflictSource,
} from './conflict/index.ts';
// #263：机关层利害关系。只提示，不阻断签出、呈批、迁移。
export {
  AGENCY_CONFLICT_ALREADY_MARKED_MESSAGE,
  AGENCY_CONFLICT_UNCHECK_MESSAGE,
  AGENCY_CONFLICT_WARNING,
  agencyConflictNotice,
} from './agency-conflict/index.ts';
export type {
  AgencyConflictMark,
} from './agency-conflict/index.ts';
// #236：调查环节与收尾。停表类别与追诉时效出口映射都由参数给出。
export {
  EXTEND_DEADLINE_PROMPT,
  INQUIRY_OFFICER_CITATION,
  MISSING_JURISDICTION_TRANSFER_MESSAGE,
  PARTY_NOTICE_PROMPT,
  LIMITATION_DISCOVERY_EXIT_V1,
  PROCEDURE_TRANSITION,
  SUSPENSION_CLOCK_PARAMETER,
  checkInquiryOfficers,
  checkLimitationDiscoveryExit,
  checkProcedureContent,
  checkProcedureState,
  checkVoidViolation,
  inquiryOfficerBlock,
  isRecognitionMode,
  parseCalendarDay,
  suspensionClockEvent,
} from './investigation/index.ts';
export type {
  LimitationDiscoveryExit,
  ProcedureContent,
  SuspensionClockParameter,
} from './investigation/index.ts';
// #271：新旧比对最小版。人工比对，批准时校验；Q31 警告，Q32 提示。
export {
  COMPARISON_MISSING_MESSAGE,
  COMPARISON_STALE_MESSAGE,
  COMPARISON_STALE_OUTLET,
  EFFECTIVE_DAY_ATTRIBUTION_V1,
  Q31_OUTLET,
  Q32_PROMPT,
  Q32_RULE_KEY,
  assessComparisonFreshness,
  assessDecisionSubmission,
  latestJudgments,
  q32Hints,
  readComparisonJudgment,
} from './comparison/index.ts';
export type {
  ComparisonBasis,
  ComparisonBenchmark,
  ComparisonFreshnessInput,
  ComparisonJudgment,
  ComparisonJudgmentEntry,
  ComparisonJudgmentRef,
  EffectiveDayAttribution,
  RawComparisonJudgment,
} from './comparison/index.ts';
// #239：改派呈批（T33）与回避后材料效力认定。
export {
  HANDLER_ROLES,
  MATERIAL_EFFECTIVENESS_NAMES,
  REASSIGN_REASON_NAMES,
  checkRecusalReference,
  checkReassignProposal,
  invalidMaterialIds,
  isMaterialEffectivenessConclusion,
  isReassignReasonCode,
  latestEffectivenessByMaterial,
  reassignInitiator,
} from './reassign/index.ts';
export type {
  ConflictDecisionFact,
  HandlerCandidateFacts,
  HandlerRole,
  MaterialEffectivenessFact,
  ReassignProposalIssue,
} from './reassign/index.ts';
// #240：审理（E04）。报告处理建议、审理人候选与签出守卫、意见类型到去向。
// 「调查审理职能分离」是独立规则，不占 X 号；时效出口读 cfg.rule.limitation-discovery-exit.v1。
export {
  REVIEW_OBJECTION_WINDOW_V1,
  REVIEW_RETURN_REASON,
  allowsObjection,
  objectionWindowDueAt,
  checkReviewSign,
  checkReviewerCandidate,
  opinionDestination,
  readDesignationReason,
  readReviewObjectionContent,
  readReviewOpinionContent,
  readReviewReportContent,
  separationWarning,
} from './review/index.ts';
export type {
  HandlingSuggestion,
  OpinionDestination,
  ReviewCandidateFacts,
  ReviewObjectionWindowRule,
  ReviewOpinionKind,
  ReviewReportContent,
} from './review/index.ts';
// #272 R-02：案件标记的统一读写出口（供 #269／#242／#270 复用）。
export {
  activeMarkerKeys,
  isStickyCaseMarker,
  readActiveCaseMarkers,
} from './marker/index.ts';

// #272：告知与听证（E05、E06）纯规则。X07 自动∪人工、较大数额提示、X26 衔接、主持人资格、X28。
export {
  assessHearing,
  checkHearingHost,
  checkHearingReopen,
  hearingCountsAsHeld,
  hearingWindowState,
  isHearingEndKind,
  isNoticeKind,
  readNoticeContent,
} from './notice/index.ts';
export type {
  HearingAssessment,
  NoticeContent,
} from './notice/index.ts';
// #248：有效性确认与重新告知。A／B／C 判据、差异分组、Q14 加重来源、决定呈批闸口。
export {
  aggravationSourceValid,
  assertValidityGate,
  assessValidity,
  decisionDigest,
  isAggravationSourceKind,
  isSystemValidityReason,
  isValidityReissueReason,
  readDecisionSummary,
} from './validity/index.ts';
export type {
  DecisionSummary,
  ValidityAssessment,
  ValidityBaseline,
  ValidityConfirmationFact,
  ValidityGateCheck,
  ValidityGateFacts,
  ValidityHit,
} from './validity/index.ts';
// #269：法制审核与集体讨论（E07、E08）纯规则。必审清单、接收人与负责人校验、法审三去向、
// 告知前与决定闸口、集体讨论标准、资格提示与同一人警告。
export {
  COLLECTIVE_DISCUSSION_CRITERIA,
  GUANGZHOU_PROCEDURE_REFERENCE_LIST_V1,
  LEGAL_REVIEW_LIST_ID,
  LEGAL_REVIEW_LIST_VERSION,
  MANDATORY_REVIEW_PENALTY_CODES,
  assertDecisionGate,
  assertNoticeGate,
  assessMandatoryReview,
  checkDiscussionReference,
  checkLegalReviewHead,
  checkLegalReviewReceiver,
  isCollectiveDiscussionCriterion,
  isManualReviewItemCode,
  legalQualificationHint,
  readDiscussionMarkContent,
  readDiscussionRecordContent,
  readLegalReviewOpinionContent,
  samePersonWarning,
  summaryCoversDecision,
} from './legal-review/index.ts';
export type {
  DecisionGateFacts,
  MandatoryReviewAssessment,
} from './legal-review/index.ts';
// #242：案件阶段三类移送（管辖、涉刑、党纪政务）纯规则。
export {
  CRIMINAL_DECISION_REVIEW_RULE_KEY,
  CRIMINAL_DECISION_SOURCE_NAMES,
  CRIMINAL_OUTLET_NAMES,
  CRIMINAL_TRANSFER_DECISION_RULE_KEY,
  TRANSFER_CLOCK_BASIS,
  TRANSFER_KIND_NAMES,
  assertCloseoutTransferGate,
  assertCriminalTransferReview,
  criminalOutletLanding,
  criminalTransferReviewPass,
  readCriminalDecisionContent,
  readCriminalOutletContent,
  readTransferContent,
  receiptsCompleteOf,
  resolveTransferApprovalChain,
  transferStatusAfter,
} from './transfer/index.ts';
export type {
  TransferApprovalChain,
  TransferContent,
  TransferKind,
} from './transfer/index.ts';
// #243：卷宗必需材料（带版本的共用常量）与定型规则。
export {
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
  dossierEventsOf,
  dossierInstanceKey,
  dossierMaterialName,
  evaluateDossierCompleteness,
  finalizeBlockOf,
  isDossierMaterialCode,
  readDeliveryEvidence,
  readFinalizeContent,
  requiredDossierItems,
} from './dossier/index.ts';
export type {
  DossierCompleteness,
  DossierMaterialFact,
  FinalizeContent,
} from './dossier/index.ts';
// #270：决定（E09／T23）纯规则。
export {
  DECISION_DOCUMENT_NAMES,
  DECISION_KIND_NAMES,
  decisionDocumentTypeOf,
  deriveDecisionKind,
  deriveDecisionSignature,
  fineBaseHint,
  fineBaseMissing,
  hasFine,
  missingEvidenceRefs,
  readDecisionContent,
  readFrozenViolations,
  x05Guard,
  x06Guard,
  x16Guard,
} from './decision/index.ts';
export type {
  DecisionContent,
  DecisionDocumentType,
  DecisionKind,
  DecisionNoticeWindow,
  DecisionSignature,
  FrozenViolationFact,
} from './decision/index.ts';
// #270：送达（T24）、执行记载（T25）、结案（T26）纯规则。
export {
  CLOSURE_BRANCH_NAMES,
  DELIVERY_RECORD_KIND_NAMES,
  EXECUTION_RECORD_KIND_NAMES,
  closureBranchOf,
  readClosureContent,
  readDeliveryRecord,
  readExecutionRecord,
  x10Guard,
} from './closeout/index.ts';
export type {
  ClosureBranch,
} from './closeout/index.ts';
