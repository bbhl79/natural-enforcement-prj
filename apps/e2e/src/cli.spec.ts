// 生命周期 CLI（#106）：纯决策引擎——只读装载宿主树，查询数据走 stdout，
// 写盘意图走 op 行协议，终值恒为 END 行。单测在 mkdtemp 临时树上跑，零基础设施。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from './cli.js'
import type { OpSink } from './ops.js'
import { REGISTRY_FILE } from './registry.js'

const temps: string[] = []
function tempTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'e2e-lifecycle-cli-'))
  temps.push(root)
  return root
}
afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function put(root: string, rel: string, content: string): void {
  const abs = join(root, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

function capture(): { sink: OpSink; protocol: string[]; humanLines: string[] } {
  const protocol: string[] = []
  const humanLines: string[] = []
  return {
    sink: { protocol: (l) => protocol.push(l), human: (l) => humanLines.push(l) },
    protocol,
    humanLines,
  }
}

function record(id: string, status = 'reported'): string {
  return JSON.stringify({
    schemaVersion: 1,
    id,
    title: `缺陷 ${id}`,
    summary: '摘要',
    status,
    engine: 'agent-session',
    layer: 'api',
    discoveredAt: '2026-11-28T00:00:00Z',
    discoveredBy: 'agent',
    charter: '创建点位输入空间全量安全',
    suspectedArea: 'packages/contracts',
    severity: 'low',
    reproducibility: {
      kind: 'pure',
      replayCommand: `node apps/e2e/replay/${id}.mjs`,
      gate: { attempts: 1, keySpaces: ['rep-1'], allFailed: true },
    },
    evidence: [{ type: 'log', uri: `.artifacts/e2e/exp-${id}/logs/api.log` }],
    sanitized: true,
  })
}

function run(root: string, args: string[]): { code: number; protocol: string[]; humanLines: string[]; data: string[] } {
  const c = capture()
  const code = runCli(['--root', root, ...args], c.sink)
  const data = c.protocol.filter((l) => !/^(W|D|V|END)\t/.test(l))
  return { code, protocol: c.protocol, humanLines: c.humanLines, data }
}

function endLine(protocol: string[]): string[] {
  const last = protocol[protocol.length - 1] ?? ''
  return last.split('\t')
}

describe('生命周期 CLI：查询命令', () => {
  it('defect list --json 输出记录数组（按 id 排序），终值 END ok 0', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0002.json', record('DEF-0002'))
    put(root, 'defects/DEF-0001.json', record('DEF-0001'))
    const r = run(root, ['defect', 'list', '--json'])
    expect(r.code).toBe(0)
    const arr = JSON.parse(r.data.join('\n')) as { id: string }[]
    expect(arr.map((d) => d.id)).toEqual(['DEF-0001', 'DEF-0002'])
    expect(endLine(r.protocol).slice(0, 3)).toEqual(['END', 'ok', '0'])
    // 查询命令零写意图
    expect(r.protocol.filter((l) => /^[WDV]\t/.test(l))).toEqual([])
  })

  it('defect list 人读模式输出摘要行（可管道），空树如实报无记录', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', record('DEF-0001'))
    const r = run(root, ['defect', 'list'])
    expect(r.code).toBe(0)
    expect(r.data.join('\n')).toContain('DEF-0001')
    expect(r.data.join('\n')).toContain('reported')
    const empty = run(tempTree(), ['defect', 'list'])
    expect(empty.code).toBe(0)
    expect(empty.data.join('\n')).toContain('无缺陷记录')
  })

  it('defect show --json 输出单条记录（含证据 URI）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', record('DEF-0001'))
    const r = run(root, ['defect', 'show', 'DEF-0001', '--json'])
    expect(r.code).toBe(0)
    const rec = JSON.parse(r.data.join('\n')) as { id: string; evidence: { uri: string }[] }
    expect(rec.id).toBe('DEF-0001')
    expect(rec.evidence[0]?.uri).toBe('.artifacts/e2e/exp-DEF-0001/logs/api.log')
  })

  it('defect show 人读模式给出状态/引擎/复现命令/证据路径', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', record('DEF-0001'))
    const r = run(root, ['defect', 'show', 'DEF-0001'])
    expect(r.code).toBe(0)
    const text = r.data.join('\n')
    expect(text).toContain('DEF-0001')
    expect(text).toContain('node apps/e2e/replay/DEF-0001.mjs')
    expect(text).toContain('.artifacts/e2e/exp-DEF-0001/logs/api.log')
  })

  it('未知 ID → exit 10 + END error（拒绝原因可被宿主透出）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', record('DEF-0001'))
    const r = run(root, ['defect', 'show', 'DEF-9999'])
    expect(r.code).toBe(10)
    const e = endLine(r.protocol)
    expect(e[0]).toBe('END')
    expect(e[1]).toBe('error')
    expect(e[2]).toBe('10')
    expect(e[3]).toContain('缺陷不存在：DEF-9999')
  })

  it('非法记录 → exit 10（show 命中坏记录 / list 遇任一坏记录）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', '{"schemaVersion":1,')
    const show = run(root, ['defect', 'show', 'DEF-0001'])
    expect(show.code).toBe(10)
    expect(endLine(show.protocol)[3]).toContain('defects/DEF-0001.json')
    expect(endLine(show.protocol)[3]).toContain('JSON 解析失败')
    const list = run(root, ['defect', 'list'])
    expect(list.code).toBe(10)
    // schema 不符（JSON 合法但字段缺失）同样 exit 10，且给出可定位字段
    const root3 = tempTree()
    put(root3, 'defects/DEF-0001.json', JSON.stringify({ schemaVersion: 1, id: 'DEF-0001', severity: 'blocker' }))
    const bad = run(root3, ['defect', 'show', 'DEF-0001'])
    expect(bad.code).toBe(10)
    expect(endLine(bad.protocol)[3]).toContain('schema 不符')
    // 其它记录损坏不阻断对完好记录的查询
    const root2 = tempTree()
    put(root2, 'defects/DEF-0001.json', record('DEF-0001'))
    put(root2, 'defects/DEF-0002.json', '{broken')
    expect(run(root2, ['defect', 'show', 'DEF-0001']).code).toBe(0)
  })

  it('ID 格式非法 → exit 10（DEF-NNNN 是唯一合法形态）', () => {
    const root = tempTree()
    expect(run(root, ['defect', 'show', 'DEF-1']).code).toBe(10)
  })
})

