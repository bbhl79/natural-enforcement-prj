// report 决策引擎单测（#109；Spec-e2e §5 门禁实测 / §4 登记产物）。
//
// 接缝 = runCli 的 report 子命令（mkdtemp 临时树 + stdin 载荷，零基础设施）。
// **重放轮次结果是 mock 的**（宿主实测后注入）：门禁判定与登记落盘意图在此被
// 独立验证——任一轮不符/unknown/infrastructure → exit 8 且**零 op**（不登记）。
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../cli.js'
import { parseDefectJson, type DefectRecord } from '../defect/schema.js'
import type { OpSink } from '../ops.js'
import type { FailureSignature } from '../signature/model.js'

const temps: string[] = []
function tempTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'e2e-report-'))
  temps.push(root)
  return root
}
afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function capture(): { sink: OpSink; protocol: string[] } {
  const protocol: string[] = []
  return { sink: { protocol: (l) => protocol.push(l), human: () => {} }, protocol }
}

function run(root: string, args: string[], stdin: string): { code: number; protocol: string[]; ops: string[]; data: string[]; end: string } {
  const c = capture()
  const code = runCli(['--root', root, ...args], c.sink, () => stdin)
  const ops = c.protocol.filter((l) => /^[WDV]\t/.test(l))
  const data = c.protocol.filter((l) => !/^(W|D|V|END)\t/.test(l))
  const end = c.protocol.filter((l) => /^END\t/.test(l)).pop() ?? ''
  return { code, protocol: c.protocol, ops, data, end }
}

const SIG: FailureSignature = {
  errorClass: 'assertion',
  assertionId: 'post-enforcement-points.whitespace-name',
  semanticMarkers: [
    { key: 'http.status.actual', value: '201' },
    { key: 'http.status.expected', value: '201' },
  ],
}

const SCRIPT = '// 零第三方依赖复现脚本\nprocess.exit(0)\n'
const SCRIPT_SHA = createHash('sha256').update(SCRIPT, 'utf8').digest('hex')
const PRECONDITION = '每轮：空库（DROP FORCE + CREATE）+ migrate deploy + 空 bucket + 空队列键空间，无种子数据'

function finding(kind: 'pure' | 'external-state' = 'external-state'): Record<string, unknown> {
  return {
    schemaVersion: 1,
    source: 'manual',
    title: '点位名称纯空白被接受入库',
    summary: '契约 min(1) 只查长度，纯空白名过校验并入库（201）；原型 DEF-0002 同类 spec 债务',
    charter: 'point-input-safety',
    suspectedArea: 'packages/contracts/src/enforcement-point.ts',
    layer: 'api',
    severity: 'low',
    engine: 'agent-session',
    discoveredAt: '2026-11-28T12:00:00Z',
    discoveredBy: 'agent',
    reproducibility: { kind, precondition: PRECONDITION, replayScript: SCRIPT },
    evidence: [],
    sanitized: true,
  }
}

function mockRound(attempt: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attempt,
    runId: `rep109-c1eed7bc-1700000000-a${attempt}`,
    keySpace: {
      database: `e2e_rep109_a${attempt}`,
      bucket: `e2e-rep109-a${attempt}`,
      queue: `e2e-rep109-a${attempt}-evidence-processing`,
    },
    precondition: PRECONDITION,
    scriptExitCode: 0,
    signature: SIG,
    ...over,
  }
}

function registerPayload(rounds: Record<string, unknown>[], kind: 'pure' | 'external-state' = 'external-state'): string {
  return JSON.stringify({
    id: 'DEF-0001',
    finding: finding(kind),
    gate: { rounds, measuredAt: '2026-11-28T12:05:00Z', scriptSha256: SCRIPT_SHA },
    remoteMax: 0,
  })
}

function writtenJson(ops: string[], rel: string): string | null {
  const line = ops.find((l) => l.startsWith(`W\t${rel}\t`))
  if (!line) return null
  return Buffer.from(line.split('\t')[2] ?? '', 'base64').toString('utf8')
}

/** 经 #106 事实源解析口径取回记录（非法记录 → null，不静默放行） */
function writtenRecord(ops: string[], rel: string): DefectRecord | null {
  const text = writtenJson(ops, rel)
  if (text === null) return null
  const p = parseDefectJson(text)
  return p.ok ? p.record : null
}

