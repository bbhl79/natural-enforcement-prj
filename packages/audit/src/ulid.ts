// ULID（#16 §1.1）。留痕包不依赖身份模块，避免与授权写入形成循环。
//
// 单调生成：同一进程内，后生成的编号严格大于先生成的编号（按字符串比较）。
// - 时钟前进：时间部取当前毫秒，随机部重新取 80 位随机值。
// - 同一毫秒，或时钟回拨：时间部沿用上一枚，随机部加一。回拨期间编号的时间部
//   会领先墙钟，直到墙钟追上。
// - 随机部加一溢出（2^80）：时间部进一毫秒，随机部重新取随机值。
//
// 边界：单调只在同一生成器实例内成立。多进程、多实例各自起点随机，同一毫秒内
// 彼此的先后仍是随机的；各机时钟偏差也会让跨实例的先后失真。编号先后是调用
// append 的先后，不是事务提交的先后。
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const TIME_LIMIT = 1n << 48n;
const RANDOM_LIMIT = 1n << 80n;

interface CryptoLike {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
}

function webcrypto(): CryptoLike {
  const found = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!found) throw new Error('当前运行时无 webcrypto，无法生成 ULID');
  return found;
}

/** 80 位随机数，取值 [0, 2^80)。 */
function randomBits80(): bigint {
  const bytes = webcrypto().getRandomValues(new Uint8Array(10));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function encode(value: bigint, length: number): string {
  let rest = value;
  let text = '';
  for (let i = 0; i < length; i += 1) {
    text = CROCKFORD[Number(rest % 32n)] + text;
    rest /= 32n;
  }
  return text;
}

/** 生成器的时钟与随机源。测试注入，生产用默认值。 */
export interface AuditIdSources {
  /** 当前毫秒数。 */
  now(): number;
  /** 80 位随机数，取值 [0, 2^80)。 */
  random(): bigint;
}

const DEFAULT_SOURCES: AuditIdSources = { now: () => Date.now(), random: randomBits80 };

/** 新建一个单调 ULID 生成器。每个生成器各自记住上一枚编号。 */
export function createAuditIdGenerator(sources: AuditIdSources = DEFAULT_SOURCES): () => string {
  let lastTime = -1n;
  let lastRandom = 0n;

  const freshRandom = (): bigint => {
    const value = sources.random();
    if (value < 0n || value >= RANDOM_LIMIT) throw new Error('ULID 随机源取值越出 80 位');
    return value;
  };

  return () => {
    const now = BigInt(sources.now());
    let time: bigint;
    let random: bigint;
    if (now > lastTime) {
      time = now;
      random = freshRandom();
    } else if (lastRandom + 1n < RANDOM_LIMIT) {
      time = lastTime;
      random = lastRandom + 1n;
    } else {
      time = lastTime + 1n;
      random = freshRandom();
    }
    if (time < 0n || time >= TIME_LIMIT) throw new Error('ULID 时间部越出 48 位');
    const id = encode(time, 10) + encode(random, 16);
    if (!ULID_PATTERN.test(id)) throw new Error('ULID 生成结果不符合 #16 §1.1 形制');
    lastTime = time;
    lastRandom = random;
    return id;
  };
}

/** 本进程的留痕编号。同一进程内严格递增。 */
export const newAuditId: () => string = createAuditIdGenerator();
