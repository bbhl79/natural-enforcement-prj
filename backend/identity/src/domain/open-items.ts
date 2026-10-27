// 承办中事项计数端口（#105「未办结前提怎么落」，#124；接缝③）。
// 停用机构前要数以本机构为承办机构、尚未办结的线索和案件（Lei Hu 2026-10-17 22:14，A2）。
// 真实实现在启动包装配（#219 prismaOpenItemsCounter；#235 计入非终态案件）：
// 线索＝当前有效分派 + 非 closed／transferred_out（filed 计入）；
// 案件＝handling_org_id 为本机构，且主状态不是已撤案、已结案、已定型；
// 不递归下级。派机构与停用共用机构行锁，避免并发漏计。
// 本文件仍导出恒 0 的 NO_OPEN_ITEMS，供 identity 单测与显式注入。

import type { IdentityTransaction } from '../persistence/identity-store.ts';

/** 未办结的线索、案件条数。 */
export interface OpenItems {
  clues: number;
  cases: number;
}

export interface OpenItemsCounter {
  /**
   * 以该机构为承办机构、尚未办结的线索与案件条数。在停用的事务里调用，机构行已加 FOR UPDATE 锁；
   * tx 是同一事务，真实实现应在 tx.client 上查询。
   */
  countOpenItems(orgUnitId: string, tx: IdentityTransaction): Promise<OpenItems>;
}

export const OPEN_ITEMS_COUNTER = Symbol('OPEN_ITEMS_COUNTER');

/** 恒为 0：identity 单测与显式注入用。默认装配已换真实实现（#219）。 */
export const NO_OPEN_ITEMS: OpenItemsCounter = {
  countOpenItems: async () => ({ clues: 0, cases: 0 }),
};
