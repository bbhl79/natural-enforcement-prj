// 停用机构池重新指定的数据层（#216；规格 D 节）。
//
// 系统管理员在机构详情里，把已停用机构待分派池中未派出的线索（待分派池、待分派决定、不派）
// 重新指定给未停用机构。理由必填；不构成指定管辖，不加锁。是否有权由服务端决定，
// 前端只按会话操作码清单决定显示什么。

import { apiFetch, type ApiDispatch } from '../api';

/** 会话里授予系统管理的操作码。 */
export const POOL_REASSIGN = 'clue.pool.reassign';

/** 池中一条未派出线索。 */
export interface PoolClue {
  readonly clueId: string;
  readonly code: string;
  /** in_pool｜pending_decision｜held。 */
  readonly status: string;
  readonly domain: string;
  readonly registeredAt: string;
}

/** 池线索状态的界面文案。 */
export function poolStatusLabel(status: string): string {
  switch (status) {
    case 'in_pool':
      return '待分派';
    case 'pending_decision':
      return '待分派决定';
    case 'held':
      return '不派';
    default:
      return status;
  }
}

/** 取已停用机构的池线索清单。失败返回 null（界面显示重试）。 */
export async function loadPoolClues(dispatch: ApiDispatch, orgUnitId: string): Promise<PoolClue[] | null> {
  const response = await apiFetch(dispatch, `/api/admin/org-units/${encodeURIComponent(orgUnitId)}/pool-clues`);
  if (!response.ok) return null;
  const body = (await response.json().catch(() => ({}))) as { clues?: PoolClue[] };
  return Array.isArray(body.clues) ? body.clues : [];
}

/** 重新指定的判别结果。 */
export type PoolReassignResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** 失败文案：理由必填、目标已停用、线索已派出或状态变化、无权限。 */
export function poolReassignFailureText(status: number, body: unknown): string {
  const value = (typeof body === 'object' && body !== null ? body : {}) as {
    result?: string;
    reason?: string;
    rules?: readonly string[];
  };
  if (status === 403) return '你没有权限执行这个操作。';
  if (status === 400) {
    return value.rules?.[0] === 'missing-reassign-reason' ? '重新指定须填写理由。' : '提交未通过，请检查后再试。';
  }
  if (value.result === 'concurrent-change') return '线索状态已被他人变更，请刷新后重试。';
  if (value.reason === 'org-unit-deactivated') return '目标机构已停用，请选择未停用的机构。';
  if (value.reason === 'org-unit-not-deactivated') return '该线索所在机构未停用，不能重新指定。';
  if (value.result === 'invalid-state') return '该线索已派出，不在待分派池里，不能重新指定。';
  return '操作未完成，请重试。';
}

/** 重新指定一条线索的接收机构。 */
export async function reassignPoolClue(
  dispatch: ApiDispatch,
  clue: PoolClue,
  input: { readonly orgUnitId: string; readonly reason: string },
): Promise<PoolReassignResult> {
  const response = await apiFetch(dispatch, `/api/clues/${encodeURIComponent(clue.clueId)}/pool-reassign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, expectedStatus: clue.status }),
  });
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => null)) as unknown;
  return { ok: false, message: poolReassignFailureText(response.status, body) };
}
