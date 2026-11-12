// 用途：案件期限页的路由 loader，读取服务端算好的期限视图。
// 调用方：frontend/src/router.tsx 的 case-deadline 路由，路径 case/:caseId/deadline。
// 边界：只读；响应非 2xx 时返回 view 为 null，由页面展示空态。
// 接口：GET /api/cases/:id/deadlines；操作码 case.read。
// 期限页取数。页面只展示服务端给出的到期日和提示。

import { apiFetch } from '../api';
import type { SessionStore } from '../session';
import type { DeadlineView } from './DeadlinePanel';

/** 期限页 loader：按路由参数 caseId 请求期限视图；请求失败时返回空视图，不抛错。 */
export function deadlineLoader(store: SessionStore) {
  return async ({ params }: { params: { caseId?: string } }) => {
    const caseId = params.caseId ?? '';
    const response = await apiFetch(store.dispatch, `/api/cases/${caseId}/deadlines`);
    if (!response.ok) return { view: null as DeadlineView | null };
    return { view: (await response.json()) as DeadlineView };
  };
}
