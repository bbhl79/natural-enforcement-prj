import '@testing-library/jest-dom/vitest'

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
