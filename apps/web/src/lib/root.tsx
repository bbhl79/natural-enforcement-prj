// React 根挂载封装（#68，Spec-工程基座 §5）：
// 始终为 createRoot 传入 identifierPrefix——多 React 根共驻同一文档时，
// React useId 生成的表单/控件 DOM id 自动带根级前缀，避免跨根 id 与 label 串扰。
import { StrictMode, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { Provider } from 'react-redux'
import { store as defaultStore, type AppStore } from '../store.js'

export const DEFAULT_ROOT_ID_PREFIX = 'ne-web-'

let nextAutoRootIndex = 1

export interface WebProvidersProps {
  store?: AppStore
  children: ReactNode
}

export function WebProviders({ store = defaultStore, children }: WebProvidersProps) {
  return (
    <ConfigProvider locale={zhCN}>
      <AntApp>
        <Provider store={store}>{children}</Provider>
      </AntApp>
    </ConfigProvider>
  )
}

export interface CreateWebRootOptions {
  /** 根级 useId 前缀（多 React 根场景区分各根的 DOM id；省略时自动分配递增前缀） */
  identifierPrefix?: string
  store?: AppStore
}

export interface WebRootHandle {
  readonly identifierPrefix: string
  render(node: ReactNode): void
  unmount(): void
}

export function createWebRoot(
  container: Element | DocumentFragment,
  options: CreateWebRootOptions = {},
): WebRootHandle {
  const trimmed = options.identifierPrefix?.trim()
  const identifierPrefix =
    trimmed && trimmed.length > 0 ? trimmed : `ne-root-${nextAutoRootIndex++}-`
  const appStore = options.store ?? defaultStore
  const root: Root = createRoot(container, { identifierPrefix })

  return {
    identifierPrefix,
    render(node: ReactNode) {
      root.render(
        <StrictMode>
          <WebProviders store={appStore}>{node}</WebProviders>
        </StrictMode>,
      )
    },
    unmount() {
      root.unmount()
    },
  }
}
