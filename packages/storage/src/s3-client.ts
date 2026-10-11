// 最小 S3 兼容 REST 客户端（#53）：基于 node 全局 fetch + 本包 SigV4 签名，
// 只覆盖存储设施所需操作集（桶/版本控制/对象锁/对象 PUT·GET·DELETE）。
// 刻意保持零第三方依赖——RustFS SDK/依赖只许进本设施包的纪律由此以
//「不引入依赖」的最强形态落实（结构测试 storage-facility-entry 机器兜底后续漂移）。
// 本文件不含装饰器——E3 驱动以 node 原生 type-stripping 运行，传递闭包内禁止装饰器。

import { encodeCanonicalQuery, signRequest, uriEncode, type S3Credentials } from './s3-signer.ts';

/** S3 协议层错误：HTTP 状态 + S3 错误码（如 AccessDenied、NoSuchBucket） */
export class S3Error extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'S3Error';
    this.status = status;
    this.code = code;
  }
}

export type ObjectLockMode = 'COMPLIANCE' | 'GOVERNANCE';

export interface PutObjectOptions {
  /** 对象级保留（WORM 最保守语义的写入侧强制） */
  retention?: { mode: ObjectLockMode; retainUntil: string };
  legalHold?: 'ON' | 'OFF';
}

export interface WriteResult {
  /** 写入产生的版本 id；存储端未返回版本 id 时为 null（视为世代信息缺失） */
  versionId: string | null;
}

export interface S3Client {
  bucketExists(bucket: string): Promise<boolean>;
  createBucket(bucket: string, opts?: { objectLockEnabled?: boolean }): Promise<void>;
  setVersioning(bucket: string, status: 'Enabled' | 'Suspended'): Promise<void>;
  getVersioning(bucket: string): Promise<string | null>;
  /** 桶级默认保留（新建对象自带 WORM；不支持的存储端抛 S3Error，由调用方决定降级） */
  setDefaultRetention(
    bucket: string,
    lock: { mode: ObjectLockMode; years: number },
  ): Promise<void>;
  putObject(bucket: string, key: string, body: Uint8Array, opts?: PutObjectOptions): Promise<WriteResult>;
  getObject(bucket: string, key: string, versionId?: string): Promise<Uint8Array>;
  deleteObject(bucket: string, key: string, versionId?: string): Promise<WriteResult>;
}

export interface S3ClientConfig extends S3Credentials {
  /** 形如 http://rustfs:9000（容器网络内服务名访问，不经宿主端口） */
  endpoint: string;
  region: string;
  /** 测试注入 fetch 替身（库边界 mock，接缝 = HTTP） */
  fetchImpl?: typeof fetch;
  /** 测试注入固定时钟 */
  now?: () => Date;
}

const XML_NS = 'http://s3.amazonaws.com/doc/2006-03-01/';

function amzDateOf(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
}

function extractXmlTag(text: string, tag: string): string | null {
  const match = text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match ? (match[1] ?? null) : null;
}

