// 工作台看板卡片数据层（#207）。
// 从 GET /api/workbench/card-counts 取数。

import { apiFetch, type ApiDispatch } from '../api';

/** 工作台卡片计数（与后端 WorkbenchCardCounts 同构）。 */
export interface WorkbenchCardCounts {
  frontline: {
    pendingDecision: number;
    orgAssigned: number;
    handlerAssigned: number;
    held: number;
    reminders: number;
    designationPending: number;
  };
  leader: {
    lawReview: number;
    approval: number;
    reminders: number;
    designationPending: number;
  };
  supervision: {
    total: number;
    pendingDispatch: number;
    held: number;
    closed: number;
  };
}

/** 从后端加载工作台卡片计数。 */
export async function loadCardCounts(
  dispatch: ApiDispatch,
): Promise<WorkbenchCardCounts> {
  const response = await apiFetch(dispatch, '/api/workbench/card-counts');
  if (!response.ok) {
    const body = await response.json().catch(() => ({ reason: 'unknown' }));
    throw new Error(`card counts query failed: ${JSON.stringify(body)}`);
  }
  return (await response.json()) as WorkbenchCardCounts;
}