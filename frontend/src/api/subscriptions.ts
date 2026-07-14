import { apiClient } from './client'
import type { SubscriptionPlan } from './system'

export interface Subscription {
  username: string
  planId: string
  status: string
  startedAt: string | null
  expiresAt: string | null
  source: string
  note: string | null
}
export interface Order {
  id: string
  username: string
  planId: string
  planName: string
  status: string
  note: string | null
  createdAt: string | null
  approvedAt: string | null
  approvedBy: string | null
}
export interface RedeemCode {
  id: string
  code: string
  planId: string
  planName: string
  status: string
  usedBy: string | null
  createdAt: string | null
}

export const subsApi = {
  me: () => apiClient.get<{ subscription: Subscription }>('/subscriptions/me').then((r) => r.data.subscription),
  plans: () =>
    apiClient.get<{ plans: SubscriptionPlan[] }>('/subscriptions/plans').then((r) => r.data.plans),
  redeem: (code: string) =>
    apiClient.post<{ subscription: Subscription }>('/subscriptions/redeem', { code }).then((r) => r.data.subscription),
  createOrder: (planId: string) =>
    apiClient.post<{ order: Order }>('/subscriptions/orders', { planId }).then((r) => r.data.order),
  listOrders: () => apiClient.get<{ orders: Order[] }>('/subscriptions/orders').then((r) => r.data.orders),
  approveOrder: (id: string) =>
    apiClient.post<{ order: Order }>(`/subscriptions/orders/${id}/approve`).then((r) => r.data.order),
  cancelOrder: (id: string) =>
    apiClient.post<{ order: Order }>(`/subscriptions/orders/${id}/cancel`).then((r) => r.data.order),
  listCodes: () =>
    apiClient.get<{ codes: RedeemCode[] }>('/subscriptions/redeem-codes').then((r) => r.data.codes),
  generateCodes: (planId: string, count: number) =>
    apiClient.post<{ codes: string[] }>('/subscriptions/redeem-codes/generate', { planId, count }).then((r) => r.data.codes),
}
