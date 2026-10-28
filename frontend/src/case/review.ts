// 审理页取数。页面只展示服务端给出的入口。

import { apiFetch } from '../api';
import type { SessionStore } from '../session';
import type { ReviewView } from './ReviewPanel';

export function reviewLoader(store: SessionStore) {
  return async ({ params }: { params: { caseId?: string } }) => {
    const caseId = params.caseId ?? '';
    const response = await apiFetch(store.dispatch, `/api/cases/${caseId}/review`);
    if (!response.ok) return { view: null as ReviewView | null };
    return { view: (await response.json()) as ReviewView };
  };
}