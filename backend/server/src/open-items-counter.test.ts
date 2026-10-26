// 真实 OpenItemsCounter 的小测（#219）：断言 SQL 绑定与口径（cases 恒 0、缺行当 0）。
import { describe, expect, it, vi } from 'vitest';

import { prismaOpenItemsCounter } from './open-items-counter.ts';

describe('prismaOpenItemsCounter', () => {
  it('按机构 id 查询并把 COUNT 映射为 clues；cases 恒 0', async () => {
    const queryRaw = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        expect(strings.join(' ')).toContain('clue_assignment');
        expect(strings.join(' ')).toContain('ended_at IS NULL');
        expect(strings.join(' ')).toContain('closed');
        expect(strings.join(' ')).toContain('transferred_out');
        expect(values[0]).toBe('org-1');
        return [{ n: 3 }];
      },
    );
    const result = await prismaOpenItemsCounter.countOpenItems('org-1', {
      store: {} as never,
      client: { $queryRaw: queryRaw },
    });
    expect(result).toEqual({ clues: 3, cases: 0 });
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
