// 分派决定与两步分派的数据层（#214；规格 B/D/H 节）。
//
// 决定步集中展示「与哪条线索重复／与谁重复」：多面命中按对方线索分组折叠，
// 每个命中面对显示「占本线索 x.x%／占对方 y.y%」（保留 1 位小数，达标一方加粗）。
// 两步分派与辖区建议共用分派视图（GET /api/clues/:id/dispatch）。

import { apiFetch, type ApiDispatch } from '../api';

/** 一个命中面对。 */
export interface DispatchHitPair {
  readonly partId: string;
  readonly partIndex: number;
  readonly otherPartId: string;
  readonly selfRatio: number;
  readonly otherRatio: number;
  readonly intersectionArea: number;
}

/** 按对方线索分组的命中。 */
export interface DispatchHitGroup {
  readonly otherClueId: string;
  readonly otherClueCode: string;
  readonly otherStatus: string;
  readonly open: boolean;
  readonly pairs: readonly DispatchHitPair[];
}

/** 一个街道的辖区建议明细。 */
export interface SuggestionStreet {
  readonly streetCode: string;
  readonly streetName: string;
  readonly area: number;
  readonly faces: readonly { readonly partIndex: number; readonly area: number }[];
}

/** 一个候选机构的辖区建议。 */
export interface AreaSuggestion {
  readonly orgUnitId: string;
  readonly orgName: string;
  readonly area: number;
  readonly ratio: number;
  readonly streets: readonly SuggestionStreet[];
}

/** 辖区建议视图。 */
export interface SuggestionView {
  readonly result: string;
  readonly clueId: string;
  readonly code: string;
  readonly kind: 'face' | 'point';
  readonly suggestions: readonly AreaSuggestion[];
  readonly crossDistrict: boolean;
  readonly hint: string | null;
  readonly unavailableReason: string | null;
}

/** 分派视图。 */
export interface DispatchView {
  readonly result: string;
  readonly clueId: string;
  readonly code: string;
  readonly status: string;
  readonly domain: string;
  readonly sourceCode: string;
  readonly sourceName: string;
  readonly complaint: boolean;
  readonly dupComputedAt: string | null;
  readonly hitGroups: readonly DispatchHitGroup[];
  readonly assignment: {
    readonly orgUnitId: string;
    readonly orgName: string;
    readonly kind: string;
    readonly designate: boolean;
  } | null;
  readonly handlers: readonly { readonly personnelId: string; readonly code: string; readonly name: string; readonly role: string }[];
  readonly candidates: readonly { readonly personnelId: string; readonly code: string; readonly name: string }[];
  readonly suggestion: SuggestionView;
  readonly mayDecide: boolean;
  readonly mayAssignOrg: boolean;
  readonly mayReassignOrg: boolean;
  readonly mayAssignPeople: boolean;
  /** 能不能登记移送（池所属机构内勤／承办机构内勤；#216）。 */
  readonly mayTransfer: boolean;
  /** 能不能登记其他（#229；主办／协办本人或承办机构内勤）。 */
  readonly mayRecordOther: boolean;
  /** 进行中的指定管辖报请（#215；无即 null）。 */
  readonly designation: DesignationRequestView | null;
  /** 当前操作者可发起报请指定管辖。 */
  readonly mayRequestDesignation: boolean;
  /** 当前操作者是受理人，可处理报请（designate=true 指定或驳回）。 */
  readonly mayReviewDesignation: boolean;
  /** 报请期间的指定锁拦当前操作者（受理链条的下级）。 */
  readonly designationLocked: boolean;
  /** 初步涉嫌违法类型编码列表（#207 P7）。 */
  readonly typeCodes: readonly string[];
  /** 是否存在需个案判断的规划类项（#207 P7）。 */
  readonly hasCaseByCasePlanningType: boolean;
}

/** 进行中的指定管辖报请（#215）。 */
export interface DesignationRequestView {
  readonly requestId: string;
  readonly requestingOrgId: string;
  readonly requestingOrgName: string;
  readonly proposedOrgId: string | null;
  readonly proposedOrgName: string | null;
  readonly reviewerOrgId: string;
  readonly reviewerOrgName: string;
  readonly reason: string;
  readonly createdAt: string;
}

