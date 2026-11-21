// PROTOTYPE（#13）— 探索轨道 charter（引擎：fast-check，P0 起步——exploratory-testing.md §3）。
// charter：POST /enforcement-points 的契约内输入空间全量安全——契约 schema 接受的任意 name
// 不得引发 5xx（5xx = 未处理服务器错误 = 缺陷；拒绝 400 是合法行为）。
// 危险字典先行（确定性 prelude，证据友好），fast-check 属性随后（失败输出 seed/反例）。
import { expect, test } from '@playwright/test'
import fc from 'fast-check'

// 已知危险输入字典：NUL（PostgreSQL text 不可存）、控制字符、DEL、孤立代理对
const DANGEROUS_NAMES = ['\u0000', `a\u0000${'b'}`, '\u001f', '\u007f', 'a\ud83d']

test('charter: 创建点位——契约内输入空间全量安全（无 5xx）', async ({ request }) => {
  const ok = async (name: string): Promise<boolean> => {
    const resp = await request.post('/enforcement-points', { data: { name, lat: 0, lng: 0 } })
    return resp.status() < 500
  }

  for (const name of DANGEROUS_NAMES) {
    if (!(await ok(name))) {
      throw new Error(
        `字典反例：name=${JSON.stringify(name)} 引发 5xx（契约 z.string() 接受该值 ⇒ 服务端未处理错误）`,
      )
    }
  }
  expect(true).toBe(true) // 字典段全绿时显式通过（探针可见性）

  await fc.assert(
    fc.asyncProperty(fc.string({ minLength: 1, maxLength: 200 }), async (name) => {
      if (!(await ok(name))) {
        throw new Error(`属性反例：name=${JSON.stringify(name)} 引发 5xx（seed 见 fast-check 输出）`)
      }
    }),
    { numRuns: 50 },
  )
})
