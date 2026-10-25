// 线索登记的领域规则（#211；ADR 0018「一份声明，两个用途」）。
//
// 本目录是纯规则：要件叠加后的缺件判定、几何解析、附件真实内容校验、幂等摘要。
// 装配（HTTP、存储、数据库事务、留痕）在启动包（ADR 0004），本目录不碰它们。

export {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  MAX_SPATIAL_SOURCE_BYTES,
  validateAttachment,
  validateAttachmentSet,
} from './attachments.ts';
export type { AttachmentCandidate, AttachmentKind, AttachmentValidation } from './attachments.ts';
export {
  CONDITIONAL_ITEM_SOURCE_CODES,
  assessGaps,
  gapKeys,
  itemApplies,
  layerOf,
} from './gaps.ts';
export type { GapAssessmentInput } from './gaps.ts';
export { ALLOWED_INPUT_SRID, parseSpatialSource } from './geometry.ts';
export type { SpatialKind, SpatialParseInput, SpatialParseOutcome, SpatialPart } from './geometry.ts';
export { contentDigest, requestDigest } from './idempotency.ts';
export type { DigestFile, RequestDigestInput } from './idempotency.ts';
export { CLUE_REGISTRATION_RULE_CODES, isAnonymousValue, isBooleanValue } from './rules.ts';
export type { ClueFormValues, ClueGap, ClueGapAssessment, ClueLayer } from './types.ts';
