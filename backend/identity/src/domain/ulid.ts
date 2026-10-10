// 技术主键生成（#16 §1.1：ULID = 48bit 毫秒时间 + 80bit 随机，26 位大写 Crockford Base32）。
// 形制守卫复用 shield 的 isTechnicalPrimaryKey（契约唯一事实源，身份组织矩阵允许依赖 shield），
// 生成结果自检不合格即抛错——格式常量不允许在模块内另起一份。

import { isTechnicalPrimaryKey } from 'shield';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// 不引 @types/node（版本未入定案表）；仅消费 webcrypto 的一个方法，
// 经 globalThis 窄化取值，避免与 integration 层 @types/node 的全局声明冲突
//（本包源码同时被根 unit 层与 integration 层编译）。
interface CryptoLike {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
}

function webcrypto(): CryptoLike {
  const found = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!found) throw new Error('当前运行时无 webcrypto，无法生成 ULID');
  return found;
}

/** 生成一枚 ULID 技术主键；now 仅注入测试用时序，默认 Date.now() */
export function newUlid(now: number = Date.now()): string {
  let time = BigInt(now);
  let id = '';
  for (let i = 0; i < 10; i += 1) {
    id = CROCKFORD[Number(time % 32n)] + id;
    time /= 32n;
  }
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