/** 受理人待办里的一条报请事项（#215）。 */
export interface DesignationTodoItem {
  readonly requestId: string;
  readonly clueId: string;
  readonly clueCode: string;
  readonly requestingOrgId: string;
  readonly requestingOrgName: string;
  readonly proposedOrgId: string | null;
  readonly proposedOrgName: string | null;
  readonly reviewerOrgId: string;
  readonly reviewerOrgName: string;
  readonly reason: string;
  readonly createdAt: string;
}

/** 写动作的判别结果。成功后由调用方重新取分派视图。 */
export type DispatchActionResult =
  | { readonly ok: true; readonly status: number }
  | { readonly ok: false; readonly status: number; readonly body: unknown };

/** 取分派视图。 */
export async function loadDispatchView(dispatch: ApiDispatch, clueId: string): Promise<DispatchView> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/dispatch`);
  if (!response.ok) throw new Error(`分派视图取数失败（${response.status}）`);
  return (await response.json()) as DispatchView;
}

async function readResult(response: Response): Promise<DispatchActionResult> {
  const body = (await response.json().catch(() => null)) as unknown;
  if (response.ok) return { ok: true, status: response.status };
  return { ok: false, status: response.status, body };
}

/** 分派决定：decision = dispatch（派）｜hold（不派）。 */
export async function submitDecide(
  dispatch: ApiDispatch,
  clueId: string,
  input: {
    readonly decision: 'dispatch' | 'hold';
    readonly acknowledged: boolean;
    readonly expectedStatus: string;
    readonly conflictResolution?: string;
    readonly conflictBasis?: string;
  },
): Promise<DispatchActionResult> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readResult(response);
}

/** 派机构（首次分派／重新分派／指定管辖）。 */
export async function submitAssignOrg(
  dispatch: ApiDispatch,
  clueId: string,
  input: {
    readonly orgUnitId: string;
    readonly expectedStatus: string;
    readonly reason: string;
    readonly designate: boolean;
  },
): Promise<DispatchActionResult> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/assign-org`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readResult(response);
}

/** 派主办／协办。 */
export async function submitAssignPeople(
  dispatch: ApiDispatch,
  clueId: string,
  input: { readonly mainId: string; readonly assistIds: readonly string[]; readonly expectedStatus: string },
): Promise<DispatchActionResult> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/assign-people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readResult(response);
}

/** 移送登记的提交内容（附件为页面取的本地文件，选填 0..n）。 */
export interface TransferInput {
  readonly transferOrg: string;
  readonly documentNo: string;
  /** 发函日期（YYYY-MM-DD；空＝服务端缺省北京当日）。 */
  readonly letterDate: string;
  readonly reason: string;
  readonly attachments: readonly File[];
}

/** 移送（自然资源部门以外的机关；登记后进已移送终态）。 */
export async function submitTransfer(
  dispatch: ApiDispatch,
  clueId: string,
  input: TransferInput & { readonly expectedStatus: string },
): Promise<DispatchActionResult> {
  const form = new FormData();
  form.set('transferOrg', input.transferOrg);
  form.set('documentNo', input.documentNo);
  form.set('letterDate', input.letterDate);
  form.set('reason', input.reason);
  form.set('expectedStatus', input.expectedStatus);
  for (const file of input.attachments) form.append('attachment', file);
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/transfer`, {
    method: 'POST',
    body: form,
  });
  return readResult(response);
}

/** 报请指定管辖（本级机构内勤；理由必填、可选拟归属机构）。 */
export async function submitDesignateRequest(
  dispatch: ApiDispatch,
  clueId: string,
  input: { readonly reason: string; readonly proposedOrgId: string | null },
): Promise<DispatchActionResult> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/designate-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readResult(response);
}

/** 驳回报请（受理人；理由必填）。 */
export async function submitDesignateReject(
  dispatch: ApiDispatch,
  clueId: string,
  input: { readonly reason: string },
): Promise<DispatchActionResult> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/designate-reject`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readResult(response);
}

