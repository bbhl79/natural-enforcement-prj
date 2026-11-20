import { describe, expect, it } from 'vitest'
import { encodeWireName, formatBytes, formatDistance, shortSha } from '../src/lib/format.js'

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

describe('formatBytes', () => {
  it('空值占位 + 各量级', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('shortSha', () => {
  it('空值占位；截取前 12 位', () => {
    expect(shortSha(null)).toBe('—')
    expect(shortSha('abcdef0123456789')).toBe('abcdef012345')
  })
})

describe('encodeWireName（unicode 文件名 → ASCII-safe header）', () => {
  it('中文文件名转百分号编码', () => {
    expect(encodeWireName('现场取证.jpg')).toBe('%E7%8E%B0%E5%9C%BA%E5%8F%96%E8%AF%81.jpg')
    expect(decodeURIComponent(encodeWireName('现场取证.jpg'))).toBe('现场取证.jpg')
  })
})
