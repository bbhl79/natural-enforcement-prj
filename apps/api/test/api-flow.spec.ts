// 集成：HTTP 全链路——健康 + 执法点位创建/附近查询（真实 PostGIS，契约校验走 zod 管道）
// 测试自清理：本文件创建的全部点位统一 `http-${runId}-` 前缀，收尾删除并按前缀断言零残留——
// devenv test 跑完库里不应留下测试点位。
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { INestApplication } from '@nestjs/common'
import type { OpenAPIObject } from '@nestjs/swagger'
import {
  ConflictErrorSchema,
  CreateEnforcementPointResultSchema,
  HealthResultSchema,
  NearbyResultSchema,
  ValidationErrorSchema,
} from '@ne/contracts'
import { createApp } from '../src/bootstrap.js'
import { verifyOpenApiCompleteness } from '../src/openapi.js'
import { EnforcementPointRepo } from '../src/enforcement-point/enforcement-point.repo.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

// 每文件独立 boot（vitest forks 隔离），随机端口
const ctx: { app?: INestApplication; baseUrl?: string } = {}
const runId = randomUUID().slice(0, 8)
const PREFIX = `http-${runId}-` // 统一前缀：本文件创建的全部点位归入，清理与断言按此前缀

beforeAll(async () => {
  ctx.app = await createApp({ logger: false })
  await ctx.app!.listen(0)
  ctx.baseUrl = await ctx.app!.getUrl()
})
afterAll(async () => {
  // 安全网：即使中途失败也不留残留（幂等；正常路径由清理用例显式删除并断言）
  const repo = new EnforcementPointRepo(ctx.app!.get(PrismaService))
  await repo.deleteByNamePrefix(PREFIX).catch(() => undefined)
  await ctx.app!.close()
})

async function jfetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${ctx.baseUrl}${path}`, init)
}

describe('health & openapi', () => {
  it('GET /health → 200（响应过 HealthResultSchema）', async () => {
    const res = await jfetch('/health')
    expect(res.status).toBe(200)
    expect(HealthResultSchema.parse(await res.json()).status).toBe('ok')
  })

  it('GET /openapi.json → 200 且通过完整契约核对', async () => {
    const res = await jfetch('/openapi.json')
    expect(res.status).toBe(200)
    const doc = (await res.json()) as OpenAPIObject
    expect(verifyOpenApiCompleteness(doc)).toEqual({ ok: true, errors: [] })
  })
})

describe('执法点位 HTTP 端点（契约校验走 zod 管道）', () => {
  it('POST 创建（响应过 CreateEnforcementPointResultSchema）+ GET nearby 命中（响应过 NearbyResultSchema）', async () => {
    const name = `${PREFIX}main`
    const created = await jfetch('/enforcement-points', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, lat: 23.13, lng: 113.265 }),
    })
    expect(created.status).toBe(201)
    const { id } = CreateEnforcementPointResultSchema.parse(await created.json())
    expect(id).toBeGreaterThan(0)

    // 重复名称 → 409 Conflict（响应过 ConflictErrorSchema）
    const dup = await jfetch('/enforcement-points', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, lat: 23.13, lng: 113.265 }),
    })
    expect(dup.status).toBe(409)
    expect(ConflictErrorSchema.parse(await dup.json()).message).toContain(name)

    const nearby = await jfetch('/enforcement-points/nearby?lat=23.1301&lng=113.2651&radiusM=500')
    expect(nearby.status).toBe(200)
    const parsed = NearbyResultSchema.parse(await nearby.json())
    const hit = parsed.points.find((p) => p.name === name)
    expect(hit).toBeDefined()
    expect(hit!.distanceM).toBeGreaterThan(0)
    expect(hit!.distanceM).toBeLessThan(500)
  })

  it('非法 body → 400 + ValidationErrorSchema；非法 query → 400 + ValidationErrorSchema', async () => {
    const badBody = await jfetch('/enforcement-points', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', lat: 999, lng: 0 }),
    })
    expect(badBody.status).toBe(400)
    const bodyErr = ValidationErrorSchema.parse(await badBody.json())
    expect(bodyErr.issues?.length ?? 0).toBeGreaterThan(0)

    const badQuery = await jfetch('/enforcement-points/nearby?lat=abc&lng=113.26&radiusM=100')
    expect(badQuery.status).toBe(400)
    const queryErr = ValidationErrorSchema.parse(await badQuery.json())
    expect(queryErr.issues?.length ?? 0).toBeGreaterThan(0)
  })

  it('自清理：按统一前缀删除本 run 全部点位，断言零残留', async () => {
    const repo = new EnforcementPointRepo(ctx.app!.get(PrismaService))
    const deleted = await repo.deleteByNamePrefix(PREFIX)
    expect(deleted).toBe(1) // main 点位
    expect(await repo.countByNamePrefix(PREFIX)).toBe(0)
  })
})
