// 保密报告工单的领域规则（#225；#222 草案 §1「报告工单」＋「等待指令」）。
//
// 状态机只有三态，只进不退：
//   pending_report（待报）→ reported（已报）→ receipted（已回执）。
// 「已报」由责任人按单位规程向保密部门／上级报告后人工登记；系统不对外发文、不代替审批。
// 「已回执」须人工录入保密部门指令摘要与回执附件；录入前工单挂起等待。
// 任何状态都不触发销毁；本期无销毁通道（二期／另票），无超时自动动作。

/** 工单状态（库内取值）。 */
export const SECRECY_REPORT_STATUSES = ['pending_report', 'reported', 'receipted'] as const;
export type SecrecyReportStatus = (typeof SECRECY_REPORT_STATUSES)[number];

/** 状态的界面文案。 */
export const SECRECY_REPORT_STATUS_LABELS: Readonly<Record<SecrecyReportStatus, string>> = {
  pending_report: '待报',
  reported: '已报',
  receipted: '已回执',
};

/** 可执行的迁移：登记已报、录入回执。 */
export type SecrecyReportTransition = 'report' | 'receipt';

/** 每个迁移允许的起点状态与落点状态。 */
export const SECRECY_REPORT_TRANSITIONS: Readonly<
  Record<SecrecyReportTransition, { readonly from: SecrecyReportStatus; readonly to: SecrecyReportStatus }>
> = {
  report: { from: 'pending_report', to: 'reported' },
  receipt: { from: 'reported', to: 'receipted' },
};

/**
 * 报告时限默认 24 小时（口径锁：《保守国家秘密法》第 47 条等「发现后 24 小时内报告」）。
 * 起算点是发现时刻（隔离登记的 discovered_at）。系统只提醒，不代发。
 */
export const SECRECY_REPORT_DEADLINE_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

/** 报告时限到期时刻 = 发现时刻 + 时限小时数。 */
export function secrecyReportDueAt(discoveredAt: Date, deadlineHours: number = SECRECY_REPORT_DEADLINE_HOURS): Date {
  return new Date(discoveredAt.getTime() + deadlineHours * HOUR_MS);
}

/** 迁移校验结果。 */
export type SecrecyReportTransitionCheck =
  | { readonly ok: true; readonly to: SecrecyReportStatus }
  | { readonly ok: false; readonly reason: 'invalid-state' };

/** 判定一次迁移是否合法：起点必须恰为该迁移的 from。 */
export function checkSecrecyReportTransition(
  current: string,
  transition: SecrecyReportTransition,
): SecrecyReportTransitionCheck {
  const rule = SECRECY_REPORT_TRANSITIONS[transition];
  if (current !== rule.from) return { ok: false, reason: 'invalid-state' };
  return { ok: true, to: rule.to };
}

/** 时限提醒（系统内提醒）。只有待报工单有提醒；已报／已回执不再提醒。 */
export interface SecrecyReportReminder {
  readonly dueAt: Date;
  /** 距到期的剩余分钟数，向上取整；已超时为负数或零。 */
  readonly remainingMinutes: number;
  /** 当前时刻已超过到期时刻。到期整点不算超时。 */
  readonly overdue: boolean;
}

/** 计算提醒。非待报返回 null。now 由调用方注入（可注入时钟）。 */
export function secrecyReportReminder(
  status: string,
  dueAt: Date,
  now: Date,
): SecrecyReportReminder | null {
  if (status !== 'pending_report') return null;
  const left = dueAt.getTime() - now.getTime();
  return {
    dueAt,
    remainingMinutes: Math.ceil(left / 60_000),
    overdue: left < 0,
  };
}
