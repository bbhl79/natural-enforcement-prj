// 失败签名提取器（#108；Spec-e2e §7 两个签名来源）：
//   1. replay 脚本失败输出约定（本文件 extractReplaySignature）；
//   2. Playwright 结果 JSON（extractPlaywrightSignatures）。
// 提取只取**结构化证据**（错误类别 / 断言标识 / 语义维度取值），不取完整消息文本——
// 合法重构改措辞不进签名，断言弱化（预期状态码变化）进签名。
// 纯函数、零基础设施：#109 门禁多轮重放与 #112 CI 判定共用同一份实现。
import { z } from 'zod'
import {
  FailureErrorClassSchema,
  SemanticMarkerSchema,
  canonicalizeSignature,
  type FailureSignature,
} from './model.js'

/**
 * replay 脚本失败输出约定的哨兵前缀：脚本在 stdout 打**一行**
 * `NE-E2E-SIGNATURE <compact JSON>`，JSON 形态见 ReplayMarkerSchema。
 * 约定要点（脚本随缺陷记录入库，是长期重建依据）：
 *   - 零第三方依赖（node 内建 fetch）；exit 0 = 复现、1 = 未复现、2 = 基础设施错误；
 *   - 无论复现与否都打标记：复现时标记承载缺陷的语义取值（供门禁逐轮比对），
 *     未复现时标记承载实际观测值（比对不符即语义反转「环境漂移或已修复？」）；
 *   - 标记只放语义维度（http.status.expected / http.status.actual / error.code …），
 *     **不放完整响应体或错误消息文本**。
 */
export const REPLAY_SIGNATURE_SENTINEL = 'NE-E2E-SIGNATURE'

/** 脚本自述结果（判定权威仍是退出码；此字段只作证据留痕） */
export type ReplayOutcome = 'reproduced' | 'not-reproduced' | 'unknown'

export interface ReplayExtraction {
  found: boolean
  signature: FailureSignature | null // 规范化形态；未找到/非法一律 null（不编造）
  outcome: ReplayOutcome
  error?: string // 标记在场但非法时的原因（供诊断，不静默判成功）
}

/** 约定标记的 JSON 形态（strictObject：未知字段一律拒绝，防拼写错误静默通过） */
export const ReplayMarkerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  assertionId: z.string().min(1),
  errorClass: FailureErrorClassSchema,
  outcome: z.enum(['reproduced', 'not-reproduced', 'unknown']).optional(),
  semanticMarkers: z.array(SemanticMarkerSchema),
})
export type ReplayMarker = z.infer<typeof ReplayMarkerSchema>

const SENTINEL_RE = new RegExp(`^${REPLAY_SIGNATURE_SENTINEL}\\s+(.+)$`)

/**
 * 从 replay 脚本输出提取签名。只认哨兵前缀行（其它输出是噪声）；多条标记取
 * **最后一条**（脚本终态）。无标记 → found=false；标记非法 → found=false + error。
 */
