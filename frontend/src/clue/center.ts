// 线索中心的取数（#213/#212）：抽屉打开时取该线索的内业核查视图与疑似重复比对视图。
//
// 取数走路由 loader（data 模式）。抽屉页签与线索编号都在地址里，
// 分享与收藏都带着（见 shell/clueUrl.ts）。

import type { SessionStore } from '../session';
import { loadDuplicate } from './duplicate';
import { loadVerification } from './verification';

/** 线索中心 loader：地址里有线索编号才取核查与疑似重复视图。 */
export function clueCenterLoader(store: SessionStore) {
  return async ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    const clueId = url.searchParams.get('clue') ?? '';
    const verification = clueId === '' ? null : loadVerification(store.dispatch, clueId);
    verification?.catch(() => undefined);
    const duplicate = clueId === '' ? null : loadDuplicate(store.dispatch, clueId);
    duplicate?.catch(() => undefined);
    return { verification, duplicate };
  };
}
