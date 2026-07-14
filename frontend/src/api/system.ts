import { apiClient } from './client'

export interface RoleTheme {
  primary_color: string
  accent_color: string
  soft_color: string
  text_color: string
}

export interface SubscriptionPlan {
  planId: string
  name: string
  shortName?: string
  validDays: number
  originalPriceText: string
  discountPercent: string
  enabled: boolean
  recommended: boolean
  badgeText?: string
  description?: string
  benefitText?: string
  usageText?: string
  [key: string]: unknown
}

export interface AdminLog {
  id: string
  action: string
  target_username: string | null
  actor: string
  detail: string | null
  at: string
}

export const systemApi = {
  permissions: () => apiClient.get('/system/permissions').then((r) => r.data),
  themes: () =>
    apiClient.get<{ themes: Record<string, RoleTheme> }>('/system/themes').then((r) => r.data.themes),
  updateTheme: (role: string, body: Partial<RoleTheme>) =>
    apiClient.put(`/system/themes/${role}`, body).then((r) => r.data.theme),
  wechatConfig: () =>
    apiClient.get<{ config: Record<string, unknown> }>('/system/wechat-config').then((r) => r.data.config),
  updateWechatConfig: (body: Record<string, unknown>) =>
    apiClient.put<{ config: Record<string, unknown> }>('/system/wechat-config', body).then((r) => r.data.config),
  plans: () =>
    apiClient.get<{ plans: SubscriptionPlan[] }>('/system/subscription-plans').then((r) => r.data.plans),
  updatePlan: (planId: string, body: Record<string, unknown>) =>
    apiClient.put(`/system/subscription-plans/${planId}`, body).then((r) => r.data.plan),
  logs: (limit = 100) =>
    apiClient.get<{ logs: AdminLog[] }>('/system/logs', { params: { limit } }).then((r) => r.data.logs),
  clearLogs: () => apiClient.delete('/system/logs').then((r) => r.data),
}
