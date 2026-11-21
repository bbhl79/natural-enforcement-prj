// PROTOTYPE（#13）— 转写模板单测：机械转写/草稿转正/摘除标记的确定性（毕业事务的机械安全面）
import { describe, expect, it } from 'vitest'
import type { DefectRecord } from './defect/schema.js'
import {
  activateDraft,
  countFailLines,
  headerDefectId,
  PLACEHOLDER_ASSERT,
  stripFailLine,
  transcribeDraft,
  transcribeMechanical,
} from './transcribe.js'

const base: DefectRecord = {
  schemaVersion: 1,
  id: 'DEF-0001',
  title: '创建点位接受 NUL 名称导致 500',
  summary: '契约 z.string() 接受 NUL，PostgreSQL text 拒绝存储，未处理异常 500',
  status: 'reported',
  engine: 'fast-check',
  layer: 'api',
  discoveredAt: '2026-11-21T00:00:00.000Z',
  discoveredBy: 'agent-e2e',
  charter: '创建点位输入空间全量安全',
  suspectedArea: 'api/src/enforcement-point',
  severity: 'medium',
  reproducibility: {
    kind: 'deterministic',
    replayCommand: 'node apps/e2e/replay/DEF-0001.mjs',
    counterexample: {
      property: '契约内输入不应引发服务器错误',
      request: { method: 'POST', path: '/enforcement-points', body: { name: 'a\u0000b', lat: 0, lng: 0 } },
    },
    gate: { attempts: 1, keySpaces: ['r1'], allFailed: true },
  },
  evidence: [],
  sanitized: true,
}

describe('transcribeMechanical', () => {
  it('渲染反例请求 + expected-fail 行 + 文件头链接', () => {
    const spec = transcribeMechanical(base, true)
    expect(spec).toContain('// defect: DEF-0001')
    expect(countFailLines(spec)).toBe(1)
    expect(spec).toContain(`data: ${JSON.stringify({ name: 'a\u0000b', lat: 0, lng: 0 })}`)
    expect(spec).toContain('.toBeLessThan(500)')
    expect(headerDefectId(spec)).toBe('DEF-0001')
  })

  it('无 fail 行变体供毕业校验运行（未修必须失败）', () => {
    const spec = transcribeMechanical(base, false)
    expect(countFailLines(spec)).toBe(0)
  })

  it('缺 counterexample 的机械引擎报错', () => {
    const d: DefectRecord = { ...base, reproducibility: { ...base.reproducibility, counterexample: undefined } }
    expect(() => transcribeMechanical(d, true)).toThrow(/counterexample/)
  })
})

describe('草稿转正', () => {
  it('占位断言未替换 → 拒绝', () => {
    const draft = transcribeDraft(base)
    expect(activateDraft(draft, true)).toMatchObject({ ok: false })
    expect(draft).toContain(PLACEHOLDER_ASSERT)
  })

  it('补完后启用 fail 行；countFailLines=1', () => {
    const draft = transcribeDraft(base).replace(PLACEHOLDER_ASSERT, "expect(1).toBe(1)")
    const act = activateDraft(draft, true)
    expect(act.ok).toBe(true)
    if (act.ok) expect(countFailLines(act.content)).toBe(1)
  })
})

describe('stripFailLine（confirm-fix）', () => {
  it('摘除唯一 fail 行后 countFailLines=0，再摘报错', () => {
    const spec = transcribeMechanical(base, true)
    const stripped = stripFailLine(spec)
    expect(stripped.ok).toBe(true)
    if (stripped.ok) {
      expect(countFailLines(stripped.content)).toBe(0)
      expect(stripFailLine(stripped.content).ok).toBe(false)
    }
  })
})
