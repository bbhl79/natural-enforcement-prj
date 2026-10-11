// SigV4 签名单测（#53，unit 层无库）。
// 独立真值来源 = 开发期以 Python hashlib/hmac 按 AWS SigV4 规范另行实现的参照计算
//（与本 TS 实现零共享代码），固定输入的期望输出以字面量固化——
// 签名向量不允许由被测代码同款逻辑推导（防同义反复）。
import { describe, expect, it } from 'vitest';

import {
  buildCanonicalRequest,
  deriveSigningKey,
  sha256Hex,
  signRequest,
  uriEncode,
} from '../src/s3-signer.ts';

const ACCESS = 'AKIDEXAMPLE';
const SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
const REGION = 'us-east-1';
const AMZ_DATE = '20261010T120000Z';

describe('SigV4 签名（AWS 规范，参照向量来自 Python 独立实现）', () => {
  it('sha256Hex 与已知摘要字面量一致', () => {
    expect(sha256Hex('hello immutable world')).toBe(
      '84a0a7a31cc1911a2d5219c270d908dcf2b0d0823d5da667c9647f83ac83af00',
    );
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('uriEncode 按 RFC 3986 非转义字符集编码', () => {
    expect(uriEncode('v1&x')).toBe('v1%26x');
    expect(uriEncode('abc 123/')).toBe('abc%20123%2F');
    expect(uriEncode('卷宗/demo')).toBe('%E5%8D%B7%E5%AE%97%2Fdemo');
    expect(uriEncode('a-_.~b')).toBe('a-_.~b');
  });

  it('PUT 对象（含特殊字符 query 值）的规范请求与签名匹配参照向量', () => {
    const payload = 'hello immutable world';
    const signed = signRequest(
      { accessKey: ACCESS, secretKey: SECRET },
      REGION,
      {
        method: 'PUT',
        key: 'ne-e3/demo.txt',
        query: [['versionId', 'v1&x']],
        payload,
        host: 'rustfs:9000',
        amzDate: AMZ_DATE,
      },
    );

    expect(signed.canonicalRequest).toBe(
      'PUT\n' +
        '/ne-e3/demo.txt\n' +
        'versionId=v1%26x\n' +
        'host:rustfs:9000\n' +
        'x-amz-content-sha256:84a0a7a31cc1911a2d5219c270d908dcf2b0d0823d5da667c9647f83ac83af00\n' +
        'x-amz-date:20261010T120000Z\n' +
        '\n' +
        'host;x-amz-content-sha256;x-amz-date\n' +
        '84a0a7a31cc1911a2d5219c270d908dcf2b0d0823d5da667c9647f83ac83af00',
    );
    expect(signed.stringToSign).toBe(
      'AWS4-HMAC-SHA256\n' +
        '20261010T120000Z\n' +
        '20261010/us-east-1/s3/aws4_request\n' +
        '5f03a3f253e09c18a9a5ccc6f6470740d0e7e4710830f442ab2b0c49cafdb521',
    );
    expect(signed.signature).toBe(
      '3dcce4c76a3888a16e57bedf4112f00cc2497ff54aa1669e4ddad1cd72d77dc2',
    );
    expect(signed.headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261010/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
        'Signature=3dcce4c76a3888a16e57bedf4112f00cc2497ff54aa1669e4ddad1cd72d77dc2',
    );
  });

  it('GET 对象（空载荷 + 多 query + 非 ASCII）的签名匹配参照向量', () => {
    const signed = signRequest(
      { accessKey: ACCESS, secretKey: SECRET },
      REGION,
      {
        method: 'GET',
        key: 'ne-e3/demo.txt',
        query: [
          ['versionId', 'abc 123/'],
          ['prefix', '卷宗/demo'],
        ],
        payload: new Uint8Array(0),
        host: 'rustfs:9000',
        amzDate: AMZ_DATE,
      },
    );

    expect(signed.signature).toBe(
      'f1cb33da358330151c5080a85720ad5ac7ae990d6a5ab65f2cec1ada31a8d793',
    );
  });

  it('对象锁头等额外头被纳入签名（保留头不出现在规范请求外）', () => {
    const signed = signRequest(
      { accessKey: ACCESS, secretKey: SECRET },
      REGION,
      {
        method: 'PUT',
        key: 'ne-e3/demo.txt',
        payload: 'x',
        host: 'rustfs:9000',
        amzDate: AMZ_DATE,
        extraHeaders: {
          'x-amz-object-lock-mode': 'COMPLIANCE',
          'x-amz-object-lock-retain-until-date': '2126-10-10T12:00:00Z',
        },
      },
    );

    expect(signed.canonicalRequest).toContain('x-amz-object-lock-mode:COMPLIANCE\n');
    expect(signed.canonicalRequest).toContain('x-amz-object-lock-retain-until-date:2126-10-10T12:00:00Z\n');
    expect(signed.headers['x-amz-object-lock-mode']).toBe('COMPLIANCE');
  });

  it('buildCanonicalRequest 对 header 名做小写化与排序', () => {
    const { canonical, signedHeaders } = buildCanonicalRequest({
      method: 'HEAD',
      encodedPath: '/ne-e3',
      headers: { 'X-Amz-Date': AMZ_DATE, Host: 'rustfs:9000' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });

    expect(signedHeaders).toBe('host;x-amz-date');
    expect(canonical).toContain('host:rustfs:9000\nx-amz-date:20261010T120000Z\n');
  });

  it('deriveSigningKey 按 date→region→service→aws4_request 逐级派生', () => {
    const key = deriveSigningKey(SECRET, '20261010', REGION);
    // 参照向量：Python hmac 链最终密钥的 hex
    expect(Buffer.from(key).toString('hex')).toBe(
      '30163ea499c1a2c1013df0e687d6417ae8b0f11eb35e7bebf232016e5ae6a0e9',
    );
  });
});
