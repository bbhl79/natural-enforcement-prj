// 技术主键生成（#16 §1.1：ULID = 48bit 毫秒时间 + 80bit 随机，26 位大写 Crockford Base32）。
// 形制守卫复用 shield 的 isTechnicalPrimaryKey（契约唯一事实源，身份组织矩阵允许依赖 shield），
// 生成结果自检不合格即抛错——格式常量不允许在模块内另起一份。
//
// 两款生成器：
// - newUlid：无状态。每次调用重新取随机值，同一毫秒内两枚的大小随机。
// - createMonotonicUlidGenerator：进程内单调（#116）。同一进程内后生成的编号严格大于
//   先生成的编号，故同毫秒写入的行按 id 取回即按写入先后。
//
// 与留痕包的边界：留痕包 packages/audit/src/ulid.ts 有一份同算法的单调生成器（#114）。
// 留痕包不依赖身份模块（避免与授权写入形成循环），身份模块已依赖留痕包，故两边不能共用
// 一份实现——与身份模块、地理字典模块各持一份无状态生成器是同一形态。各模块自持技术主键
// 生成，契约只在 shield（形制断言）。改动单调规则时两边都要改。

import { isTechnicalPrimaryKey } from '@natural-enforcement/shield';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LIMIT = 1n << 48n;
const RANDOM_LIMIT = 1n << 80n;

// 仓库不引 @types/node 直接依赖（VERSIONS.md「类型」行钉的 24.19.0 只是 overrides 收敛出的
// peer 传递依赖），故本文件编译时 crypto 全局类型不在场。仅消费 webcrypto 的一个方法，
// 经 globalThis 窄化取值——不为一个全局拉入整包类型依赖
//（本包源码同时被根 unit 层与 integration 层编译，两层程序组成不同——故本文件不加任何
// 全局声明，只在函数内窄化取值）。
interface CryptoLike {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
}

function webcrypto(): CryptoLike {
  const found = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!found) throw new Error('当前运行时无 webcrypto，无法生成 ULID');
  return found;
}

/** 按大端把 value 编成定长 Crockford Base32。定长下编码结果与 value 同序，故加一即变大。 */
function encodeBase32(value: bigint, length: number): string {
  let rest = value;
  let text = '';
  for (let i = 0; i < length; i += 1) {
    text = CROCKFORD[Number(rest % 32n)] + text;
    rest /= 32n;
  }
  return text;
}

/** 生成一枚 ULID 技术主键；now 仅注入测试用时序，默认 Date.now() */
export function newUlid(now: number = Date.now()): string {
  let id = encodeBase32(BigInt(now), 10);
  // 随机部 16 字符：按字节各映射一字符（256 = 8×32 整除，无偏），16 字节 → 16 字符
  const random = webcrypto().getRandomValues(new Uint8Array(16));
  for (const byte of random) {
    id += CROCKFORD[byte % 32];
  }
  if (!isTechnicalPrimaryKey(id)) {
    throw new Error('ULID 生成结果不符合 #16 §1.1 技术主键形制');
  }
  return id;
}

/** 80 位随机数，取值 [0, 2^80)。 */
function randomBits80(): bigint {
  const bytes = webcrypto().getRandomValues(new Uint8Array(10));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

/** 单调生成器的随机源。测试注入，生产用默认值。 */
export interface MonotonicUlidSources {
  /** 80 位随机数，取值 [0, 2^80)。 */
  random(): bigint;
}

const DEFAULT_MONOTONIC_SOURCES: MonotonicUlidSources = { random: randomBits80 };

/** 单调 ULID 生成器。参数是毫秒时间戳，由调用方给出业务时间那一次的时钟读数。 */
export type MonotonicUlidGenerator = (now: number) => string;

/**
 * 新建一个进程内单调的 ULID 生成器。每个生成器各自记住上一枚编号。
 *
 * - 时钟前进：时间部取当前毫秒，随机部重新取 80 位随机值。
 * - 同一毫秒，或时钟回拨：时间部沿用上一枚，随机部加一。回拨期间编号的时间部会领先
 *   墙钟，直到墙钟追上。
 * - 随机部加一溢出（2^80）：时间部进一毫秒，随机部重新取随机值。
 * - 时间超出 48 位，或随机源取值越出 80 位：抛错，不写库。
 *
 * 边界（与 #114 留痕编号同）：单调只在同一生成器实例内成立，即同一进程。多进程、多实例
 * 各自起点随机，同一毫秒内彼此的先后仍是随机的；各机时钟偏差也会让跨实例的先后失真。
 * 编号先后是调用生成的先后，不是事务提交的先后。
 */
export function createMonotonicUlidGenerator(
  sources: MonotonicUlidSources = DEFAULT_MONOTONIC_SOURCES,
): MonotonicUlidGenerator {
  let lastTime = -1n;
  let lastRandom = 0n;

  const freshRandom = (): bigint => {
    const value = sources.random();
    if (value < 0n || value >= RANDOM_LIMIT) throw new Error('ULID 随机源取值越出 80 位');
    return value;
  };

  return (now: number): string => {
    const clock = BigInt(now);
    let time: bigint;
    let random: bigint;
    if (clock > lastTime) {
      time = clock;
      random = freshRandom();
    } else if (lastRandom + 1n < RANDOM_LIMIT) {
      time = lastTime;
      random = lastRandom + 1n;
    } else {
      time = lastTime + 1n;
      random = freshRandom();
    }
    if (time < 0n || time >= TIME_LIMIT) throw new Error('ULID 时间部越出 48 位');
    const id = encodeBase32(time, 10) + encodeBase32(random, 16);
    if (!isTechnicalPrimaryKey(id)) {
      throw new Error('ULID 生成结果不符合 #16 §1.1 技术主键形制');
    }
    lastTime = time;
    lastRandom = random;
    return id;
  };
}
