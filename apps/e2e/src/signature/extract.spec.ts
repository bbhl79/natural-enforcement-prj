// replay 脚本失败输出约定的提取器（#108；Spec-e2e §4 replayCommand / §7 签名来源）。
// 约定：脚本在 stdout 打一行 `NE-E2E-SIGNATURE <compact JSON>`，JSON 携带断言标识 +
// 错误类别 + 关键语义标记（+ 可选 outcome 自述）。零第三方依赖脚本据此让签名可机械提取。
// 本单测零基础设施：构造样本，不跑容器、不起栈。
import { describe, expect, it } from 'vitest'
import { REPLAY_SIGNATURE_SENTINEL, extractReplaySignature } from './extract.js'

/** 构造样本：DEF-0002 类（纯空白名被接受）复现时的约定输出 */
const reproducedLine = `${REPLAY_SIGNATURE_SENTINEL} {"schemaVersion":1,"assertionId":"post-enforcement-points.whitespace-name","errorClass":"assertion","outcome":"reproduced","semanticMarkers":[{"key":"http.status.expected","value":"201"},{"key":"http.status.actual","value":"201"},{"key":"body.id","value":"number"}]}`

describe('replay 脚本失败输出约定 → 失败签名提取', () => {
  it('约定标记行提取为规范化签名（三要素 + outcome 自述）', () => {
    const r = extractReplaySignature(`创建点位响应 201\n${reproducedLine}\n`)
    expect(r.found).toBe(true)
    expect(r.outcome).toBe('reproduced')
    expect(r.signature).toEqual({
      errorClass: 'assertion',
      assertionId: 'post-enforcement-points.whitespace-name',
      semanticMarkers: [
        { key: 'body.id', value: 'number' },
        { key: 'http.status.actual', value: '201' },
        { key: 'http.status.expected', value: '201' },
      ],
    })
  })

  it('脚本其它输出是噪声：只认约定前缀行；多条标记取最后一条（终态）', () => {
    const noise = '正在请求 http://api:3000/enforcement-points\n{"assertionId":"伪标记（无前缀）"}\n'
    const early = `${REPLAY_SIGNATURE_SENTINEL} {"schemaVersion":1,"assertionId":"early","errorClass":"assertion","semanticMarkers":[]}`
    const r = extractReplaySignature(`${noise}${early}\n${reproducedLine}\n`)
    expect(r.found).toBe(true)
    expect(r.signature?.assertionId).toBe('post-enforcement-points.whitespace-name')
  })

  it('无约定标记 → 不编造签名（found=false，signature=null）', () => {
    const r = extractReplaySignature('脚本只打了普通日志\n')
    expect(r.found).toBe(false)
    expect(r.signature).toBeNull()
    expect(r.outcome).toBe('unknown')
  })

  it('标记 JSON 非法或 schema 不符 → 如实报错，不静默判成功', () => {
    for (const bad of [
      `${REPLAY_SIGNATURE_SENTINEL} {不是 JSON`,
      `${REPLAY_SIGNATURE_SENTINEL} {"schemaVersion":1,"assertionId":"x"}`, // 缺 errorClass/markers
      `${REPLAY_SIGNATURE_SENTINEL} {"schemaVersion":1,"assertionId":"x","errorClass":"timeout","semanticMarkers":[]}`,
      `${REPLAY_SIGNATURE_SENTINEL} {"schemaVersion":1,"assertionId":"","errorClass":"assertion","semanticMarkers":[]}`,
    ]) {
      const r = extractReplaySignature(`${bad}\n`)
      expect(r.found, bad).toBe(false)
      expect(r.signature, bad).toBeNull()
      expect(typeof r.error, bad).toBe('string')
    }
  })

  it('基础设施档标记（连接失败）提取为 infrastructure 类别 + error.code 语义标记', () => {
    const line = `${REPLAY_SIGNATURE_SENTINEL} {"schemaVersion":1,"assertionId":"post-enforcement-points.whitespace-name","errorClass":"infrastructure","outcome":"unknown","semanticMarkers":[{"key":"error.code","value":"ECONNREFUSED"}]}`
    const r = extractReplaySignature(`${line}\n`)
    expect(r.found).toBe(true)
    expect(r.signature?.errorClass).toBe('infrastructure')
    expect(r.signature?.semanticMarkers).toEqual([{ key: 'error.code', value: 'ECONNREFUSED' }])
  })

  it('outcome 缺省时如实报 unknown（退出码才是判定权威，标记自述只作证据）', () => {
    const line = `${REPLAY_SIGNATURE_SENTINEL} {"schemaVersion":1,"assertionId":"a","errorClass":"assertion","semanticMarkers":[]}`
    expect(extractReplaySignature(`${line}\n`).outcome).toBe('unknown')
  })
})