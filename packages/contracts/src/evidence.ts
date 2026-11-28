// 取证证据：同源文件证据往返的传输契约（Spec-工程基座 §9 / #69）。
//
// 安全边界（票面 AC）：
// - 文件名仅是展示元数据，绝不参与对象键/存储路径；对象键只由服务端生成的记录 id 构成。
// - 浏览器只经同源入口上传/下载；presigned URL 仅服务间使用，绝不出现在浏览器响应里。
// - unicode 文件名经 `x-original-name: encodeURIComponent(name)` 传输；解码失败、
//   长度超限、恶意名称（路径分隔符/控制字符/双向控制符/纯空白）一律在入口拒绝。
import { z } from 'zod'
import type { ApiContractEndpoint } from './api-contract.js'
import { HttpErrorSchema, ValidationErrorSchema } from './http-errors.js'

export const EVIDENCE_ROUTES = {
  base: '/evidence',
  detail: '/evidence/:id',
  content: '/evidence/:id/content',
} as const

export const ORIGINAL_NAME_HEADER = 'x-original-name'
export const POINT_ID_HEADER = 'x-point-id'
export const EVIDENCE_CONTENT_TYPE = 'application/octet-stream'

/** 解码后展示名的最大码点数（不是 UTF-16 单元数——emoji 按字符计） */
export const MAX_ORIGINAL_NAME_CODE_POINTS = 200
/** 线上 header 值最大长度（encodeURIComponent 最坏每码点 12 字符；留足余量） */
export const MAX_ORIGINAL_NAME_WIRE_LENGTH = 4096
/** 单次上传原始字节上限（10 MiB）；body parser 上限与之联动 */
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024
/** 应用层自校验上限要略高于契约上限，让 413 走契约声明的错误载荷而非解析层默认 413 */
export const EVIDENCE_BODY_PARSER_LIMIT_BYTES = MAX_EVIDENCE_BYTES + 1

export const EVIDENCE_STATUSES = ['pending', 'ready', 'failed'] as const
export const EvidenceStatusSchema = z.enum(EVIDENCE_STATUSES)
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>

// C0/C1 控制符（含 CR/LF/NUL——header 注入与 PostgreSQL text NUL）、
// 行/段分隔符、双向控制符（展示欺骗：用 RTL override 伪装扩展名）。
// 用码点谓词而非正则字面量：避免行分隔符/U+2028 在源码中破坏解析，也更易读。
function isForbiddenDisplayCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x00 && codePoint <= 0x1f) ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  )
}

function hasForbiddenDisplayChar(name: string): boolean {
  for (const char of name) {
    const codePoint = char.codePointAt(0)
    if (codePoint !== undefined && isForbiddenDisplayCodePoint(codePoint)) return true
  }
  return false
}
const PATH_SEPARATORS = /[\\/]/

export type OriginalNameDecodeFailureReason =
  | 'missing'
  | 'too_long_wire'
  | 'malformed_encoding'
  | 'empty'
  | 'too_long'
  | 'path_separator'
  | 'forbidden_character'
  | 'invalid'

export type OriginalNameDecodeResult =
  | { readonly ok: true; readonly name: string }
  | {
      readonly ok: false
      readonly reason: OriginalNameDecodeFailureReason
      readonly message: string
    }

export type OriginalNameValidationResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: OriginalNameDecodeFailureReason; readonly message: string }

function fail(reason: OriginalNameDecodeFailureReason, message: string): OriginalNameValidationResult {
  return { ok: false, reason, message }
}

/** 展示名校验（解码后/编码前共用；文件名不是路径，也不是对象键） */
export function validateOriginalName(name: string): OriginalNameValidationResult {
  if (name.length === 0) return fail('empty', '文件名不能为空')
  if ([...name].length > MAX_ORIGINAL_NAME_CODE_POINTS) {
    return fail('too_long', `文件名超过 ${MAX_ORIGINAL_NAME_CODE_POINTS} 个字符`)
  }
  // 路径穿越：拒绝任何分隔符与 "."/".." 名称（文件名永远只是展示元数据）
  if (PATH_SEPARATORS.test(name)) return fail('path_separator', '文件名不能包含路径分隔符')
  if (name === '.' || name === '..') return fail('invalid', '文件名不能是 "." 或 ".."')
  if (hasForbiddenDisplayChar(name)) {
    return fail('forbidden_character', '文件名不能包含控制字符或双向控制符')
  }
  if (name.trim().length === 0) return fail('invalid', '文件名不能只包含空白字符')
  return { ok: true, name }
}

/** 编码为 header 线上值（`x-original-name: encodeURIComponent(name)`） */
export function encodeOriginalName(name: string): string {
  const checked = validateOriginalName(name)
  if (!checked.ok) throw new Error(checked.message)
  return encodeURIComponent(checked.name)
}

