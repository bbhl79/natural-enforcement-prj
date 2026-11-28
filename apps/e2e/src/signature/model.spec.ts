// 失败签名模型（#108；Spec-e2e §7 / ADR 双轨 §5 / GLOSSARY「失败签名」）。
// 签名 = 错误类别 + 断言标识 + 关键语义标记；**不绑定完整消息文本**。
// 本单测零基础设施：只验模型的公开行为（规范化 / schema 校验），不碰容器。
import { describe, expect, it } from 'vitest'
import {
  FailureSignatureSchema,
  canonicalizeSignature,
  type FailureSignature,
} from './model.js'

/** 已知良好样本（独立事实源：DEF-0001 的真实毕业证据语义，见 #108 真跑取证） */
const def0001: FailureSignature = {
  errorClass: 'assertion',
  assertionId: 'tests/repro/def-0001.spec.ts#DEF-0001 创建点位接受 NUL 名称导致 500#a1',
  semanticMarkers: [
    { key: 'matcher', value: 'toBeLessThan' },
    { key: 'expected', value: '< 500' },
    { key: 'actual', value: '500' },
  ],
}

describe('失败签名模型（错误类别 + 断言标识 + 关键语义标记）', () => {
  it('语义标记是 key/value 结构（不是自由文本），三要素缺一即拒', () => {
    expect(FailureSignatureSchema.safeParse(def0001).success).toBe(true)
    for (const key of ['errorClass', 'assertionId', 'semanticMarkers']) {
      const partial = { ...def0001 } as Record<string, unknown>
      delete partial[key]
      expect(FailureSignatureSchema.safeParse(partial).success, `缺 ${key} 应被拒`).toBe(false)
    }
    // 标记必须是 {key,value}：裸字符串数组（旧形态）与缺 value 的标记都拒
    expect(FailureSignatureSchema.safeParse({ ...def0001, semanticMarkers: ['status<500'] }).success).toBe(false)
    expect(FailureSignatureSchema.safeParse({ ...def0001, semanticMarkers: [{ key: 'expected' }] }).success).toBe(false)
    expect(FailureSignatureSchema.safeParse({ ...def0001, semanticMarkers: [{ key: '', value: '500' }] }).success).toBe(false)
  })

  it('错误类别两档 + 普通断言失败 + 证据不足档（未知不得伪装成确定分类）', () => {
    for (const errorClass of ['assertion', 'infrastructure', 'locator', 'unknown']) {
      expect(FailureSignatureSchema.safeParse({ ...def0001, errorClass }).success, errorClass).toBe(true)
    }
    expect(FailureSignatureSchema.safeParse({ ...def0001, errorClass: 'timeout' }).success).toBe(false)
  })

  it('规范化：语义标记按 key 排序，书写顺序不影响签名身份', () => {
    const reordered: FailureSignature = {
      ...def0001,
      semanticMarkers: [
        { key: 'actual', value: '500' },
        { key: 'matcher', value: 'toBeLessThan' },
        { key: 'expected', value: '< 500' },
      ],
    }
    expect(canonicalizeSignature(reordered)).toEqual(canonicalizeSignature(def0001))
    expect(canonicalizeSignature(def0001).semanticMarkers.map((m) => m.key)).toEqual([
      'actual',
      'expected',
      'matcher',
    ])
  })

  it('规范化不改动语义：标记值原样保留（不做措辞归一，措辞本就不进签名）', () => {
    const c = canonicalizeSignature(def0001)
    expect(c.errorClass).toBe('assertion')
    expect(c.assertionId).toBe(def0001.assertionId)
    expect(c.semanticMarkers).toContainEqual({ key: 'expected', value: '< 500' })
  })
})