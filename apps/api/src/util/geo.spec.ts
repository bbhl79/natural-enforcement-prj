import { describe, expect, it } from 'vitest'
import { haversineMeters } from './geo.js'

describe('haversineMeters', () => {
  it('赤道上经度 1° ≈ 111.32km（±1%）', () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })
    expect(d).toBeGreaterThan(110_209) // 111.32km 的 99%
    expect(d).toBeLessThan(112_433) // 111.32km 的 101%
  })

  it('同点为 0；纬度 1° ≈ 111.19km', () => {
    expect(haversineMeters({ lat: 39.9, lng: 116.4 }, { lat: 39.9, lng: 116.4 })).toBe(0)
    const d = haversineMeters({ lat: 39, lng: 116 }, { lat: 40, lng: 116 })
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_500)
  })

  it('天安门→中关村 ≈ 9.7km（互证基准值，±10% 容差）', () => {
    const d = haversineMeters({ lat: 39.9087, lng: 116.3975 }, { lat: 39.9847, lng: 116.3159 })
    expect(d).toBeGreaterThan(8_700)
    expect(d).toBeLessThan(10_700)
  })
})
