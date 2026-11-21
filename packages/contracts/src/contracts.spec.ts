// 契约 schema 行为单元测试（可缓存、零基础设施）
import { describe, expect, it } from 'vitest'
import { CreateEnforcementPointSchema, NearbyQuerySchema } from './enforcement-point.js'
import { EvidenceRecordDtoSchema } from './evidence.js'

describe('CreateEnforcementPointSchema', () => {
  it('接受合法点位', () => {
    expect(
      CreateEnforcementPointSchema.parse({ name: '中关村执法点', lat: 39.98, lng: 116.31 }),
    ).toMatchObject({ name: '中关村执法点' })
  })

  it('拒绝未知字段（strict）与越界坐标', () => {
    expect(
      CreateEnforcementPointSchema.safeParse({ name: 'x', lat: 0, lng: 0, extra: 1 }).success,
    ).toBe(false)
    expect(CreateEnforcementPointSchema.safeParse({ name: 'x', lat: 91, lng: 0 }).success).toBe(false)
  })

  it('拒绝 NUL 字符（DEF-0001 修复：PostgreSQL text 禁存 → 400 而非 500）', () => {
    expect(CreateEnforcementPointSchema.safeParse({ name: 'a\u0000b', lat: 0, lng: 0 }).success).toBe(false)
    expect(CreateEnforcementPointSchema.safeParse({ name: '\u0000', lat: 0, lng: 0 }).success).toBe(false)
  })
})

describe('NearbyQuerySchema', () => {
  it('把字符串 query 参数 coerce 成数字', () => {
    expect(NearbyQuerySchema.parse({ lat: '39.9', lng: '116.4', radiusM: '500' })).toEqual({
      lat: 39.9,
      lng: 116.4,
      radiusM: 500,
    })
  })

  it('拒绝非数字字符串', () => {
    expect(NearbyQuerySchema.safeParse({ lat: 'abc', lng: '116', radiusM: '1' }).success).toBe(false)
  })
})

describe('EvidenceRecordDtoSchema', () => {
  it('接受 pending 态记录（数值列未就绪为 null）', () => {
    const r = EvidenceRecordDtoSchema.parse({
      id: 'ck1',
      pointId: null,
      originalName: 'a.jpg',
      contentType: 'application/octet-stream',
      bytes: null,
      sha256: null,
      status: 'pending',
      error: null,
      createdAt: new Date().toISOString(),
    })
    expect(r.status).toBe('pending')
  })

  it('拒绝未知状态', () => {
    expect(
      EvidenceRecordDtoSchema.safeParse({
        id: 'ck1',
        pointId: null,
        originalName: 'a.jpg',
        contentType: 'application/octet-stream',
        bytes: 1,
        sha256: 'x',
        status: 'gone',
        error: null,
        createdAt: new Date().toISOString(),
      }).success,
    ).toBe(false)
  })
})
