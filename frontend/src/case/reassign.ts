// 用途：案件人员页签的数据层：读承办人与改派、发起与批准改派、材料效力认定。
// 调用方：frontend/src/case/CaseConflictPage.tsx 与 frontend/src/case/CaseReassignSection.tsx。
// 接口：GET/POST /api/cases/:id/reassignments、POST /api/cases/:id/reassignments/:reassignmentId/approve、POST /api/cases/:id/material-effectivities。
// 案件详情「人员」页签的数据层（#239）。
// 发起改派走既有呈批入口，批准走既有批准入口，效力认定不另设呈批。

import { apiFetch, type ApiDispatch } from '../api';

/** 承办人任职视图：人员、角色与任职起止时间。 */
export interface HandlerView {
  readonly id: string;
  readonly personnelId: string;
  readonly role: string;
  readonly roleName: string;
  readonly assignedAt: string;
  readonly endedAt: string | null;
}

/** 改派呈批视图：状态、原因、拟任承办人与审批时间。 */
export interface ReassignmentView {
  readonly id: string;
  readonly status: string;
  readonly statusName: string;
  readonly reasonCode: string;
  readonly reasonName: string;
  readonly note: string;
  readonly conflictLineageId: string | null;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly proposedHandlers: readonly { readonly personnelId: string; readonly role: string }[];
}

/** 材料效力认定视图：结论、理由与认定人、认定时间。 */
export interface MaterialEffectivenessView {
  readonly id: string;
  readonly conclusion: string;
  readonly conclusionName: string;
  readonly reason: string;
  readonly determinedBy: string;
  readonly determinedAt: string;
}

/** 材料视图：材料标识、种类、形成时间与效力认定。 */
export interface MaterialView {
  readonly materialId: string;
  readonly kind: string;
  readonly createdAt: string;
  readonly effectiveness: MaterialEffectivenessView | null;
}

/** 人员页签整页视图：现任与前任承办人、改派呈批、材料与失效材料。 */
export interface ReassignListView {
  readonly handlers: readonly HandlerView[];
  readonly formerHandlers: readonly HandlerView[];
  readonly reassignments: readonly ReassignmentView[];
  readonly materials: readonly MaterialView[];
  readonly invalidMaterialIds: readonly string[];
}

/** 改派原因选项，值对应后端登记的原因码。 */
export const REASSIGN_REASONS = [
  { value: 'transfer', label: '调岗' },
  { value: 'leave', label: '离职' },
  { value: 'recusal', label: '回避' },
  { value: 'other', label: '其他' },
] as const;

/** 材料效力结论选项，值对应后端登记的结论码。 */
export const EFFECTIVENESS_CONCLUSIONS = [
  { value: 'valid', label: '有效' },
  { value: 'invalid', label: '无效' },
  { value: 'needs-correction', label: '需补正' },
] as const;

async function readBody(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => null)) as unknown;
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function messageOf(body: Record<string, unknown>, fallback: string): string {
  const message = typeof body.message === 'string' ? body.message : '';
  const outlet = typeof body.outlet === 'string' ? body.outlet : '';
  if (message !== '' && outlet !== '') return `${message}。${outlet}`;
  if (message !== '') return message;
  if (typeof body.reason === 'string') return body.reason;
  return fallback;
}

/** 读取人员页签视图；接口 GET /api/cases/:id/reassignments，操作码 case.read；非 2xx 抛出后端原因。 */
export async function loadReassignments(dispatch: ApiDispatch, caseId: string): Promise<ReassignListView> {
  const response = await apiFetch(dispatch, `/api/cases/${caseId}/reassignments`);
  const body = await readBody(response);
  if (!response.ok) throw new Error(messageOf(body, '取数失败'));
  return {
    handlers: Array.isArray(body.handlers) ? (body.handlers as HandlerView[]) : [],
    formerHandlers: Array.isArray(body.formerHandlers) ? (body.formerHandlers as HandlerView[]) : [],
    reassignments: Array.isArray(body.reassignments) ? (body.reassignments as ReassignmentView[]) : [],
    materials: Array.isArray(body.materials) ? (body.materials as MaterialView[]) : [],
    invalidMaterialIds: Array.isArray(body.invalidMaterialIds)
      ? body.invalidMaterialIds.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

/** 发起改派呈批；接口 POST /api/cases/:id/reassignments，操作码 case.reassign.submit；失败抛出后端原因。 */
export async function submitReassignment(
  dispatch: ApiDispatch,
  caseId: string,
  input: {
    readonly mainId: string;
    readonly assistIds: readonly string[];
    readonly reasonCode: string;
    readonly note: string;
    readonly conflictLineageId: string | null;
  },
): Promise<Record<string, unknown>> {
  const response = await apiFetch(dispatch, `/api/cases/${caseId}/reassignments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await readBody(response);
  if (!response.ok) throw new Error(messageOf(body, '改派发起失败'));
  return body;
}

/** 批准改派呈批；接口 POST /api/cases/:id/reassignments/:reassignmentId/approve，操作码 doc.approve；失败抛出后端原因。 */
export async function approveReassignment(
  dispatch: ApiDispatch,
  caseId: string,
  reassignmentId: string,
): Promise<Record<string, unknown>> {
  const response = await apiFetch(dispatch, `/api/cases/${caseId}/reassignments/${reassignmentId}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ opinion: null }),
  });
  const body = await readBody(response);
  if (!response.ok) throw new Error(messageOf(body, '改派批准失败'));
  return body;
}

/** 认定材料效力；接口 POST /api/cases/:id/material-effectivities，操作码 doc.draft；失败抛出后端原因。 */
export async function determineMaterial(
  dispatch: ApiDispatch,
  caseId: string,
  input: { readonly materialId: string; readonly conclusion: string; readonly reason: string },
): Promise<Record<string, unknown>> {
  const response = await apiFetch(dispatch, `/api/cases/${caseId}/material-effectivities`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await readBody(response);
  if (!response.ok) throw new Error(messageOf(body, '效力认定失败'));
  return body;
}