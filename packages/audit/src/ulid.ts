import { isTechnicalPrimaryKey } from '@natural-enforcement/shield';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

interface CryptoLike {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
}

function webcrypto(): CryptoLike {
  const found = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!found) throw new Error('当前运行时无 webcrypto，无法生成 ULID');
  return found;
}

/** 留痕主键。形制与身份模块相同，生成结果交给 shield 守卫。 */
export function newAuditId(now: number = Date.now()): string {
  let time = BigInt(now);
  let id = '';
  for (let i = 0; i < 10; i += 1) {
    id = CROCKFORD[Number(time % 32n)] + id;
    time /= 32n;
  }
  const random = webcrypto().getRandomValues(new Uint8Array(16));
  for (const byte of random) id += CROCKFORD[byte % 32];
  if (!isTechnicalPrimaryKey(id)) throw new Error('留痕主键不符合技术主键形制');
  return id;
}
