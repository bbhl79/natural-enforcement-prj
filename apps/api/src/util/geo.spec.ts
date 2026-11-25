import { describe, expect, it } from 'vitest'
import { haversineMeters } from './geo.js'

describe('haversineMeters', () => {
  it('赤道上经度 1° ≈ 111.32km（±1%）', () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })
    expect(d).toBeGreaterThan(110_209) // 111.32km 的 99%
    expect(d).toBeLessThan(112_433) // 111.32km 的 101%
  })

  it('同点为 0；纬度 1° ≈ 111.19km', () => {
    expect(haversineMeters({ lat: 23.1291, lng: 113.2644 }, { lat: 23.1291, lng: 113.2644 })).toBe(0)
    const d = haversineMeters({ lat: 23, lng: 113 }, { lat: 24, lng: 113 })
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_500)
  })

  it('越秀公园→广州塔 ≈ 6.9km（互证基准值，±5% 容差）', () => {
    const d = haversineMeters({ lat: 23.136, lng: 113.265 }, { lat: 23.1065, lng: 113.3245 })
    expect(d).toBeGreaterThan(6_500)
    expect(d).toBeLessThan(7_400)
  })
})
