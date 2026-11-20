// RTK Query 手写消费 @ne/contracts（#9 决议：不做 codegen）：
// 路由常量来自契约包；响应经契约 zod schema 运行时校验（transformResponse）——传输层失配立即暴露。
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import {
  ENFORCEMENT_POINT_ROUTES,
  EVIDENCE_ROUTES,
  EvidenceRecordDtoSchema,
  NearbyResultSchema,
  type CreateEnforcementPointDto,
  type EvidenceRecordDto,
  type NearbyQueryDto,
  type NearbyResult,
} from '@ne/contracts'
import { encodeWireName } from './lib/format.js'

export const neApi = createApi({
  reducerPath: 'neApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/' }), // 同源：api 调用经 vite preview proxy → http://api:3000
  tagTypes: ['Points', 'Evidence'],
  endpoints: (b) => ({
    health: b.query<{ status: string; uptime: number }, void>({
      query: () => '/health',
    }),

    nearby: b.query<NearbyResult, NearbyQueryDto>({
      query: (p) => ({ url: ENFORCEMENT_POINT_ROUTES.nearby, params: p }),
      transformResponse: (raw: unknown) => NearbyResultSchema.parse(raw),
      providesTags: ['Points'],
    }),

    createPoint: b.mutation<{ id: number }, CreateEnforcementPointDto>({
      query: (body) => ({ url: ENFORCEMENT_POINT_ROUTES.base, method: 'POST', body }),
      invalidatesTags: ['Points'], // 建点后 nearby 自动重查（PostGIS 实时可见）
    }),

    getEvidence: b.query<EvidenceRecordDto, string>({
      query: (id) => `${EVIDENCE_ROUTES.base}/${id}`,
      transformResponse: (raw: unknown) => EvidenceRecordDtoSchema.parse(raw),
      providesTags: ['Evidence'],
    }),

    // 原始字节上传（octet-stream）：队列消费由 api 侧 BullMQ worker 异步完成 → 前端轮询 getEvidence
    uploadEvidence: b.mutation<
      { id: string },
      { name: string; pointId: number | null; bytes: ArrayBuffer }
    >({
      query: ({ name, pointId, bytes }) => ({
        url: EVIDENCE_ROUTES.base,
        method: 'POST',
        body: new Uint8Array(bytes),
        headers: {
          'content-type': 'application/octet-stream',
          'x-original-name': encodeWireName(name),
          ...(pointId != null ? { 'x-point-id': String(pointId) } : {}),
        },
      }),
      invalidatesTags: ['Evidence'],
    }),
  }),
})

export const {
  useHealthQuery,
  useNearbyQuery,
  useCreatePointMutation,
  useGetEvidenceQuery,
  useUploadEvidenceMutation,
} = neApi
