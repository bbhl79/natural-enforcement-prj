// 基本信息与要件取数（#207 线索中心抽屉「基本信息与要件」页签）。
//
// 取数模式参考 duplicate.ts：async 函数直接 fetch，不建 thunk。
// 反映人脱敏在前端：姓名保留首字，联系方式保留前 3 后 4。
// 查看实名走 POST /api/clues/:id/reporter-read（API 在 duplicate.ts 已有）。
// 缺件补齐走 POST /api/clues/:id/gap-fill。

import { data } from 'react-router';

import { apiFetch, type ApiDispatch } from '../api';

/** 一项要件定义。 */
export interface ClueRequirement {
  readonly key: string;
  readonly layer: string;
  readonly label: string;
  readonly required: boolean;
  readonly consequence: string;
  readonly timing: string;
}

/** 一项要件取值。 */
export interface ClueValue {
  readonly key: string;
  readonly value: string | null;
}

/** 一个缺件项。filledAt 为 null 表示未补齐。 */
export interface ClueGap {
  readonly key: string;
  readonly layer: string;
  readonly label: string;
  readonly required: boolean;
  readonly timing: string;
  readonly consequence: string;
  readonly filledAt: string | null;
}

/** 一条初步涉嫌违法类型。 */
export interface ClueInitialType {
  readonly typeCode: string;
}

/** 线索详情（基本信息与要件视图）。 */
export interface ClueDetail {
  readonly id: string;
  readonly code: string;
  readonly domain: string;
  readonly sourceCode: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly verificationStatus: string;
  readonly receivedAt: string;
  readonly registeredAt: string;
  readonly narrative: string;
  readonly subjectUnknown: boolean;
  readonly anonymityConfirmed: boolean;
  readonly requirements: readonly ClueRequirement[];
  readonly values: readonly ClueValue[];
  readonly gaps: readonly ClueGap[];
  readonly tags: readonly string[];
  readonly initialTypes: readonly string[];
  readonly reporterName: string | null;
  readonly reporterContact: string | null;
}

/** 取线索详情。 */
export async function loadDetail(dispatch: ApiDispatch, clueId: string): Promise<ClueDetail> {
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/detail`);
  if (!response.ok) throw data({ status: response.status }, response.status);
  return (await response.json()) as ClueDetail;
}

/** 一次补齐的结果。 */
export type GapFillResult =
  | { readonly ok: true; readonly body: ClueDetail }
  | { readonly ok: false; readonly status: number; readonly reason: string | null };

/** 补齐缺件。fills 是待补齐的 key-value 列表。 */
export async function fillGaps(
  dispatch: ApiDispatch,
  clueId: string,
  fills: readonly { readonly key: string; readonly value: string }[],
): Promise<GapFillResult> {
  const values: Record<string, string> = {};
  for (const fill of fills) values[fill.key] = fill.value;
  const response = await apiFetch(dispatch, `/api/clues/${clueId}/gaps/fill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (response.ok) return { ok: true, body: body as ClueDetail };
  const reason =
    typeof body === 'object' && body !== null && typeof (body as { reason?: unknown }).reason === 'string'
      ? (body as { reason: string }).reason
      : null;
  return { ok: false, status: response.status, reason };
}

/** 脱敏姓名：保留首字，其余替换为 **。 */
export function maskName(name: string): string {
  if (name.length === 0) return name;
  return name[0] + '**';
}

/** 脱敏联系方式：保留前 3 后 4，中间替换为 ****。 */
export function maskContact(contact: string): string {
  if (contact.length <= 7) return contact[0] + '****' + contact.slice(-1);
  return contact.slice(0, 3) + '****' + contact.slice(-4);
}