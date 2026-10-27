// 退回规则公共出口（#238）。
export {
  FILING_DRAFT_TARGET,
  FILING_RETURN_STAGE,
  RETURN_CODES,
  RETURN_DISABLED_STAGES,
  RETURN_INHERITABLE_CODES,
  RETURN_REASONS,
  findReturnReason,
  isInheritableReturnCode,
  isReturnCode,
  isReturnStageDisabled,
} from './catalog.ts';
export type { ReturnCode, ReturnInheritableCode, ReturnReasonSpec, ReturnStage } from './catalog.ts';
export {
  RETURN_CHAIN_RECEIVER_ROLES,
  RETURN_FORBIDDEN_RECEIVER_ROLES,
  RETURN_NEVER_RECEIVER_ROLES,
  LEGAL_REVIEW_ORG_LEVELS,
  bothHandlersUnavailable,
  checkDocumentEdit,
  checkReceiver,
  handlerUnavailable,
  legalReviewAttributionOrgId,
} from './receiver.ts';
export type {
  DocumentEditCheck,
  HandlerAvailability,
  LegalReviewOrgFact,
  LegalReviewOrgLevel,
  ReceiverCandidate,
  ReceiverCheck,
} from './receiver.ts';
export {
  investigationDownstreamIds,
  n5Applies,
  planReturn,
  returnFailureStatus,
  RETURN_REFUSAL_REASONS,
  signatureReusable,
} from './plan.ts';
export type { PlanReturnInput, PlanReturnResult, ReturnInstanceFact, ReturnPlan, ReturnRefusalReason } from './plan.ts';
export {
  RETURN_EXITS,
  RETURN_EXIT_NAMES,
  findTarget,
  hearingHasStarted,
  noticeValidityCallSite,
  returnTarget,
  returnsToInvestigation,
  targetKeys,
} from './target.ts';
export type { ReturnCaseContext, ReturnExit, ReturnTarget, ReturnTargetResult } from './target.ts';
