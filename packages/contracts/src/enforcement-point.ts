// 执法点位：传输契约（POST 体 / 附近查询 query / 响应 DTO）
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

// HTTP query 参数一律以字符串到达：coerce 到 number（事实记录于 #11 原型）
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