/** 受理人待办：待处理的指定管辖报请。 */
export async function loadDesignationTodos(dispatch: ApiDispatch): Promise<DesignationTodoItem[]> {
  const response = await apiFetch(dispatch, '/api/clues/designation-requests');
  if (!response.ok) throw new Error(`指定管辖待办取数失败（${response.status}）`);
  const body = (await response.json()) as { readonly items?: readonly DesignationTodoItem[] };
  return [...(body.items ?? [])];
}

/** 达标阈值（与服务端 DUPLICATE_OVERLAP_THRESHOLD 同值：界面口径，改配归管理台二期）。 */
export const OVERLAP_THRESHOLD = 0.6;

/** 命中比例文本（保留 1 位小数）。 */
export function hitRatioText(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** 该面对是否达标（达标一方加粗）。 */
export function hitQualified(value: number): boolean {
  return value >= OVERLAP_THRESHOLD;
}

/** 面积换算：库内平方米，界面按 1 亩 = 2000/3 平方米（规格 B）。 */
export function muText(squareMeters: number): string {
  return `${((squareMeters * 3) / 2000).toFixed(1)} 亩`;
}

/** 状态的中文标签。 */
export function dispatchStatusLabel(status: string): string {
  switch (status) {
    case 'pending_decision':
      return '待分派决定';
    case 'in_pool':
      return '待分派';
    case 'org_assigned':
      return '已派机构';
    case 'handler_assigned':
      return '已派承办人';
    case 'held':
      return '不派';
    case 'transferred_out':
      return '已移送';
    default:
      return status;
  }
}

/** 空建议的界面提示。 */
export function suggestionEmptyText(view: SuggestionView): string | null {
  if (view.suggestions.length > 0) return null;
  if (view.unavailableReason === null) return null;
  return '暂无辖区建议（街道边界服务或辖区对应未就绪），可手工选择机构分派。';
}


/** 其他（行政处理事项，系统外办理；#229）。理由必填，进 closed。 */
export async function submitOtherDisposition(
  dispatch: ApiDispatch,
  clueId: string,
  input: { readonly note: string; readonly expectedStatus: string },
): Promise<DispatchActionResult> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/disposition`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ disposition: 'other', note: input.note, expectedStatus: input.expectedStatus }),
  });
  return readResult(response);
}

/** 系统外移送附加记录（#229；须处置为 other）。 */
export async function submitExternalTransfer(
  dispatch: ApiDispatch,
  clueId: string,
  input: {
    readonly transferOrg: string;
    readonly documentNo: string;
    readonly letterDate: string;
    readonly reason: string;
    readonly attachments: readonly File[];
  },
): Promise<DispatchActionResult> {
  const form = new FormData();
  form.append('transferOrg', input.transferOrg);
  form.append('documentNo', input.documentNo);
  form.append('letterDate', input.letterDate);
  form.append('reason', input.reason);
  for (const file of input.attachments) form.append('attachment', file);
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/external-transfers`, {
    method: 'POST',
    body: form,
  });
  return readResult(response);
}

export interface ExternalTransferItem {
  readonly id: string;
  readonly transferredOrg: string;
  readonly documentNo: string;
  readonly letterDate: string;
  readonly reason: string;
  readonly recordedAt: string;
  readonly attachments: readonly {
    readonly id: string;
    readonly fileName: string;
    readonly contentType: string;
    readonly byteSize: number;
  }[];
}

/** 系统外移送附加记录列表。 */
export async function loadExternalTransfers(
  dispatch: ApiDispatch,
  clueId: string,
): Promise<readonly ExternalTransferItem[]> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/external-transfers`);
  if (!response.ok) throw new Error(`系统外移送列表取数失败（${response.status}）`);
  const body = (await response.json()) as { readonly transfers?: readonly ExternalTransferItem[] };
  return body.transfers ?? [];
}
