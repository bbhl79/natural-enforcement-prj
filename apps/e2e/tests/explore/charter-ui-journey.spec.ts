// PROTOTYPE（#13）— 探索轨道 charter（引擎：agent-session 起步会话；顺带验证容器内浏览器路径——
// mcr playwright 镜像 + --ipc=host + compose 内网 e2e-web 无宿主端口）。
// charter：web 创建点位 → 附近表出现该点位（写路径经 preview proxy → api → PostGIS → 读路径回表）。
// 实测事实：查询表单与创建表单都有 纬度/经度 标签（须按 form 含「名称」圈定作用域）；
// antd 6 对两字中文按钮自动插空格（「创 建」）→ 名称匹配用正则。
import { expect, test } from '@playwright/test'
import { WEB_BASE, uniq } from '../common.js'

test('charter: web 创建点位 → 附近表可见（全链旅程）', async ({ page }) => {
  const name = uniq('探索旅程')

  await page.goto(`${WEB_BASE}/`)
  await expect(page.getByText('api 在线')).toBeVisible({ timeout: 30_000 })

  // 创建表单 = 含「名称」字段的那个 form；antd 无 form name → 两个表单的 Form.Item id 撞车
  // （label[for] 跨表单指向查询表单控件，实测 #13）→ 表单内按角色定位（textbox×1 + spinbutton×2）
  const createForm = page.locator('form').filter({ hasText: '名称' })
  await createForm.getByRole('textbox').fill(name)
  await createForm.getByRole('spinbutton').first().fill('39.909')
  await createForm.getByRole('spinbutton').nth(1).fill('116.398')
  await createForm.getByRole('button', { name: /创\s*建/ }).click()

  // 断言落在数据面（附近表出现唯一名）而非 toast——读路径回表才是全链闭环
  await expect(page.getByRole('cell', { name, exact: true })).toBeVisible({ timeout: 20_000 })
})