export function createS3Client(config: S3ClientConfig): S3Client {
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? (() => new Date());
  const endpoint = new URL(config.endpoint);
  const host = endpoint.host;

  async function request(
    method: string,
    bucket: string,
    key: string | null,
    opts: {
      query?: ReadonlyArray<readonly [string, string]>;
      extraHeaders?: Record<string, string>;
      body?: Uint8Array;
    } = {},
  ): Promise<Response> {
    const payload = opts.body ?? new Uint8Array(0);
    const amzDate = amzDateOf(now());
    const signed = signRequest(
      { accessKey: config.accessKey, secretKey: config.secretKey },
      config.region,
      {
        method,
        key: key === null ? bucket : `${bucket}/${key}`,
        query: opts.query,
        extraHeaders: opts.extraHeaders,
        payload,
        host,
        amzDate,
      },
    );
    const path = key === null ? `/${bucket}` : `/${bucket}/${key.split('/').map(uriEncode).join('/')}`;
    const queryString = encodeCanonicalQuery(opts.query ?? []);
    const url = `${endpoint.protocol}//${host}${path}${queryString ? `?${queryString}` : ''}`;
    const response = await fetchImpl(url, {
      method,
      headers: { ...signed.headers, ...opts.extraHeaders },
      // TS 6 DOM lib 的 BodyInit 不接纳 Uint8Array<ArrayBufferLike>，运行时契约一致，显式收窄
      body: (opts.body === undefined ? undefined : opts.body) as BodyInit | undefined,
    });
    if (!response.ok) {
      const text = await response.text();
      const code = extractXmlTag(text, 'Code') ?? `HTTP_${response.status}`;
      const message = extractXmlTag(text, 'Message') ?? text.slice(0, 200);
      throw new S3Error(response.status, code, message);
    }
    return response;
  }

  return {
    async bucketExists(bucket) {
      try {
        await request('HEAD', bucket, null);
        return true;
      } catch (err) {
        if (err instanceof S3Error && err.status === 404) return false;
        throw err;
      }
    },

    async createBucket(bucket, opts = {}) {
      // 对象锁必须在建桶时启用（S3 契约）；RustFS/MinIO 系实现认 MinIO 风格头，
      // 先按 AWS 标准头发起，被拒（400）则降级重试另一头——两种形态都记录在用例输出。
      if (!opts.objectLockEnabled) {
        await request('PUT', bucket, null);
        return;
      }
      try {
        await request('PUT', bucket, null, {
          extraHeaders: { 'x-amz-object-lock-enabled-for-bucket': 'true' },
        });
      } catch (err) {
        if (!(err instanceof S3Error) || err.status !== 400) throw err;
        await request('PUT', bucket, null, {
          extraHeaders: { 'x-amz-bucket-object-lock-enabled': 'true' },
        });
      }
    },

    async setVersioning(bucket, status) {
      const body = new TextEncoder().encode(
        `<VersioningConfiguration xmlns="${XML_NS}"><Status>${status}</Status></VersioningConfiguration>`,
      );
      await request('PUT', bucket, null, {
        query: [['versioning', '']],
        extraHeaders: { 'content-type': 'application/xml' },
        body,
      });
    },

    async getVersioning(bucket) {
      const response = await request('GET', bucket, null, { query: [['versioning', '']] });
      const text = await response.text();
      return extractXmlTag(text, 'Status');
    },

    async setDefaultRetention(bucket, lock) {
      const body = new TextEncoder().encode(
        `<ObjectLockConfiguration xmlns="${XML_NS}"><ObjectLockEnabled>Enabled</ObjectLockEnabled>` +
          `<Rule><DefaultRetention><Mode>${lock.mode}</Mode><Years>${lock.years}</Years>` +
          `</DefaultRetention></Rule></ObjectLockConfiguration>`,
      );
      await request('PUT', bucket, null, {
        query: [['object-lock', '']],
        extraHeaders: { 'content-type': 'application/xml' },
        body,
      });
    },

    async putObject(bucket, key, body, opts = {}) {
      const extraHeaders: Record<string, string> = {};
      if (opts.retention) {
        extraHeaders['x-amz-object-lock-mode'] = opts.retention.mode;
        extraHeaders['x-amz-object-lock-retain-until-date'] = opts.retention.retainUntil;
      }
      if (opts.legalHold) {
        extraHeaders['x-amz-object-lock-legal-hold'] = opts.legalHold;
      }
      const response = await request('PUT', bucket, key, {
        extraHeaders,
        body,
      });
      return { versionId: response.headers.get('x-amz-version-id') };
    },

    async getObject(bucket, key, versionId) {
      const response = await request('GET', bucket, key, {
        query: versionId === undefined ? undefined : [['versionId', versionId]],
      });
      return new Uint8Array(await response.arrayBuffer());
    },

    async deleteObject(bucket, key, versionId) {
      const response = await request('DELETE', bucket, key, {
        query: versionId === undefined ? undefined : [['versionId', versionId]],
      });
      return { versionId: response.headers.get('x-amz-version-id') };
    },
  };
}
