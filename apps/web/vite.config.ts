// Vite 8：preview 供烘焙产物（无 bind 架构，改动反馈环 = devenv web 重跑秒级重建）。
// proxy：浏览器只触 web 一个源；api 调用经容器内网转发（零宿主端口不变量的唯一例外是 web 自身）。
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiProxy = {
  '/enforcement-points': 'http://api:3000',
  '/health': 'http://api:3000',
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { sourcemap: true },
  server: { host: true, port: 5173, strictPort: true, proxy: apiProxy },
  preview: { host: true, port: 4173, strictPort: true, proxy: apiProxy },
})
