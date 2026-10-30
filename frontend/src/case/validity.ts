// 有效性确认页取数。页面只展示服务端给出的入口。

import { apiFetch } from '../api';
import type { SessionStore } from '../session';
import type { ValidityView } from './ValidityPanel';

export function validityLoader(store: SessionStore) {
  return async ({ params }: { params: { caseId?: string } }) => {
    const caseId = params.caseId ?? '';
    const response = await apiFetch(store.dispatch, `/api/cases/${caseId}/validity`);
    if (!response.ok) return { view: null as ValidityView | null };
    return { view: (await response.json()) as ValidityView };
  };
}