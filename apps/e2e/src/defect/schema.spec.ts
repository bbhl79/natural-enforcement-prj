// 缺陷报告 schema（#106；Spec-e2e §4 全字段 + ADR §5 失败签名 / §4 确认记录）。
// 每缺陷一个入库 JSON 记录是生命周期唯一事实源；schema 归 e2e 包（不入共享契约包）。
import { describe, expect, it } from 'vitest'
import {
  DEFECT_SCHEMA_VERSION,
  DefectRecordSchema,
  MECHANICAL_ENGINES,
  minGateAttempts,
  parseDefectJson,
} from './schema.js'

/** 合法 reported 记录（机械引擎 fast-check）：各测试按覆盖点改写 */
function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: DEFECT_SCHEMA_VERSION,
    id: 'DEF-0001',
    title: '点位名称接受 NUL',
    summary: '契约内输入（含内嵌 NUL）引发 500：输入校验缺口',
    status: 'reported',
    engine: 'fast-check',
    layer: 'api',
    discoveredAt: '2026-11-28T02:00:00Z',
    discoveredBy: 'agent-charter',
    charter: '创建点位输入空间全量安全',
    suspectedArea: 'packages/contracts/src/enforcement-point.ts',
    severity: 'medium',
    reproducibility: {
      kind: 'external-state',
      seed: '12345',
      path: 'name',
      replayPath: 'apps/e2e/replay/DEF-0001.mjs',
      curl: "curl -X POST http://api:3000/enforcement-points -d '{\"name\":\"a\\u0000b\"}'",
      replayCommand: 'node apps/e2e/replay/DEF-0001.mjs',
      counterexample: {
        property: '契约内输入不应引发服务器错误',
        request: { method: 'POST', path: '/enforcement-points', body: { name: 'a\u0000b', lat: 0, lng: 0 } },
      },
      gate: { attempts: 3, keySpaces: ['rep-a', 'rep-b', 'rep-c'], allFailed: true },
    },
    evidence: [{ type: 'json-report', uri: '.artifacts/e2e/exp-1/results.json' }],
    issue: 106,
    sanitized: true,
    ...overrides,
  }
}

const graduation = {
  at: '2026-11-28T03:00:00Z',
  by: 'human-commander',
  specPath: 'tests/repro/def-0001.spec.ts',
  mode: 'expected-fail',
  verifiedRun: { expect: 'fail', outcome: 'fail', at: '2026-11-28T02:59:00Z', runId: 'ver-1' },
  failureSignature: {
    errorClass: 'assertion',
    assertionId: '契约内输入不应引发服务器错误',
    semanticMarkers: ['status<500'],
  },
  confirmation: {
    at: '2026-11-28T03:00:00Z',
    by: 'human-commander',
    evidenceSnapshot: '.artifacts/e2e/ver-1/results.json',
    token: {
      verifyRunId: 'ver-1',
      evidenceHash: 'sha256:aa',
      sourceTreeHash: 'bb',
      appImageDigest: 'sha256:cc',
      executorImageDigest: 'sha256:dd',
      migrationVersion: '20261128000000',
    },
  },
}

