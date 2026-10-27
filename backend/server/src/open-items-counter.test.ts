// 真实 OpenItemsCounter 的小测（#219，#235）：断言 SQL 绑定与口径（缺行当 0）。
import { describe, expect, it, vi } from 'vitest';

import { prismaOpenItemsCounter } from './open-items-counter.ts';

describe('prismaOpenItemsCounter', () => {
  it('按机构 id 查询，线索与非终态案件分别计数', async () => {
    const queryRaw = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join(' ');
        expect(sql).toContain('clue_assignment');
        expect(sql).toContain('ended_at IS NULL');
        expect(sql).toContain('transferred_out');
        expect(sql).toContain('case_record');
        expect(sql).toContain('withdrawn');
        expect(sql).toContain('finalized');
        expect(values).toEqual(['org-1', 'org-1']);
        return [{ clues: 3, cases: 2 }];
      },
    );
    const result = await prismaOpenItemsCounter.countOpenItems('org-1', {
      store: {} as never,
      client: { $queryRaw: queryRaw },
    });
    expect(result).toEqual({ clues: 3, cases: 2 });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('查询无行时 clues 为 0', async () => {
    const result = await prismaOpenItemsCounter.countOpenItems('org-x', {
      store: {} as never,
      client: { $queryRaw: async () => [] },
    });
    expect(result).toEqual({ clues: 0, cases: 0 });
  });

  it('client 不是查询面时抛错', async () => {
    await expect(
      prismaOpenItemsCounter.countOpenItems('org-1', { store: {} as never, client: null }),
    ).rejects.toThrow(/事务客户端/);
  });
});
