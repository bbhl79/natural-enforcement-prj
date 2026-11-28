// Vite 8：preview 供烘焙产物（无 bind 架构，改动反馈环 = devenv web 重跑秒级重建）。
// proxy：浏览器只触 web 一个源；api 调用经容器内网转发（零宿主端口不变量的唯一例外是 web 自身）。
// 代理路由表直接取自 @ne/contracts 的 API_CONTRACT_ENDPOINTS（唯一事实源），因此
// `devenv gen nest-module --http` 新增的任何路由无需手工同步即可同源代理到 api:3000。
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { API_CONTRACT_ENDPOINTS } from '@ne/contracts'

// 代理目标按运行栈注入（#70）：dev 栈默认 api:3000；e2e per-run web 注入本 run 的 api
// 服务名（同 run 网络内唯一），浏览器仍只触 web 一个源（零宿主端口）。
const apiOrigin = process.env.API_ORIGIN ?? 'http://api:3000'

const apiProxy: Record<string, string> = Object.fromEntries(
  Array.from(new Set(API_CONTRACT_ENDPOINTS.map((endpoint) => endpoint.path))).map((routePath) => [
    routePath,
    apiOrigin,
  ]),
)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { sourcemap: true },
  server: { host: true, port: 5173, strictPort: true, proxy: apiProxy },
  // allowedHosts 放行容器内网服务名 web（供 tools/e2e 容器经 http://web:4173 访问，
  // Vite 8 默认拒绝非 localhost Host 头导致 403——#68 真实引擎冒烟实测）。
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
    allowedHosts: ['web', 'localhost'],
    proxy: apiProxy,
  },
})
