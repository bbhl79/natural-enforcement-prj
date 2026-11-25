// 契约消费侧校验：web 工具链下用 @ne/contracts 的 zod schema 解析 api 真实响应形状
// （RTK Query transformResponse 同款调用路径——传输层失配在此先行暴露，无需起容器）。
import { describe, expect, it } from 'vitest'
import { CreateEnforcementPointResultSchema, HealthResultSchema, NearbyResultSchema } from '@ne/contracts'

// 广州市域响应夹具
const NEARBY_SAMPLE = {
  center: { lat: 23.1291, lng: 113.2644 },
  radiusM: 8000,
  points: [
    { id: 1, name: '越秀公园执法点', lat: 23.136, lng: 113.265, distanceM: 770.5, createdAt: '2026-11-25T00:00:00.000Z' },
    { id: 2, name: '沙面执法点', lat: 23.109, lng: 113.243, distanceM: 2930.1, createdAt: '2026-11-25T00:00:00.000Z' },
  ],
}

describe('契约 schema 在 web 侧解析', () => {
  it('NearbyResultSchema 解析真实响应形状', () => {
    const r = NearbyResultSchema.parse(NEARBY_SAMPLE)
    expect(r.points).toHaveLength(2)
    expect(r.points[0]?.distanceM).toBe(770.5)
  })

  it('CreateEnforcementPointResultSchema 解析 create 响应', () => {
    expect(CreateEnforcementPointResultSchema.parse({ id: 7 })).toEqual({ id: 7 })
  })

  it('HealthResultSchema 解析健康检查响应', () => {
    expect(HealthResultSchema.parse({ status: 'ok', uptime: 42 })).toEqual({ status: 'ok', uptime: 42 })
  })

  it('契约外字段/形状失配立即失败（fail fast）', () => {
    expect(() => NearbyResultSchema.parse({ ...NEARBY_SAMPLE, points: [{ id: 'x' }] })).toThrow()
    expect(() => CreateEnforcementPointResultSchema.parse({ id: 'x' })).toThrow()
  })
})
