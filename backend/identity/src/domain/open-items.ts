// 承办中事项计数端口（#105「未办结前提怎么落」，#124；新增接缝③）。
// 停用机构前要数以本机构为承办机构、尚未办结的线索和案件（Lei Hu 2026-10-17 22:14，A2）。
// 一期没有线索和案件表，本期接恒为 0 的实现；测试注入返回非零的实现。
// 线索、案件切片上线时接上真实查询，并保证「指定承办机构」与「停用机构」不能并发穿过
//（同一把机构锁或等效约束，由线索切片落实）。只数本机构承办的事项，不数下级机构的。

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

/** 本期实现：恒为 0。 */
export const NO_OPEN_ITEMS: OpenItemsCounter = {
  countOpenItems: async () => ({ clues: 0, cases: 0 }),
};
