// 调查环节取数。页面只展示服务端给出的入口。

import { apiFetch } from '../api';
import type { SessionStore } from '../session';
import type { InvestigationView } from './InvestigationPanel';

export function investigationLoader(store: SessionStore) {
  return async ({ params }: { params: { caseId?: string } }) => {
    const caseId = params.caseId ?? '';
    const response = await apiFetch(store.dispatch, `/api/cases/${caseId}/investigation`);
    if (!response.ok) return { view: null as InvestigationView | null };
    return { view: (await response.json()) as InvestigationView };
  };
}
