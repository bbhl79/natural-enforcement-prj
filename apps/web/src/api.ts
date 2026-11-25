// RTK Query 手写消费 @ne/contracts（#9 决议：不做 codegen）：
// 路由常量 + 推断类型来自契约包；响应经统一校验封装（lib/validate.ts）——
// 传输层失配在前端即刻暴露。
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import {
  CreateEnforcementPointResultSchema,
  ENFORCEMENT_POINT_ROUTES,
  HealthResultSchema,
  NearbyResultSchema,
  type CreateEnforcementPointDto,
  type CreateEnforcementPointResult,
  type HealthResult,
  type NearbyQueryDto,
  type NearbyResult,
} from '@ne/contracts'
import { validated } from './lib/validate.js'

export const neApi = createApi({
  reducerPath: 'neApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/' }), // 同源：api 调用经 vite preview proxy → http://api:3000
  tagTypes: ['Points'],
  endpoints: (b) => ({
    health: b.query<HealthResult, void>({
      query: () => '/health',
      transformResponse: validated(HealthResultSchema),
    }),

    nearby: b.query<NearbyResult, NearbyQueryDto>({
      query: (p) => ({ url: ENFORCEMENT_POINT_ROUTES.nearby, params: p }),
      transformResponse: validated(NearbyResultSchema),
      providesTags: ['Points'],
    }),

    createPoint: b.mutation<CreateEnforcementPointResult, CreateEnforcementPointDto>({
      query: (body) => ({ url: ENFORCEMENT_POINT_ROUTES.base, method: 'POST', body }),
      transformResponse: validated(CreateEnforcementPointResultSchema),
      invalidatesTags: ['Points'], // 建点后 nearby 自动重查（PostGIS 实时可见）
    }),
  }),
})

export const { useHealthQuery, useNearbyQuery, useCreatePointMutation } = neApi