export function extractReplaySignature(output: string): ReplayExtraction {
  let payload: string | null = null
  for (const raw of output.split('\n')) {
    const m = SENTINEL_RE.exec(raw.replace(/\r$/, '').trim())
    if (m && m[1] !== undefined) payload = m[1]
  }
  if (payload === null) return { found: false, signature: null, outcome: 'unknown' }

  let raw: unknown
  try {
    raw = JSON.parse(payload)
  } catch (e) {
    return {
      found: false,
      signature: null,
      outcome: 'unknown',
      error: `约定标记 JSON 解析失败：${String(e instanceof Error ? e.message : e)}`,
    }
  }
  const parsed = ReplayMarkerSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      found: false,
      signature: null,
      outcome: 'unknown',
      error: `约定标记 schema 不符：${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
    }
  }
  const marker = parsed.data
  return {
    found: true,
    signature: canonicalizeSignature({
      errorClass: marker.errorClass,
      assertionId: marker.assertionId,
      semanticMarkers: marker.semanticMarkers,
    }),
    outcome: marker.outcome ?? 'unknown',
  }
}
// ---------------------------------------------------------------------------
// 来源二：Playwright 结果 JSON
// ---------------------------------------------------------------------------

/** 一条失败断言的提取结果（envelope 带用例状态，判定权归 #112 判定引擎） */
export interface PlaywrightFailure {
  file: string
  titlePath: string[] // describe 路径 + 测试标题（不含文件级 suite 标题）
  assertionId: string // 结构身份：file#titlePath#断言序号（不含行号、不含消息措辞）
  testStatus: string // unexpected | expected | flaky | skipped（Playwright 原样）
  expectedStatus: string // passed | failed | skipped（expected-fail 注解用例为 failed）
  retry: number
  signature: FailureSignature
}

export interface PlaywrightStats {
  expected: number
  unexpected: number
  flaky: number
  skipped: number
}

export interface PlaywrightExtraction {
  failures: PlaywrightFailure[]
  stats: PlaywrightStats | null
  error?: string
}

/** JSON reporter 的 error.message 带 ANSI 颜色码（真实证据实证）——解析前必须剥码 */
const ESC = String.fromCharCode(27)
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g')

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

/** 连接级故障码（基础设施档）：只认结构化的错误码/固定故障短语，不认 HTTP 状态响应
 *  （5xx 响应本身可能是被测缺陷，不是环境故障——不得据此判基础设施错误）。 */
const INFRA_CODE_RES: [RegExp, string][] = [
  [/net::(ERR_[A-Z_]+)/, '$1'],
  [/\b(ECONNREFUSED|ECONNRESET|ECONNABORTED|EHOSTUNREACH|ENOTFOUND|EPIPE|EAI_AGAIN|ETIMEDOUT|EPROTO|ERR_SOCKET_CONNECTION_TIMEOUT)\b/, '$1'],
  [/socket hang up/, 'SOCKET_HANG_UP'],
  [/fetch failed/, 'FETCH_FAILED'],
  [/Target page, context or browser has been closed|browser has been closed/, 'TARGET_CLOSED'],
]

/** 超时档（基础设施）：必须在**定位档之后**判——`locator.click: Timeout` 是元素
 *  找不到（定位失败），不是环境超时；只有页面级/测试级超时才归基础设施。 */
const INFRA_TIMEOUT_RE = /page\.goto: Timeout|Navigation timeout|Test timeout of \d+ms exceeded|Timeout \d+ms exceeded/

/** 定位失败证据（元素找不到/多命中）：UI 缺陷本身可能表现为元素缺失，不得一律归环境 */
const LOCATOR_RE = /\blocator\.[a-zA-Z]+:|strict mode violation:|waiting for (?:getBy|locator)|element\(s\) not found|resolved to \d+ elements/
const LOCATOR_EXPECT_RE = /expect\(locator\)\.\w+\(/
const LOCATOR_TARGET_RES: RegExp[] = [
  /waiting for (getBy\w+\([^\n]*\)|locator\([^\n]*\))/,
  /Locator:\s*([^\n]+)/,
  /strict mode violation:\s*([^\n]+?)\s+resolved to/,
]

/** expect 结构（普通断言失败档）：matcher 链 + Expected/Received 单行取值 */
const MATCHER_RE = /expect\([^)]*\)\.((?:\w+\.)*\w+)\(/
const EXPECTED_RE = /^Expected:[ \t]*(.+)$/m
const RECEIVED_RE = /^Received:[ \t]*(.+)$/m
const ERROR_NAME_RE = /^([A-Za-z_$][\w$]*):/

interface Classified {
  errorClass: FailureSignature['errorClass']
  markers: { key: string; value: string }[]
}

/**
 * 错误类别判定（Spec-e2e §7 两档 + 普通断言失败 + 证据不足档）。
 * 顺序即证据优先级：连接级故障码 → 定位失败 → 超时 → expect 结构 → unknown。
 * `locator.click: Timeout` 先命中定位档（元素找不到），不被通用超时吞成基础设施。
 */
export function classifyErrorMessage(rawMessage: string): Classified {
  const message = stripAnsi(rawMessage)
  const markers: { key: string; value: string }[] = []

  for (const [re, code] of INFRA_CODE_RES) {
    const m = re.exec(message)
    if (m) {
      const value = code === '$1' ? (m[1] ?? code) : code
      return { errorClass: 'infrastructure', markers: [{ key: 'error.code', value }] }
    }
  }

  const locatorExpect = LOCATOR_EXPECT_RE.exec(message)
  const locatorMissing = /Timeout|element\(s\) not found|not found|not visible/.test(message)
  if (LOCATOR_RE.test(message) || (locatorExpect && locatorMissing)) {
    for (const re of LOCATOR_TARGET_RES) {
      const m = re.exec(message)
      if (m?.[1]) {
        markers.push({ key: 'locator', value: m[1].trim() })
        break
      }
    }
    const action = /\blocator\.([a-zA-Z]+):/.exec(message) ?? locatorExpect
    if (action?.[1]) markers.push({ key: 'locator.action', value: action[1] })
    return { errorClass: 'locator', markers }
  }

  // 定位档之后才判超时：页面级/测试级超时 = 基础设施档
  if (INFRA_TIMEOUT_RE.test(message)) {
    return { errorClass: 'infrastructure', markers: [{ key: 'error.code', value: 'TIMEOUT' }] }
  }

  const matcher = MATCHER_RE.exec(message)
  if (matcher?.[1]) {
    markers.push({ key: 'matcher', value: matcher[1] })
    const expected = EXPECTED_RE.exec(message)
    const received = RECEIVED_RE.exec(message)
    if (expected?.[1]) markers.push({ key: 'expected', value: expected[1].trim() })
    if (received?.[1]) markers.push({ key: 'actual', value: received[1].trim() })
    return { errorClass: 'assertion', markers }
  }

  // 证据不足以分类（如测试自身 throw 的自由文本）：unknown 档，不伪装成确定分类。
  // 只取错误名这一结构证据（Error / TypeError …），不取消息文本。
  const name = ERROR_NAME_RE.exec(message)
  markers.push({ key: 'error.name', value: name?.[1] ?? 'Error' })
  return { errorClass: 'unknown', markers }
}

interface RawSuite {
  title?: unknown
  file?: unknown
  specs?: unknown
  suites?: unknown
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/**
 * 从 Playwright 结果 JSON 提取全部失败断言的签名。
 * 遍历 suites（含 describe 嵌套）→ specs → tests → 最后一次失败 result 的 errors；
 * 每条 error 一个签名（断言序号 a1/a2…）。通过/跳过的用例不产生签名。
 * 报告非法 → failures=[] + error（不编造）。
 */
export function extractPlaywrightSignatures(report: unknown): PlaywrightExtraction {
  const root = asRecord(report)
  if (!root || !Array.isArray(root.suites)) {
    return { failures: [], stats: null, error: 'Playwright 结果 JSON 非法（缺 suites 数组）' }
  }
  const failures: PlaywrightFailure[] = []

  const walkSuites = (suites: unknown[], titlePath: string[], fileHint: string): void => {
    for (const s of suites) {
      const suite = asRecord(s)
      if (!suite) continue
      // 文件级 suite 的 title 就是文件名（不进 titlePath，避免与 file 重复）
      const isFileSuite = typeof suite.file === 'string'
      const file = isFileSuite ? str(suite.file) : fileHint
      const nextPath = isFileSuite || str(suite.title) === '' ? titlePath : [...titlePath, str(suite.title)]
      if (Array.isArray(suite.specs)) {
        for (const sp of suite.specs) {
          const spec = asRecord(sp)
          if (!spec) continue
          const specFile = str(spec.file) || file
          const specTitle = str(spec.title)
          if (!Array.isArray(spec.tests)) continue
          for (const t of spec.tests) {
            const test = asRecord(t)
            if (!test || !Array.isArray(test.results)) continue
            const testStatus = str(test.status)
            if (testStatus === 'skipped') continue
            // 取最后一次失败结果（重试后终态才是判定依据）
            let last: Record<string, unknown> | null = null
            for (const r of test.results) {
              const res = asRecord(r)
              if (!res) continue
              const st = str(res.status)
              if (st === 'failed' || st === 'timedOut' || st === 'interrupted') last = res
            }
            if (!last) continue
            const errors = Array.isArray(last.errors) && last.errors.length > 0
              ? last.errors
              : last.error !== undefined ? [last.error] : []
            const retry = typeof last.retry === 'number' ? last.retry : 0
            errors.forEach((e, i) => {
              const err = asRecord(e)
              const message = str(err?.message)
              if (message === '') return
              const c = classifyErrorMessage(message)
              const path = [...nextPath, specTitle]
              failures.push({
                file: specFile,
                titlePath: path,
                assertionId: `${specFile}#${path.join(' > ')}#a${i + 1}`,
                testStatus,
                expectedStatus: str(test.expectedStatus),
                retry,
                signature: canonicalizeSignature({
                  errorClass: c.errorClass,
                  assertionId: `${specFile}#${path.join(' > ')}#a${i + 1}`,
                  semanticMarkers: c.markers,
                }),
              })
            })
          }
        }
      }
      if (Array.isArray(suite.suites)) walkSuites(suite.suites, nextPath, file)
    }
  }
  walkSuites(root.suites, [], '')

  const statsRaw = asRecord(root.stats)
  const stats: PlaywrightStats | null = statsRaw
    ? {
        expected: typeof statsRaw.expected === 'number' ? statsRaw.expected : 0,
        unexpected: typeof statsRaw.unexpected === 'number' ? statsRaw.unexpected : 0,
        flaky: typeof statsRaw.flaky === 'number' ? statsRaw.flaky : 0,
        skipped: typeof statsRaw.skipped === 'number' ? statsRaw.skipped : 0,
      }
    : null
  return { failures, stats }
}
