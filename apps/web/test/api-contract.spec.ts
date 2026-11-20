// 契约消费侧校验：web 工具链下用 @ne/contracts 的 zod schema 解析 api 真实响应形状
// （RTK Query transformResponse 同款调用路径——传输层失配在此先行暴露，无需起容器）。
import { describe, expect, it } from 'vitest'
import { EvidenceRecordDtoSchema, NearbyResultSchema } from '@ne/contracts'

const NEARBY_SAMPLE = {
  center: { lat: 39.9087, lng: 116.3975 },
  radiusM: 3000,
  points: [
    { id: 1, name: '天安门执法点', lat: 39.9087, lng: 116.3975, distanceM: 0, createdAt: '2026-11-20T00:00:00.000Z' },
    { id: 4, name: '西单执法点', lat: 39.9086, lng: 116.3743, distanceM: 1984.2, createdAt: '2026-11-20T00:00:00.000Z' },
  ],
}

const EVIDENCE_SAMPLE = {
  id: '01JDKZZY00000000000000000',
  pointId: null,
  originalName: '%E7%8E%B0%E5%9C%BA%E5%8F%96%E8%AF%81.jpg',
  contentType: 'application/octet-stream',
  bytes: 1024,
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  status: 'ready',
  error: null,
  createdAt: '2026-11-20T00:00:00.000Z',
}

describe('契约 schema 在 web 侧解析', () => {
  it('NearbyResultSchema 解析真实响应形状', () => {
    const r = NearbyResultSchema.parse(NEARBY_SAMPLE)
    expect(r.points).toHaveLength(2)
    expect(r.points[0]?.distanceM).toBe(0)
  })

  it('EvidenceRecordDtoSchema 解析回写后的记录（status 枚举）', () => {
    const r = EvidenceRecordDtoSchema.parse(EVIDENCE_SAMPLE)
    expect(r.status).toBe('ready')
  })

  it('契约外字段/形状失配立即失败（fail fast）', () => {
    expect(() => NearbyResultSchema.parse({ ...NEARBY_SAMPLE, points: [{ id: 'x' }] })).toThrow()
    expect(() => EvidenceRecordDtoSchema.parse({ ...EVIDENCE_SAMPLE, status: 'unknown' })).toThrow()
  })
})
