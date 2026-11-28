// RTK Query 手写消费 @ne/contracts（#9 决议：不做 codegen）：
// 路由常量 + 推断类型来自契约包；响应经统一校验封装（lib/validate.ts）——
// 传输层失配在前端即刻暴露。
import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react'
import {
  CreateEnforcementPointResultSchema,
  ENFORCEMENT_POINT_ROUTES,
  EvidenceRecordDtoSchema,
  evidenceRecordPath,
  HEALTH_ROUTES,
  HealthResultSchema,
  NearbyResultSchema,
  type CreateEnforcementPointDto,
  type CreateEnforcementPointResult,
  type EvidenceRecordDto,
  type HealthResult,
  type NearbyQueryDto,
  type NearbyResult,
} from '@ne/contracts'
import { buildEvidenceUploadRequest, type EvidenceUploadInput } from './lib/evidence.js'
import { validated } from './lib/validate.js'

// 运行时同源基准：浏览器走当前源（经 vite preview proxy → http://api:3000）；
// jsdom / Node 26 下 fetchBaseQuery 传相对路径会因 new Request('/...') 报错，
// 故解析为 window.location.origin；容器内真实端到端测试可通过覆盖函数指向 http://web:4173。
let apiBaseUrlOverride: string | undefined

export function setApiBaseUrlOverride(url: string | undefined): void {
  apiBaseUrlOverride = url
}

export function resolveApiBaseUrl(): string {
  if (apiBaseUrlOverride !== undefined) return apiBaseUrlOverride
  if (
    typeof window !== 'undefined' &&
    window.location?.origin &&
    window.location.origin !== 'null'
  ) {
    return window.location.origin
  }
  return 'http://localhost'
}

const dynamicBaseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = (
  args,
  api,
  extraOptions,
) => fetchBaseQuery({ baseUrl: resolveApiBaseUrl() })(args, api, extraOptions)

export const neApi = createApi({
  reducerPath: 'neApi',
  baseQuery: dynamicBaseQuery,
  tagTypes: ['Points', 'Evidence'],
  endpoints: (b) => ({
    health: b.query<HealthResult, void>({
      query: () => HEALTH_ROUTES.base,
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

    // 同源证据上传（原始字节 → 后台 worker 处理）；文件名经契约 helper 编码
    uploadEvidence: b.mutation<EvidenceRecordDto, EvidenceUploadInput>({
      query: (input) => buildEvidenceUploadRequest(input),
      transformResponse: validated(EvidenceRecordDtoSchema),
      invalidatesTags: ['Evidence'],
    }),

    // 同源读取处理状态（pending → ready/failed）；浏览器不接触内部存储地址
    getEvidence: b.query<EvidenceRecordDto, string>({
      query: (id) => evidenceRecordPath(id),
      transformResponse: validated(EvidenceRecordDtoSchema),
      providesTags: ['Evidence'],
    }),
  }),
})

export const {
  useHealthQuery,
  useNearbyQuery,
  useCreatePointMutation,
  useUploadEvidenceMutation,
  useGetEvidenceQuery,
} = neApi
