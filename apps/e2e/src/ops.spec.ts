// 生命周期决策引擎 → devenv 的 op 行协议（#106；原型定型格式，见 docs/adr/）：
//   W\t<relpath>\t<base64(utf8)>   写文件（relpath 相对 apps/e2e）
//   D\t<relpath>                   删文件
//   V\t<id数字段>\t<expect>\t<b64>  校验运行载荷（expect=fail|pass）
//   END\t<status>\t<code>\t<message> 终值（每次调用恰一行，最后输出）
// 协议通道纯净可被 bash 逐行解析；人类可读摘要走独立通道（stderr）。
import { describe, expect, it } from 'vitest'
import { emit, end, human, type OpSink } from './ops.js'

function capture(): { sink: OpSink; protocol: string[]; humanLines: string[] } {
  const protocol: string[] = []
  const humanLines: string[] = []
  return {
    sink: {
      protocol: (line) => protocol.push(line),
      human: (line) => humanLines.push(line),
    },
    protocol,
    humanLines,
  }
}

describe('op 行协议', () => {
  it('W 行 = 写意图 + 路径 + base64 内容（三字段，tab 分隔，相对 apps/e2e）', () => {
    const c = capture()
    emit(c.sink, { op: 'W', path: 'defects/DEF-0001.json', content: '{"id":"DEF-0001"}\n' })
    expect(c.protocol).toEqual([
      `W\tdefects/DEF-0001.json\t${Buffer.from('{"id":"DEF-0001"}\n', 'utf8').toString('base64')}`,
    ])
    // 内容字节可无损还原（含中文/换行）
    const content = '{"title":"点位名称接受 NUL"}\n'
    const c2 = capture()
    emit(c2.sink, { op: 'W', path: 'defects/DEF-0002.json', content })
    const fields = (c2.protocol[0] ?? '').split('\t')
    expect(fields).toHaveLength(3)
    expect(Buffer.from(fields[2] ?? '', 'base64').toString('utf8')).toBe(content)
  })

  it('D 行 = 删意图 + 路径（两字段）', () => {
    const c = capture()
    emit(c.sink, { op: 'D', path: 'tests/repro/def-0001.spec.ts' })
    expect(c.protocol).toEqual(['D\ttests/repro/def-0001.spec.ts'])
  })

  it('V 行 = 校验载荷四字段（id 数字段 / expect / base64）', () => {
    const c = capture()
    emit(c.sink, { op: 'V', id: '0001', expect: 'fail', content: 'test("x", () => {})\n' })
    expect(c.protocol).toEqual([
      `V\t0001\tfail\t${Buffer.from('test("x", () => {})\n', 'utf8').toString('base64')}`,
    ])
    const c2 = capture()
    emit(c2.sink, { op: 'V', id: '0002', expect: 'pass', content: 'ok' })
    expect((c2.protocol[0] ?? '').split('\t').slice(0, 3)).toEqual(['V', '0002', 'pass'])
  })

  it('END 行 = 终值（status/code/message），end 返回该退出码', () => {
    const c = capture()
    expect(end(c.sink, 'ok', 0, '注册表已重建')).toBe(0)
    expect(c.protocol).toEqual(['END\tok\t0\t注册表已重建'])
    const c2 = capture()
    expect(end(c2.sink, 'error', 10, '缺陷不存在：DEF-9999')).toBe(10)
    expect(c2.protocol).toEqual(['END\terror\t10\t缺陷不存在：DEF-9999'])
  })

  it('END message 内的 tab/换行被压平——终值恒为单行（宿主按行解析不被截断）', () => {
    const c = capture()
    end(c.sink, 'error', 8, '第一行\n第二行\t带 tab')
    expect(c.protocol).toHaveLength(1)
    expect(c.protocol[0]).not.toContain('\n')
    expect((c.protocol[0] ?? '').split('\t')).toHaveLength(4)
  })

  it('人类摘要走独立通道，不污染协议通道', () => {
    const c = capture()
    human(c.sink, 'DEF-0001 — 点位名称接受 NUL')
    expect(c.protocol).toEqual([])
    expect(c.humanLines).toEqual(['DEF-0001 — 点位名称接受 NUL'])
  })

  it('路径含 tab/换行即拒绝（协议不可被路径注入截断）', () => {
    const c = capture()
    expect(() => emit(c.sink, { op: 'W', path: 'defects/a\tb.json', content: 'x' })).toThrow()
    expect(() => emit(c.sink, { op: 'D', path: 'defects/a\nb.json' })).toThrow()
    expect(c.protocol).toEqual([])
  })
})