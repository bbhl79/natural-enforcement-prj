import { describe, expect, it } from 'vitest';

import { createAuditIdGenerator, newAuditId } from '../src/ulid.ts';

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MAX_RANDOM = (1n << 80n) - 1n;

function timeOf(id: string): number {
  let value = 0;
  for (const char of id.slice(0, 10)) value = value * 32 + CROCKFORD.indexOf(char);
  return value;
}

function strictlyIncreasing(ids: string[]): boolean {
  return ids.every((id, i) => i === 0 || ids[i - 1]! < id);
}

function fixedClock(...readings: number[]): () => number {
  let i = 0;
  return () => readings[Math.min(i++, readings.length - 1)]!;
}

describe('留痕编号生成', () => {
  it('同一进程连续生成的编号严格递增且合 ULID 形制', () => {
    const ids = Array.from({ length: 10_000 }, () => newAuditId());
    expect(ids.every((id) => ULID.test(id))).toBe(true);
    expect(strictlyIncreasing(ids)).toBe(true);
  });

  it('同一毫秒内生成的编号严格递增，时间部都是该毫秒', () => {
    const next = createAuditIdGenerator({ now: () => 1_700_000_000_000, random: () => 12345n });
    const ids = Array.from({ length: 1_000 }, () => next());
    expect(strictlyIncreasing(ids)).toBe(true);
    expect(new Set(ids.map(timeOf))).toEqual(new Set([1_700_000_000_000]));
  });

  it('时钟前进后，时间部取新的毫秒', () => {
    const next = createAuditIdGenerator({ now: fixedClock(1_000, 1_001), random: () => MAX_RANDOM });
    const first = next();
    const second = next();
    expect(first < second).toBe(true);
    expect(timeOf(second)).toBe(1_001);
  });

  it('时钟回拨时编号不倒退，时间部沿用回拨前的毫秒', () => {
    const next = createAuditIdGenerator({ now: fixedClock(5_000, 4_000, 4_500), random: () => 7n });
    const ids = [next(), next(), next()];
    expect(strictlyIncreasing(ids)).toBe(true);
    expect(ids.map(timeOf)).toEqual([5_000, 5_000, 5_000]);
  });

  it('随机部加到上限溢出时，时间部进一毫秒，编号仍然递增', () => {
    const next = createAuditIdGenerator({ now: () => 2_000, random: () => MAX_RANDOM });
    const ids = [next(), next(), next()];
    expect(strictlyIncreasing(ids)).toBe(true);
    expect(ids.map(timeOf)).toEqual([2_000, 2_001, 2_002]);
    expect(ids.every((id) => ULID.test(id))).toBe(true);
  });

  it('各生成器互不影响：新生成器从当前时钟起算', () => {
    const first = createAuditIdGenerator({ now: fixedClock(9_000, 1_000), random: () => 0n });
    first();
    const second = createAuditIdGenerator({ now: () => 1_000, random: () => 0n });
    expect(timeOf(second())).toBe(1_000);
  });

  it('时间超出 48 位时拒绝生成', () => {
    const next = createAuditIdGenerator({ now: () => 2 ** 48, random: () => 0n });
    expect(() => next()).toThrow();
  });

  it('随机源越出 80 位时拒绝生成', () => {
    const next = createAuditIdGenerator({ now: () => 1_000, random: () => MAX_RANDOM + 1n });
    expect(() => next()).toThrow();
  });
});
