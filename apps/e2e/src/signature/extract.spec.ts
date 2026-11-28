// replay 脚本失败输出约定的提取器（#108；Spec-e2e §4 replayCommand / §7 签名来源）。
// 约定：脚本在 stdout 打一行 `NE-E2E-SIGNATURE <compact JSON>`，JSON 携带断言标识 +
// 错误类别 + 关键语义标记（+ 可选 outcome 自述）。零第三方依赖脚本据此让签名可机械提取。
// 本单测零基础设施：构造样本，不跑容器、不起栈。
import { describe, expect, it } from 'vitest'
import {
  REPLAY_SIGNATURE_SENTINEL,
  extractPlaywrightSignatures,
  extractReplaySignature,
} from './extract.js'

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

// ---------------------------------------------------------------------------
// 来源二：Playwright 结果 JSON
// ---------------------------------------------------------------------------

// ANSI 转义用 fromCharCode 构造（避免源码里写裸控制字符）：真实 JSON reporter 的
// error.message 带颜色码，提取必须先剥码再解析结构。
const ESC = String.fromCharCode(27)
const dim = (s: string): string => `${ESC}[2m${s}${ESC}[22m`
const red = (s: string): string => `${ESC}[31m${s}${ESC}[39m`
const green = (s: string): string => `${ESC}[32m${s}${ESC}[39m`

/**
 * 真实证据样本形态（独立事实源：原型 DEF-0001 毕业校验运行 verify-results.json）：
 * `Error: <自定义消息>\n\nexpect(received).<matcher>(expected)\n\nExpected: <值>\nReceived: <值>`
 * 其中 expect/expected/received 与取值都被 ANSI 码包裹。
 */
function ansiExpectMessage(custom: string, matcher: string, expectedLine: string, actual: string): string {
  const nl = '\n'
  return (
    `Error: ${custom}${nl}${nl}` +
    dim('expect(') + red('received') + dim(').') + matcher + dim('(') + green('expected') + dim(')') +
    `${nl}${nl}Expected: ${expectedLine.startsWith('<') ? '< ' : ''}${green(expectedLine.replace(/^< /, ''))}` +
    `${nl}Received:   ${red(actual)}`
  )
}

interface PwEntry {
  file: string
  title: string
  messages: string[] // results[0].errors[] 的 message（按序）
  testStatus?: string
  expectedStatus?: string
  annotations?: { type: string; description?: string }[]
  retry?: number
  resultStatus?: string
  describes?: string[]
}

/** 构造最小 Playwright 结果 JSON（文件级 suite → specs / describe 子 suite → specs） */
function pwReport(entries: PwEntry[]): unknown {
  const byFile = new Map<string, PwEntry[]>()
  for (const e of entries) {
    const list = byFile.get(e.file) ?? []
    list.push(e)
    byFile.set(e.file, list)
  }
  const suites = [...byFile.entries()].map(([file, list]) => {
    const specs: unknown[] = []
    const childSuites: unknown[] = []
    for (const e of list) {
      const spec = {
        title: e.title,
        ok: false,
        tags: [],
        file: e.file,
        line: 6,
        column: 1,
        id: `${e.file}-${e.title}`,
        tests: [
          {
            timeout: 120000,
            annotations: e.annotations ?? [],
            expectedStatus: e.expectedStatus ?? 'passed',
            projectId: '',
            projectName: '',
            status: e.testStatus ?? 'unexpected',
            results: [
              {
                workerIndex: 0,
                status: e.resultStatus ?? 'failed',
                duration: 10,
                retry: e.retry ?? 0,
                startTime: '2026-11-28T00:00:00.000Z',
                stdout: [],
                stderr: [],
                attachments: [],
                error: { message: e.messages[0] ?? '', stack: e.messages[0] ?? '' },
                errors: e.messages.map((message) => ({ message, stack: message })),
              },
            ],
          },
        ],
      }
      const describes = e.describes ?? []
      if (describes.length === 0) {
        specs.push(spec)
        continue
      }
      // describe 嵌套：最内层 suite 持 specs，外层逐层包裹（真实 JSON 形态）
      let node: Record<string, unknown> = { title: describes[describes.length - 1], line: 1, column: 1, specs: [spec] }
      for (const d of describes.slice(0, -1).reverse()) {
        node = { title: d, line: 1, column: 1, suites: [node] }
      }
      childSuites.push(node)
    }
    return { title: file, file, line: 1, column: 1, specs, suites: childSuites }
  })
  return {
    config: { rootDir: '/workspace/apps/e2e' },
    suites,
    errors: [],
    stats: { startTime: '2026-11-28T00:00:00.000Z', duration: 10, expected: 0, skipped: 0, unexpected: entries.length, flaky: 0 },
  }
}

