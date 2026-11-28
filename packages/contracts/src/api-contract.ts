// 公开 API 端点契约类型骨架（手写契约与生成契约共用；#66 / #67 / #69）。
// 这里只放类型：schema 是唯一事实源（zod-first），端点清单由 api-registry 装配。
//
// 媒体类型扩展（#69）：默认请求体/响应体是 application/json（zod schema 直接派生）。
// 非 JSON 端点（如原始字节上传/下载）用 ApiContractMediaType 显式声明 contentType
// 与 schema；OpenAPI 完整性检查（openapi.ts）对两种形态统一核对。
import type { z } from 'zod'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

/** 非 default JSON 的媒体类型契约：schema 仍是 zod 唯一事实源（如 binary 用 meta） */
export interface ApiContractMediaType {
  readonly contentType: string
  readonly schema: z.ZodType
}

/** 请求体：zod schema（application/json）或显式媒体类型 */
export type ApiContractRequestBody = z.ZodType | ApiContractMediaType

/** 响应体：zod schema（application/json）或显式媒体类型（如 application/octet-stream） */
export type ApiContractResponseBody = z.ZodType | ApiContractMediaType

export interface ApiContractEndpoint {
  readonly method: HttpMethod
  readonly path: string
  readonly requestBody?: ApiContractRequestBody
  readonly query?: z.ZodObject
  /** 请求头契约（OpenAPI in: header 参数；#69 文件名/关联点位头） */
  readonly headers?: z.ZodObject
  /** 路径参数契约（OpenAPI in: path 参数；#69 证据记录 id） */
  readonly pathParams?: z.ZodObject
  readonly responses: Readonly<Record<number, ApiContractResponseBody>>
}

export function isMediaType(value: unknown): value is ApiContractMediaType {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { contentType?: unknown }).contentType === 'string' &&
    'schema' in value
  )
}