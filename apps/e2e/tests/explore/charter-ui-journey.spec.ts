// PROTOTYPE（#13）— 探索轨道 charter（引擎：agent-session 起步会话；顺带验证容器内浏览器路径——
// mcr playwright 镜像 + --ipc=host + compose 内网 e2e-web 无宿主端口）。
// charter：web 创建点位 → 附近表出现该点位（写路径经 preview proxy → api → PostGIS → 读路径回表）。
import { expect, test } from '@playwright/test'
import { WEB_BASE, uniq } from '../common.js'

test('charter: web 创建点位 → 附近表可见（全链旅程）', async ({ page }) => {
  const name = uniq('探索旅程')

  await page.goto(`${WEB_BASE}/`)
  await expect(page.getByText('api 在线')).toBeVisible({ timeout: 30_000 })

  // 表单在「执法点位」Tab 的创建卡片内（antd Form label 关联）
  await page.getByLabel('名称', { exact: false }).fill(name)
  await page.getByLabel('纬度').fill('39.909')
  await page.getByLabel('经度').fill('116.398')
  await page.getByRole('button', { name: '创建' }).click()

  // 断言落在数据面（附近表出现唯一名）而非 toast——读路径回表才是全链闭环
  await expect(page.getByRole('cell', { name, exact: true })).toBeVisible({ timeout: 20_000 })
})
