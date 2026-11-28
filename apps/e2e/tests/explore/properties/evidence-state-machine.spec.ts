// P0 业务规则属性（#107）：证据处理状态机合法转移（EV-STATE-01）。
// 被检验规则（Spec-e2e §15 流程绕过/记录完整性类）：
//   上传创建 pending（bytes/sha256/error 均 null）→ 本 run worker 处理到终态 ready|failed；
//   ready ⇒ bytes=上传字节数 ∧ sha256=sha256(上传字节) ∧ error=null；
//   failed ⇒ 固定浏览器可见文案（不含内部地址）∧ bytes/sha256 保持 null；
//   终态后合法操作序列重读稳定（状态/校验和不漂移）。
// 黑盒口径（Spec-e2e §1）：只经 API 面探测；apps/api 内部纯函数
// （isFinalAttempt/toRow 等）不导入 e2e——其规则经本属性的 HTTP 行为间接检验。
// 已知规则缺口（不编码进默认属性，charter 素材归 #114/#117）：
//   markReady/markFailed 仅按 id UPDATE、无 WHERE status 前置条件（终态吸收未被
//   仓储层强制）；公开 API 无再触发处理路径，无法构造重复/乱序 job——详见
//   charter-gap-probes.spec.ts 头注。
import { expect, test } from '@playwright/test'
import fc from 'fast-check'
import {
  EVIDENCE_CONTENT_TYPE,
  EVIDENCE_ROUTES,
  EvidenceRecordDtoSchema,
  ORIGINAL_NAME_HEADER,
  encodeOriginalName,
} from '@ne/contracts'
import { API_BASE, sha256Hex, waitForEvidenceTerminal } from '../../common.js'
import { payloadBase64Arb, safeDisplayNameArb } from './arbitraries.js'
import { runProperty } from './harness.js'

// 固定失败文案（独立 oracle 字面量，与 api 侧常量同值；不导入应用内部模块）
const FAILED_MESSAGE = '证据处理失败：无法读取或校验对象'

const REF = {
  property: 'P0/EV-STATE-01/evidence-processing-legal-transitions',
  rule: 'EV-STATE-01',
  charter: 'evidence-processing-rules',
} as const

test('EV-STATE-01 证据处理状态机：合法转移与终态不变量', async ({ request }, testInfo) => {
  await runProperty(
    testInfo,
    REF,
    fc.asyncProperty(payloadBase64Arb(1024), safeDisplayNameArb, async (payloadBase64, name) => {
      const payload = Buffer.from(payloadBase64, 'base64')
      const uploaded = await request.post(`${API_BASE}${EVIDENCE_ROUTES.base}`, {
        headers: {
          'content-type': EVIDENCE_CONTENT_TYPE,
          [ORIGINAL_NAME_HEADER]: encodeOriginalName(name),
        },
        data: payload,
      })
      expect(uploaded.status(), '合法名称+合法字节的上传应 201').toBe(201)
      // strict 契约解析：任何内部字段泄漏（bucket/objectKey/presigned）在此即红
      const created = EvidenceRecordDtoSchema.parse(await uploaded.json())
      // 创建规则：pending ∧ bytes/sha256/error 全 null（pending 期间不得有终态字段）
      expect(created.status).toBe('pending')
      expect(created.bytes).toBeNull()
      expect(created.sha256).toBeNull()
      expect(created.error).toBeNull()
      expect(created.originalName).toBe(name)

      // 合法转移：pending → ready | failed（终态二选一，不得停在 pending）
      const terminal = await waitForEvidenceTerminal(request, created.id)
      expect(['ready', 'failed']).toContain(terminal.status)
      if (terminal.status === 'ready') {
        expect(terminal.bytes).toBe(payload.byteLength)
        expect(terminal.sha256).toBe(sha256Hex(payload))
        expect(terminal.error).toBeNull()
      } else {
        expect(terminal.error).toBe(FAILED_MESSAGE)
        expect(terminal.bytes).toBeNull()
        expect(terminal.sha256).toBeNull()
      }

      // 终态稳定：合法操作序列（只读重查）下终态与校验和不漂移
      const detailPath = EVIDENCE_ROUTES.detail.replace(':id', encodeURIComponent(created.id))
      const again = await request.get(`${API_BASE}${detailPath}`)
      expect(again.status()).toBe(200)
      const reread = EvidenceRecordDtoSchema.parse(await again.json())
      expect(reread.status).toBe(terminal.status)
      expect(reread.bytes).toBe(terminal.bytes)
      expect(reread.sha256).toBe(terminal.sha256)
      expect(reread.error).toBe(terminal.error)
    }),
    {
      numRuns: 8,
      requestOf: (counterexample) => {
        const [payloadBase64, name] = counterexample as [string, string]
        return {
          method: 'post',
          path: EVIDENCE_ROUTES.base,
          headers: {
            'content-type': EVIDENCE_CONTENT_TYPE,
            [ORIGINAL_NAME_HEADER]: encodeOriginalName(name),
          },
          bodyBase64: payloadBase64,
        }
      },
    },
  )
})