// 集成：HTTP 全链路——地理端点 + 证据上传→BullMQ→rustfs→校验和 往返
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { NearbyResultSchema } from '@ne/contracts'
import { createApp } from '../src/bootstrap.js'

// 每文件独立 boot（vitest forks 隔离），随机端口；复用 setup 逻辑见同目录说明
// （vitest 5 + helpers 子目录的扩展名解析问题 → 直接内联）
import { afterAll, beforeAll } from 'vitest'
import type { INestApplication } from '@nestjs/common'

const ctx: { app?: INestApplication; baseUrl?: string } = {}
beforeAll(async () => {
  ctx.app = await createApp({ logger: false })
  await ctx.app!.listen(0)
  ctx.baseUrl = await ctx.app!.getUrl()
})
afterAll(async () => {
  await ctx.app!.close()
})

const runId = randomUUID().slice(0, 8)

async function jfetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${ctx.baseUrl}${path}`, init)
}

describe('health', () => {
  it('GET /health → 200 {status:ok}', async () => {
    const res = await jfetch('/health')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { status: string }).status).toBe('ok')
  })
})

describe('执法点位 HTTP 端点（契约校验走 zod 管道）', () => {
  it('POST 创建 + GET nearby 命中（响应过 NearbyResultSchema）', async () => {
    const name = `http-${runId}`
    const created = await jfetch('/enforcement-points', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, lat: 39.915, lng: 116.404 }),
    })
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: number }
    expect(id).toBeGreaterThan(0)

    const nearby = await jfetch('/enforcement-points/nearby?lat=39.9151&lng=116.4041&radiusM=500')
    expect(nearby.status).toBe(200)
    const parsed = NearbyResultSchema.parse(await nearby.json())
    const hit = parsed.points.find((p) => p.name === name)
    expect(hit).toBeDefined()
    expect(hit!.distanceM).toBeGreaterThan(0)
    expect(hit!.distanceM).toBeLessThan(500)
  })

  it('非法 body → 400 + issues；非法 query → 400', async () => {
    const badBody = await jfetch('/enforcement-points', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', lat: 999, lng: 0 }),
    })
    expect(badBody.status).toBe(400)
    const bodyJson = (await badBody.json()) as { issues: unknown[] }
    expect(Array.isArray(bodyJson.issues)).toBe(true)

    const badQuery = await jfetch('/enforcement-points/nearby?lat=abc&lng=116&radiusM=100')
    expect(badQuery.status).toBe(400)
  })
})

describe('证据全链路往返（rustfs 上传→BullMQ 处理→下载/presign）', () => {
  it('上传 1MB → 队列计算 sha256 → content/url 两路取回字节一致', async () => {
    const payload = new Uint8Array(randomBytes(1_000_000))
    const sha = createHash('sha256').update(payload).digest('hex')

    // 注：HTTP header 不接受非 Latin-1 字符（undici 直接抛 TypeError）——
    // unicode 文件名的传输契约（RFC 8187 / multipart / base64 头）留 SPEC 决策，见 NOTES.md
    const uploaded = await jfetch('/evidence', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-original-name': `evidence-${runId}.bin`,
      },
      body: payload,
    })
    expect(uploaded.status).toBe(201)
    const record0 = (await uploaded.json()) as { id: string; status: string }
    expect(record0.status).toBe('pending')

    // 等待 worker 完成处理（BullMQ 往返）
    let record: { id: string; status: string; sha256: string | null; bytes: number | null } | undefined
    const deadline = Date.now() + 20_000
    for (;;) {
      const res = await jfetch(`/evidence/${record0.id}`)
      expect(res.status).toBe(200)
      record = (await res.json()) as NonNullable<typeof record>
      if (record.status !== 'pending') break
      if (Date.now() > deadline) throw new Error('队列处理超时（20s）')
      await new Promise((r) => setTimeout(r, 200))
    }
    expect(record!.status).toBe('ready')
    expect(record!.sha256).toBe(sha)
    expect(record!.bytes).toBe(payload.byteLength)

    // 直读（api 流式转发）
    const content = await jfetch(`/evidence/${record0.id}/content`)
    expect(content.status).toBe(200)
    const got = new Uint8Array(await content.arrayBuffer())
    expect(got.byteLength).toBe(payload.byteLength)
    expect(createHash('sha256').update(got).digest('hex')).toBe(sha)

    // presigned URL（容器网络内 rustfs 地址）
    const urlRes = await jfetch(`/evidence/${record0.id}/url`)
    expect(urlRes.status).toBe(200)
    const { url } = (await urlRes.json()) as { url: string }
    const presigned = await fetch(url)
    expect(presigned.status).toBe(200)
    const got2 = new Uint8Array(await presigned.arrayBuffer())
    expect(createHash('sha256').update(got2).digest('hex')).toBe(sha)
  })

  it('空上传 → 400；缺 x-original-name → 400', async () => {
    const empty = await jfetch('/evidence', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-original-name': 'e.bin' },
      body: new Uint8Array(0),
    })
    expect(empty.status).toBe(400)

    const noName = await jfetch('/evidence', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array([1, 2, 3]),
    })
    expect(noName.status).toBe(400)
  })

  it('GET 不存在的记录 → 404', async () => {
    const res = await jfetch('/evidence/nonexistent-id')
    expect(res.status).toBe(404)
  })
})
