import { Injectable } from '@nestjs/common'
import type { CreateEnforcementPointResult } from '@ne/contracts'
import { PrismaService } from '../prisma/prisma.service.js'
import type { LatLng } from '../util/geo.js'

export type NearbyRow = {
  id: number
  name: string
  lat: number
  lng: number
  distance_m: number
  createdAt: Date
}

/**
 * 空间读写全部走 $queryRaw（Prisma client 不含 Unsupported 列）：
 * - geography(Point,4326) + ST_DWithin（geography 版第三参=米，bbox 比较走 GiST）
 * - 输出用 ST_Y/ST_X 拆坐标、ST_Distance 取米；原生 geography 列返回 WKB hex，不可直接 select
 */
@Injectable()
export class EnforcementPointRepo {
  constructor(private readonly db: PrismaService) {}

  async create(name: string, at: LatLng): Promise<CreateEnforcementPointResult> {
    const rows = await this.db.$queryRaw<{ id: number }[]>`
      INSERT INTO "EnforcementPoint" ("name", "location")
      VALUES (${name}, ST_SetSRID(ST_Point(${at.lng}, ${at.lat}), 4326)::geography)
      RETURNING id`
    const row = rows[0]
    if (!row) throw new Error('INSERT 未返回行')
    return row
  }

  async findNearby(center: LatLng, radiusM: number): Promise<NearbyRow[]> {
    return this.db.$queryRaw<NearbyRow[]>`
      SELECT id, name,
             ST_Y("location"::geometry) AS lat,
             ST_X("location"::geometry) AS lng,
             ST_Distance("location", ST_SetSRID(ST_Point(${center.lng}, ${center.lat}), 4326)::geography) AS distance_m,
             "createdAt"
      FROM "EnforcementPoint"
      WHERE ST_DWithin("location", ST_SetSRID(ST_Point(${center.lng}, ${center.lat}), 4326)::geography, ${radiusM})
      ORDER BY distance_m ASC`
  }

  /** EXPLAIN 证据：断言空间查询走 GiST 索引（集成测试消费） */
  async explainNearby(center: LatLng, radiusM: number): Promise<string> {
    const rows = await this.db.$queryRaw<{ 'QUERY PLAN': unknown }[]>`
      EXPLAIN (ANALYZE, FORMAT JSON)
      SELECT id FROM "EnforcementPoint"
      WHERE ST_DWithin("location", ST_SetSRID(ST_Point(${center.lng}, ${center.lat}), 4326)::geography, ${radiusM})`
    return JSON.stringify(rows)
  }

  async bulkInsertForExplain(namePrefix: string, center: LatLng, count: number): Promise<number> {
    // 密集簇（中心 ~1km 内）+ 远处散点混合，让规划器有真实选择空间
    const n = await this.db.$executeRaw`
      INSERT INTO "EnforcementPoint" ("name", "location")
      SELECT ${namePrefix} || g,
             ST_SetSRID(
               ST_Point(
                 ${center.lng} + 0.010 * sin(g * 1.7) * (0.15 + 0.85 * (g % 7) / 7.0),
                 ${center.lat} + 0.008 * cos(g * 2.3) * (0.15 + 0.85 * (g % 5) / 5.0)
               ), 4326)::geography
      FROM generate_series(1, ${count}) AS g`
    await this.db.$executeRaw`ANALYZE "EnforcementPoint"`
    return n
  }

  /** 测试自清理：按统一前缀删除（starts_with 免 LIKE 转义），返回删除行数 */
  async deleteByNamePrefix(prefix: string): Promise<number> {
    return this.db.$executeRaw`DELETE FROM "EnforcementPoint" WHERE starts_with(name, ${prefix})`
  }

  /** 清理断言：按统一前缀计数（应归 0） */
  async countByNamePrefix(prefix: string): Promise<number> {
    const rows = await this.db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "EnforcementPoint" WHERE starts_with(name, ${prefix})`
    return Number(rows[0]?.n ?? 0)
  }
}
