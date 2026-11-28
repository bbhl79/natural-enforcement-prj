// P0 业务规则属性（#107）：上传字节同源不变量（EV-BYTES-01，API 黑盒）。
// 被检验规则（#69 同源文件证据往返 / Spec-e2e §15 记录完整性类）：
//   任意非空合法字节上传 → 本 run worker 回写 ready → 同源下载字节逐位一致 ∧
//   sha256 一致 ∧ DTO/下载响应绝不携带内部存储地址（bucket/objectKey/presigned）。
// 对象键只由服务端 id 构成（文件名绝不进键）是 api 内部规则——经 HTTP 面间接检验：
//   strict DTO 解析拒绝任何内部字段泄漏；contentPath 恒为同源相对路径；
//   Content-Disposition 恒为 RFC6266/5987 固定前缀（名称已入口校验，无 CR/LF）。
// 展示名纯函数往返见 evidence-name-roundtrip.spec.ts（白盒合法面）。
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

const REF = {
  property: 'P0/EV-BYTES-01/upload-byte-provenance',
  rule: 'EV-BYTES-01',
  charter: 'evidence-byte-provenance',
} as const

test('EV-BYTES-01 上传字节同源：下载逐位一致 + sha256 一致 + 无内部地址泄漏', async ({ request }, testInfo) => {
  await runProperty(
    testInfo,
    REF,
    fc.asyncProperty(payloadBase64Arb(2048), safeDisplayNameArb, async (payloadBase64, name) => {
      const payload = Buffer.from(payloadBase64, 'base64')
      const uploaded = await request.post(`${API_BASE}${EVIDENCE_ROUTES.base}`, {
        headers: {
          'content-type': EVIDENCE_CONTENT_TYPE,
          [ORIGINAL_NAME_HEADER]: encodeOriginalName(name),
        },
        data: payload,
      })
      expect(uploaded.status()).toBe(201)
      const created = EvidenceRecordDtoSchema.parse(await uploaded.json())
      const terminal = await waitForEvidenceTerminal(request, created.id)
      expect(terminal.status, '健康栈上合法上传应处理到 ready').toBe('ready')
      expect(terminal.sha256).toBe(sha256Hex(payload))
      expect(terminal.bytes).toBe(payload.byteLength)

      // 同源下载：字节逐位一致（对象存储往返不改动证据本体）
      const content = await request.get(`${API_BASE}${terminal.contentPath}`)
      expect(content.status()).toBe(200)
      const downloaded = Buffer.from(await content.body())
      expect(downloaded.equals(payload), '下载字节必须与上传字节逐位一致').toBe(true)
      expect(sha256Hex(downloaded)).toBe(terminal.sha256)

      // 同源路径契约：相对路径，浏览器拿不到内部存储地址
      expect(terminal.contentPath).toMatch(/^\/evidence\/[^/]+\/content$/)
      // 内部地址泄漏扫描：剔除用户可控的 originalName 后，服务端生成字段不得含
      // presigned 标记/内部端点（对任意生成名称稳健，不受名称子串干扰）
      const serverFields = JSON.stringify({ ...terminal, originalName: '' })
      expect(serverFields).not.toContain('X-Amz-')
      expect(serverFields).not.toContain('rustfs')
      expect(serverFields).not.toContain('http://')
      // 下载头：RFC6266/5987 固定前缀 + 无 CR/LF（header 注入面）
      const disposition = content.headers()['content-disposition'] ?? ''
      expect(disposition.startsWith('attachment; filename="evidence.bin"; filename*=UTF-8\'\'')).toBe(true)
      expect(disposition.includes('\r') || disposition.includes('\n')).toBe(false)
      expect(content.headers()['content-type']).toContain(EVIDENCE_CONTENT_TYPE)
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