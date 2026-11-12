// 用途：案件有效性确认页的路由 loader，读取服务端给出的有效性视图。
// 调用方：frontend/src/router.tsx 的 case-validity 路由，路径 case/:caseId/validity。
// 边界：只读；响应非 2xx 时返回 view 为 null，由页面展示空态。
// 接口：GET /api/cases/:id/validity；操作码 case.read。
// 有效性确认页取数。页面只展示服务端给出的入口。

import { apiFetch } from '../api';
import type { SessionStore } from '../session';
import type { ValidityView } from './ValidityPanel';

/** 有效性确认页 loader：按路由参数 caseId 请求有效性视图；请求失败时返回空视图，不抛错。 */
export function validityLoader(store: SessionStore) {
  return async ({ params }: { params: { caseId?: string } }) => {
    const caseId = params.caseId ?? '';
    const response = await apiFetch(store.dispatch, `/api/cases/${caseId}/validity`);
    if (!response.ok) return { view: null as ValidityView | null };
    return { view: (await response.json()) as ValidityView };
  };
}