describe('缺陷报告 schema（Spec-e2e §4 全字段）', () => {
  it('合法 reported 记录解析成功，全字段保真', () => {
    const r = DefectRecordSchema.safeParse(record())
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.id).toBe('DEF-0001')
      expect(r.data.reproducibility.replayCommand).toBe('node apps/e2e/replay/DEF-0001.mjs')
      expect(r.data.evidence[0]?.uri).toBe('.artifacts/e2e/exp-1/results.json')
      expect(r.data.sanitized).toBe(true)
    }
  })

  it('§4 必填字段缺一即拒（逐字段删除）', () => {
    const required = [
      'schemaVersion', 'id', 'title', 'summary', 'status', 'engine', 'layer',
      'discoveredAt', 'discoveredBy', 'charter', 'suspectedArea', 'severity',
      'reproducibility', 'evidence', 'sanitized',
    ]
    for (const field of required) {
      const partial = record()
      delete partial[field]
      const r = DefectRecordSchema.safeParse(partial)
      expect(r.success, `缺 ${field} 应被拒`).toBe(false)
    }
    const reproRequired = ['kind', 'replayCommand', 'gate']
    for (const field of reproRequired) {
      const partial = record()
      const repro = { ...(partial.reproducibility as Record<string, unknown>) }
      delete repro[field]
      partial.reproducibility = repro
      expect(DefectRecordSchema.safeParse(partial).success, `缺 reproducibility.${field} 应被拒`).toBe(false)
    }
  })

  it('按引擎判别联合：机械引擎（fast-check/schemathesis）counterexample 必填', () => {
    expect([...MECHANICAL_ENGINES].sort()).toEqual(['fast-check', 'schemathesis'])
    for (const engine of ['fast-check', 'schemathesis']) {
      const repro = { ...(record().reproducibility as Record<string, unknown>) }
      delete repro.counterexample
      const r = DefectRecordSchema.safeParse(record({ engine, reproducibility: repro }))
      expect(r.success, `${engine} 缺 counterexample 应被拒`).toBe(false)
    }
    // 非机械引擎（草稿区路径）无 counterexample 也合法
    for (const engine of ['visual', 'model-journey', 'monkey', 'agent-session']) {
      const repro = { ...(record().reproducibility as Record<string, unknown>) }
      delete repro.counterexample
      const r = DefectRecordSchema.safeParse(record({ engine, reproducibility: repro }))
      expect(r.success, `${engine} 无 counterexample 应合法`).toBe(true)
    }
  })

  it('未知引擎 / 未知状态 / 未知层 / 未知严重度被拒', () => {
    expect(DefectRecordSchema.safeParse(record({ engine: 'graphwalker' })).success).toBe(false)
    expect(DefectRecordSchema.safeParse(record({ status: 'quarantined' })).success).toBe(false)
    expect(DefectRecordSchema.safeParse(record({ layer: 'db' })).success).toBe(false)
    expect(DefectRecordSchema.safeParse(record({ severity: 'blocker' })).success).toBe(false)
  })

  it('ID 为 DEF-NNNN；schemaVersion 锁 1', () => {
    for (const id of ['DEF-1', 'DEF-00001', 'def-0001', 'DEF-000A', '']) {
      expect(DefectRecordSchema.safeParse(record({ id })).success, `id=${id} 应被拒`).toBe(false)
    }
    expect(DefectRecordSchema.safeParse(record({ schemaVersion: 2 })).success).toBe(false)
  })

  it('reproducibility.kind 按被测路径分类（ADR §3）：pure 1 次 / external-state ≥3 次', () => {
    expect(minGateAttempts('pure')).toBe(1)
    expect(minGateAttempts('external-state')).toBe(3)
    expect(DefectRecordSchema.safeParse(record({
      reproducibility: { ...(record().reproducibility as Record<string, unknown>), kind: 'deterministic' },
    })).success).toBe(false)
  })

  it('evidence 只存 URI：内嵌证据内容被拒（不入库）', () => {
    const withContent = {
      type: 'log',
      uri: '.artifacts/e2e/exp-1/logs/api.log',
      content: 'POST /enforcement-points 500',
    }
    expect(DefectRecordSchema.safeParse(record({ evidence: [withContent] })).success).toBe(false)
    expect(DefectRecordSchema.safeParse(record({ evidence: [{ type: 'log' }] })).success).toBe(false)
    expect(DefectRecordSchema.safeParse(record({ evidence: [{ type: 'bogus', uri: 'x' }] })).success).toBe(false)
    expect(DefectRecordSchema.safeParse(record({ evidence: [] })).success).toBe(true)
  })

  it('graduation 含失败签名与确认记录（令牌六元组缺一即拒）', () => {
    const graduated = record({ status: 'graduated', graduation })
    const r = DefectRecordSchema.safeParse(graduated)
    expect(r.success).toBe(true)
    if (r.success && r.data.graduation) {
      expect(r.data.graduation.failureSignature?.assertionId).toBe('契约内输入不应引发服务器错误')
      expect(r.data.graduation.confirmation?.token.executorImageDigest).toBe('sha256:dd')
    }
    for (const key of ['verifyRunId', 'evidenceHash', 'sourceTreeHash', 'appImageDigest', 'executorImageDigest', 'migrationVersion']) {
      const token = { ...graduation.confirmation.token } as Record<string, unknown>
      delete token[key]
      const bad = {
        ...graduation,
        confirmation: { ...graduation.confirmation, token },
      }
      expect(DefectRecordSchema.safeParse(record({ status: 'graduated', graduation: bad })).success,
        `令牌缺 ${key} 应被拒`).toBe(false)
    }
    // 失败签名三要素：错误类别 + 断言标识 + 关键语义标记
    for (const key of ['errorClass', 'assertionId', 'semanticMarkers']) {
      const sig = { ...graduation.failureSignature } as Record<string, unknown>
      delete sig[key]
      expect(DefectRecordSchema.safeParse(record({
        status: 'graduated', graduation: { ...graduation, failureSignature: sig },
      })).success, `签名缺 ${key} 应被拒`).toBe(false)
    }
    expect(DefectRecordSchema.safeParse(record({
      status: 'graduated',
      graduation: { ...graduation, failureSignature: { ...graduation.failureSignature, errorClass: 'timeout' } },
    })).success).toBe(false)
  })

  it('fixImmediate 毕业无失败签名也合法（生来绿）；确认记录留位两段式', () => {
    const rest: Record<string, unknown> = { ...graduation }
    delete rest.failureSignature
    delete rest.confirmation
    const r = DefectRecordSchema.safeParse(record({
      status: 'fixed',
      graduation: { ...rest, mode: 'fixImmediate', verifiedRun: { expect: 'pass', outcome: 'pass', at: '2026-11-28T03:00:00Z' } },
      fix: { at: '2026-11-28T03:00:00Z', by: 'agent', commit: 'abc1234' },
    }))
    expect(r.success).toBe(true)
  })

  it('retirement.reason 必填（退役是唯一合法出口，原因留档）', () => {
    const retirement = { at: '2026-11-28T04:00:00Z', by: 'human', reason: 'spec 债务：契约允许纯空白名' }
    expect(DefectRecordSchema.safeParse(record({ status: 'retired', retirement })).success).toBe(true)
    expect(DefectRecordSchema.safeParse(record({ status: 'retired', retirement: { ...retirement, reason: '' } })).success).toBe(false)
    const noReason = { ...retirement } as Record<string, unknown>
    delete noReason.reason
    expect(DefectRecordSchema.safeParse(record({ status: 'retired', retirement: noReason })).success).toBe(false)
  })

  it('gate 证据形态：attempts 非负整数 / keySpaces 字符串数组 / allFailed 布尔', () => {
    const repro = record().reproducibility as Record<string, unknown>
    for (const gate of [
      { attempts: -1, keySpaces: [], allFailed: true },
      { attempts: 1.5, keySpaces: [], allFailed: true },
      { attempts: 1, keySpaces: 'rep-a', allFailed: true },
      { attempts: 1, keySpaces: [], allFailed: 'yes' },
    ]) {
      expect(DefectRecordSchema.safeParse(record({ reproducibility: { ...repro, gate } })).success).toBe(false)
    }
    // 报告期占位（attempts=0）合法：门禁由 report 命令实测回填（#109）
    expect(DefectRecordSchema.safeParse(record({
      reproducibility: { ...repro, gate: { attempts: 0, keySpaces: [], allFailed: false } },
    })).success).toBe(true)
  })

  it('parseDefectJson：非法 JSON / schema 不符给出可定位错误，合法返回记录', () => {
    expect(parseDefectJson('{').ok).toBe(false)
    const bad = parseDefectJson(JSON.stringify(record({ severity: 'blocker' })))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('severity')
    const good = parseDefectJson(JSON.stringify(record()))
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.record.id).toBe('DEF-0001')
  })
})