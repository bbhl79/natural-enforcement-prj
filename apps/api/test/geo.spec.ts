// 集成：PostGIS 空间查询正确性 + GiST 索引使用证据（EXPLAIN）
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EnforcementPointRepo } from '../src/enforcement-point/enforcement-point.repo.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { haversineMeters } from '../src/util/geo.js'

const db = new PrismaService()
const repo = new EnforcementPointRepo(db)
const runId = randomUUID().slice(0, 8)

const CENTER = { lat: 39.915, lng: 116.404 } // 北京市中心

beforeAll(async () => {
  await db.$connect()
})

afterAll(async () => {
  await repo.cleanupExplainRows(runId).catch(() => undefined)
  await db.$disconnect()
})

describe('EnforcementPointRepo 空间读写', () => {
  it('create + findNearby：ST_DWithin 半径语义（米）+ 距离与 haversine 互证', async () => {
    const near = `it-near-${runId}`
    const far = `it-far-${runId}`
    // 近点：中心东北 ~0.7km；远点：~30km 外（涿州方向）
    await repo.create(near, { lat: CENTER.lat + 0.005, lng: CENTER.lng + 0.005 })
    await repo.create(far, { lat: CENTER.lat - 0.2, lng: CENTER.lng - 0.25 })

    const rows = await repo.findNearby(CENTER, 2_000)
    const names = rows.map((r) => r.name)
    expect(names).toContain(near)
    expect(names).not.toContain(far)

    const hit = rows.find((r) => r.name === near)
    expect(hit).toBeDefined()
    const expectM = haversineMeters(CENTER, { lat: CENTER.lat + 0.005, lng: CENTER.lng + 0.005 })
    // geography 默认 spheroid 距离 vs 球面 haversine：±2% 内一致
    expect(hit!.distance_m).toBeGreaterThan(expectM * 0.98)
    expect(hit!.distance_m).toBeLessThan(expectM * 1.02)
  })

  it('EXPLAIN：ST_DWithin 走 GiST 索引（ EnforcementPoint_location_idx ）', async () => {
    const n = await repo.bulkInsertForExplain(runId, CENTER, 2_000)
    expect(n).toBe(2_000)

    const plan = await repo.explainNearby(CENTER, 300)
    expect(plan).toContain('Index Scan')
    expect(plan.toLowerCase()).toContain('enforcementpoint_location_idx')
  })

  it('幂等清理：bulk 行可按 runId 删除', async () => {
    const deleted = await repo.cleanupExplainRows(runId)
    expect(deleted).toBe(2_000)
  })
})
