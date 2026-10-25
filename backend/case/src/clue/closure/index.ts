// 撤回不派与结案的领域规则出口（#217）。
export {
  CLUE_CLOSURE_RULE_CODES,
  DISPOSITION_KINDS,
  DISPOSITION_RECORD_FROM_STATUS,
  REMINDER_KINDS,
  REMINDER_RESOLUTIONS,
  WITHDRAW_FROM_STATUS,
  WITHDRAW_REASONS,
  checkDispositionNote,
  checkWithdrawInput,
} from './rules.ts';
export type {
  DispositionNoteCheckOutcome,
  WithdrawCheckOutcome,
} from './rules.ts';
