import { describe, expect, it } from 'vitest'
import { parseJob, ProcessEvidenceJobSchema } from './payload.js'

describe('ProcessEvidenceJobSchema', () => {
  it('接受 {recordId}', () => {
    expect(ProcessEvidenceJobSchema.parse({ recordId: 'ck123' })).toEqual({ recordId: 'ck123' })
    expect(parseJob({ recordId: 'ck123' }).recordId).toBe('ck123')
  })

  it('拒绝未知字段与空 id', () => {
    expect(ProcessEvidenceJobSchema.safeParse({ recordId: 'x', extra: 1 }).success).toBe(false)
    expect(ProcessEvidenceJobSchema.safeParse({ recordId: '' }).success).toBe(false)
    expect(() => parseJob(null)).toThrow(/非法任务负载/)
  })
})
