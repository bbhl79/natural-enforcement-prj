// 探索 charter（#70）：对象存储按 run 绑定——API 必须把证据写进本 run 注入的 bucket。
// 本文件是隔离/服务绑定自检（不是业务 charter）：执行器额外接收本 run 的 S3 坐标，
// 仅用于直接核对对象位置，不作为业务测试访问存储的接口（公开 HTTP 面仍只经 API/UI）。
// 若编排层注入错了 bucket，本 run bucket 里不会出现这个对象，测试即失败。
import { expect, test } from '@playwright/test'
import {
  EVIDENCE_CONTENT_TYPE,
  EVIDENCE_ROUTES,
  encodeOriginalName,
  ORIGINAL_NAME_HEADER,
  type EvidenceRecordDto,
} from '@ne/contracts'
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { API_BASE, RUN_ID, s3TestConfig, uniqueName, waitForEvidenceTerminal } from '../common.js'

test('证据对象只写入本 run 注入的 bucket（服务绑定实证）', async ({ request }, testInfo) => {
  const cfg = s3TestConfig()
  const label = uniqueName(testInfo, '存储')
  const payload = new TextEncoder().encode(`${label}-${RUN_ID}`)

  const uploaded = await request.post(`${API_BASE}${EVIDENCE_ROUTES.base}`, {
    headers: {
      'content-type': EVIDENCE_CONTENT_TYPE,
      [ORIGINAL_NAME_HEADER]: encodeOriginalName(`存储-${RUN_ID}.bin`),
    },
    data: Buffer.from(payload),
  })
  expect(uploaded.status()).toBe(201)
  const record = (await uploaded.json()) as EvidenceRecordDto

  // worker 必须能经本 run bucket 读到对象并回写 ready（读取路径同样按 run 绑定）。
  const terminal = await waitForEvidenceTerminal(request, record.id)
  expect(terminal.status).toBe('ready')

  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    forcePathStyle: true,
  })
  try {
    // 对象键只由服务端生成的记录 id 构成（#69 契约）；本 run bucket 中必须存在该对象。
    await expect(
      client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: `evidence/${record.id}` })),
      `本 run bucket（${cfg.bucket}）中不存在证据对象：API 未绑定本 run 的对象存储`,
    ).resolves.toBeTruthy()
  } finally {
    client.destroy()
  }
})