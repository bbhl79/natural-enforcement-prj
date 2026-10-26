// 流转留痕取数（#207 线索中心抽屉「流转与留痕」页签）。
//
// 取数模式参考 duplicate.ts：async 函数直接 fetch。
// 留痕列表不含 detail，仅含时间、操作人、操作人机构、动作描述。

import { data } from 'react-router';

import { apiFetch, type ApiDispatch } from '../api';

/** 后端返回的留痕行（不含 detail）。 */
interface BackendTrailRow {
  readonly id: string;
  readonly createdAt: string;
  readonly action: string;
  readonly outcome: string;
  readonly actorCode: string | null;
  readonly subjectCode: string | null;
  readonly orgUnitId: string | null;
  readonly opcode: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly reason: string | null;
}

/** 一条留痕（前端展示用）。 */
export interface TrailEntry {
  readonly action: string;
  readonly actionLabel: string;
  readonly actorName: string;
  readonly orgName: string;
  readonly createdAt: string;
}

/** 后端返回的留痕列表包装。 */
interface TrailResponse {
  readonly result: string;
  readonly rows: readonly BackendTrailRow[];
}

/** 取流转留痕列表。 */
export async function loadTrail(dispatch: ApiDispatch, clueId: string): Promise<TrailEntry[]> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/trail`);
  if (!response.ok) throw data({ status: response.status }, response.status);
  const body = (await response.json()) as TrailResponse;
  return (body.rows ?? []).map((row) => ({
    action: row.action,
    actionLabel: row.action,
    actorName: row.actorCode ?? '-',
    orgName: row.orgUnitId ?? '-',
    createdAt: row.createdAt,
  }));
}