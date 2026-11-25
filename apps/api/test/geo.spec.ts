// 集成：PostGIS 空间查询正确性 + GiST 索引使用证据（EXPLAIN）
// 测试自清理：本文件创建的全部点位统一 `it-${runId}-` 前缀，收尾删除并按前缀断言零残留——
// devenv test 跑完库里不应留下测试点位。
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EnforcementPointRepo } from '../src/enforcement-point/enforcement-point.repo.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { haversineMeters } from '../src/util/geo.js'

const db = new PrismaService()
const repo = new EnforcementPointRepo(db)
const runId = randomUUID().slice(0, 8)
const PREFIX = `it-${runId}-` // 统一前缀：near/far/exp 全部归入，清理与断言按此前缀

const CENTER = { lat: 23.1291, lng: 113.2644 } // 广州市中心（市政府一带）

beforeAll(async () => {
  await db.$connect()
})

afterAll(async () => {
  // 安全网：即使中途失败也不留残留（幂等；正常路径由清理用例显式删除并断言）
  await repo.deleteByNamePrefix(PREFIX).catch(() => undefined)
  await db.$disconnect()
})

describe('EnforcementPointRepo 空间读写', () => {
  it('create + findNearby：ST_DWithin 半径语义（米）+ 距离与 haversine 互证', async () => {
    const near = `${PREFIX}near`
    const far = `${PREFIX}far`
    // 近点：中心东北 ~0.7km（越秀区东部）；远点：西南 ~34km 外（佛山方向）
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

  it('EXPLAIN：ST_DWithin 走 GiST 索引（EnforcementPoint_location_idx）', async () => {
    const n = await repo.bulkInsertForExplain(`${PREFIX}exp-`, CENTER, 2_000)
    expect(n).toBe(2_000)

    const plan = await repo.explainNearby(CENTER, 300)
    expect(plan).toContain('Index Scan')
    expect(plan.toLowerCase()).toContain('enforcementpoint_location_idx')
  })

  it('自清理：按统一前缀删除本 run 全部点位，断言零残留', async () => {
    const deleted = await repo.deleteByNamePrefix(PREFIX)
    expect(deleted).toBe(2_000 + 2) // 2000 bulk + near/far
    expect(await repo.countByNamePrefix(PREFIX)).toBe(0)
  })
})
