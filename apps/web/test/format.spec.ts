import { describe, expect, it } from 'vitest'
import { formatBytes, formatDistance, shortSha } from '../src/lib/format.js'

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

describe('formatBytes（证据文件，10MiB 上限内）', () => {
  it('空值占位，B/KiB/MiB 三档', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KiB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.00 MiB')
  })
})

describe('shortSha', () => {
  it('空值占位；长 sha256 截断展示', () => {
    expect(shortSha(null)).toBe('—')
    expect(shortSha('abcdef0123456789')).toBe('abcdef012345…')
    expect(shortSha('abc')).toBe('abc')
  })
})
