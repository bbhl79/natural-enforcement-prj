// 内业核查的领域规则与端口（#213）。
//
// 本目录是纯规则与纯类型：图层目录、状态与失败分类、核查执行端口、报告与分析图组装。
// 编排（入队、重试、权限、落库、留痕）在启动包（ADR 0004），本目录不碰它们。

export {
  ALL_LAYERS,
  STREET_BOUNDARY_LAYER,
  VERIFICATION_LAYERS,
  findVerificationLayer,
} from './layers.ts';
export type { VerificationLayer } from './layers.ts';
export { CLUE_VERIFICATION_PORT } from './port.ts';
export type {
  ClueVerificationPort,
  VerificationFeature,
  VerificationLayerResult,
  VerificationOutcome,
  VerificationPart,
  VerificationRequest,
} from './port.ts';
export {
  AUTO_VERIFICATION_ATTEMPTS,
  AUTO_VERIFICATION_BACKOFF,
  FAILURE_CATEGORIES,
  LAYER_STATES,
  LAYER_STATE_LABELS,
  MANUAL_VERIFICATION_ATTEMPTS,
  TERMINAL_CLUE_STATUSES,
  VERIFICATION_DOMAINS,
  VERIFICATION_RUN_STATUSES,
  VERIFICATION_STATUSES,
  VERIFICATION_STATUS_LABELS,
  isTerminalClueStatus,
  layerStateOf,
  requiresVerification,
} from './status.ts';
export type {
  FailureCategory,
  LayerState,
  VerificationRunStatus,
  VerificationStatus,
} from './status.ts';
export {
  VERIFICATION_REPORT_VERSION,
  buildVerificationAnalysis,
  buildVerificationReport,
  reportLayerOf,
  spatialVersionOf,
  verificationReportText,
} from './report.ts';
export type {
  VerificationReport,
  VerificationReportInput,
  VerificationReportLayer,
} from './report.ts';
export { UNAVAILABLE_REASONS, createLayerServiceVerificationPort } from './layer-service-port.ts';
export type { LayerServiceVerificationOptions } from './layer-service-port.ts';
