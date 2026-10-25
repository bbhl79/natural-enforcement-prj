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
  input: { readonly decision: 'dispatch' | 'hold'; readonly acknowledged: boolean; readonly expectedStatus: string },
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
