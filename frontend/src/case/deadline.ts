// 期限页取数。页面只展示服务端给出的到期日和提示。

import { apiFetch } from '../api';
import type { SessionStore } from '../session';
import type { DeadlineView } from './DeadlinePanel';

export function deadlineLoader(store: SessionStore) {
  return async ({ params }: { params: { caseId?: string } }) => {
    const caseId = params.caseId ?? '';
    const response = await apiFetch(store.dispatch, `/api/cases/${caseId}/deadlines`);
    if (!response.ok) return { view: null as DeadlineView | null };
    return { view: (await response.json()) as DeadlineView };
  };
}
