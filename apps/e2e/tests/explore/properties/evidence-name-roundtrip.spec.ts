// P0 业务规则属性（#107）：证据展示名编码/解码往返与拒绝稳定性（EV-NAME）。
// 白盒合法性（Spec-e2e §1）：被测对象是共享契约包导出的纯函数
// （packages/contracts evidence.ts validateOriginalName/encodeOriginalName/decodeOriginalName），
// 不触及 apps/api 内部。上传字节同源不变量的 API 面见 evidence-byte-provenance.spec.ts。
// 被检验规则（#69 契约落点）：
//   EV-NAME-01 合法展示名 unicode 无损往返：decode(encode(name)) = name；
//              encode 输出 ∈ 非空可见 ASCII（header 线上值域）。
//   EV-NAME-02 非法名拒绝且原因稳定：控制符/路径分隔符/纯空白/超长/恶意 wire 值
//              一律拒，reason 可映射稳定错误码（400/413 语义之源）。
import { expect, test } from '@playwright/test'
import fc from 'fast-check'
import {
  MAX_ORIGINAL_NAME_CODE_POINTS,
  MAX_ORIGINAL_NAME_WIRE_LENGTH,
  decodeOriginalName,
  encodeOriginalName,
  validateOriginalName,
  type OriginalNameDecodeFailureReason,
} from '@ne/contracts'
import { safeDisplayNameArb } from './arbitraries.js'
import { runProperty } from './harness.js'

const NUL = String.fromCharCode(0)
const ROUNDTRIP_REF = {
  property: 'P0/EV-NAME-01/original-name-encode-decode-roundtrip',
  rule: 'EV-NAME-01',
  charter: 'evidence-byte-provenance',
} as const
const REJECTION_REF = {
  property: 'P0/EV-NAME-02/original-name-rejection-stability',
  rule: 'EV-NAME-02',
  charter: 'evidence-byte-provenance',
} as const

test('EV-NAME-01 展示名 unicode 无损往返（encode→decode 恒等 + wire 可见 ASCII）', async (_fixtures, testInfo) => {
  await runProperty(
    testInfo,
    ROUNDTRIP_REF,
    fc.asyncProperty(safeDisplayNameArb, async (name) => {
      const validated = validateOriginalName(name)
      expect(validated.ok, `独立构造的合法域名称应被接受：${JSON.stringify(name)}`).toBe(true)
      const wire = encodeOriginalName(name)
      expect(wire).toMatch(/^[\x21-\x7e]+$/)
      expect(wire.length).toBeLessThanOrEqual(MAX_ORIGINAL_NAME_WIRE_LENGTH)
      expect(decodeOriginalName(wire)).toEqual({ ok: true, name })
    }),
    { numRuns: 200 },
  )
})

// 拒绝案例表（独立 oracle：输入 → 期望 reason，逐条对照契约实现语义）
const REJECTION_CASES: ReadonlyArray<{ name: string; reason: OriginalNameDecodeFailureReason }> = [
  { name: NUL, reason: 'forbidden_character' },
  { name: 'a' + NUL + 'b', reason: 'forbidden_character' },
  { name: String.fromCharCode(0x1f), reason: 'forbidden_character' },
  { name: String.fromCharCode(0x7f), reason: 'forbidden_character' },
  { name: String.fromCharCode(0x85), reason: 'forbidden_character' },
  { name: String.fromCharCode(0x2028), reason: 'forbidden_character' },
  { name: String.fromCharCode(0x2029), reason: 'forbidden_character' },
  { name: String.fromCharCode(0x202e), reason: 'forbidden_character' },
  { name: String.fromCharCode(0x2066), reason: 'forbidden_character' },
  { name: 'a/b', reason: 'path_separator' },
  { name: 'a\\b', reason: 'path_separator' },
  { name: '.', reason: 'invalid' },
  { name: '..', reason: 'invalid' },
  { name: '   ', reason: 'invalid' },
  { name: String.fromCharCode(0xa0), reason: 'invalid' },
  { name: '\t\n', reason: 'forbidden_character' },
]

test('EV-NAME-02 非法展示名拒绝稳定性（reason 稳定 + wire 边界先拒）', async (_fixtures, testInfo) => {
  await runProperty(
    testInfo,
    REJECTION_REF,
    fc.asyncProperty(
      fc.oneof(
        fc.constantFrom(...REJECTION_CASES),
        fc.integer({ min: MAX_ORIGINAL_NAME_CODE_POINTS + 1, max: 300 }).map((n) => ({
          name: '名'.repeat(n),
          reason: 'too_long' as const,
        })),
      ),
      async (c) => {
        const result = validateOriginalName(c.name)
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.reason).toBe(c.reason)
        // 编码入口同口径拒绝（encode 对非法名抛错，绝不产出 wire 值）
        expect(() => encodeOriginalName(c.name)).toThrow()
      },
    ),
    { numRuns: 100 },
  )

  // wire 层边界（decodeOriginalName 专属规则，示例式边界锚点）：
  // 超长 wire 先拒再解码（防无界分配）；非法百分号编码；缺失头。
  const overlongWire = 'x'.repeat(MAX_ORIGINAL_NAME_WIRE_LENGTH + 1)
  expect(decodeOriginalName(overlongWire)).toMatchObject({ ok: false, reason: 'too_long_wire' })
  expect(decodeOriginalName('%zz')).toMatchObject({ ok: false, reason: 'malformed_encoding' })
  expect(decodeOriginalName('')).toMatchObject({ ok: false, reason: 'missing' })
  expect(decodeOriginalName(null)).toMatchObject({ ok: false, reason: 'missing' })
  expect(decodeOriginalName(undefined)).toMatchObject({ ok: false, reason: 'missing' })
})