/** 从 header 线上值解码并校验；失败原因可映射为 400/413 的稳定语义 */
export function decodeOriginalName(raw: string | null | undefined): OriginalNameDecodeResult {
  if (raw == null || raw.length === 0) {
    return { ok: false, reason: 'missing', message: `缺少 ${ORIGINAL_NAME_HEADER} 头` }
  }
  if (raw.length > MAX_ORIGINAL_NAME_WIRE_LENGTH) {
    return {
      ok: false,
      reason: 'too_long_wire',
      message: `${ORIGINAL_NAME_HEADER} 超过 ${MAX_ORIGINAL_NAME_WIRE_LENGTH} 字符`,
    }
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return { ok: false, reason: 'malformed_encoding', message: `${ORIGINAL_NAME_HEADER} 不是合法的 URI 编码` }
  }
  return validateOriginalName(decoded)
}

/**
 * Content-Disposition（RFC 6266 + RFC 5987）：ASCII 兜底 + UTF-8 百分号编码。
 * 名称已在入口校验（无 CR/LF），不会产生 header 注入。
 */
export function contentDispositionHeader(name: string): string {
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="evidence.bin"; filename*=UTF-8''${encoded}`
}

/** 同源下载路径（相对路径，永远不携带内部存储地址） */
export function evidenceContentPath(id: string): string {
  return EVIDENCE_ROUTES.content.replace(':id', encodeURIComponent(id))
}

// --- HTTP 契约 schema ---------------------------------------------------------

/** wire 值必须是非空可见 ASCII（encodeURIComponent 的输出域） */
export const OriginalNameHeaderSchema = z
  .string()
  .min(1)
  .max(MAX_ORIGINAL_NAME_WIRE_LENGTH)
  .regex(/^[\x21-\x7e]+$/, `${ORIGINAL_NAME_HEADER} 必须是非空可见 ASCII 的 URI 编码值`)

/** 关联点位 id：header 一律以字符串到达；运行时再解析为 int 并校验存在性 */
export const PointIdHeaderSchema = z.string().regex(/^[1-9][0-9]{0,9}$/, '点位 id 必须是正整数')

export const EvidenceUploadHeadersSchema = z
  .object({
    [ORIGINAL_NAME_HEADER]: OriginalNameHeaderSchema,
    [POINT_ID_HEADER]: PointIdHeaderSchema.optional(),
  })
  .strict()

export const EvidenceIdParamsSchema = z.object({ id: z.string() }).strict()

/** OpenAPI 二进制 schema（zod 唯一事实源；运行时不会把字节交给 zod 校验） */
export const BinaryBodySchema = z.string().meta({ format: 'binary' })

export const UploadEvidenceBodyContract = {
  contentType: EVIDENCE_CONTENT_TYPE,
  schema: BinaryBodySchema,
} as const

export const DownloadEvidenceBodyContract = {
  contentType: EVIDENCE_CONTENT_TYPE,
  schema: BinaryBodySchema,
} as const

export const EvidenceRecordDtoSchema = z
  .object({
    id: z.string(),
    pointId: z.number().int().nullable(),
    originalName: z.string(),
    contentType: z.string(),
    bytes: z.number().int().nonnegative().nullable(),
    sha256: z.string().nullable(),
    status: EvidenceStatusSchema,
    error: z.string().nullable(),
    createdAt: z.string(),
    // 同源下载路径（契约内即相对路径；浏览器拿不到内部存储地址）
    contentPath: z.string().regex(/^\/evidence\/[^/]+\/content$/),
  })
  .strict()
export type EvidenceRecordDto = z.infer<typeof EvidenceRecordDtoSchema>

export const EVIDENCE_ENDPOINTS: readonly ApiContractEndpoint[] = [
  {
    method: 'post',
    path: EVIDENCE_ROUTES.base,
    requestBody: UploadEvidenceBodyContract,
    headers: EvidenceUploadHeadersSchema,
    responses: {
      201: EvidenceRecordDtoSchema,
      400: ValidationErrorSchema,
      413: HttpErrorSchema,
      415: HttpErrorSchema,
      503: HttpErrorSchema,
    },
  },
  {
    method: 'get',
    path: EVIDENCE_ROUTES.detail,
    pathParams: EvidenceIdParamsSchema,
    responses: {
      200: EvidenceRecordDtoSchema,
      404: HttpErrorSchema,
    },
  },
  {
    method: 'get',
    path: EVIDENCE_ROUTES.content,
    pathParams: EvidenceIdParamsSchema,
    responses: {
      200: DownloadEvidenceBodyContract,
      404: HttpErrorSchema,
      503: HttpErrorSchema,
    },
  },
] as const