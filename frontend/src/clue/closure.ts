// 撤回不派与结案提醒的数据层（#217；规格 D 节、GLOSSARY）。
//
// 四项常用原因由服务端给（/api/clues/closure-options），界面不另存一份，
// 避免界面与后端各写一份而逐字不一致。
// 用词一律 GLOSSARY：撤回不派、不派、结案提醒、随旧线索办结；禁用「捞回」。

import { apiFetch, type ApiDispatch } from '../api';

/** 撤回不派与结案提醒的界面口径。 */
export interface ClosureOptions {
  readonly result: string;
  /** 四项常用原因（逐字，服务端给）。 */
  readonly withdrawReasons: readonly string[];
}

/** 不派视图的一行。 */
export interface HeldClue {
  readonly clueId: string;
  readonly code: string;
  readonly status: string;
  readonly domain: string;
  readonly sourceCode: string;
  readonly sourceName: string;
  readonly registeredAt: string;
  /** 撞上的对方线索编号（疑似重复命中）。 */
  readonly hitCodes: readonly string[];
  /** 当前操作者能不能撤回不派。 */
  readonly mayWithdraw: boolean;
}

/** 结案提醒的一行。 */
export interface ReminderItem {
  readonly reminderId: string;
  readonly clueId: string;
  readonly clueCode: string;
  /** 提醒类型：no-case（不予立案）｜transfer（移送）｜case（立案）。 */
  readonly kind: string;
  readonly otherClueId: string | null;
  readonly otherClueCode: string | null;
  readonly otherStatus: string | null;
  readonly createdAt: string;
  /** 当前操作者能不能处理这条提醒。 */
  readonly mayResolve: boolean;
}

/** 写动作的判别结果。 */
export type ClosureActionResult =
  | { readonly ok: true; readonly status: number }
  | { readonly ok: false; readonly status: number; readonly body: unknown };

async function readResult(response: Response): Promise<ClosureActionResult> {
  const body = (await response.json().catch(() => null)) as unknown;
  if (response.ok) return { ok: true, status: response.status };
  return { ok: false, status: response.status, body };
}

/** 取界面口径（四项常用原因）。 */
export async function loadClosureOptions(dispatch: ApiDispatch): Promise<ClosureOptions> {
  const response = await apiFetch(dispatch, '/api/clues/closure-options');
  if (!response.ok) throw new Error(`撤回不派口径取数失败（${response.status}）`);
  return (await response.json()) as ClosureOptions;
}

/** 不派视图。 */
export async function loadHeldClues(dispatch: ApiDispatch): Promise<readonly HeldClue[]> {
  const response = await apiFetch(dispatch, '/api/clues/held');
  if (!response.ok) throw new Error(`不派视图取数失败（${response.status}）`);
  const body = (await response.json()) as { readonly clues?: readonly HeldClue[] };
  return body.clues ?? [];
}

/** 结案提醒列表。 */
export async function loadReminders(dispatch: ApiDispatch): Promise<readonly ReminderItem[]> {
  const response = await apiFetch(dispatch, '/api/clues/reminders');
  if (!response.ok) throw new Error(`结案提醒取数失败（${response.status}）`);
  const body = (await response.json()) as { readonly reminders?: readonly ReminderItem[] };
  return body.reminders ?? [];
}

/** 撤回不派：四项原因多选（至少一项）＋补充说明必填。 */
export async function submitWithdraw(
  dispatch: ApiDispatch,
  clueId: string,
  input: {
    readonly reasonCodes: readonly string[];
    readonly note: string;
    readonly expectedStatus: string;
  },
): Promise<ClosureActionResult> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/withdraw`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readResult(response);
}

/** 提醒处理：撤回不派再办｜写明原因随旧线索办结。 */
export async function submitResolveReminder(
  dispatch: ApiDispatch,
  reminderId: string,
  input: {
    readonly resolution: string;
    readonly reasonCodes: readonly string[];
    readonly note: string;
    readonly expectedStatus: string;
  },
): Promise<ClosureActionResult> {
  const response = await apiFetch(dispatch, `/api/clues/reminders/${reminderId}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readResult(response);
}

/** 失败结果的界面文案。 */
export function closureFailureText(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '操作未完成，请重试。';
  const value = body as {
    readonly result?: string;
    readonly reason?: string;
    readonly rules?: readonly string[];
  };
  if (value.result === 'non-compliant') {
    switch (value.rules?.[0] ?? '') {
      case 'missing-withdraw-reason':
        return '请至少勾选一项撤回原因。';
      case 'missing-withdraw-note':
        return '请填写补充说明。';
      case 'invalid-withdraw-reason':
        return '撤回原因不在四项常用原因之内。';
      case 'missing-disposition-fields':
        return '请写明原因。';
      case 'unsupported-disposition':
        return '当前不支持该处置类型。';
      default:
        return '提交未通过，请检查后再试。';
    }
  }
  if (value.result === 'concurrent-change') return '线索状态已被他人变更，请刷新后重试。';
  if (value.result === 'invalid-state') return '当前状态不能执行该操作。';
  return '操作未完成，请重试。';
}

/** 提醒类型的中文标签。 */
export function reminderKindLabel(kind: string): string {
  switch (kind) {
    case 'no-case':
      return '不予立案';
    case 'transfer':
      return '移送';
    case 'case':
      return '立案';
    default:
      return kind;
  }
}
