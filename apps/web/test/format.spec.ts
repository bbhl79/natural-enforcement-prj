import { describe, expect, it } from 'vitest'
import { formatDistance } from '../src/lib/format.js'

describe('formatDistance', () => {
  it('空值渲染占位符', () => {
    expect(formatDistance(null)).toBe('—')
    expect(formatDistance(undefined)).toBe('—')
  })
  it('米级取整', () => {
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(123.4)).toBe('123 m')
    expect(formatDistance(999.9)).toBe('1000 m')
  })
  it('公里级保留两位', () => {
    expect(formatDistance(1984)).toBe('1.98 km')
    expect(formatDistance(3000)).toBe('3.00 km')
  })
})
