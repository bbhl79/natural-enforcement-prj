// e2e 公共装配（#70）：隔离参数只经环境变量注入（数据隔离收敛在 devenv 编排层，
// 测试代码不感知库名/bucket/队列名）；测试数据命名区分 run / 测试 / 尝试三层。
import { createHash, randomUUID } from 'node:crypto'
import type { APIRequestContext, TestInfo } from '@playwright/test'
import type { EvidenceRecordDto } from '@ne/contracts'

export const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3000'
export const WEB_BASE = process.env.E2E_WEB_BASE_URL ?? 'http://127.0.0.1:4173'
export const RUN_ID = process.env.E2E_RUN_ID ?? 'local'
/** 并行证据演练的共享标记（两个 run 用同组标记，互查对方数据是否泄漏）；单 run 时退化为 run 自身 */
export const PARALLEL_GROUP = process.env.E2E_PARALLEL_GROUP?.trim() || RUN_ID
/** 并行演练等待窗口（毫秒）：0 = 不额外等待（默认，单 run 快速） */
export const PARALLEL_SOAK_MS = Math.max(0, Number(process.env.E2E_PARALLEL_SOAK_MS ?? '0') || 0)

function slug(input: string): string {
  const value = input
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return value.length > 0 ? value : 't'
}

/**
 * 测试数据名（SPEC-e2e §11 三层）：
 *   run（PARALLEL_GROUP + RUN_ID） / 测试（标题 slug） / 尝试（retry）+ 随机尾。
 * 断言只匹配本测试创建的名称，天然可并行、失败不传染。
 */
export function uniqueName(testInfo: TestInfo, label: string): string {
  return `${label}-${PARALLEL_GROUP}-${RUN_ID}-${slug(testInfo.title)}-a${testInfo.retry}-${randomUUID().slice(0, 8)}`
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export interface S3TestConfig {
  readonly endpoint: string
  readonly region: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly bucket: string
}

/** 本 run 的对象存储坐标（由 devenv 注入；用于直接核对 bucket 绑定，不经公开 HTTP 面） */
export function s3TestConfig(): S3TestConfig {
  const endpoint = process.env.E2E_S3_ENDPOINT
  const accessKeyId = process.env.E2E_S3_ACCESS_KEY
  const secretAccessKey = process.env.E2E_S3_SECRET_KEY
  const bucket = process.env.E2E_S3_BUCKET
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('缺少 E2E_S3_* 注入（devenv 编排层负责每 run 资源绑定）')
  }
  return {
    endpoint,
    region: process.env.E2E_S3_REGION ?? 'us-east-1',
    accessKeyId,
    secretAccessKey,
    bucket,
  }
}

/** 轮询证据记录直到终态（pending 由本 run worker 消费）。 */
export async function waitForEvidenceTerminal(
  request: APIRequestContext,
  id: string,
  timeoutMs = 30_000,
): Promise<EvidenceRecordDto> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const res = await request.get(`${API_BASE}/evidence/${encodeURIComponent(id)}`)
    if (res.status() !== 200) throw new Error(`证据记录查询失败（HTTP ${res.status()}，id=${id}）`)
    const record = (await res.json()) as EvidenceRecordDto
    if (record.status === 'ready' || record.status === 'failed') return record
    if (Date.now() > deadline) throw new Error(`等待证据处理终态超时（${timeoutMs}ms，id=${id}）`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

/** 探索自检的点位名标签（命名契约单点维护：生成与隔离断言共用） */
export const POINT_LABEL = '点位'
const POINT_GROUP_PREFIX = `${POINT_LABEL}-${PARALLEL_GROUP}-`
const POINT_OWN_PREFIX = `${POINT_GROUP_PREFIX}${RUN_ID}-`

export function pointName(testInfo: TestInfo): string {
  return uniqueName(testInfo, POINT_LABEL)
}

/** 本 run 的并发隔离断言：同组其它 run 的点位不得出现在本 run 的读路径。 */
export function foreignPointNames(points: readonly { name: string }[]): string[] {
  return points
    .filter((p) => p.name.startsWith(POINT_GROUP_PREFIX) && !p.name.startsWith(POINT_OWN_PREFIX))
    .map((p) => p.name)
}