const REAL_CUSTOM = '契约内输入不应引发服务器错误'
const REAL_FILE = 'tests/repro/def-0001.spec.ts'
const REAL_TITLE = 'DEF-0001 创建点位接受 NUL 名称导致 500'

describe('Playwright 结果 JSON → 失败签名提取', () => {
  it('真实毕业证据样本：剥 ANSI、取 matcher/Expected/Received，自定义消息措辞不进签名', () => {
    const msg = ansiExpectMessage(REAL_CUSTOM, 'toBeLessThan', '< 500', '500')
    const r = extractPlaywrightSignatures(pwReport([{ file: REAL_FILE, title: REAL_TITLE, messages: [msg] }]))
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0]?.signature).toEqual({
      errorClass: 'assertion',
      assertionId: `${REAL_FILE}#${REAL_TITLE}#a1`,
      semanticMarkers: [
        { key: 'actual', value: '500' },
        { key: 'expected', value: '< 500' },
        { key: 'matcher', value: 'toBeLessThan' },
      ],
    })
    // 措辞是消息文本，绝不出现在签名任何字段里
    expect(JSON.stringify(r.failures[0]?.signature)).not.toContain(REAL_CUSTOM)
  })

  it('语义敏感性：只改错误消息措辞 → 签名逐字段相同（合法重构不红）', () => {
    const a = extractPlaywrightSignatures(pwReport([{ file: REAL_FILE, title: REAL_TITLE, messages: [ansiExpectMessage(REAL_CUSTOM, 'toBeLessThan', '< 500', '500')] }]))
    const b = extractPlaywrightSignatures(pwReport([{ file: REAL_FILE, title: REAL_TITLE, messages: [ansiExpectMessage('重构后的措辞：不得出现服务器错误', 'toBeLessThan', '< 500', '500')] }]))
    expect(b.failures[0]?.signature).toEqual(a.failures[0]?.signature)
  })

  it('语义敏感性：预期状态码 500 → 400（断言弱化）→ 语义标记不符', () => {
    const a = extractPlaywrightSignatures(pwReport([{ file: REAL_FILE, title: REAL_TITLE, messages: [ansiExpectMessage(REAL_CUSTOM, 'toBeLessThan', '< 500', '500')] }]))
    const b = extractPlaywrightSignatures(pwReport([{ file: REAL_FILE, title: REAL_TITLE, messages: [ansiExpectMessage(REAL_CUSTOM, 'toBeLessThan', '< 400', '400')] }]))
    expect(b.failures[0]?.signature).not.toEqual(a.failures[0]?.signature)
    expect(b.failures[0]?.signature.semanticMarkers).toContainEqual({ key: 'expected', value: '< 400' })
  })

  it('基础设施错误（连接被拒 / 导航超时）→ infrastructure 档 + error.code 语义标记', () => {
    const samples: [string, string][] = [
      ['Error: page.goto: net::ERR_CONNECTION_REFUSED at http://api:3000/health\nCall log:\n  - navigating to "http://api:3000/health", waiting until "load"', 'ERR_CONNECTION_REFUSED'],
      ['Error: connect ECONNREFUSED 127.0.0.1:3000', 'ECONNREFUSED'],
      ['Error: page.goto: Timeout 30000ms exceeded.\nCall log:\n  - navigating to "http://web:4173/", waiting until "load"', 'TIMEOUT'],
      ['Error: socket hang up', 'SOCKET_HANG_UP'],
    ]
    for (const [message, code] of samples) {
      const r = extractPlaywrightSignatures(pwReport([{ file: REAL_FILE, title: REAL_TITLE, messages: [message] }]))
      expect(r.failures[0]?.signature.errorClass, message).toBe('infrastructure')
      expect(r.failures[0]?.signature.semanticMarkers, message).toContainEqual({ key: 'error.code', value: code })
    }
  })

  it('测试定位失败（元素找不到 / strict mode 多命中）→ locator 档（不得一律归为环境问题）', () => {
    const samples = [
      "Error: locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: '创 建' })\n",
      "Error: strict mode violation: getByRole('button', { name: '创建' }) resolved to 2 elements:\n    1) <button>…</button>\n    2) <button>…</button>",
      'Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole(\'button\', { name: \'创建\' })\nExpected: visible\nTimeout: 5000ms\nError: element(s) not found',
    ]
    for (const message of samples) {
      const r = extractPlaywrightSignatures(pwReport([{ file: 'tests/repro/def-0002.spec.ts', title: 'DEF-0002 UI 旅程', messages: [message] }]))
      expect(r.failures[0]?.signature.errorClass, message).toBe('locator')
    }
  })

  it('自由文本 throw（无 expect 结构）→ unknown 档：证据不足以分类，不伪装成断言失败', () => {
    // 真实样本形态：原型 charter-create-input-space 的危险字典 throw
    const message = 'Error: 字典反例：name="\\u0000" 引发 5xx（契约 z.string() 接受该值 ⇒ 服务端未处理错误）'
    const r = extractPlaywrightSignatures(pwReport([{ file: 'tests/explore/charter-create-input-space.spec.ts', title: 'charter: 创建点位', messages: [message] }]))
    expect(r.failures[0]?.signature.errorClass).toBe('unknown')
    expect(r.failures[0]?.signature.semanticMarkers).toContainEqual({ key: 'error.name', value: 'Error' })
  })

  it('断言标识是结构身份：文件 + describe 路径 + 测试标题 + 断言序号（不含行号/措辞）', () => {
    const msg = ansiExpectMessage(REAL_CUSTOM, 'toBeLessThan', '< 500', '500')
    const r = extractPlaywrightSignatures(pwReport([{
      file: REAL_FILE, title: REAL_TITLE, messages: [msg, msg], describes: ['点位输入空间'],
    }]))
    expect(r.failures).toHaveLength(2)
    expect(r.failures[0]?.assertionId).toBe(`${REAL_FILE}#点位输入空间 > ${REAL_TITLE}#a1`)
    expect(r.failures[1]?.assertionId).toBe(`${REAL_FILE}#点位输入空间 > ${REAL_TITLE}#a2`)
  })

  it('expected-fail 注解用例仍提取签名，并如实带出 testStatus（判定权归 #112 判定引擎）', () => {
    const msg = ansiExpectMessage(REAL_CUSTOM, 'toBeLessThan', '< 500', '500')
    const r = extractPlaywrightSignatures(pwReport([{
      file: REAL_FILE, title: REAL_TITLE, messages: [msg],
      annotations: [{ type: 'fail', description: 'DEF-0001 未修复' }],
      expectedStatus: 'failed', testStatus: 'expected',
    }]))
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0]?.testStatus).toBe('expected')
    expect(r.failures[0]?.expectedStatus).toBe('failed')
    expect(r.failures[0]?.signature.errorClass).toBe('assertion')
  })

  it('通过/跳过的用例不产生失败签名；stats 如实带出', () => {
    const report = pwReport([{ file: REAL_FILE, title: REAL_TITLE, messages: [''] }]) as Record<string, unknown>
    const suites = report.suites as { specs: { tests: { status: string; expectedStatus: string; results: { status: string; errors: unknown[]; error?: unknown }[] }[] }[] }[]
    const test = suites[0]!.specs[0]!.tests[0]!
    test.status = 'expected'
    test.expectedStatus = 'passed'
    test.results[0]!.status = 'passed'
    test.results[0]!.errors = []
    delete test.results[0]!.error
    const r = extractPlaywrightSignatures(report)
    expect(r.failures).toEqual([])
    expect(r.stats?.unexpected).toBe(1) // stats 原样带出（判定引擎自行核对）
  })

  it('非法报告（非对象 / 缺 suites）如实报错，不编造失败列表', () => {
    for (const bad of [null, 42, 'x', {}, { suites: 'nope' }]) {
      const r = extractPlaywrightSignatures(bad)
      expect(r.failures).toEqual([])
      expect(typeof r.error).toBe('string')
    }
  })
})