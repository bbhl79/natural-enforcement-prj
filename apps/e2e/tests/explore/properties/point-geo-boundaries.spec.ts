// P0 业务规则属性（#107）：点位查询半径/坐标边界约束（PT-BOUND / PT-GEO）。
// 白盒合法面（Spec-e2e §1）：契约包导出 schema 的边界判定（纯函数）。
// API 黑盒面：ST_DWithin 米语义经 nearby 端点探测——apps/api 内部 haversine
// 不导入；测试侧用独立球面公式作 oracle（与 PostGIS spheroid 差 <0.6%，
// 判定裕量 0.5d/1.5d 远大于误差，距离容差 1%）。
// 地理背景：广州市中心（23.1291,113.2644）——项目为广州市自然资源部门开发，
// 原型北京坐标不搬运。
import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import fc from 'fast-check'
import {
  CreateEnforcementPointSchema,
  ENFORCEMENT_POINT_ROUTES,
  NearbyQuerySchema,
  type NearbyResult,
} from '@ne/contracts'
import { API_BASE, uniqueName } from '../../common.js'
import { runProperty } from './harness.js'

const GZ = { lat: 23.1291, lng: 113.2644 }
const EARTH_RADIUS_M = 6_371_000

const BOUND_REF = {
  property: 'P0/PT-BOUND-01/coordinate-radius-contract-boundaries',
  rule: 'PT-BOUND-01',
  charter: 'point-query-rules',
} as const
const GEO_REF = {
  property: 'P0/PT-GEO-01/nearby-radius-meter-semantics',
  rule: 'PT-GEO-01',
  charter: 'point-query-rules',
} as const

/** 数字字符串域（query coerce 语义）：数值串 + 边界/恶意字面量 */
const numericStringArb = fc.oneof(
  fc.double({ min: -200, max: 200, noNaN: true, noDefaultInfinity: true }).map(String),
  fc.constantFrom('', 'abc', '1e2', ' 1 ', '0x10', 'Infinity', '-Infinity', '1.5', '90', '-90', '180', '-180', '1', '100000', '0', '100001'),
)

test('PT-BOUND-01 nearby query 边界：接受 ⇔ 界内（coerce 语义独立 oracle）', async ({}, testInfo) => {
  await runProperty(
    testInfo,
    BOUND_REF,
    fc.asyncProperty(numericStringArb, numericStringArb, numericStringArb, async (latS, lngS, rS) => {
      // 独立 oracle：JS Number 语义 + 闭区间判定（不经被测 schema 计算期望）
      const lat = Number(latS)
      const lng = Number(lngS)
      const r = Number(rS)
      const expected = lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && Number.isInteger(r) && r >= 1 && r <= 100_000
      const result = NearbyQuerySchema.safeParse({ lat: latS, lng: lngS, radiusM: rS })
      expect(result.success, `query(${latS},${lngS},${rS}) 接受性应与界内判定一致`).toBe(expected)
      if (result.success) {
        expect(result.data).toEqual({ lat, lng, radiusM: r })
      }
    }),
    { numRuns: 200 },
  )
})

test('PT-BOUND-01 创建点位坐标边界：lat∈[-90,90] ∧ lng∈[-180,180] 闭区间', async ({}, testInfo) => {
  await runProperty(
    testInfo,
    { ...BOUND_REF, property: 'P0/PT-BOUND-01/create-coordinate-boundaries' },
    fc.asyncProperty(
      fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
      async (lat, lng) => {
        const expected = lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
        const result = CreateEnforcementPointSchema.safeParse({ name: '边界探针', lat, lng })
        expect(result.success).toBe(expected)
      },
    ),
    { numRuns: 200 },
  )
})

/** 球面正算（测试侧独立 oracle）：中心 + 方位角 + 距离 → 目标点 */
function destination(center: { lat: number; lng: number }, bearingDeg: number, distanceM: number) {
  const toRad = (d: number): number => (d * Math.PI) / 180
  const toDeg = (r: number): number => (r * 180) / Math.PI
  const delta = distanceM / EARTH_RADIUS_M
  const theta = toRad(bearingDeg)
  const phi1 = toRad(center.lat)
  const lam1 = toRad(center.lng)
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta))
  const lam2 = lam1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2))
  return { lat: toDeg(phi2), lng: toDeg(lam2) }
}

