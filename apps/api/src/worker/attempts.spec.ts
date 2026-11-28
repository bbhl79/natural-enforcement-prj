import { describe, expect, it } from 'vitest'
import { isFinalAttempt } from './attempts.js'

describe('isFinalAttempt（重试期间不写最终失败）', () => {
  it('attempts=3：前两次失败不是最终失败，第三次是', () => {
    expect(isFinalAttempt(1, 3)).toBe(false)
    expect(isFinalAttempt(2, 3)).toBe(false)
    expect(isFinalAttempt(3, 3)).toBe(true)
  })

  it('未配置 attempts 时按单次处理（首次即最终）', () => {
    expect(isFinalAttempt(1, undefined)).toBe(true)
    expect(isFinalAttempt(0, undefined)).toBe(false)
    expect(isFinalAttempt(0, 1)).toBe(false)
  })
})
