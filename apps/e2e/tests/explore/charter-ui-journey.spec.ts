// 探索 charter（#70）：完整 UI 旅程——浏览器经 e2e-web 的 preview proxy 打本 run 的
// api/worker（零宿主端口，容器内网同源）。本文件是隔离/服务绑定自检（不是业务 charter），
// 验证「每 run 前端/API/后台处理」都是本 run 实例，不是测试脚本自己换 URL 指向共享服务。
import { expect, test } from '@playwright/test'
import { RUN_ID, WEB_BASE, sha256Hex, uniqueName } from '../common.js'

// 地理背景：广州市中心（项目为广州市自然资源部门开发）
const CENTER = { lat: 23.1291, lng: 113.2644 }

test('UI 旅程：创建点位 + 上传证据 → 本 run worker ready → 同源下载字节一致', async ({
  page,
}, testInfo) => {
  const name = uniqueName(testInfo, '界面点位')
  const fileName = `界面证据-${RUN_ID}.bin`
  const payload = Buffer.from(`ui-journey-${RUN_ID}-${name}`)

  await page.goto(`${WEB_BASE}/`)
  await expect(page.getByText('api 在线')).toBeVisible({ timeout: 30_000 })

  // 创建点位：antd 双表单无 name 时 id 撞车，按「含名称字段的 form」圈定作用域。
  const createForm = page.locator('form').filter({ hasText: '名称' })
  await createForm.getByRole('textbox').fill(name)
  await createForm.getByRole('spinbutton').first().fill(String(CENTER.lat))
  await createForm.getByRole('spinbutton').nth(1).fill(String(CENTER.lng))
  await createForm.getByRole('button', { name: /创\s*建/ }).click()

  // 读路径回表才算全链闭环（写 → API → PostGIS → nearby 重查 → 表格）。
  await expect(page.getByRole('cell', { name, exact: true })).toBeVisible({ timeout: 20_000 })

  // 证据 UI：切 tab → 原始字节上传 → 后台轮询 → ready。
  await page.getByRole('tab', { name: '证据文件' }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: fileName,
    mimeType: 'application/octet-stream',
    buffer: payload,
  })
  await page.getByRole('button', { name: /上\s*传\s*并\s*入\s*队/ }).click()

  await expect(page.getByText('ready（sha256 已回写）')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('evidence-file-name')).toHaveText(fileName)

  // 同源下载：href 是相对 contentPath，经 e2e-web 代理到本 run api，字节必须一致。
  const href = await page.getByTestId('evidence-download').getAttribute('href')
  expect(href).toMatch(/^\/evidence\/[^/]+\/content$/)
  const content = await page.request.get(new URL(href!, WEB_BASE).toString())
  expect(content.status()).toBe(200)
  const downloaded = await content.body()
  expect(sha256Hex(downloaded)).toBe(sha256Hex(payload))
})