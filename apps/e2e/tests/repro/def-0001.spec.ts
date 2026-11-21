// defect: DEF-0001
// track: repro — devenv e2e graduate 自 fast-check 反例机械转写（模板 v1）
// replay: node apps/e2e/replay/DEF-0001.mjs
import { expect, test } from '@playwright/test'

test("DEF-0001 创建点位接受 NUL 名称导致 500（契约 z.string() 未拦 PostgreSQL text 禁存字符）", async ({ request }) => {
  const resp = await request.post("/enforcement-points", { data: {"name":"a\u0000b","lat":0,"lng":0} })
  expect(resp.status(), "契约内输入不应引发服务器错误").toBeLessThan(500)
})