async function nearby(
  request: APIRequestContext,
  lat: number | string,
  lng: number | string,
  radiusM: number | string,
): Promise<{ status: number; result: NearbyResult | null }> {
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng), radiusM: String(radiusM) })
  const res = await request.get(`${API_BASE}${ENFORCEMENT_POINT_ROUTES.nearby}?${params.toString()}`)
  const status = res.status()
  return { status, result: status === 200 ? ((await res.json()) as NearbyResult) : null }
}

test('PT-GEO-01 nearby 半径米语义：r<d 不命中 / r≥d 命中 + 升序 + center 回显', async ({ request }, testInfo) => {
  await runProperty(
    testInfo,
    GEO_REF,
    fc.asyncProperty(
      fc.double({ min: 0, max: 360, noNaN: true, noDefaultInfinity: true }),
      fc.integer({ min: 300, max: 4000 }),
      async (bearing, d) => {
        const target = destination(GZ, bearing, d)
        const name = uniqueName(testInfo, '地理')
        const created = await request.post(`${API_BASE}${ENFORCEMENT_POINT_ROUTES.base}`, {
          data: { name, lat: target.lat, lng: target.lng },
        })
        expect(created.status(), '界内坐标创建点位应 201').toBe(201)

        // 半径 < 距离（0.5d 裕量 ≫ 球面/椭球误差）：本点不得命中
        const rOut = Math.max(1, Math.floor(d * 0.5))
        const outside = await nearby(request, GZ.lat, GZ.lng, rOut)
        expect(outside.status).toBe(200)
        expect(outside.result?.points.some((p) => p.name === name), `radius=${rOut} < d=${d} 不应命中本点`).toBe(false)

        // 半径 ≥ 距离（1.5d+100 裕量）：本点必须命中，distanceM ≤ radius 且 ≈ d
        const rIn = Math.min(100_000, Math.ceil(d * 1.5) + 100)
        const inside = await nearby(request, GZ.lat, GZ.lng, rIn)
        expect(inside.status).toBe(200)
        const result = inside.result
        expect(result).not.toBeNull()
        const mine = result?.points.find((p) => p.name === name)
        expect(mine, `radius=${rIn} ≥ d=${d} 应命中本点`).toBeTruthy()
        expect(mine?.distanceM).not.toBeNull()
        expect(mine?.distanceM ?? Infinity).toBeLessThanOrEqual(rIn)
        expect(Math.abs((mine?.distanceM ?? 0) - d)).toBeLessThanOrEqual(0.01 * d + 1)

        // 全局不变量：center/radius 回显 + 全部点按 distanceM 升序（独立排序 oracle）
        expect(result?.center).toEqual(GZ)
        expect(result?.radiusM).toBe(rIn)
        const distances = (result?.points ?? []).map((p) => p.distanceM)
        expect(distances.every((x): x is number => typeof x === 'number')).toBe(true)
        const nums = distances as number[]
        expect(nums).toEqual([...nums].sort((a, b) => a - b))
      },
    ),
    { numRuns: 6 },
  )
})

test('PT-BOUND-01 nearby 边界 HTTP 边缘：越界 400 / 边界值 200（绝不 5xx）', async ({ request }) => {
  const bad: ReadonlyArray<[string, string, string]> = [
    ['90.0001', '113.2644', '1000'],
    ['23.1291', '180.0001', '1000'],
    ['23.1291', '113.2644', '0'],
    ['23.1291', '113.2644', '100001'],
    ['23.1291', '113.2644', '1.5'],
    ['abc', '113.2644', '1000'],
  ]
  for (const [lat, lng, radiusM] of bad) {
    const res = await nearby(request, lat, lng, radiusM)
    expect(res.status, `越界 query(${lat},${lng},${radiusM}) 应 400`).toBe(400)
  }
  const good: ReadonlyArray<[string, string, string]> = [
    ['90', '180', '1'],
    ['-90', '-180', '100000'],
    ['23.1291', '113.2644', '100000'],
  ]
  for (const [lat, lng, radiusM] of good) {
    const res = await nearby(request, lat, lng, radiusM)
    expect(res.status, `边界值 query(${lat},${lng},${radiusM}) 应 200`).toBe(200)
  }
})