describe('生命周期 CLI：取号', () => {
  it('next-id 本地 max+1；--remote-max 叠读远端', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0002.json', record('DEF-0002'))
    const local = run(root, ['next-id', '--json'])
    expect(local.code).toBe(0)
    expect(JSON.parse(local.data.join('\n'))).toEqual({ id: 'DEF-0003', localMax: 2, remoteMax: 0 })
    const remote = run(root, ['next-id', '--remote-max', '7', '--json'])
    expect(JSON.parse(remote.data.join('\n')).id).toBe('DEF-0008')
    const human = run(root, ['next-id'])
    expect(human.data.join('\n').trim()).toBe('DEF-0003')
  })

  it('next-id 非法 --remote-max → exit 2（用法错误）', () => {
    const root = tempTree()
    expect(run(root, ['next-id', '--remote-max', 'abc']).code).toBe(2)
    expect(run(root, ['next-id', '--remote-max']).code).toBe(2)
  })
})

describe('生命周期 CLI：注册表重建（写意图经 op 协议）', () => {
  it('registry rebuild 发射 W .registry.json + END ok，内容派生自事实源', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', record('DEF-0001'))
    const r = run(root, ['registry', 'rebuild'])
    expect(r.code).toBe(0)
    const w = r.protocol.filter((l) => l.startsWith('W\t'))
    expect(w).toHaveLength(1)
    const fields = (w[0] ?? '').split('\t')
    expect(fields[1]).toBe(REGISTRY_FILE)
    const content = Buffer.from(fields[2] ?? '', 'base64').toString('utf8')
    expect(JSON.parse(content).defects[0].id).toBe('DEF-0001')
    expect(endLine(r.protocol).slice(0, 3)).toEqual(['END', 'ok', '0'])
    // CLI 自身不落盘（写盘由宿主原子应用）
    expect(run(root, ['defect', 'list']).code).toBe(0)
  })

  it('缓存漂移仍重建（始终重建），漂移只作人类 WARN，不改退出码', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', record('DEF-0001'))
    put(root, REGISTRY_FILE, '{"defects":[]}')
    const r = run(root, ['registry', 'rebuild'])
    expect(r.code).toBe(0)
    expect(r.protocol.filter((l) => l.startsWith('W\t'))).toHaveLength(1)
    expect(r.humanLines.join('\n')).toContain('漂移')
    expect(r.humanLines.join('\n')).toContain('完整性')
  })

  it('事实源损坏 → END error 10 且零写意图（不派生半成品缓存）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', '{broken')
    const r = run(root, ['registry', 'rebuild'])
    expect(r.code).toBe(10)
    expect(r.protocol.filter((l) => /^[WDV]\t/.test(l))).toEqual([])
    expect(endLine(r.protocol).slice(0, 3)).toEqual(['END', 'error', '10'])
  })
})

describe('生命周期 CLI：用法与协议不变量', () => {
  it('未知子命令 / 缺动作 / 缺 ID → exit 2 + 用法走人类通道', () => {
    const root = tempTree()
    for (const args of [['graduate', 'DEF-0001'], ['defect'], ['defect', 'show'], ['defect', 'bogus'], ['registry'], []]) {
      const r = run(root, args)
      expect(r.code, `args=${args.join(' ')}`).toBe(2)
      expect(endLine(r.protocol).slice(0, 3)).toEqual(['END', 'error', '2'])
      expect(r.humanLines.join('\n')).toContain('用法')
    }
  })

  it('每次调用恰一行 END 且为最后一行（宿主按行解析的终值不变量）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', record('DEF-0001'))
    for (const args of [['defect', 'list'], ['defect', 'show', 'DEF-0001'], ['next-id'], ['registry', 'rebuild'], ['defect', 'show', 'DEF-9999']]) {
      const r = run(root, args)
      const ends = r.protocol.filter((l) => l.startsWith('END\t'))
      expect(ends, `args=${args.join(' ')}`).toHaveLength(1)
      expect(r.protocol[r.protocol.length - 1]).toBe(ends[0])
    }
  })

  it('--json 旗标位置无关（全局旗标）', () => {
    const root = tempTree()
    put(root, 'defects/DEF-0001.json', record('DEF-0001'))
    const a = run(root, ['--json', 'defect', 'list'])
    const b = run(root, ['defect', 'list', '--json'])
    expect(a.code).toBe(0)
    expect(b.code).toBe(0)
    expect(a.data).toEqual(b.data)
  })
})