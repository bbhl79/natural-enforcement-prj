// 真实 UI 同源证据旅程（#69）：渲染 EvidencePanel → 选择 unicode 文件 → 上传 →
// 轮询 pending→ready → 展示 sha256 与同源下载链接。
// 默认跳过；devenv/test/evidence-ui-smoke.sh 在 `devenv up` + `devenv web` 后以
// EVIDENCE_UI_BASE_URL=http://web:4173 启用（浏览器同源路径经 vite preview proxy）。
import { createHash } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setApiBaseUrlOverride } from '../src/api.js'
import EvidencePanel from '../src/components/EvidencePanel.js'
import { WebProviders } from '../src/lib/root.js'
import { createAppStore } from '../src/store.js'

const BASE_URL = process.env.EVIDENCE_UI_BASE_URL
const describeLive = BASE_URL ? describe : describe.skip

beforeAll(() => {
  if (BASE_URL) setApiBaseUrlOverride(BASE_URL)
})

afterEach(cleanup)

describeLive('真实 UI 同源证据往返（浏览器路径）', () => {
  it('选择 unicode 文件 → 上传 → worker ready → 同源下载链接与 sha256 一致', async () => {
    const store = createAppStore()
    const { container } = render(
      <WebProviders store={store}>
        <EvidencePanel />
      </WebProviders>,
    )

    const payload = new TextEncoder().encode(`ui-evidence-${Date.now()}`)
    const expectedSha = createHash('sha256').update(payload).digest('hex')
    const name = '广州市界面证据（2026）.txt'

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    fireEvent.change(input!, {
      target: { files: [new File([payload], name, { type: 'application/octet-stream' })] },
    })

    fireEvent.click(await screen.findByText('上传并入队'))

    const nameEl = await screen.findByTestId('evidence-file-name', {}, { timeout: 20_000 })
    expect(nameEl).toHaveTextContent(name)

    await waitFor(
      () => expect(screen.getByText('ready（sha256 已回写）')).toBeInTheDocument(),
      { timeout: 20_000 },
    )

    const link = screen.getByTestId('evidence-download')
    const href = link.getAttribute('href') ?? ''
    expect(href).toMatch(/^\/evidence\/[^/]+\/content$/) // 同源相对路径
    expect(href).not.toMatch(/^[a-z]+:\/\//i)
    expect(container.innerHTML).not.toContain('rustfs')
    expect(container.innerHTML).not.toContain('9000')

    // 同源下载字节与上传一致（浏览器可观察行为）
    const downloaded = new Uint8Array(await (await fetch(`${BASE_URL}${href}`)).arrayBuffer())
    expect(createHash('sha256').update(downloaded).digest('hex')).toBe(expectedSha)

    // 供 smoke 脚本在容器退出后按 id 自清理
    console.log(JSON.stringify({ recordId: href.split('/')[2] ?? '', contentPath: href }))
  }, 30_000)
})