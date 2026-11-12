// 用途：案件审理页的路由 loader，读取服务端给出的审理环节视图。
// 调用方：frontend/src/router.tsx 的 case-review 路由，路径 case/:caseId/review。
// 边界：只读；响应非 2xx 时返回 view 为 null，由页面展示空态。
// 接口：GET /api/cases/:id/review；操作码 case.read。
// 审理页取数。页面只展示服务端给出的入口。

import { apiFetch } from '../api';
import type { SessionStore } from '../session';
import type { ReviewView } from './ReviewPanel';

/** 审理页 loader：按路由参数 caseId 请求审理视图；请求失败时返回空视图，不抛错。 */
export function reviewLoader(store: SessionStore) {
  return async ({ params }: { params: { caseId?: string } }) => {
    const caseId = params.caseId ?? '';
    const response = await apiFetch(store.dispatch, `/api/cases/${caseId}/review`);
    if (!response.ok) return { view: null as ReviewView | null };
    return { view: (await response.json()) as ReviewView };
  };
}