import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      // 开发期把 /api 转发到 FastAPI（:8000），避开跨域；保留 /api 前缀。
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
})
