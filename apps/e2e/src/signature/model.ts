// 失败签名模型（#108；Spec-e2e §7 / ADR 双轨 §5 / GLOSSARY「失败签名」）。
//
// 签名内容 = **错误类别 + 断言标识 + 关键语义标记**，不绑定完整消息文本：
//   - 合法重构改错误消息措辞 → 三要素都不变 → 仍判同一失败（不红）；
//   - 断言弱化（如预期状态码 500 变 400）→ 语义标记不符 → 红。
//
// 错误类别（Spec-e2e §7「只把有证据支持的分类当确定事实」）：
//   infrastructure  基础设施错误（连接失败/超时/服务不健康）→ 判定引擎直接红；
//   locator         测试定位失败（找不到元素）→ 红 + 标明「需人判断 UI 改版还是缺陷」；
//   assertion       普通断言失败（expect 结构可解析，语义标记来自 matcher/expected/actual）；
//   unknown         证据不足以分类（如测试自身 throw 的自由文本错误）——**不得伪装成
//                   确定分类**；判定引擎不得据此判绿（保守档，#112 消费）。
//
// 语义标记是 {key,value} 结构（不是自由文本）：key 是语义维度（如 expected/actual/
// matcher/http.status.expected/error.code），value 是该维度的规范化取值。比对按
// key→value 集合相等，与书写顺序无关（canonicalizeSignature 排序）。
//
// 本模块是**纯函数库**：零基础设施、零副作用，#109 门禁多轮重放与 #112 CI 预期失败
// 判定共用同一份实现（本地与 CI 同一判定器）。
import { z } from 'zod'

/** 错误类别两档 + 普通断言失败 + 证据不足档 */
export const FailureErrorClassSchema = z.enum(['assertion', 'infrastructure', 'locator', 'unknown'])
export type FailureErrorClass = z.infer<typeof FailureErrorClassSchema>

/** 关键语义标记：一个语义维度及其规范化取值（二者皆非空字符串） */
export const SemanticMarkerSchema = z.strictObject({
  key: z.string().min(1),
  value: z.string().min(1),
})
export type SemanticMarker = z.infer<typeof SemanticMarkerSchema>

/** 失败签名三要素（缺陷记录 graduation.failureSignature 与本库提取结果同一形态） */
export const FailureSignatureSchema = z.strictObject({
  errorClass: FailureErrorClassSchema,
  assertionId: z.string().min(1), // 哪条断言 / 哪个测试步骤（结构标识，不含消息措辞）
  semanticMarkers: z.array(SemanticMarkerSchema),
})
export type FailureSignature = z.infer<typeof FailureSignatureSchema>

/**
 * 规范化：语义标记按 key（同 key 再按 value）升序排序，三要素去首尾空白。
 * 规范化只改**书写形态**不改语义——比对与落盘都用规范化形态，保证 JSON 形状稳定。
 */
export function canonicalizeSignature(sig: FailureSignature): FailureSignature {
  const markers = sig.semanticMarkers
    .map((m) => ({ key: m.key.trim(), value: m.value.trim() }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
  return {
    errorClass: sig.errorClass,
    assertionId: sig.assertionId.trim(),
    semanticMarkers: markers,
  }
}