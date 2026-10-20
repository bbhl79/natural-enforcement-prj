// #116 进程内单调 ULID 生成器。纯函数，无库。
// 断言外部可观察结果：编号的形制、同一进程内的先后、越界时的报错。
import { describe, expect, it } from 'vitest';

import { isTechnicalPrimaryKey } from '@natural-enforcement/shield';

import { createMonotonicUlidGenerator } from '../src/domain/ulid.ts';

const T0 = Date.parse('2026-10-20T02:00:00.000Z');
const RANDOM_LIMIT = 1n << 80n;
const TIME_LIMIT = 1n << 48n;

/** 随机源按调用次序发号，便于断言随机部的进位。 */
function scriptedRandom(values: bigint[]): () => bigint {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) throw new Error('随机源已用尽');
    return value;
  };
}

describe('进程内单调 ULID', () => {
  it('同一毫秒内连续生成的编号严格递增，且都符合技术主键形制', () => {
    const next = createMonotonicUlidGenerator();
    const first = next(T0);
    const second = next(T0);
    const third = next(T0);
    expect(first < second).toBe(true);
    expect(second < third).toBe(true);
    for (const id of [first, second, third]) {
      expect(isTechnicalPrimaryKey(id)).toBe(true);
      expect(id).toHaveLength(26);
    }
  });

  it('时钟前进时时间部进位，编号仍然递增', () => {
    const next = createMonotonicUlidGenerator();
    const earlier = next(T0);
    const later = next(T0 + 1000);
    expect(earlier < later).toBe(true);
  });

  it('时钟回拨时编号不倒退，时间部沿用上一枚', () => {
    const next = createMonotonicUlidGenerator();
    const before = next(T0);
    const after = next(T0 - 5000);
    expect(after > before).toBe(true);
    // 时间部沿用上一枚，故两枚的时间部相同，只有随机部加一。
    expect(after.slice(0, 10)).toBe(before.slice(0, 10));
  });

  it('随机部加一溢出时时间部进一毫秒', () => {
    const next = createMonotonicUlidGenerator({ random: scriptedRandom([RANDOM_LIMIT - 1n, 0n]) });
    const first = next(T0);
    const second = next(T0);
    expect(second > first).toBe(true);
    expect(second.slice(0, 10)).not.toBe(first.slice(0, 10));
  });

  it('随机源取值越出 80 位时报错', () => {
    const next = createMonotonicUlidGenerator({ random: () => RANDOM_LIMIT });
    expect(() => next(T0)).toThrow(/越出 80 位/);
  });

  it('随机源取负值时报错', () => {
    const next = createMonotonicUlidGenerator({ random: () => -1n });
    expect(() => next(T0)).toThrow(/越出 80 位/);
  });

  it('时间部越出 48 位时报错', () => {
    const next = createMonotonicUlidGenerator();
    expect(() => next(Number(TIME_LIMIT))).toThrow(/越出 48 位/);
  });

  it('时钟回拨到负数时报错', () => {
    const next = createMonotonicUlidGenerator();
    expect(() => next(-1)).toThrow(/越出 48 位/);
  });
});
