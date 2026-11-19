import { describe, expect, it } from 'vitest'
import { buildObjectKey } from './keys.js'

describe('buildObjectKey', () => {
  it('uuid 分层 + 文件名清洗（每个非安全字符替换为单个 _）', () => {
    expect(buildObjectKey({ uuid: 'u1', originalName: '现场照片 01.jpg' })).toBe(
      'evidence/u1/_____01.jpg', // 现场(2)+照片(2)+空格(1) = 5 个非安全字符
    )
  })

  it('超长文件名截尾保留后 80 字符', () => {
    const long = 'a'.repeat(200) + '.png'
    const key = buildObjectKey({ uuid: 'u2', originalName: long })
    expect(key).toBe(`evidence/u2/${'a'.repeat(76)}.png`)
    expect(key.endsWith('.png')).toBe(true)
  })
})
