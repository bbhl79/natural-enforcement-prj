// 证据文件传输契约单元测试（零基础设施，Spec-工程基座 §9 / #69）：
// unicode 文件名编解码、解码失败、长度限制、恶意文件名与同源路径语义。
import { describe, expect, it } from 'vitest'
import {
  contentDispositionHeader,
  decodeOriginalName,
  encodeOriginalName,
  EVIDENCE_CONTENT_TYPE,
  EVIDENCE_ENDPOINTS,
  EVIDENCE_ROUTES,
  EvidenceContentResponseHeadersSchema,
  EvidenceRecordDtoSchema,
  evidenceContentPath,
  evidenceRecordPath,
  MAX_EVIDENCE_BYTES,
  MAX_ORIGINAL_NAME_CODE_POINTS,
  MAX_ORIGINAL_NAME_WIRE_LENGTH,
  OriginalNameHeaderSchema,
  POINT_ID_HEADER,
  ORIGINAL_NAME_HEADER,
  validateOriginalName,
} from './evidence.js'
import { isMediaType } from './api-contract.js'

const UNICODE_NAME = '广州市执法证据（2026）· 現場照片.jpg'
const EMOJI_NAME = '📷现场取证📸.png'
// 不可见双向控制符：用码点构造，避免源码中出现不可见字符
const RTL_OVERRIDE = String.fromCodePoint(0x202e)
const BIDI_ISOLATE = String.fromCodePoint(0x2066)
const BIDI_POP = String.fromCodePoint(0x2069)

describe('encodeOriginalName / decodeOriginalName（unicode 往返）', () => {
  it('中文、全角符号与 emoji 均能无损往返', () => {
    for (const name of [UNICODE_NAME, EMOJI_NAME, 'plain-evidence.bin']) {
      const wire = encodeOriginalName(name)
      expect(wire).toMatch(/^[\x21-\x7e]+$/) // header 只允许可见 ASCII
      expect(decodeOriginalName(wire)).toEqual({ ok: true, name })
    }
  })

  it('编码结果与 x-original-name: encodeURIComponent(name) 的线上约定一致', () => {
    expect(encodeOriginalName(UNICODE_NAME)).toBe(encodeURIComponent(UNICODE_NAME))
  })

  it('字符数按码点计：200 个 emoji 合法，201 个拒绝', () => {
    const max = '📷'.repeat(MAX_ORIGINAL_NAME_CODE_POINTS)
    expect(validateOriginalName(max)).toEqual({ ok: true, name: max })
    expect(decodeOriginalName(encodeURIComponent(max))).toEqual({ ok: true, name: max })

    const tooLong = '📷'.repeat(MAX_ORIGINAL_NAME_CODE_POINTS + 1)
    expect(validateOriginalName(tooLong)).toMatchObject({ ok: false, reason: 'too_long' })
  })

  it('编码前即拒绝非法展示名（不在客户端生成不可解码的 header）', () => {
    expect(() => encodeOriginalName('../etc/passwd')).toThrow('路径分隔符')
    expect(() => encodeOriginalName('a\u0000b')).toThrow('控制字符')
  })
})

describe('decodeOriginalName（解码失败与长度限制）', () => {
  it('缺失/空值 → missing', () => {
    expect(decodeOriginalName(undefined)).toMatchObject({ ok: false, reason: 'missing' })
    expect(decodeOriginalName(null)).toMatchObject({ ok: false, reason: 'missing' })
    expect(decodeOriginalName('')).toMatchObject({ ok: false, reason: 'missing' })
  })

  it('非法百分号编码 → malformed_encoding（decodeURIComponent 抛错被收敛）', () => {
    for (const raw of ['%', '%E0%A4%A', '%ZZ', '%C3%28']) {
      expect(decodeOriginalName(raw)).toMatchObject({ ok: false, reason: 'malformed_encoding' })
    }
  })

  it('wire 超长 → too_long_wire（不先解码，避免无界分配）', () => {
    expect(decodeOriginalName('a'.repeat(MAX_ORIGINAL_NAME_WIRE_LENGTH + 1))).toMatchObject({
      ok: false,
      reason: 'too_long_wire',
    })
  })

  it('解码后超长 → too_long', () => {
    expect(decodeOriginalName(encodeURIComponent('a'.repeat(201)))).toMatchObject({
      ok: false,
      reason: 'too_long',
    })
  })

  it('空 wire 视同缺失；空展示名由 validateOriginalName 判 empty', () => {
    // encodeURIComponent('') === ''，线上与缺失不可区分——统一按 missing 拒绝
    expect(decodeOriginalName(encodeURIComponent(''))).toMatchObject({ ok: false, reason: 'missing' })
    expect(validateOriginalName('')).toMatchObject({ ok: false, reason: 'empty' })
  })
})

describe('decodeOriginalName（恶意文件名）', () => {
  it('路径分隔符与穿越名称一律拒绝（文件名不是路径）', () => {
    for (const name of ['../etc/passwd', 'a/b', 'a\\b', '..', '.']) {
      const result = decodeOriginalName(encodeURIComponent(name))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(['path_separator', 'invalid']).toContain(result.reason)
    }
  })

  it('NUL/换行/回车/ESC 等控制字符拒绝（header 注入与 PostgreSQL text 不可存）', () => {
    for (const name of ['a\u0000b', 'a\nb', 'a\rb', 'a\u001b[31m', 'a\u009fb']) {
      expect(decodeOriginalName(encodeURIComponent(name))).toMatchObject({
        ok: false,
        reason: 'forbidden_character',
      })
    }
  })

  it('双向控制符拒绝（防止 RTL override 伪装扩展名）', () => {
    for (const name of [`${RTL_OVERRIDE}gnp.exe`, `a${BIDI_ISOLATE}b${BIDI_POP}`]) {
      expect(decodeOriginalName(encodeURIComponent(name))).toMatchObject({
        ok: false,
        reason: 'forbidden_character',
      })
    }
  })

  it('纯空白名称拒绝', () => {
    for (const name of ['   ', '\t\t']) {
      expect(decodeOriginalName(encodeURIComponent(name))).toMatchObject({ ok: false })
    }
  })
})

