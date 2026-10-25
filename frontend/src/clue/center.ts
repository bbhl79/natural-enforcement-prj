// 线索中心的取数（#213/#212/#207）：列表取数、抽屉四页签视图。
//
// 取数走路由 loader（data 模式）。列表筛选、分页、抽屉页签与线索编号都在地址里，
// 分享与收藏都带着（见 shell/clueUrl.ts）。

import type { SessionStore } from '../session';
import { loadDetail } from './detail';
import { loadDuplicate } from './duplicate';
import { loadClueList, type ClueListParams } from './list';
import { loadTrail } from './trail';
import { loadVerification } from './verification';

/** 线索中心 loader：列表与抽屉取数。 */
export function clueCenterLoader(store: SessionStore) {
  return async ({ request }: { request: Request }) => {
    const url = new URL(request.url);

    // 列表取数。
    const listParams: ClueListParams = {
      view: url.searchParams.get('view') ?? '',
      page: parseInt(url.searchParams.get('page') ?? '1', 10) || 1,
      size: parseInt(url.searchParams.get('size') ?? '20', 10) || 20,
      keyword: url.searchParams.get('q') ?? '',
      domain: url.searchParams.get('domain') ?? '',
      source: url.searchParams.get('source') ?? '',
      org: url.searchParams.get('org') ?? '',
      status: url.searchParams.get('status') ?? '',
      check: url.searchParams.get('check') ?? '',
      gap: url.searchParams.get('gap') ?? '',
      from: url.searchParams.get('from') ?? '',
      to: url.searchParams.get('to') ?? '',
    };
    const list = loadClueList(store.dispatch, listParams);
    list.catch(() => undefined);

    // 抽屉取数：地址里有线索编号才取四页签视图。
    const clueId = url.searchParams.get('clue') ?? '';
    const verification = clueId === '' ? null : loadVerification(store.dispatch, clueId);
    verification?.catch(() => undefined);
    const duplicate = clueId === '' ? null : loadDuplicate(store.dispatch, clueId);
    duplicate?.catch(() => undefined);
    const detail = clueId === '' ? null : loadDetail(store.dispatch, clueId);
    detail?.catch(() => undefined);
    const trail = clueId === '' ? null : loadTrail(store.dispatch, clueId);
    trail?.catch(() => undefined);

    return { verification, duplicate, detail, trail, list };
  };
}
