// 立案呈批数据层（#234）。

import { apiFetch, type ApiDispatch } from '../api';

export type FilingConclusion = 'file' | 'no-case';

export interface FilingApprovalView {
  readonly id: string;
  readonly status: string;
  readonly adminReview: string | null;
  readonly currentVersionNo: number;
  readonly drafterId: string;
  readonly conclusion: string | null;
  readonly content: unknown;
  readonly steps: readonly {
    readonly id: string;
    readonly versionNo: number;
    readonly step: string;
    readonly actorId: string;
    readonly opinion: string | null;
    readonly createdAt: string;
  }[];
  readonly pending: boolean;
}

export type FilingActionResult =
  | { readonly ok: true; readonly status: number; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly status: number; readonly body: unknown };

async function readResult(response: Response): Promise<FilingActionResult> {
  const body = (await response.json().catch(() => null)) as unknown;
  if (response.ok) {
    return { ok: true, status: response.status, body: (body ?? {}) as Record<string, unknown> };
  }
  return { ok: false, status: response.status, body };
}

export async function loadFilingApproval(
  dispatch: ApiDispatch,
  clueId: string,
): Promise<{ readonly approval: FilingApprovalView | null }> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/filing-approval`);
  if (!response.ok) throw new Error(`立案呈批取数失败（${response.status}）`);
  const body = (await response.json()) as {
    readonly approval?: FilingApprovalView | null;
  };
  return { approval: body.approval ?? null };
}

export async function saveFilingDraft(
  dispatch: ApiDispatch,
  clueId: string,
  content: unknown,
): Promise<FilingActionResult> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/filing-approval`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  return readResult(response);
}

export async function submitFilingApproval(
  dispatch: ApiDispatch,
  approvalId: string,
): Promise<FilingActionResult> {
  const response = await apiFetch(dispatch, `/api/filing-approvals/${approvalId}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  return readResult(response);
}

export async function reviewFilingApproval(
  dispatch: ApiDispatch,
  approvalId: string,
  opinion?: string,
): Promise<FilingActionResult> {
  const response = await apiFetch(dispatch, `/api/filing-approvals/${approvalId}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ opinion: opinion ?? null }),
  });
  return readResult(response);
}

export async function approveFilingApproval(
  dispatch: ApiDispatch,
  approvalId: string,
  opinion?: string,
): Promise<FilingActionResult> {
  const response = await apiFetch(dispatch, `/api/filing-approvals/${approvalId}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ opinion: opinion ?? null }),
  });
  return readResult(response);
}

/** 立案呈批不批的原因。名称与 #238 目录一致。系统不代选。 */
export const FILING_RETURN_REASONS = [
  ['R1', '无违法事实（违法事实不成立）'],
  ['R2', '事实不清、证据不足，需补充调查'],
  ['R3', '事实清楚但不构成犯罪'],
  ['R4', '定性或法律适用错误，事实不变'],
  ['R5', '程序瑕疵（未依法告知、送达瑕疵、人员不足等）'],
  ['R6', '超出本机关管辖'],
  ['R7', '法律依据变化（新法施行、补录法条版本）'],
  ['R8', '裁量不当（罚种、金额、并处事项）'],
  ['R9', '文字、格式、文号'],
  ['R10', '其他（须写明）'],
] as const;

export interface FilingReturnInput {
  readonly reasonCode: string;
  readonly note: string;
  readonly receiverId: string;
  readonly inheritedCode: string;
}

export async function returnFilingApproval(
  dispatch: ApiDispatch,
  approvalId: string,
  input: FilingReturnInput,
): Promise<FilingActionResult> {
  const response = await apiFetch(dispatch, `/api/filing-approvals/${approvalId}/return`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      reasonCode: input.reasonCode,
      note: input.note,
      receiverId: input.receiverId,
      inheritedCode: input.inheritedCode === '' ? null : input.inheritedCode,
    }),
  });
  return readResult(response);
}

export async function withdrawFilingApproval(
  dispatch: ApiDispatch,
  approvalId: string,
  opinion: string,
): Promise<FilingActionResult> {
  const response = await apiFetch(dispatch, `/api/filing-approvals/${approvalId}/withdraw`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ opinion }),
  });
  return readResult(response);
}

export async function loadFilingTodos(dispatch: ApiDispatch): Promise<readonly Record<string, unknown>[]> {
  const response = await apiFetch(dispatch, '/api/filing-approvals/todo');
  if (!response.ok) throw new Error(`立案呈批待办取数失败（${response.status}）`);
  const body = (await response.json()) as { readonly items?: readonly Record<string, unknown>[] };
  return body.items ?? [];
}
