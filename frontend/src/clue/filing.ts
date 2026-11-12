// 用途：立案呈批数据层：取呈批单与待办，存草稿、提交、审核、批准、退回、撤回。
// 调用方：frontend/src/clue/ClueFilingPanel.tsx。
// 接口：GET/POST /api/clues/:id/filing-approval（操作码 doc.read、doc.draft）；POST /api/filing-approvals/:id/{submit,review,approve,return,withdraw}；GET /api/filing-approvals/todo。
// 立案呈批数据层（#234）。

import { apiFetch, type ApiDispatch } from '../api';

/** 立案结论：立案或不予立案。 */
export type FilingConclusion = 'file' | 'no-case';

/** 呈批单视图：版本、审批步骤与是否待办。 */
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

/** 写操作结果；ok 表示 HTTP 成功，body 为响应体。 */
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

/** 取线索当前的立案呈批单；GET /api/clues/:id/filing-approval，操作码 doc.read。无呈批单时 approval 为 null。 */
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

/** 保存呈批草稿；POST /api/clues/:id/filing-approval，操作码 doc.draft。 */
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

/** 提交呈批；POST /api/filing-approvals/:id/submit，操作码 doc.submit。 */
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

/** 行政审核；POST /api/filing-approvals/:id/review，操作码 doc.admin.review。 */
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

/** 行政审批（批准或不予立案）；POST /api/filing-approvals/:id/approve，操作码 doc.approve。 */
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

/** 退回草稿的输入：原因码、说明、接收人与沿用编号。 */
export interface FilingReturnInput {
  readonly reasonCode: string;
  readonly note: string;
  readonly receiverId: string;
  readonly inheritedCode: string;
}

/** 退回草稿；POST /api/filing-approvals/:id/return，操作码按阶段取 doc.admin.review 或 doc.approve。 */
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

/** 撤回呈批；POST /api/filing-approvals/:id/withdraw，操作码 doc.submit。服务端另校验起草人与当前经办人。 */
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

/** 取当前用户的立案呈批待办；GET /api/filing-approvals/todo，无操作码（服务按角色筛选）。当前无前端调用方。 */
export async function loadFilingTodos(dispatch: ApiDispatch): Promise<readonly Record<string, unknown>[]> {
  const response = await apiFetch(dispatch, '/api/filing-approvals/todo');
  if (!response.ok) throw new Error(`立案呈批待办取数失败（${response.status}）`);
  const body = (await response.json()) as { readonly items?: readonly Record<string, unknown>[] };
  return body.items ?? [];
}
