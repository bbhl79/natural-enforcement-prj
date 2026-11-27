// 契约 schema 行为单元测试（可缓存、零基础设施）
import { describe, expect, it } from 'vitest'
import {
  API_CONTRACT_ENDPOINTS,
  CreateEnforcementPointResultSchema,
  CreateEnforcementPointSchema,
  ENFORCEMENT_POINT_ROUTES,
  HEALTH_ROUTES,
  HealthResultSchema,
  NearbyQuerySchema,
  NearbyResultSchema,
  ValidationErrorSchema,
} from './enforcement-point.js'

describe('CreateEnforcementPointSchema', () => {
  it('接受合法点位', () => {
    expect(
      CreateEnforcementPointSchema.parse({ name: '珠江新城执法点', lat: 23.1197, lng: 113.321 }),
    ).toMatchObject({ name: '珠江新城执法点' })
  })

  it('拒绝未知字段（strict）与越界坐标', () => {
    expect(
      CreateEnforcementPointSchema.safeParse({ name: 'x', lat: 0, lng: 0, extra: 1 }).success,
    ).toBe(false)
    expect(CreateEnforcementPointSchema.safeParse({ name: 'x', lat: 91, lng: 0 }).success).toBe(false)
  })
})

describe('CreateEnforcementPointResultSchema（create 类 {id} 响应契约）', () => {
  it('接受 {id} 响应', () => {
    expect(CreateEnforcementPointResultSchema.parse({ id: 42 })).toEqual({ id: 42 })
  })

  it('拒绝缺 id / 非整数 id / 多余字段', () => {
    expect(CreateEnforcementPointResultSchema.safeParse({}).success).toBe(false)
    expect(CreateEnforcementPointResultSchema.safeParse({ id: 1.5 }).success).toBe(false)
    expect(CreateEnforcementPointResultSchema.safeParse({ id: 1, extra: 1 }).success).toBe(false)
  })
})

describe('NearbyQuerySchema', () => {
  it('把字符串 query 参数 coerce 成数字', () => {
    expect(NearbyQuerySchema.parse({ lat: '23.1291', lng: '113.2644', radiusM: '500' })).toEqual({
      lat: 23.1291,
      lng: 113.2644,
      radiusM: 500,
    })
  })

  it('拒绝非数字字符串与越界半径', () => {
    expect(NearbyQuerySchema.safeParse({ lat: 'abc', lng: '113.26', radiusM: '1' }).success).toBe(false)
    expect(NearbyQuerySchema.safeParse({ lat: '23.1', lng: '113.26', radiusM: '0' }).success).toBe(false)
  })
})

describe('HealthResultSchema（健康检查响应契约）', () => {
  it('解析 {status, uptime}', () => {
    expect(HealthResultSchema.parse({ status: 'ok', uptime: 42 })).toEqual({ status: 'ok', uptime: 42 })
  })

  it('缺字段立即失败', () => {
    expect(HealthResultSchema.safeParse({ status: 'ok' }).success).toBe(false)
  })
})

describe('NearbyResultSchema', () => {
  it('解析真实响应形状', () => {
    const r = NearbyResultSchema.parse({
      center: { lat: 23.1291, lng: 113.2644 },
      radiusM: 3000,
      points: [
        { id: 1, name: '越秀公园执法点', lat: 23.136, lng: 113.265, distanceM: 770.5, createdAt: '2026-11-25T00:00:00.000Z' },
      ],
    })
    expect(r.points).toHaveLength(1)
    expect(r.points[0]?.distanceM).toBe(770.5)
  })

  it('形状失配立即失败（fail fast）', () => {
    expect(() =>
      NearbyResultSchema.parse({ center: { lat: 1, lng: 2 }, radiusM: 3, points: [{ id: 'x' }] }),
    ).toThrow()
  })
})

describe('ValidationErrorSchema 与 API_CONTRACT_ENDPOINTS', () => {
  it('解析 400 校验错误载荷并拒绝缺 message', () => {
    expect(
      ValidationErrorSchema.parse({
        message: '契约校验失败',
        issues: [{ path: 'lat', code: 'too_big', message: 'Too big' }],
      }),
    ).toMatchObject({ message: '契约校验失败' })
    expect(
      ValidationErrorSchema.parse({
        message: 'Unexpected token',
        error: 'Bad Request',
        statusCode: 400,
      }),
    ).toMatchObject({ statusCode: 400 })
    expect(ValidationErrorSchema.safeParse({ issues: [] }).success).toBe(false)
  })

  it('端点契约清单覆盖全部公开路由并声明请求体/参数/响应 schema', () => {
    const keys = API_CONTRACT_ENDPOINTS.map((e) => `${e.method.toUpperCase()} ${e.path}`)
    expect(keys).toEqual([
      `POST ${ENFORCEMENT_POINT_ROUTES.base}`,
      `GET ${ENFORCEMENT_POINT_ROUTES.nearby}`,
      `GET ${HEALTH_ROUTES.base}`,
    ])
    const createEp = API_CONTRACT_ENDPOINTS.find(
      (e) => e.method === 'post' && e.path === ENFORCEMENT_POINT_ROUTES.base,
    )
    expect(createEp?.requestBody).toBe(CreateEnforcementPointSchema)
    expect(createEp?.responses[201]).toBe(CreateEnforcementPointResultSchema)
    expect(createEp?.responses[400]).toBe(ValidationErrorSchema)
  })
})
