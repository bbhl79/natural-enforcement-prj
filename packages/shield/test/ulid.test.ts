// 技术主键生成（#16 §1.1 ULID）。纯函数，无库。
// 断言外部可观察结果：编号的形制、同一进程内的先后、越界时的报错。
//
// 生成器的实现统一收敛到契约包本处（原身份模块、地理字典模块、留痕包与种子通道各持一份
// 等价实现），故本测试覆盖无状态生成与单调生成两条语义。
import { describe, expect, it } from 'vitest';

import { createMonotonicUlidGenerator, isTechnicalPrimaryKey, newUlid } from '../src/index.ts';

const T0 = Date.parse('2026-10-20T02:00:00.000Z');
const RANDOM_LIMIT = 1n << 80n;
const TIME_LIMIT = 1n << 48n;
const MAX_RANDOM = RANDOM_LIMIT - 1n;
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

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

function timeOf(id: string): number {
  let value = 0;
  for (const char of id.slice(0, 10)) value = value * 32 + CROCKFORD.indexOf(char);
  return value;
}

function strictlyIncreasing(ids: string[]): boolean {
  return ids.every((id, i) => i === 0 || ids[i - 1]! < id);
}

describe('无状态技术主键', () => {
  it('生成结果符合技术主键形制', () => {
    const id = newUlid();
    expect(isTechnicalPrimaryKey(id)).toBe(true);
    expect(id).toHaveLength(26);
    expect(ULID.test(id)).toBe(true);
  });

  it('时间部取给定的毫秒读数', () => {
    expect(timeOf(newUlid(T0))).toBe(T0);
  });

  it('同一毫秒内两枚的大小随机（无状态，不承诺先后）', () => {
    const ids = Array.from({ length: 200 }, () => newUlid(T0));
    expect(ids.every((id) => isTechnicalPrimaryKey(id))).toBe(true);
    expect(new Set(ids).size).toBe(200);
  });
});

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

  it('同一毫秒内生成的编号严格递增，时间部都是该毫秒', () => {
    const next = createMonotonicUlidGenerator({ random: () => 12345n });
    const ids = Array.from({ length: 1_000 }, () => next(1_700_000_000_000));
    expect(strictlyIncreasing(ids)).toBe(true);
    expect(new Set(ids.map(timeOf))).toEqual(new Set([1_700_000_000_000]));
  });

  it('时钟前进后，时间部取新的毫秒', () => {
    const next = createMonotonicUlidGenerator({ random: () => MAX_RANDOM });
    const first = next(1_000);
    const second = next(1_001);
    expect(first < second).toBe(true);
    expect(timeOf(second)).toBe(1_001);
  });

  it('随机部加到上限溢出时，时间部进一毫秒，编号仍然递增', () => {
    const next = createMonotonicUlidGenerator({ random: () => MAX_RANDOM });
    const ids = [next(2_000), next(2_000), next(2_000)];
    expect(strictlyIncreasing(ids)).toBe(true);
    expect(ids.map(timeOf)).toEqual([2_000, 2_001, 2_002]);
    expect(ids.every((id) => ULID.test(id))).toBe(true);
  });

  it('各生成器互不影响：新生成器从自己的时钟起算', () => {
    const first = createMonotonicUlidGenerator({ random: () => 0n });
    first(9_000);
    const second = createMonotonicUlidGenerator({ random: () => 0n });
    expect(timeOf(second(1_000))).toBe(1_000);
  });
});
