// 内业核查抽屉页签的数据层与纯函数（#213；规格 C 节）。
//
// 页签显示四样东西：当前与历史运行、每层的三态与相交事实、分析图预览、手动重跑入口。
// 核查状态三态：核查进行中／已完成／没跑成；没跑成时重跑提示一直挂到跑成。
// 无权手动重跑的人看不到入口（服务端也照样校验，前端不据此放行）。

import { data } from 'react-router';

import { apiFetch, type ApiDispatch } from '../api';

/** 一层的事实。 */
export interface VerificationLayerView {
  readonly layerKey: string;
  readonly layerName: string;
  readonly state: string;
  readonly stateLabel: string;
  readonly totalArea: number;
  readonly overlapArea: number;
  readonly outsideArea: number;
  readonly overlapRatio: number;
  readonly featureCount: number;
  readonly serviceUrl: string | null;
  readonly queriedAt: string | null;
  readonly unavailableReason: string | null;
}

/** 一次运行。 */
export interface VerificationRunView {
  readonly id: string;
  readonly runNo: number;
  readonly status: string;
  readonly statusLabel: string;
  readonly trigger: string;
  readonly attemptsUsed: number;
  readonly failureCategory: string | null;
  readonly missingLayers: readonly { readonly key: string; readonly name: string }[];
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly layers: readonly VerificationLayerView[];
}

/** 核查视图。 */
export interface VerificationView {
  readonly result: string;
  readonly clueId: string;
  readonly code: string;
  readonly domain: string;
  readonly required: boolean;
  readonly verificationStatus: string;
  readonly verificationStatusLabel: string;
  readonly clueStatus: string;
  readonly canRetry: boolean;
  readonly retryBlockedReason: string | null;
  readonly current: VerificationRunView | null;
  readonly runs: readonly VerificationRunView[];
  readonly artifacts: {
    readonly report: { readonly fileKey: string; readonly versionId: string };
    readonly analysis: { readonly fileKey: string; readonly versionId: string };
  } | null;
}

/** 手动重跑的结果。 */
export type RetryResult =
  | { readonly ok: true; readonly status: number; readonly body: VerificationView }
  | { readonly ok: false; readonly status: number; readonly reason: string | null };

/** 取核查视图。 */
export async function loadVerification(dispatch: ApiDispatch, clueId: string): Promise<VerificationView> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/verification`);
  if (!response.ok) throw data({ status: response.status }, response.status);
  return (await response.json()) as VerificationView;
}

/** 手动重跑。 */
export async function retryVerification(dispatch: ApiDispatch, clueId: string): Promise<RetryResult> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/verification/retry`, { method: 'POST' });
  const body = (await response.json().catch(() => null)) as unknown;
  if (response.ok) return { ok: true, status: response.status, body: body as VerificationView };
  const reason =
    typeof body === 'object' && body !== null && typeof (body as { reason?: unknown }).reason === 'string'
      ? ((body as { reason: string }).reason)
      : null;
  return { ok: false, status: response.status, reason };
}

/** 不能重跑时的界面提示。 */
export function retryBlockedText(view: VerificationView): string | null {
  if (view.canRetry) return null;
  switch (view.retryBlockedReason) {
    case 'verification-not-required':
      return '该线索不设内业核查。';
    case 'clue-terminal':
      return '线索已终态，不再允许重跑。';
    case 'verification-running':
      return '核查正在跑，跑完可再重跑。';
    case 'permission-denied':
      return '没有重跑权限。';
    default:
      return '当前不能重跑。';
  }
}

/** 面积文本（平方米，保留一位小数）。 */
export function areaText(value: number): string {
  return `${value.toFixed(1)} 平方米`;
}

/** 比例文本（百分比，保留一位小数）。 */
export function ratioText(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** 三态的标签（服务端没给标签时按状态词取）。 */
export function layerStateLabel(state: string): string {
  if (state === 'overlapped') return '有相交';
  if (state === 'no_overlap') return '无相交';
  return '查不成';
}
