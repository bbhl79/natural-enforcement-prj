// S3 兼容客户端单测（#53，unit 层无库）。
// 接缝 = HTTP 边界：注入 fetch 替身，断言「请求形态」（方法/URL/签名头/对象锁头）
// 与「响应解析」（版本 id、错误码透出）；不触真实网络。
import { describe, expect, it, vi } from 'vitest';

import { createS3Client, S3Error } from '../src/s3-client.ts';

const CONFIG = {
  endpoint: 'http://rustfs:9000',
  region: 'us-east-1',
  accessKey: 'AKIDEXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  now: () => new Date('2026-10-10T12:00:00.000Z'),
};

const XML_ERROR = `<Error><Code>AccessDenied</Code><Message>Object is WORM protected</Message></Error>`;

function fetchStub(status: number, opts: { headers?: Record<string, string>; body?: string } = {}) {
  return vi.fn(async () => {
    const headers = new Map(Object.entries(opts.headers ?? {}));
    // 204/304 等无体状态码禁止携带 body（undici Response 契约）
    const body = opts.body ?? (status === 204 ? null : '');
    return new Response(body, {
      status,
      headers: Object.fromEntries(headers),
    });
  }) as unknown as typeof fetch;
}

describe('S3 兼容客户端（RustFS 适配的协议层）', () => {
  it('putObject 携带对象锁保留头并返回存储端版本 id', async () => {
    const fetchImpl = fetchStub(200, { headers: { 'x-amz-version-id': 'v1' } });
    const client = createS3Client({ ...CONFIG, fetchImpl });

    const result = await client.putObject('ne-e3', 'a/文书.txt', new TextEncoder().encode('内容'), {
      retention: { mode: 'COMPLIANCE', retainUntil: '2126-10-10T12:00:00Z' },
    });

    expect(result).toEqual({ versionId: 'v1' });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://rustfs:9000/ne-e3/a/%E6%96%87%E4%B9%A6.txt');
    expect(init.method).toBe('PUT');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-amz-object-lock-mode']).toBe('COMPLIANCE');
    expect(headers['x-amz-object-lock-retain-until-date']).toBe('2126-10-10T12:00:00Z');
    expect(headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers.authorization).toContain('Credential=AKIDEXAMPLE/20261010/us-east-1/s3/aws4_request');
  });

  it('getObject 按 versionId 组装 URL 并返回字节内容', async () => {
    const fetchImpl = fetchStub(200, { body: '原始内容' });
    const client = createS3Client({ ...CONFIG, fetchImpl });

    const content = await client.getObject('ne-e3', 'demo.txt', 'v1&x');

    expect(new TextDecoder().decode(content)).toBe('原始内容');
    const [url] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [string];
    expect(url).toBe('http://rustfs:9000/ne-e3/demo.txt?versionId=v1%26x');
  });

  it('deleteObject 不带 versionId 时即对最新世代发起删除（违规尝试通道，仅设施内用）', async () => {
    const fetchImpl = fetchStub(204, { headers: { 'x-amz-version-id': 'd1' } });
    const client = createS3Client({ ...CONFIG, fetchImpl });

    const result = await client.deleteObject('ne-e3', 'demo.txt');

    expect(result).toEqual({ versionId: 'd1' });
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://rustfs:9000/ne-e3/demo.txt');
    expect(init.method).toBe('DELETE');
  });

  it('bucketExists 以 404 区分不存在，其余错误原样抛出', async () => {
    const missing = createS3Client({ ...CONFIG, fetchImpl: fetchStub(404, { body: XML_ERROR }) });
    await expect(missing.bucketExists('ne-e3')).resolves.toBe(false);

    const denied = createS3Client({ ...CONFIG, fetchImpl: fetchStub(403, { body: XML_ERROR }) });
    await expect(denied.bucketExists('ne-e3')).rejects.toMatchObject({ status: 403 });
  });

  it('错误响应透出 S3 错误码与人类可读消息（红绿对照的判别依据）', async () => {
    const fetchImpl = fetchStub(403, { body: XML_ERROR });
    const client = createS3Client({ ...CONFIG, fetchImpl });

    const err = await client.putObject('ne-e3', 'demo.txt', new Uint8Array([1])).catch((e) => e);
    expect(err).toBeInstanceOf(S3Error);
    expect(err.code).toBe('AccessDenied');
    expect(err.message).toContain('WORM');
  });

  it('createBucket 带对象锁：AWS 标准头被拒时降级 MinIO 风格头重试', async () => {
    const calls: Array<string | undefined> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push(headers['x-amz-object-lock-enabled-for-bucket'] ?? headers['x-amz-bucket-object-lock-enabled']);
      if (calls.length === 1) {
        return new Response(XML_ERROR, { status: 400 });
      }
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    const client = createS3Client({ ...CONFIG, fetchImpl });

    await client.createBucket('ne-e3', { objectLockEnabled: true });

    expect(calls).toEqual(['true', 'true']);
  });
});
