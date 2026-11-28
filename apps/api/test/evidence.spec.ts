// 集成：#69 同源文件证据往返（真实 PostGIS + Redis + rustfs）。
// 覆盖：unicode 文件名、恶意/解码失败/长度限制、后台 worker 回写、同源下载字节一致、
// 服务间 presigned（worker 经 presigned GET）与浏览器响应不泄漏内部存储地址。
//
// worker 在测试进程内以独立 Nest 上下文启动（与生产同一 WorkerModule），并使用
// 随机队列名隔离——运行中的 compose worker 不会消费本测试任务（#70 键空间隔离预演）。
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { INestApplication, INestApplicationContext } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import {
  encodeOriginalName,
  EVIDENCE_CONTENT_TYPE,
  EVIDENCE_ROUTES,
  EvidenceRecordDtoSchema,
  HttpErrorSchema,
  MAX_EVIDENCE_BYTES,
  ORIGINAL_NAME_HEADER,
  POINT_ID_HEADER,
  ValidationErrorSchema,
  type EvidenceRecordDto,
} from '@ne/contracts'
import { createApp } from '../src/bootstrap.js'
import { EnforcementPointRepo } from '../src/enforcement-point/enforcement-point.repo.js'
import { EvidenceRepo } from '../src/evidence/evidence.repo.js'
import { StorageService } from '../src/storage/storage.service.js'
import { WorkerModule } from '../src/worker/worker.module.js'

const runId = randomUUID().slice(0, 8)
const PREFIX = `file-${runId}-`
const QUEUE_NAME = `evidence-test-${runId}`
// 必须在 createApp / worker 上下文创建前设置（队列名在首次使用时读取）
process.env.EVIDENCE_QUEUE_NAME = QUEUE_NAME

const UNICODE_NAME = `广州市执法证据（${runId}）· 現場照片.jpg`
const EMOJI_NAME = '📷现场取证📸.png'
// 不可见双向控制符：用码点构造，避免源码中出现不可见字符
const RTL_OVERRIDE = String.fromCodePoint(0x202e)

const ctx: { app?: INestApplication; worker?: INestApplicationContext; baseUrl?: string } = {}
const recordIds = new Set<string>()
const extraObjectKeys = new Set<string>()

beforeAll(async () => {
  ctx.app = await createApp({ logger: false })
  await ctx.app.listen(0)
  ctx.baseUrl = await ctx.app.getUrl()
  // 独立 worker 上下文（真实 BullMQ Worker + Prisma + rustfs presigned GET）
  ctx.worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false })
})

afterAll(async () => {
  // 自清理：对象 + 记录 + 本文件创建的点位（幂等；正常路径也在这里收尾）
  const storage = ctx.app?.get(StorageService)
  if (storage) {
    for (const key of extraObjectKeys) await storage.delete(key).catch(() => undefined)
    for (const id of recordIds) await storage.delete(`evidence/${id}`).catch(() => undefined)
  }
  const repo = ctx.app?.get(EvidenceRepo)
  if (repo) await repo.deleteManyByIds([...recordIds]).catch(() => undefined)
  const points = ctx.app?.get(EnforcementPointRepo)
  if (points) await points.deleteByNamePrefix(PREFIX).catch(() => undefined)
  await ctx.worker?.close()
  await ctx.app?.close()
})

