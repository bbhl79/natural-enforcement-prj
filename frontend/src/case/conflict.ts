// 案件详情「回避」页的数据层（#237）。
// 登记声明走既有拟制入口，回避决定走既有批准入口。页面不出现票号。

import { apiFetch, type ApiDispatch } from '../api';

export interface ConflictRecordView {
  readonly id: string;
  readonly lineageId: string;
  readonly personId: string;
  readonly source: string;
  readonly sourceName: string;
  readonly reason: string;
  readonly status: string;
  readonly statusName: string;
  readonly seq: number;
  readonly createdAt: string;
}

export interface ConflictDecisionView {
  readonly id: string;
  readonly lineageId: string;
  readonly deciderId: string;
  readonly conclusion: string;
  readonly conclusionName: string;
  readonly reason: string;
  readonly decidedAt: string;
}

export interface ConflictListView {
  readonly records: readonly ConflictRecordView[];
  readonly decisions: readonly ConflictDecisionView[];
  readonly active: readonly ConflictRecordView[];
}

export const CONFLICT_SOURCES = [
  { value: 'self', label: '本人申请' },
  { value: 'party', label: '当事人申请' },
  { value: 'other', label: '他人勾选' },
] as const;

export const DECISION_CONCLUSIONS = [
  { value: 'recuse', label: '回避' },
  { value: 'reject', label: '驳回' },
] as const;

async function readBody(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => null)) as unknown;
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

export async function loadConflicts(dispatch: ApiDispatch, caseId: string): Promise<ConflictListView> {
  const response = await apiFetch(dispatch, `/api/cases/${caseId}/conflicts`);
  const body = await readBody(response);
  if (!response.ok) {
    const reason = typeof body.reason === 'string' ? body.reason : '取数失败';
    throw new Error(reason);
  }
  return {
    records: Array.isArray(body.records) ? (body.records as ConflictRecordView[]) : [],
    decisions: Array.isArray(body.decisions) ? (body.decisions as ConflictDecisionView[]) : [],
    active: Array.isArray(body.active) ? (body.active as ConflictRecordView[]) : [],
  };
}

export async function declareConflict(
  dispatch: ApiDispatch,
  caseId: string,
  input: { readonly personId: string; readonly source: string; readonly reason: string },
): Promise<Record<string, unknown>> {
  const response = await apiFetch(dispatch, `/api/cases/${caseId}/conflicts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(typeof body.message === 'string' ? body.message : typeof body.reason === 'string' ? body.reason : '登记失败');
  }
  return body;
}

export async function decideConflict(
  dispatch: ApiDispatch,
  caseId: string,
  lineageId: string,
  input: { readonly conclusion: string; readonly reason: string },
): Promise<Record<string, unknown>> {
  const response = await apiFetch(dispatch, `/api/cases/${caseId}/conflicts/${lineageId}/decisions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(typeof body.message === 'string' ? body.message : typeof body.reason === 'string' ? body.reason : '决定失败');
  }
  return body;
}
