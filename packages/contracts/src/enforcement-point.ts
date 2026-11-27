// 执法点位：传输契约（POST 体 / 附近查询 query / 响应 DTO）
// zod-first（Spec-工程基座 §1）：schema 是唯一真相，类型经 z.infer 推断，
// 路由常量前后端共享；响应 schema 全覆盖（含 create 类 {id} 响应，§9）。
import { z } from 'zod'

export const ENFORCEMENT_POINT_ROUTES = {
  base: '/enforcement-points',
  nearby: '/enforcement-points/nearby',
} as const

const latSchema = z.number().min(-90).max(90)
const lngSchema = z.number().min(-180).max(180)

// PostgreSQL text 不接受 NUL 字节（SQLSTATE 22021）：契约在入口即拒绝，
// 使「OpenAPI 声明的合法请求」与运行时行为一致（Schemathesis ST101 实测发现，
// 否则契约校验放行的名称会在 INSERT 阶段炸成未声明的 500）。
// 用 regex（而非 refine）以便该约束进入派生的 JSON Schema / OpenAPI pattern。
const nameSchema = z
  .string()
  .min(1)
  .max(200)
  // eslint-disable-next-line no-control-regex -- 显式排除 NUL（U+0000）：PostgreSQL text 不接受该字节，规则此处为有意为之
  .regex(/^[^\u0000]*$/, { message: '名称不能包含 NUL 字节' })

export const CreateEnforcementPointSchema = z
  .object({
    name: nameSchema,
    lat: latSchema,
    lng: lngSchema,
  })
  .strict()
export type CreateEnforcementPointDto = z.infer<typeof CreateEnforcementPointSchema>

// create 类端点的响应契约（Spec §9：响应 schema 全覆盖，含 {id} 响应）
export const CreateEnforcementPointResultSchema = z
  .object({
    id: z.number().int(),
  })
  .strict()
export type CreateEnforcementPointResult = z.infer<typeof CreateEnforcementPointResultSchema>

// HTTP query 参数一律以字符串到达：coerce 到 number（原型 #11 实测事实）
export const NearbyQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusM: z.coerce.number().int().min(1).max(100_000),
  })
  .strict()
export type NearbyQueryDto = z.infer<typeof NearbyQuerySchema>

export const EnforcementPointDtoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  distanceM: z.number().nullable(),
  createdAt: z.string(),
})
export type EnforcementPointDto = z.infer<typeof EnforcementPointDtoSchema>

export const NearbyResultSchema = z.object({
  center: z.object({ lat: z.number(), lng: z.number() }),
  radiusM: z.number(),
  points: z.array(EnforcementPointDtoSchema),
})
export type NearbyResult = z.infer<typeof NearbyResultSchema>

// 健康检查：浏览器旅程消费的响应同样纳入契约全覆盖（Spec §9）
export const HEALTH_ROUTES = {
  base: '/health',
} as const

export const HealthResultSchema = z.object({
  status: z.string(),
  uptime: z.number(),
})
export type HealthResult = z.infer<typeof HealthResultSchema>

// 通用 HTTP 错误基类（与 NestJS HttpException 默认载荷同构）
export const HttpErrorSchema = z.object({
  message: z.string(),
  error: z.string().optional(),
  statusCode: z.number().int().optional(),
})
export type HttpError = z.infer<typeof HttpErrorSchema>

// 400 请求契约校验错误载荷（兼容 ZodValidationPipe 与框架层非法 JSON 400）
export const ValidationIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
})
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>

export const ValidationErrorSchema = HttpErrorSchema.extend({
  issues: z.array(ValidationIssueSchema).optional(),
})
export type ValidationError = z.infer<typeof ValidationErrorSchema>

// 409 冲突错误载荷（如执法点位唯一名称冲突）
export const ConflictErrorSchema = HttpErrorSchema
export type ConflictError = z.infer<typeof ConflictErrorSchema>

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

export interface ApiContractEndpoint {
  readonly method: HttpMethod
  readonly path: string
  readonly requestBody?: z.ZodType
  readonly query?: z.ZodObject
  readonly responses: Readonly<Record<number, z.ZodType>>
}

// 公开 API 端点契约总表（zod 唯一事实源；OpenAPI 完整性检查据此核对，遗漏即报错）
export const API_CONTRACT_ENDPOINTS: readonly ApiContractEndpoint[] = [
  {
    method: 'post',
    path: ENFORCEMENT_POINT_ROUTES.base,
    requestBody: CreateEnforcementPointSchema,
    responses: {
      201: CreateEnforcementPointResultSchema,
      400: ValidationErrorSchema,
      409: ConflictErrorSchema,
    },
  },
  {
    method: 'get',
    path: ENFORCEMENT_POINT_ROUTES.nearby,
    query: NearbyQuerySchema,
    responses: {
      200: NearbyResultSchema,
      400: ValidationErrorSchema,
    },
  },
  {
    method: 'get',
    path: HEALTH_ROUTES.base,
    responses: {
      200: HealthResultSchema,
    },
  },
] as const
