// SigV4 签名纯函数（#53 存储设施包）：S3 兼容 REST 请求签名，只依赖 node:crypto。
// 独立真值来源 = AWS SigV4 算法规范 + 开发期以 Python hashlib/hmac 另行实现的
// 参照计算（与本实现零共享代码），固定输入的期望输出以字面量固化于
// test/s3-signer.test.ts——签名向量不允许由被测代码同款逻辑推导。
import { createHash, createHmac } from 'node:crypto';

export interface S3Credentials {
  accessKey: string;
  secretKey: string;
}

export interface SignInput {
  method: string;
  /** 请求路径（桶级请求 = 桶名；对象请求 = 桶名/key，原始形态可含非 ASCII；内部按段做 RFC 3986 编码） */
  key: string;
  /** 子资源查询参数（如 versionId、versioning），值允许空串 */
  query?: ReadonlyArray<readonly [string, string]>;
  /** 额外需签入的 x-amz-* 头（如对象锁保留头）；host/date/content-sha256 由本函数补齐 */
  extraHeaders?: Readonly<Record<string, string>>;
  payload: string | Uint8Array;
  /** 形如 rustfs:9000（不带 scheme） */
  host: string;
  /** 固定格式 yyyymmddThhmmssZ，由调用方时钟给出（测试注入固定值） */
  amzDate: string;
}

export interface SignedRequest {
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** RFC 3986 编码（保留非转义字符集与 AWS 规范一致） */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function sha256Hex(payload: string | Uint8Array): string {
  const hash = createHash('sha256');
  hash.update(typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload);
  return hash.digest('hex');
}

export function hmacSha256(key: Uint8Array, data: string): Uint8Array {
  return new Uint8Array(createHmac('sha256', key).update(data, 'utf8').digest());
}

/** 派生签名密钥：AWS4 + secret → date → region → service → aws4_request */
export function deriveSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
): Uint8Array {
  let key = hmacSha256(new TextEncoder().encode(`AWS4${secretKey}`), dateStamp);
  key = hmacSha256(key, region);
  key = hmacSha256(key, SERVICE);
  return hmacSha256(key, 'aws4_request');
}

/** 规范查询串：各对值 RFC 3986 编码后按编码键排序（签名与实发 URL 共用同一序列） */
export function encodeCanonicalQuery(
  pairs: ReadonlyArray<readonly [string, string]>,
): string {
  return pairs
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/** 组装规范请求（canonical request）；path 按段编码，query 按键排序并编码 */
export function buildCanonicalRequest(input: {
  method: string;
  encodedPath: string;
  query?: ReadonlyArray<readonly [string, string]>;
  headers: Readonly<Record<string, string>>;
  payloadHash: string;
}): { canonical: string; signedHeaders: string } {
  const query = encodeCanonicalQuery(input.query ?? []);
  const headerEntries = Object.entries(input.headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim()] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalHeaders = headerEntries.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = headerEntries.map(([k]) => k).join(';');
  const canonical = [
    input.method,
    input.encodedPath,
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  return { canonical, signedHeaders };
}

/** 对一次 S3 请求做完整 SigV4 签名（纯函数，时钟与密钥均由调用方注入） */
export function signRequest(
  credentials: S3Credentials,
  region: string,
  input: SignInput,
): SignedRequest {
  const payloadHash = input.payload.length === 0 ? EMPTY_SHA256 : sha256Hex(input.payload);
  const headers: Record<string, string> = {
    host: input.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': input.amzDate,
    ...Object.fromEntries(
      Object.entries(input.extraHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    ),
  };
  const encodedPath = `/${input.key
    .split('/')
    .map((segment) => uriEncode(segment))
    .join('/')}`;
  const { canonical, signedHeaders } = buildCanonicalRequest({
    method: input.method,
    encodedPath,
    query: input.query,
    headers,
    payloadHash,
  });
  const dateStamp = input.amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    input.amzDate,
    credentialScope,
    sha256Hex(canonical),
  ].join('\n');
  const signingKey = deriveSigningKey(credentials.secretKey, dateStamp, region);
  const signatureBytes = hmacSha256(signingKey, stringToSign);
  const signature = Buffer.from(signatureBytes).toString('hex');
  const authorization =
    `${ALGORITHM} Credential=${credentials.accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    headers: { ...headers, authorization },
    canonicalRequest: canonical,
    stringToSign,
    signature,
  };
}
