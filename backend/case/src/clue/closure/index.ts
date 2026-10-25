// 撤回不派与结案的领域规则出口（#217）。
export {
  CLUE_CLOSURE_RULE_CODES,
  DISPOSITION_FROM_STATUSES,
  DISPOSITION_KINDS,
  DISPOSITION_RECORD_FROM_STATUS,
  DISPOSITION_TERMINAL_STATUS,
  REMINDER_KINDS,
  REMINDER_RESOLUTIONS,
  WITHDRAW_FROM_STATUS,
  WITHDRAW_REASONS,
  checkDispositionNote,
  checkReminderResolve,
  checkWithdrawInput,
} from './rules.ts';
export type {
  DispositionNoteCheckOutcome,
  ReminderResolveCheckOutcome,
  WithdrawCheckOutcome,
} from './rules.ts';
export { generateClosureReminders } from './reminders.ts';
export type { ClosureReminderGeneration } from './reminders.ts';