async function jfetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${ctx.baseUrl}${path}`, init)
}

interface UploadOptions {
  readonly pointId?: number | string
  readonly contentType?: string
  readonly wireName?: string
}

async function uploadRaw(
  bytes: Uint8Array,
  opts: UploadOptions & { readonly wireName?: string },
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': opts.contentType ?? EVIDENCE_CONTENT_TYPE,
  }
  if (opts.wireName !== undefined) headers[ORIGINAL_NAME_HEADER] = opts.wireName
  if (opts.pointId !== undefined) headers[POINT_ID_HEADER] = String(opts.pointId)
  return jfetch(EVIDENCE_ROUTES.base, { method: 'POST', headers, body: bytes })
}

async function uploadName(
  name: string,
  bytes: Uint8Array,
  opts: Omit<UploadOptions, 'wireName'> = {},
): Promise<Response> {
  return uploadRaw(bytes, { ...opts, wireName: encodeOriginalName(name) })
}

async function parseRecord(res: Response): Promise<EvidenceRecordDto> {
  const dto = EvidenceRecordDtoSchema.parse(await res.json())
  recordIds.add(dto.id)
  return dto
}

async function waitForTerminal(id: string, timeoutMs = 30_000): Promise<EvidenceRecordDto> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const res = await jfetch(`${EVIDENCE_ROUTES.base}/${id}`)
    expect(res.status).toBe(200)
    const dto = EvidenceRecordDtoSchema.parse(await res.json())
    if (dto.status === 'ready' || dto.status === 'failed') return dto
    if (Date.now() > deadline) throw new Error(`等待 worker 处理超时（30s，record=${id}）`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertNoInternalAddresses(text: string): void {
  for (const marker of ['rustfs', 'minio', 'S3_', 'objectKey', 'presign', '9000', 'http://', 'https://']) {
    expect(text).not.toContain(marker)
  }
}

describe('同源文件证据往返（上传 → 后台 worker → 同源下载）', () => {
  it('unicode 文件名上传：pending 后 worker 回写 ready，下载字节与上传一致，响应不含内部存储地址', async () => {
    const payload = new Uint8Array(randomBytes(256 * 1024))
    const expectedSha = sha256(payload)

    const uploaded = await uploadName(UNICODE_NAME, payload)
    expect(uploaded.status).toBe(201)
    const record = await parseRecord(uploaded)
    expect(record.status).toBe('pending')
    expect(record.originalName).toBe(UNICODE_NAME)
    expect(record.pointId).toBeNull()
    expect(record.contentPath).toBe(`${EVIDENCE_ROUTES.base}/${record.id}/content`)
    assertNoInternalAddresses(JSON.stringify(record))

    const ready = await waitForTerminal(record.id)
    expect(ready.status).toBe('ready')
    expect(ready.sha256).toBe(expectedSha)
    expect(ready.bytes).toBe(payload.byteLength)
    expect(ready.error).toBeNull()
    expect(ready.originalName).toBe(UNICODE_NAME)

    const content = await jfetch(ready.contentPath)
    expect(content.status).toBe(200)
    expect(content.headers.get('content-type')).toContain(EVIDENCE_CONTENT_TYPE)
    expect(content.headers.get('content-disposition')).toContain("filename*=UTF-8''")
    assertNoInternalAddresses(content.headers.get('content-disposition') ?? '')
    const downloaded = new Uint8Array(await content.arrayBuffer())
    expect(downloaded.byteLength).toBe(payload.byteLength)
    expect(sha256(downloaded)).toBe(expectedSha)
  })

  it('emoji 文件名同样无损往返（展示名按码点计长度）', async () => {
    const payload = new Uint8Array(randomBytes(1024))
    const uploaded = await uploadName(EMOJI_NAME, payload)
    expect(uploaded.status).toBe(201)
    const record = await parseRecord(uploaded)
    expect(record.originalName).toBe(EMOJI_NAME)
    const ready = await waitForTerminal(record.id)
    expect(ready.status).toBe('ready')
    expect(ready.sha256).toBe(sha256(payload))
  })

  it('服务间 presigned GET 可用；公开端点清单不含 presigned 路由', async () => {
    const storage = ctx.app!.get(StorageService)
    const getKey = `evidence-test/${runId}/presign-get`
    extraObjectKeys.add(getKey)

    const direct = new Uint8Array(randomBytes(4096))
    await storage.put(getKey, direct, EVIDENCE_CONTENT_TYPE)
    const getUrl = await storage.presignGet(getKey, 60)
    expect(getUrl).toContain('rustfs') // 容器内网地址：仅服务间可达
    const got = await fetch(getUrl)
    expect(got.status).toBe(200)
    expect(sha256(new Uint8Array(await got.arrayBuffer()))).toBe(sha256(direct))

    // 公开契约没有 presigned/内部 URL 端点
    expect(Object.values(EVIDENCE_ROUTES).some((p) => p.includes('url') || p.includes('presign'))).toBe(
      false,
    )
  })
})

describe('恶意文件名 / 解码失败 / 长度限制', () => {
  const cases: ReadonlyArray<{ label: string; wire: string }> = [
    { label: '路径穿越', wire: encodeURIComponent('../etc/passwd') },
    { label: '斜杠', wire: encodeURIComponent('a/b') },
    { label: '反斜杠', wire: encodeURIComponent('a\\b') },
    { label: '上级目录名', wire: encodeURIComponent('..') },
    { label: 'NUL 字节', wire: encodeURIComponent('a\u0000b') },
    { label: '换行 header 注入', wire: encodeURIComponent('a\nb') },
    { label: '回车 header 注入', wire: encodeURIComponent('a\rb') },
    { label: 'RTL override 伪装', wire: encodeURIComponent(`${RTL_OVERRIDE}gnp.exe`) },
    { label: '纯空白', wire: encodeURIComponent('   ') },
    { label: '非法百分号编码', wire: '%E0%A4%A' },
    { label: '解码后超长', wire: encodeURIComponent('a'.repeat(201)) },
  ]

  for (const item of cases) {
    it(`${item.label} → 400 + 契约错误（不落存储、不建记录）`, async () => {
      const res = await uploadRaw(new Uint8Array([1, 2, 3]), { wireName: item.wire })
      expect(res.status).toBe(400)
      const err = ValidationErrorSchema.parse(await res.json())
      expect(err.issues?.some((i) => i.path === ORIGINAL_NAME_HEADER)).toBe(true)
    })
  }

  it('缺失 x-original-name → 400', async () => {
    const res = await uploadRaw(new Uint8Array([1, 2, 3]), {})
    expect(res.status).toBe(400)
    expect(ValidationErrorSchema.parse(await res.json()).issues?.[0]?.path).toBe(ORIGINAL_NAME_HEADER)
  })

  it('wire 超长（>4096）→ 400', async () => {
    const res = await uploadRaw(new Uint8Array([1, 2, 3]), { wireName: 'a'.repeat(4097) })
    expect(res.status).toBe(400)
    expect(ValidationErrorSchema.parse(await res.json()).issues?.[0]?.code).toBe('too_long_wire')
  })

  it('文件名只作展示元数据：对象键只由记录 id 构成（不含文件名/路径）', async () => {
    const originalName = 'a'.repeat(20) + '.txt'
    const payload = new Uint8Array([7, 7, 7])
    const uploaded = await uploadName(originalName, payload)
    const record = await parseRecord(uploaded)
    const ready = await waitForTerminal(record.id)
    expect(ready.status).toBe('ready')

    const repo = ctx.app!.get(EvidenceRepo)
    const row = await repo.findById(record.id)
    expect(row?.objectKey).toBe(`evidence/${record.id}`)
    expect(row?.objectKey?.split('/')).toEqual(['evidence', record.id])
    expect(row?.objectKey).not.toContain(originalName)

    // 下载仍拿到同样的字节（展示名不参与任何存储寻址）
    const downloaded = new Uint8Array(await (await jfetch(ready.contentPath)).arrayBuffer())
    expect(sha256(downloaded)).toBe(sha256(payload))
  })
})

describe('请求媒体类型 / 体积 / 关联点位', () => {
  it('非 octet-stream 上传 → 415 + HttpError 契约', async () => {
    const res = await jfetch(EVIDENCE_ROUTES.base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [ORIGINAL_NAME_HEADER]: encodeOriginalName('a.txt') },
      body: JSON.stringify({ hello: 'world' }),
    })
    expect(res.status).toBe(415)
    expect(HttpErrorSchema.parse(await res.json()).message).toContain(EVIDENCE_CONTENT_TYPE)
  })

  it('空内容 → 400；超过上限（10MiB+1）→ 413', async () => {
    const empty = await uploadName('empty.bin', new Uint8Array(0))
    expect(empty.status).toBe(400)
    expect(ValidationErrorSchema.parse(await empty.json()).issues?.[0]?.path).toBe('body')

    const tooLarge = await uploadName('too-large.bin', new Uint8Array(MAX_EVIDENCE_BYTES + 1))
    expect(tooLarge.status).toBe(413)
    expect(HttpErrorSchema.parse(await tooLarge.json()).message).toContain('上限')
  }, 30_000)

  it('关联已存在点位 → 201 且 pointId 回读；不存在/非法点位 → 400', async () => {
    const pointRes = await jfetch('/enforcement-points', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `${PREFIX}point`, lat: 23.1291, lng: 113.2644 }),
    })
    expect(pointRes.status).toBe(201)
    const { id: pointId } = (await pointRes.json()) as { id: number }

    const uploaded = await uploadName('linked.bin', new Uint8Array([1, 2, 3, 4]), { pointId })
    expect(uploaded.status).toBe(201)
    const record = await parseRecord(uploaded)
    expect(record.pointId).toBe(pointId)
    await waitForTerminal(record.id)

    const missing = await uploadName('missing-point.bin', new Uint8Array([1]), {
      pointId: 2_147_483_647,
    })
    expect(missing.status).toBe(400)
    expect(ValidationErrorSchema.parse(await missing.json()).issues?.[0]?.path).toBe(POINT_ID_HEADER)

    const malformed = await uploadRaw(new Uint8Array([1]), {
      wireName: encodeOriginalName('bad-point.bin'),
      pointId: 'abc',
    })
    expect(malformed.status).toBe(400)
    expect(ValidationErrorSchema.parse(await malformed.json()).issues?.[0]?.path).toBe(POINT_ID_HEADER)
  })

  it('不存在的记录 → 404（详情与下载）', async () => {
    const id = randomUUID()
    expect((await jfetch(`${EVIDENCE_ROUTES.base}/${id}`)).status).toBe(404)
    expect((await jfetch(`${EVIDENCE_ROUTES.base}/${id}/content`)).status).toBe(404)
  })
})
