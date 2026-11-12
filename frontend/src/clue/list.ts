// 用途：线索中心列表的取数：按筛选条件分页请求，供 /clue 页的 loader 使用。
// 调用方：frontend/src/clue/center.ts 的 clueCenterLoader。
// 线索列表取数（#207：列表、筛选、分页）。
// 调用 GET /api/clues?... 返回分页列表。
// 无操作码（服务按数据范围内的机构过滤，不调用操作码授权）。
// 参数：view, page, size, q, domain, source, org, status, check, gap, from, to。

import { data } from 'react-router';

import { apiFetch, type ApiDispatch } from '../api';

/** 列表请求参数。 */
export interface ClueListParams {
  readonly view: string;
  readonly page: number;
  readonly size: number;
  readonly keyword: string;
  readonly domain: string;
  readonly source: string;
  readonly org: string;
  readonly status: string;
  readonly check: string;
  readonly gap: string;
  readonly from: string;
  readonly to: string;
}

/** 列表一行。 */
export interface ClueListRow {
  readonly id: string;
  readonly code: string;
  readonly domain: string;
  readonly sourceCode: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly verificationStatus: string;
  readonly verificationStatusLabel: string;
  readonly narrative: string;
  readonly registeredAt: string;
  readonly hasGaps: boolean;
  /** #335：列表可选；true=已单位签收。 */
  readonly unitReceived?: boolean;
  readonly tags: readonly string[];
}

/** 分页列表返回。 */
export interface ClueListPage {
  readonly rows: readonly ClueListRow[];
  readonly total: number;
  readonly page: number;
  readonly size: number;
}

// 接口：GET /api/clues，无操作码（服务按数据范围过滤）；查询参数见 ClueListParams。
/** 取线索分页列表。 */
export async function listClues(dispatch: ApiDispatch, params: ClueListParams): Promise<ClueListPage> {
  const qs = new URLSearchParams();
  qs.set('view', params.view);
  qs.set('page', String(params.page));
  qs.set('size', String(params.size));
  if (params.keyword) qs.set('q', params.keyword);
  if (params.domain) qs.set('domain', params.domain);
  if (params.source) qs.set('source', params.source);
  if (params.org) qs.set('org', params.org);
  if (params.status) qs.set('status', params.status);
  if (params.check) qs.set('check', params.check);
  if (params.gap) qs.set('gap', params.gap);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);

  const response = await apiFetch(dispatch, `/api/clues?${qs.toString()}`);
  if (!response.ok) throw data({ status: response.status }, response.status);
  return (await response.json()) as ClueListPage;
}

/** 从 ClueListParams 生成 loader 用的取数函数。 */
export function loadClueList(dispatch: ApiDispatch, params: ClueListParams): Promise<ClueListPage> {
  return listClues(dispatch, params);
}