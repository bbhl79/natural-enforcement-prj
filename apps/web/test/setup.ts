import '@testing-library/jest-dom/vitest'

// React 19 多根测试直接调用 createRoot + act(...) 需要开启 act 环境标记，
// 否则仅 RTL render() 内部临时置位，直接 act() 会刷屏告警（#68 实测）。
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom 不实现 ResizeObserver，而 antd 6 的 Tabs 等组件通过 @rc-component/resize-observer
// 挂载时直接实例化——未 stub 则渲染 App/Tabs 必抛 ReferenceError（#68 真实引擎冒烟实测）。
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom 不实现 matchMedia，而 antd 6 的响应式观察者（responsiveObserver，Table/Grid 均经 useBreakpoint
// 订阅）在挂载即调用——不 mock 则组件测试全线 TypeError（原型 #12 实测）。
if (typeof window.matchMedia === 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {}, // legacy API：antd 内部仍调用
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
