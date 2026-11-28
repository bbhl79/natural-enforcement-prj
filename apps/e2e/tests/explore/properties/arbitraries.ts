// P0 属性输入域（#107）：独立构造的生成器（不以被测函数自身过滤定义域），
// 收缩保持在域内；反例一律 JSON 可序列化（字节走 base64、名称走码点字符串），
// 保证 results.json 附件 body 无损、report 可机械重放。
import fc from 'fast-check'

/**
 * 合法证据展示名域（EV-NAME/EV-STATE/EV-BYTES 共用）：
 * 可见 ASCII（显式排除路径分隔符 / 与 \）+ CJK + emoji + 偶发空格；
 * 至少一个非空白字符、非 "."/".."；≤80 码点（上限边界另由拒绝属性覆盖）。
 * 与 validateOriginalName 的判定逻辑相互独立——往返属性才有判别力。
 */
export const safeDisplayNameArb = fc
  .array(
    fc.oneof(
      fc.integer({ min: 0x21, max: 0x7e }).filter((cp) => cp !== 0x2f && cp !== 0x5c),
      fc.integer({ min: 0x4e00, max: 0x9fff }),
      fc.constantFrom(0x1f600, 0x1f4cd, 0x1f3d9, 0x2705),
      fc.constant(0x20),
    ),
    { minLength: 1, maxLength: 80 },
  )
  .map((codePoints) => String.fromCodePoint(...codePoints))
  .filter((name) => name.trim().length > 0 && name !== '.' && name !== '..')

/** 任意非空字节载荷（base64 表示）：上传字节同源不变量的输入域 */
export function payloadBase64Arb(maxBytes: number) {
  return fc
    .uint8Array({ minLength: 1, maxLength: maxBytes })
    .map((bytes) => Buffer.from(bytes).toString('base64'))
}

/** 纯空白点名域（GAP 探针专用：编码「名称非空白」缺席规则，DEF-0002 同类） */
const WHITESPACE_CODE_POINTS = [0x20, 0x09, 0x0a, 0xa0, 0x3000, 0x2000, 0x200a] as const
export const whitespaceNameArb = fc
  .array(fc.constantFrom(...WHITESPACE_CODE_POINTS), { minLength: 1, maxLength: 8 })
  .map((codePoints) => String.fromCharCode(...codePoints))