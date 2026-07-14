import axios from 'axios'

// baseURL 走相对路径 /api/v1：开发期由 Vite proxy 转发到 :8000，
// 生产期由 nginx 等同源转发。无需配置跨域。
export const apiClient = axios.create({
  baseURL: '/api/v1',
  timeout: 10000,
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const msg = error.response?.data?.detail || error.message || '请求失败'
    return Promise.reject(new Error(msg))
  },
)
