// 案件聚合模块公共出口（#47/#51 定案：跨模块消费只许经本文件；内部路径导入由结构测试
// module-public-entry 拦截）。空壳阶段暂无对外查询/事件接口内容，形态约定先行。
// #210：录入要件声明是本模块的常量（ADR 0018「case 常量是唯一要件声明源」）。
// #211：线索登记的领域规则（缺件判定、几何解析、附件校验、幂等摘要）也在本模块出。
export {
  ALLOWED_INPUT_SRID,
  CLUE_REGISTRATION_RULE_CODES,
  CONDITIONAL_ITEM_SOURCE_CODES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  MAX_SPATIAL_SOURCE_BYTES,
  assessGaps,
  contentDigest,
  gapKeys,
  isAnonymousValue,
  isBooleanValue,
  itemApplies,
  layerOf,
  parseSpatialSource,
  requestDigest,
  validateAttachment,
  validateAttachmentSet,
} from './clue/registration/index.ts';
export type {
  AttachmentCandidate,
  AttachmentKind,
  AttachmentValidation,
  ClueFormValues,
  ClueGap,
  ClueGapAssessment,
  ClueLayer,
  DigestFile,
  GapAssessmentInput,
  RequestDigestInput,
  SpatialKind,
  SpatialParseInput,
  SpatialParseOutcome,
  SpatialPart,
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
  BasisReference,
  Domain,
  FormSchemaInput,
  RequirementConsequence,
  RequirementItem,
  RequirementTiming,
  SourceLayerGroup,
  TypeLayerItem,
} from './clue/requirements/index.ts';
export { CaseModule } from './case.module.ts';
// #211：线索持久化端口（Prisma 适配器在模块内，不经公共出口出）。
export { CLUE_STORE, ClueIdempotencyConflictError } from './persistence/clue-store.ts';
export type {
  ClueHitSummary,
  ClueHitWrite,
  ClueIdempotencyRow,
  ClueItemGapRow,
  ClueItemValueRow,
  ClueMaterialRow,
  ClueRegistrationOutcome,
  ClueRegistrationResult,
  ClueRegistrationWrite,
  ClueRequirementSnapshotRow,
  ClueRowToWrite,
  ClueSpatialPartRow,
  ClueSpatialWrite,
  ClueStore,
} from './persistence/clue-store.ts';
