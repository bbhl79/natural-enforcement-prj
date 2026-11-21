// PROTOTYPE（#13）— 毕业转写（#10 §6）：缺陷报告 → 复现轨道用例。
// 机械转写（fast-check / schemathesis）：反例请求 → API 复现用例，真跑校验后直接入轨；
// 非机械引擎（visual / model-journey / monkey / agent-session）：生成 _drafts 草稿骨架，
// 补完断言后重跑 graduate 转正（占位断言自毁式：补完前不可转正）。
import { z } from 'zod'
import { CounterexampleRequestSchema, type DefectRecord } from './defect/schema.js'

export const FAIL_LINE_PREFIX = 'test.fail()'
/** 占位断言（自毁式）：草稿补完前若被误收集必然失败；graduate 转正校验其已替换 */
export const PLACEHOLDER_ASSERT = `expect(true, '占位断言：补完前不可转正').toBe(false)`
export const DRAFT_FAIL_MARKER = '// test.fail()' // 草稿内注释态的 expected-fail 行，转正时启用

const CounterexampleSchema = z.object({
  property: z.string().optional(),
  request: CounterexampleRequestSchema,
})

function failLine(id: string): string {
  return `  ${FAIL_LINE_PREFIX} // expected-fail：${id} 未修复；修复确认走 devenv e2e confirm-fix（摘除此行）`
}

function reqCall(req: z.infer<typeof CounterexampleRequestSchema>): string {
  const method = req.method.toLowerCase()
  if (!['get', 'post', 'put', 'patch', 'delete'].includes(method))
    throw new Error(`不支持的 method：${req.method}`)
  const parts: string[] = []
  parts.push(JSON.stringify(req.path))
  const opts: string[] = []
  if (req.headers !== undefined && Object.keys(req.headers).length > 0)
    opts.push(`headers: ${JSON.stringify(req.headers)}`)
  if (req.body !== undefined) opts.push(`data: ${JSON.stringify(req.body)}`)
  if (opts.length > 0) parts.push(`{ ${opts.join(', ')} }`)
  return `await request.${method}(${parts.join(', ')})`
}

/** 机械转写：fast-check / schemathesis 反例 → API 复现用例（带/不带 expected-fail 行） */
export function transcribeMechanical(d: DefectRecord, withFailLine: boolean): string {
  const parsed = CounterexampleSchema.safeParse(d.reproducibility.counterexample)
  if (!parsed.success) {
    throw new Error(
      `engine=${d.engine} 需要 counterexample{property?, request{method,path,headers?,body?}}：${parsed.error.issues[0]?.message}`,
    )
  }
  const { property, request } = parsed.data
  const assertionMsg = property ?? '契约内输入不应引发服务器错误'
  const lines = [
    `// defect: ${d.id}`,
    `// track: repro — devenv e2e graduate 自 ${d.engine} 反例机械转写（模板 v1）`,
    `// replay: ${d.reproducibility.replayCommand}`,
    `import { expect, test } from '@playwright/test'`,
    ``,
    `test(${JSON.stringify(`${d.id} ${d.title}`)}, async ({ request }) => {`,
  ]
  if (withFailLine) lines.push(failLine(d.id))
  lines.push(
    `  const resp = ${reqCall(request)}`,
    `  expect(resp.status(), ${JSON.stringify(assertionMsg)}).toBeLessThan(500)`,
    `})`,
    ``,
  )
  return lines.join('\n')
}

/** 非机械转写：草稿骨架入 tests/repro/_drafts/（CI 不收集；文件头必须链 reported 缺陷） */
export function transcribeDraft(d: DefectRecord): string {
  return [
    `// defect: ${d.id}`,
    `// track: repro-draft — devenv e2e graduate 生成（${d.engine} 无机械转写；补完断言后重跑 graduate 转正）`,
    `// replay: ${d.reproducibility.replayCommand}`,
    `import { expect, test } from '@playwright/test'`,
    ``,
    `test(${JSON.stringify(`${d.id} ${d.title}`)}, async ({ request, page }) => {`,
    `  // TODO(agent/human)：按缺陷报告补完复现步骤与断言；证据见 defect 记录 evidence 字段`,
    `  ${PLACEHOLDER_ASSERT}`,
    `  ${DRAFT_FAIL_MARKER} // expected-fail：${d.id} 未修复；graduate 转正时启用此行`,
    `})`,
    ``,
  ].join('\n')
}

export type DraftActivation =
  | { ok: true; content: string }
  | { ok: false; error: string }

/** 草稿转正：占位断言必须已替换；注释态 test.fail 行启用（--fixed 模式则删除） */
export function activateDraft(content: string, withFailLine: boolean): DraftActivation {
  if (content.includes(PLACEHOLDER_ASSERT))
    return { ok: false, error: '草稿仍含占位断言（补完真实断言后重跑 graduate）' }
  if (!content.includes(DRAFT_FAIL_MARKER))
    return { ok: false, error: `草稿缺 ${DRAFT_FAIL_MARKER} 转正锚行（不要改动模板标记）` }
  let out = content
  if (withFailLine) {
    out = out.replace(DRAFT_FAIL_MARKER, FAIL_LINE_PREFIX)
  } else {
    out = out
      .split('\n')
      .filter((l) => !l.includes(DRAFT_FAIL_MARKER))
      .join('\n')
  }
  return { ok: true, content: out }
}

/** confirm-fix：摘除 expected-fail 行（首个 test.fail( 起始行） */
export function stripFailLine(content: string): { ok: true; content: string } | { ok: false; error: string } {
  const lines = content.split('\n')
  const idx = lines.findIndex((l) => l.trimStart().startsWith(FAIL_LINE_PREFIX))
  if (idx < 0) return { ok: false, error: '未找到 test.fail( 行（已摘除或模板被改）' }
  return { ok: true, content: lines.filter((_, i) => i !== idx).join('\n') }
}

/** 校验用：内容中 test.fail( 起始行的数量 */
export function countFailLines(content: string): number {
  return content.split('\n').filter((l) => l.trimStart().startsWith(FAIL_LINE_PREFIX)).length
}

/** 校验用：文件头 defect 链接（前 5 行内出现 defect: DEF-NNNN） */
export function headerDefectId(content: string): string | undefined {
  for (const line of content.split('\n').slice(0, 5)) {
    const m = /defect:\s*(DEF-\d{4})/.exec(line)
    if (m?.[1]) return m[1]
  }
  return undefined
}
