// 分派决定与两步分派（#214）。公共出口。
export {
  CLUE_DISPATCH_RULE_CODES,
  DECIDE_FROM_STATUS,
  DUP_TERMINAL_STATUSES,
  ORG_ASSIGN_FROM_STATUSES,
  PEOPLE_ASSIGN_FROM_STATUS,
  decideDispatch,
  isOpenHit,
} from './rules.ts';
export type { DecideOutcome } from './rules.ts';
export {
  STREET_BOUNDARY_PORT,
  STREET_UNAVAILABLE_REASONS,
  createStreetBoundaryPort,
} from './street-port.ts';
export type {
  StreetBoundaryPart,
  StreetBoundaryPort,
  StreetBoundaryPortOptions,
  StreetBoundaryRequest,
  StreetFeature,
  StreetBoundaryOutcome,
} from './street-port.ts';
