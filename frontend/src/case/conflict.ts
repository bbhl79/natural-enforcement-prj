// 用途：案件回避页的数据层：读声明与决定、登记声明、作出决定、签出前检查。
// 调用方：frontend/src/case/CaseConflictPage.tsx。
// 接口：GET /api/cases/:id/conflicts、POST /api/cases/:id/conflicts、POST /api/cases/:id/conflicts/:lineageId/decisions、POST /api/cases/:id/sign-checks。
// 案件详情「回避」页的数据层（#237）。
// 登记声明走既有拟制入口，回避决定走既有批准入口。页面不出现票号。

import { apiFetch, type ApiDispatch } from '../api';

/** 回避声明视图：声明人、来源、理由与当前状态。 */
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

/** 回避决定视图：决定人、结论、理由与决定时间。 */
export interface ConflictDecisionView {
  readonly id: string;
  readonly lineageId: string;
  readonly deciderId: string;
  readonly conclusion: string;
  readonly conclusionName: string;
  readonly reason: string;
  readonly decidedAt: string;
}

/** 回避页整页视图：全部声明、已作决定与生效中的声明。 */
export interface ConflictListView {
  readonly records: readonly ConflictRecordView[];
  readonly decisions: readonly ConflictDecisionView[];
  readonly active: readonly ConflictRecordView[];
}

/** 回避声明来源选项，值对应后端登记的 source。 */
export const CONFLICT_SOURCES = [
  { value: 'self', label: '本人申请' },
  { value: 'party', label: '当事人申请' },
  { value: 'other', label: '他人勾选' },
] as const;

/** 回避决定结论选项，值对应后端决定的 conclusion。 */
export const DECISION_CONCLUSIONS = [
  { value: 'recuse', label: '回避' },
  { value: 'reject', label: '驳回' },
] as const;

/** 签出前的签署种类选项，值对应后端登记表内的 signKind。 */
export const SIGN_KINDS = [
  { value: 'trial-opinion', label: '审理意见' },
  { value: 'legal-opinion', label: '法审意见' },
  { value: 'decision', label: '决定' },
] as const;

async function readBody(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => null)) as unknown;
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

/** 读取案件回避视图；接口 GET /api/cases/:id/conflicts，操作码 case.read；非 2xx 抛出后端原因。 */
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

/** 登记一条回避声明；接口 POST /api/cases/:id/conflicts，操作码 doc.draft；失败抛出后端原因。 */
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

/** 对指定声明链作出决定；接口 POST /api/cases/:id/conflicts/:lineageId/decisions，操作码 doc.approve；失败抛出后端原因。 */
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

// 接口 POST /api/cases/:id/sign-checks，无操作码（服务内不做操作码判定，仅需登录会话）。
/** 检查本人或指定人员能否签出。409 时返回票面文案，不把它当成页面故障。 */
export async function checkSign(
  dispatch: ApiDispatch,
  caseId: string,
  input: { readonly personId: string; readonly signKind: string },
): Promise<{ readonly allowed: boolean; readonly text: string }> {
  const response = await apiFetch(dispatch, `/api/cases/${caseId}/sign-checks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      personId: input.personId,
      signKind: input.signKind,
    }),
  });
  const body = await readBody(response);
  if (response.status === 409) {
    const message = typeof body.message === 'string' ? body.message : '';
    const outlet = typeof body.outlet === 'string' ? body.outlet : '';
    return { allowed: false, text: outlet === '' ? message : `${message}。${outlet}` };
  }
  if (!response.ok) {
    throw new Error(typeof body.reason === 'string' ? body.reason : '检查失败');
  }
  return { allowed: true, text: '可以签出' };
}
