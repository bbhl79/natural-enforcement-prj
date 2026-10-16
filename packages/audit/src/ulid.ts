// ULID（#16 §1.1）。留痕包不依赖身份模块，避免与授权写入形成循环。
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

interface CryptoLike {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
}

function webcrypto(): CryptoLike {
  const found = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!found) throw new Error('当前运行时无 webcrypto，无法生成 ULID');
  return found;
}

export function newAuditId(now: number = Date.now()): string {
  let time = BigInt(now);
  let id = '';
  for (let i = 0; i < 10; i += 1) {
    id = CROCKFORD[Number(time % 32n)] + id;
    time /= 32n;
  }
  const random = webcrypto().getRandomValues(new Uint8Array(16));
  for (const byte of random) id += CROCKFORD[byte % 32];
  if (!ULID_PATTERN.test(id)) throw new Error('ULID 生成结果不符合 #16 §1.1 形制');
  return id;
}
