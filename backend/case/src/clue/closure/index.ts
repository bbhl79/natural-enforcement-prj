// 撤回不派与结案的领域规则出口（#217）。
export {
  CLUE_CLOSURE_RULE_CODES,
  DISPOSITION_FROM_STATUSES,
  DISPOSITION_KINDS,
  DISPOSITION_RECORD_FROM_STATUS,
  DISPOSITION_TERMINAL_STATUS,
  MINOR_ELEMENT_KEYS,
  MINOR_ELEMENT_LABELS,
  NON_FILING_GROUND_CODES,
  NON_FILING_GROUND_LABELS,
  REMINDER_KINDS,
  REMINDER_RESOLUTIONS,
  WITHDRAW_FROM_STATUS,
  WITHDRAW_REASONS,
  checkDispositionNote,
  checkNoCaseReason,
  checkReminderResolve,
  checkWithdrawInput,
} from './rules.ts';
export type {
  DispositionNoteCheckOutcome,
  MinorElementConfirmation,
  MinorElementKey,
  NoCaseReason,
  NoCaseReasonCheckOutcome,
  NonFilingGroundCode,
  ReminderResolveCheckOutcome,
  WithdrawCheckOutcome,
} from './rules.ts';
export { generateClosureReminders } from './reminders.ts';
export type { ClosureReminderGeneration } from './reminders.ts';
export { recordNoCaseFromFilingApproval } from './no-case-from-filing.ts';
export type {
  NoCaseFromFilingFailureReason,
  NoCaseFromFilingInput,
  NoCaseFromFilingOutcome,
} from './no-case-from-filing.ts';
