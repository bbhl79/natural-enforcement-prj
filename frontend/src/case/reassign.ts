// 案件详情「人员」页签的数据层（#239）。
// 发起改派走既有呈批入口，批准走既有批准入口，效力认定不另设呈批。

import { apiFetch, type ApiDispatch } from '../api';

export interface HandlerView {
  readonly id: string;
  readonly personnelId: string;
  readonly role: string;
  readonly roleName: string;
  readonly assignedAt: string;
  readonly endedAt: string | null;
}

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

export interface MaterialEffectivenessView {
  readonly id: string;
  readonly conclusion: string;
  readonly conclusionName: string;
  readonly reason: string;
  readonly determinedBy: string;
  readonly determinedAt: string;
}

export interface MaterialView {
  readonly materialId: string;
  readonly kind: string;
  readonly createdAt: string;
  readonly effectiveness: MaterialEffectivenessView | null;
}

export interface ReassignListView {
  readonly handlers: readonly HandlerView[];
  readonly formerHandlers: readonly HandlerView[];
  readonly reassignments: readonly ReassignmentView[];
  readonly materials: readonly MaterialView[];
  readonly invalidMaterialIds: readonly string[];
}

export const REASSIGN_REASONS = [
  { value: 'transfer', label: '调岗' },
  { value: 'leave', label: '离职' },
  { value: 'recusal', label: '回避' },
  { value: 'other', label: '其他' },
] as const;

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