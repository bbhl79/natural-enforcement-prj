// 内业核查的状态与失败分类（#213；规格 C 节、USER LOCK L2）。
//
// 核查状态是线索的正交属性，不进三级校验、不拦分派：
// not_required（不设内业核查）｜running（核查进行中）｜done（已完成）｜failed（没跑成）。
// 没跑成时重跑提示一直挂到跑成；终态线索不再允许手动重跑。

/** 线索上的核查状态。 */
export const VERIFICATION_STATUSES = ['not_required', 'running', 'done', 'failed'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** 一次核查运行的状态。 */
export const VERIFICATION_RUN_STATUSES = ['running', 'done', 'failed'] as const;
export type VerificationRunStatus = (typeof VERIFICATION_RUN_STATUSES)[number];

/** 失败类别：瞬时（可重试）｜确定性（不重试，当次即判没跑成）。 */
export const FAILURE_CATEGORIES = ['transient', 'deterministic'] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/** 报告里每层的三态。 */
export const LAYER_STATES = ['overlapped', 'no_overlap', 'unavailable'] as const;
export type LayerState = (typeof LAYER_STATES)[number];

/** 需要跑内业核查的法域：土地与矿产。测绘与规划不跑，只显示「不设内业核查」。 */
export const VERIFICATION_DOMAINS = ['land', 'mineral'] as const;

/** 终态线索：不再允许手动重跑；终态不取消已开始核查。 */
export const TERMINAL_CLUE_STATUSES = ['closed', 'transferred_out', 'filed'] as const;

/** 自动核查的总尝试次数（含首次执行）：首次加自动重试至多 3 次。 */
export const AUTO_VERIFICATION_ATTEMPTS = 4;

/** 手动重跑只执行 1 次，不自动重试。 */
export const MANUAL_VERIFICATION_ATTEMPTS = 1;

/** 自动核查的重试延迟：30／60／120 秒三档（指数退避，首次 30 秒）。 */
export const AUTO_VERIFICATION_BACKOFF = { type: 'exponential', delay: 30_000 } as const;

/** 该法域要不要跑内业核查。 */
export function requiresVerification(domain: string): boolean {
  return (VERIFICATION_DOMAINS as readonly string[]).includes(domain);
}

/** 线索是不是终态。 */
export function isTerminalClueStatus(status: string): boolean {
  return (TERMINAL_CLUE_STATUSES as readonly string[]).includes(status);
}

/** 相交面积决定三态：大于 0 即相交；等于 0 即查过没有；查不成即不可用。 */
export function layerStateOf(overlapArea: number): LayerState {
  return overlapArea > 0 ? 'overlapped' : 'no_overlap';
}

/** 核查状态的中文说明（界面与接口通用）。 */
export const VERIFICATION_STATUS_LABELS: Readonly<Record<VerificationStatus, string>> = {
  not_required: '不设内业核查',
  running: '核查进行中',
  done: '已完成',
  failed: '没跑成',
};

/** 每层三态的中文说明。 */
export const LAYER_STATE_LABELS: Readonly<Record<LayerState, string>> = {
  overlapped: '有相交',
  no_overlap: '无相交',
  unavailable: '查不成',
};
