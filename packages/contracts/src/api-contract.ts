// 公开 API 端点契约类型骨架（手写契约与生成契约共用；#66 / #67）。
// 这里只放类型：schema 是唯一事实源（zod-first），端点清单由 api-registry 装配。
import type { z } from 'zod'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

export interface ApiContractEndpoint {
  readonly method: HttpMethod
  readonly path: string
  readonly requestBody?: z.ZodType
  readonly query?: z.ZodObject
  readonly responses: Readonly<Record<number, z.ZodType>>
}
