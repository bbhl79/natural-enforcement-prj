// 用途：汇总机关层利害关系提示规则与类型的对外导出。
export {
  AGENCY_CONFLICT_ALREADY_MARKED_MESSAGE,
  AGENCY_CONFLICT_GATES,
  AGENCY_CONFLICT_OUTLET,
  AGENCY_CONFLICT_UNCHECK_MESSAGE,
  AGENCY_CONFLICT_WARNING,
  agencyConflictBlocks,
  agencyConflictMarked,
  agencyConflictNotice,
} from './rules.ts';
export type { AgencyConflictGate, AgencyConflictMark } from './rules.ts';
