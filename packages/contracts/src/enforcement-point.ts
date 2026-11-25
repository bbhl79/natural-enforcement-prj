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

export const CreateEnforcementPointSchema = z
  .object({
    name: z.string().min(1).max(200),
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
