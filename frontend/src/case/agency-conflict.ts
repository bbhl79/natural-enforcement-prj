// 案件详情上的机关层利害关系（#263）。
// 勾选走既有拟制入口。页面不出现票号。取消勾选由服务拒绝。

import { apiFetch, type ApiDispatch } from '../api';

export const AGENCY_CONFLICT_WARNING = '本机关与本案当事人存在利害关系';
export const AGENCY_CONFLICT_OUTLET = '线下报请上级处理';

export interface AgencyConflictView {
  readonly marked: boolean;
  readonly warning: string | null;
  readonly outlet: string | null;
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => null)) as unknown;
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

export async function loadAgencyConflict(dispatch: ApiDispatch, caseId: string): Promise<AgencyConflictView> {
  const response = await apiFetch(dispatch, `/api/cases/${caseId}/agency-conflict`);
  const body = await readBody(response);
  if (!response.ok) {
    const reason = typeof body.reason === 'string' ? body.reason : '取数失败';
    throw new Error(reason);
  }
  return {
    marked: body.marked === true,
    warning: typeof body.warning === 'string' ? body.warning : null,
    outlet: typeof body.outlet === 'string' ? body.outlet : null,
  };
}

/** 登记勾选。已勾选或取消勾选时抛出服务端原文。 */
export async function markAgencyConflict(dispatch: ApiDispatch, caseId: string): Promise<AgencyConflictView> {
  const response = await apiFetch(dispatch, `/api/cases/${caseId}/agency-conflict`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ checked: true }),
  });
  const body = await readBody(response);
  if (!response.ok) {
    const message = typeof body.message === 'string' ? body.message : typeof body.reason === 'string' ? body.reason : '登记失败';
    throw new Error(message);
  }
  return {
    marked: body.marked === true,
    warning: typeof body.warning === 'string' ? body.warning : AGENCY_CONFLICT_WARNING,
    outlet: typeof body.outlet === 'string' ? body.outlet : AGENCY_CONFLICT_OUTLET,
  };
}
