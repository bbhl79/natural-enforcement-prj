// 证据上传请求构造（UI 侧契约消费）：文件名编码、可选点位、同源 URL。
import { describe, expect, it } from 'vitest'
import {
  decodeOriginalName,
  EVIDENCE_CONTENT_TYPE,
  EVIDENCE_ROUTES,
  ORIGINAL_NAME_HEADER,
  POINT_ID_HEADER,
} from '@ne/contracts'
import { buildEvidenceUploadRequest } from '../src/lib/evidence.js'

const UNICODE_NAME = '广州市执法证据（2026）· 現場照片.jpg'

describe('buildEvidenceUploadRequest', () => {
  it('unicode 文件名按 x-original-name: encodeURIComponent 传输且可无损解码', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const req = buildEvidenceUploadRequest({ name: UNICODE_NAME, pointId: null, bytes })
    expect(req.url).toBe(EVIDENCE_ROUTES.base) // 同源相对路径
    expect(req.method).toBe('POST')
    expect(req.body).toBe(bytes)
    expect(req.headers['content-type']).toBe(EVIDENCE_CONTENT_TYPE)
    expect(decodeOriginalName(req.headers[ORIGINAL_NAME_HEADER])).toEqual({
      ok: true,
      name: UNICODE_NAME,
    })
  })

  it('关联点位仅在填写时携带', () => {
    const bytes = new Uint8Array([1])
    expect(buildEvidenceUploadRequest({ name: 'a.txt', pointId: null, bytes }).headers).not.toHaveProperty(
      POINT_ID_HEADER,
    )
    expect(
      buildEvidenceUploadRequest({ name: 'a.txt', pointId: 42, bytes }).headers[POINT_ID_HEADER],
    ).toBe('42')
  })

  it('恶意文件名在客户端即被拒绝（不生成不可解码 header）', () => {
    expect(() =>
      buildEvidenceUploadRequest({ name: '../etc/passwd', pointId: null, bytes: new Uint8Array([1]) }),
    ).toThrow('路径分隔符')
    expect(() =>
      buildEvidenceUploadRequest({ name: 'a\u0000b', pointId: null, bytes: new Uint8Array([1]) }),
    ).toThrow('控制字符')
  })
})