// 统一校验封装行为：schema 通过则透传推断类型，失配则抛错（fail fast）
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { validated } from '../src/lib/validate.js'

const SampleSchema = z.object({ id: z.number().int(), name: z.string() }).strict()

describe('validated（统一校验封装）', () => {
  it('合法响应透传并返回推断类型', () => {
    const parse = validated(SampleSchema)
    const r = parse({ id: 1, name: '越秀公园执法点' })
    expect(r.id).toBe(1)
    expect(r.name).toBe('越秀公园执法点')
  })

  it('形状失配抛错（传输层失配即刻暴露）', () => {
    const parse = validated(SampleSchema)
    expect(() => parse({ id: 'x', name: 1 })).toThrow()
    expect(() => parse({ id: 1, name: 'a', extra: true })).toThrow()
  })
})
