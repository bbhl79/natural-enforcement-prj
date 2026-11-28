// 对象键单元测试（#69 AC：文件名仅展示元数据，不作路径或存储键）
import { describe, expect, it } from 'vitest'
import { buildEvidenceObjectKey } from './keys.js'

describe('buildEvidenceObjectKey', () => {
  it('只由记录 id 构成（不含原文件名/路径分隔符）', () => {
    const id = '0b6c1f60-1f1e-4c55-9a70-1b8e3a7e9d21'
    const key = buildEvidenceObjectKey(id)
    expect(key).toBe(`evidence/${id}`)
    expect(key).not.toContain('..')
  })

  it('同一 id 恒定、不同 id 不冲突', () => {
    expect(buildEvidenceObjectKey('a')).toBe(buildEvidenceObjectKey('a'))
    expect(buildEvidenceObjectKey('a')).not.toBe(buildEvidenceObjectKey('b'))
  })
})