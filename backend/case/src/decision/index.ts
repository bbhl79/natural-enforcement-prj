// 用途：决定环节的对外出口，只做再导出。
// 调用方：backend/server/src/case-decision.service.ts 等，经包名 @natural-enforcement/case 汇总导出。
// 依据：#270。
export {
  DECISION_CONTENT_RULE_ID,
  DECISION_CONTENT_VERSION,
  DECISION_DOCUMENT_NAMES,
  DECISION_DOCUMENT_TYPES,
  DECISION_FINE_BASE_MESSAGE,
  DECISION_FINE_BASE_OUTLET,
  DECISION_FINE_BASE_RULE_KEY,
  DECISION_ISSUER_NAME,
  DECISION_KIND_NAMES,
  DECISION_KINDS,
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
} from './rules.ts';
export type {
  DecisionContent,
  DecisionContentHit,
  DecisionContentRead,
  DecisionDocumentType,
  DecisionKind,
  DecisionNoticeWindow,
  DecisionSignature,
  FrozenViolationFact,
} from './rules.ts';