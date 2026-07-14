import { apiClient } from './client'

export interface AppUser {
  username: string
  role: string
  status: string
  display_name: string | null
  email: string | null
  phone: string | null
  subject: string | null
  tags: string[]
  note: string | null
  source: string
  wechat: Record<string, unknown> | null
  created_at: string | null
  updated_at: string | null
  last_login_at: string | null
  last_active_at: string | null
  archived_at: string | null
  has_password: boolean
}

export const authApi = {
  login: (username: string, password: string) =>
    apiClient.post<{ user: AppUser }>('/auth/login', { username, password }).then((r) => r.data.user),
  register: (data: { username: string; password: string; display_name?: string; subject?: string }) =>
    apiClient.post<{ user: AppUser }>('/auth/register', data).then((r) => r.data.user),
  logout: () => apiClient.post<{ ok: boolean }>('/auth/logout').then((r) => r.data),
  me: () => apiClient.get<{ user: AppUser }>('/auth/me').then((r) => r.data.user),
}
