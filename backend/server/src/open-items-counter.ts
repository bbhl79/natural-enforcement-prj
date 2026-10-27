// 承办中事项真实计数（#219，#235）：以当前有效分派（clue_assignment.ended_at IS NULL）
// 的承办机构为准，线索状态不在 closed／transferred_out 的计入（filed 计入）。
// 案件按 handling_org_id 计，主状态不在 withdrawn／closed／finalized 的计入
// （办理中与调查已终止·待收尾计入）。不递归下级。
// 查询走停用／分派同一事务的 tx.client，与机构行锁同事务可见。

import type { IdentityTransaction, OpenItems, OpenItemsCounter } from '@natural-enforcement/identity';

/** Prisma 事务客户端上只用到的查询面（避免本文件依赖生成客户端）。 */
interface QueryClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

function asQueryClient(client: unknown): QueryClient {
  if (client == null || typeof client !== 'object' || typeof (client as QueryClient).$queryRaw !== 'function') {
    throw new Error('OpenItemsCounter 需要带 $queryRaw 的事务客户端');
  }
  return client as QueryClient;
}

/** 默认装配的真实实现：数本机构承办、尚未办结的线索与非终态案件。 */
export const prismaOpenItemsCounter: OpenItemsCounter = {
  async countOpenItems(orgUnitId: string, tx: IdentityTransaction): Promise<OpenItems> {
    const client = asQueryClient(tx.client);
    const rows = await client.$queryRaw<Array<{ clues: number; cases: number }>>`
      SELECT
        (
          SELECT COUNT(*)::int
          FROM clue c
          JOIN clue_assignment a ON a.clue_id = c.id AND a.ended_at IS NULL
          WHERE a.org_unit_id = ${orgUnitId}
            AND c.status NOT IN ('closed', 'transferred_out')
        ) AS clues,
        (
          SELECT COUNT(*)::int
          FROM case_record r
          WHERE r.handling_org_id = ${orgUnitId}
            AND r.status NOT IN ('withdrawn', 'closed', 'finalized')
        ) AS cases
    `;
    return { clues: rows[0]?.clues ?? 0, cases: rows[0]?.cases ?? 0 };
  },
};