describe('report-register：门禁不过 → exit 8 零登记', () => {
  it('任一轮签名不符（第 3 轮实际状态码变 400）→ exit 8，零 op', () => {
    const root = tempTree()
    const weakened: FailureSignature = {
      ...SIG,
      semanticMarkers: [
        { key: 'http.status.actual', value: '400' },
        { key: 'http.status.expected', value: '201' },
      ],
    }
    const r = run(root, ['report', 'register'], registerPayload([mockRound(1), mockRound(2), mockRound(3, { signature: weakened })]))
    expect(r.code).toBe(8)
    expect(r.ops).toEqual([])
    expect(r.end).toMatch(/^END\terror\t8\t/)
  })

  it('任一轮 errorClass=unknown → exit 8，零 op（保守档永不过门禁）', () => {
    const root = tempTree()
    const unknownSig: FailureSignature = { ...SIG, errorClass: 'unknown' }
    const r = run(root, ['report', 'register'], registerPayload([mockRound(1), mockRound(2, { signature: unknownSig }), mockRound(3)]))
    expect(r.code).toBe(8)
    expect(r.ops).toEqual([])
  })

  it('任一轮基础设施错误 → exit 8，零 op（不是缺陷复现）', () => {
    const root = tempTree()
    const infra: FailureSignature = { ...SIG, errorClass: 'infrastructure' }
    const r = run(root, ['report', 'register'], registerPayload([mockRound(1), mockRound(2), mockRound(3, { scriptExitCode: 2, signature: infra })]))
    expect(r.code).toBe(8)
    expect(r.ops).toEqual([])
  })

  it('external-state 只跑 2 轮（低于下限 3）→ exit 8，零 op', () => {
    const root = tempTree()
    const r = run(root, ['report', 'register'], registerPayload([mockRound(1), mockRound(2)]))
    expect(r.code).toBe(8)
    expect(r.ops).toEqual([])
  })

  it('某轮未复现（exit 1）→ exit 8，零 op', () => {
    const root = tempTree()
    const r = run(root, ['report', 'register'], registerPayload([mockRound(1), mockRound(2, { scriptExitCode: 1 }), mockRound(3)]))
    expect(r.code).toBe(8)
    expect(r.ops).toEqual([])
  })

  it('各轮共用同一键空间（库名相同）→ exit 8，零 op', () => {
    const root = tempTree()
    const same = { database: 'e2e_shared', bucket: 'e2e-shared', queue: 'e2e-shared-evidence-processing' }
    const r = run(root, ['report', 'register'], registerPayload([
      mockRound(1, { keySpace: same }),
      mockRound(2, { keySpace: same }),
      mockRound(3, { keySpace: same }),
    ]))
    expect(r.code).toBe(8)
    expect(r.ops).toEqual([])
  })

  it('实测脚本与登记脚本字节不符（sha256 不同）→ exit 8，零 op', () => {
    const root = tempTree()
    const payload = JSON.parse(registerPayload([mockRound(1), mockRound(2), mockRound(3)]))
    payload.gate.scriptSha256 = 'b'.repeat(64)
    const r = run(root, ['report', 'register'], JSON.stringify(payload))
    expect(r.code).toBe(8)
    expect(r.ops).toEqual([])
    expect(r.end).toMatch(/字节不符/)
  })
})

describe('report-register：过门禁 → 登记产物完整', () => {
  it('external-state 3 轮独立键空间全复现且签名一致 → 记录 + 脚本同一事务', () => {
    const root = tempTree()
    const r = run(root, ['report', 'register'], registerPayload([mockRound(1), mockRound(2), mockRound(3)]))
    expect(r.code).toBe(0)
    expect(r.ops.map((l) => l.split('\t')[1]).sort()).toEqual([
      '.registry.json',
      'defects/DEF-0001.json',
      'replay/DEF-0001.mjs',
    ])
    const rec = writtenRecord(r.ops, 'defects/DEF-0001.json')
    expect(rec?.status).toBe('reported')
    expect(rec?.reproducibility.gate.attempts).toBe(3)
    expect(rec?.reproducibility.gate.allFailed).toBe(true)
    expect(rec?.reproducibility.gate.signatureMatched).toBe(true)
    expect(rec?.reproducibility.gate.keySpaces).toHaveLength(3)
    expect(rec?.reproducibility.gate.precondition).toBe(PRECONDITION)
    expect(rec?.reproducibility.gate.rounds).toHaveLength(3)
    expect(rec?.reproducibility.gate.rounds?.[2]?.comparison?.matched).toBe(true)
    expect(rec?.reproducibility.replayCommand).toBe('node apps/e2e/replay/DEF-0001.mjs')
    expect(rec?.issue).toBeUndefined() // tracker 回链位留空（写入归 #114）
    const script = r.ops.find((l) => l.startsWith('W\treplay/DEF-0001.mjs\t')) ?? ''
    expect(Buffer.from(script.split('\t')[2] ?? '', 'base64').toString('utf8')).toBe(SCRIPT)
  })

  it('pure 路径 1 轮即过门禁（按被测路径分类，非按引擎）', () => {
    const root = tempTree()
    const r = run(root, ['report', 'register'], registerPayload([mockRound(1)], 'pure'))
    expect(r.code).toBe(0)
    const rec = writtenRecord(r.ops, 'defects/DEF-0001.json')
    expect(rec?.reproducibility.kind).toBe('pure')
    expect(rec?.reproducibility.gate.attempts).toBe(1)
    expect(rec?.reproducibility.gate.signatureMatched).toBeNull() // 单轮无从跨轮比对
  })

  it('登记记录经缺陷 schema 校验（zod 判别联合 + 门禁不变量）', () => {
    const root = tempTree()
    const r = run(root, ['report', 'register'], registerPayload([mockRound(1), mockRound(2), mockRound(3)]))
    // 独立事实源：入库字节必须能被 #106 的解析口径接受（不经测试助手）
    const text = writtenJson(r.ops, 'defects/DEF-0001.json')
    expect(text).not.toBeNull()
    const parsed = parseDefectJson(text ?? '')
    expect(parsed.ok).toBe(true)
  })
})