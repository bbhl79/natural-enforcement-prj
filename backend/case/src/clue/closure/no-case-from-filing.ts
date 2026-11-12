// 用途：不予立案落点服务：按立案呈批的不予立案结论写入处置行与结案提醒。
// 不予立案落点服务（#226）：供案件段在立案呈批 doc.approve（结论为不予立案）时同一事务调用。
// 非 HTTP、不授角色；调用方注入事务内 ClueStore 与主键生成器。
// 边界：本服务不写审计留痕，留痕由 backend/server/src/case-filing.service.ts 在同一事务追加；重复调用非幂等，状态已变后返回 concurrent-change 或 invalid-state。

import type { ClueStore } from '../../persistence/clue-store.ts';

import {
  DISPOSITION_RECORD_FROM_STATUS,
  checkNoCaseReason,
  type NoCaseReason,
} from './rules.ts';
import { generateClosureReminders } from './reminders.ts';

/** 落点服务入参。 */
export interface NoCaseFromFilingInput {
  readonly clueId: string;
  /** 乐观并发：须为当前线索状态。 */
  readonly expectedStatus: string;
  /** 呈批表／审批记录技术主键（#16 跨域引用用主键）。 */
  readonly filingApprovalRef: string;
  /** 不予立案理由快照（两类互斥）。 */
  readonly reason: unknown;
  readonly recordedBy: string;
  readonly recordedAt: Date;
  readonly newId: () => string;
  /** 可选业务说明（与理由快照分立；可空）。 */
  readonly note?: string | null;
}

/**
 * 落点失败原因码。
 * missing-filing-approval-ref 呈批引用为空；invalid-no-case-reason 理由快照不合规；
 * invalid-state 期望状态不是 handler_assigned；concurrent-change 条件更新落空（并发或状态已变）。
 */
export type NoCaseFromFilingFailureReason =
  | 'invalid-state'
  | 'concurrent-change'
  | 'invalid-no-case-reason'
  | 'missing-filing-approval-ref';

/** 落点结果：成功携带处置主键、提醒主键、理由快照与呈批引用；失败携带原因码与规则编号，且不写业务行。 */
export type NoCaseFromFilingOutcome =
  | {
      readonly ok: true;
      readonly dispositionId: string;
      readonly reminderIds: readonly string[];
      readonly reason: NoCaseReason;
      readonly filingApprovalRef: string;
    }
  | {
      readonly ok: false;
      readonly reason: NoCaseFromFilingFailureReason;
      readonly rules: readonly string[];
    };

/**
 * 经立案呈批批准后写入不予立案处置。
 * 成功：ClueDisposition(no-case)＋呈批引用＋理由快照，线索 handler_assigned→closed，
 * 生成 kind=no-case 提醒，与调用方事务同成同败。
 * 非 handler_assigned：返回 invalid-state（不写业务行）。
 * 其余失败：missing-filing-approval-ref、invalid-no-case-reason、concurrent-change。
 * 不写审计留痕，留痕由调用方同事务追加；重复调用非幂等，状态已变后返回 concurrent-change 或 invalid-state。
 */
export async function recordNoCaseFromFilingApproval(
  clues: ClueStore,
  input: NoCaseFromFilingInput,
): Promise<NoCaseFromFilingOutcome> {
  const filingApprovalRef = input.filingApprovalRef.trim();
  if (filingApprovalRef === '') {
    return { ok: false, reason: 'missing-filing-approval-ref', rules: ['missing-filing-approval-ref'] };
  }
  const checked = checkNoCaseReason(input.reason);
  if (!checked.ok) {
    return { ok: false, reason: 'invalid-no-case-reason', rules: [checked.rule] };
  }
  if (input.expectedStatus !== DISPOSITION_RECORD_FROM_STATUS) {
    return { ok: false, reason: 'invalid-state', rules: ['invalid-state'] };
  }

  const dispositionId = input.newId();
  const note = typeof input.note === 'string' && input.note.trim() !== '' ? input.note.trim() : null;
  const applied = await clues.applyDisposition({
    clueId: input.clueId,
    expectedStatus: input.expectedStatus,
    dispositionId,
    disposition: 'no-case',
    transferredOrg: null,
    documentNo: null,
    note,
    recordedBy: input.recordedBy,
    recordedAt: input.recordedAt,
    nextStatus: 'closed',
    filingApprovalRef,
    noCaseReasonJson: JSON.stringify(checked.reason),
  });
  if (!applied) {
    // 条件更新落空：可能是并发，也可能是状态已变。调用方按 expected 再读分辨。
    return { ok: false, reason: 'concurrent-change', rules: ['concurrent-change'] };
  }
  const reminderIds = await generateClosureReminders(clues, {
    closedClueId: input.clueId,
    kind: 'no-case',
    createdAt: input.recordedAt,
    newId: input.newId,
  });
  return {
    ok: true,
    dispositionId,
    reminderIds,
    reason: checked.reason,
    filingApprovalRef,
  };
}