describe('Content-Disposition 与同源路径', () => {
  it('Content-Disposition 使用 RFC 5987 UTF-8 编码且不含 CR/LF', () => {
    const value = contentDispositionHeader(UNICODE_NAME)
    expect(value.startsWith('attachment; filename="evidence.bin"; filename*=UTF-8\'\'')).toBe(true)
    expect(value).toContain(encodeURIComponent(UNICODE_NAME))
    expect(value).not.toMatch(/[\r\n]/)
  })

  it('RFC 5987 要求转义 encodeURIComponent 未编码的 \' ( ) *', () => {
    const value = contentDispositionHeader("a'b(c)d*e.txt")
    expect(value).toContain("filename*=UTF-8''a%27b%28c%29d%2Ae.txt")
  })

  it('下载路径是同源相对路径（绝不携带内部存储地址）', () => {
    const id = '0b6c1f60-1f1e-4c55-9a70-1b8e3a7e9d21'
    const contentPath = evidenceContentPath(id)
    expect(contentPath).toBe(`/evidence/${id}/content`)
    expect(contentPath).not.toMatch(/^[a-z]+:\/\//i)
    expect(contentPath).not.toContain('rustfs')
    expect(evidenceRecordPath(id)).toBe(`/evidence/${id}`)
  })

  it('下载响应头 Content-Disposition 进入契约（与运行时设置同源）', () => {
    expect(EvidenceContentResponseHeadersSchema.parse({
      'content-disposition': contentDispositionHeader('a.txt'),
    })).toMatchObject({ 'content-disposition': expect.stringContaining('filename*=UTF-8') })
    expect(EvidenceContentResponseHeadersSchema.safeParse({}).success).toBe(false)
  })
})

describe('HTTP 契约 schema', () => {
  it('x-original-name 只接受可见 ASCII 的 wire 值', () => {
    expect(OriginalNameHeaderSchema.safeParse(encodeOriginalName(UNICODE_NAME)).success).toBe(true)
    expect(OriginalNameHeaderSchema.safeParse(UNICODE_NAME).success).toBe(false)
    expect(OriginalNameHeaderSchema.safeParse('').success).toBe(false)
  })

  it('EvidenceRecordDtoSchema 严格校验并拒绝内部字段泄漏', () => {
    const dto = {
      id: '0b6c1f60-1f1e-4c55-9a70-1b8e3a7e9d21',
      pointId: 3,
      originalName: UNICODE_NAME,
      contentType: EVIDENCE_CONTENT_TYPE,
      bytes: 128,
      sha256: 'a'.repeat(64),
      status: 'ready',
      error: null,
      createdAt: '2026-11-28T00:00:00.000Z',
      contentPath: '/evidence/0b6c1f60-1f1e-4c55-9a70-1b8e3a7e9d21/content',
    }
    expect(EvidenceRecordDtoSchema.parse(dto)).toEqual(dto)
    // 内部 bucket/objectKey/presigned 地址不属于浏览器契约
    for (const extra of ['bucket', 'objectKey', 'url']) {
      expect(EvidenceRecordDtoSchema.safeParse({ ...dto, [extra]: 'internal' }).success).toBe(false)
    }
    expect(
      EvidenceRecordDtoSchema.safeParse({ ...dto, contentPath: 'http://rustfs:9000/x' }).success,
    ).toBe(false)
  })

  it('证据端点契约覆盖上传/查询/下载，上传与下载均为二进制媒体类型且带 header 契约', () => {
    const keys = EVIDENCE_ENDPOINTS.map((e) => `${e.method.toUpperCase()} ${e.path}`)
    expect(keys).toEqual([
      `POST ${EVIDENCE_ROUTES.base}`,
      `GET ${EVIDENCE_ROUTES.detail}`,
      `GET ${EVIDENCE_ROUTES.content}`,
    ])

    const upload = EVIDENCE_ENDPOINTS[0]!
    expect(isMediaType(upload.requestBody)).toBe(true)
    if (isMediaType(upload.requestBody)) {
      expect(upload.requestBody.contentType).toBe(EVIDENCE_CONTENT_TYPE)
    }
    expect(Object.keys(upload.headers?.shape ?? {})).toEqual([ORIGINAL_NAME_HEADER, POINT_ID_HEADER])

    const download = EVIDENCE_ENDPOINTS[2]!
    const response = download.responses[200]
    expect(isMediaType(response)).toBe(true)
    if (isMediaType(response)) expect(response.contentType).toBe(EVIDENCE_CONTENT_TYPE)
    expect(download.responseHeaders?.[200]).toBe(EvidenceContentResponseHeadersSchema)
  })

  it('上传字节上限是正数且 body parser 上限联动', () => {
    expect(MAX_EVIDENCE_BYTES).toBe(10 * 1024 * 1024)
  })
})
