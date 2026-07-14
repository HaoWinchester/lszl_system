import { apiClient } from './client'
import type { AppUser } from './auth'

export interface UserListResponse {
  users: AppUser[]
  total: number
  page: number
  page_size: number
}

export interface UserStats {
  username: string
  graph_nodes: number
  graph_links: number
  banks: number
  questions: number
  papers: number
}

export const usersApi = {
  list: (params: {
    query?: string
    role?: string
    status?: string
    page?: number
    page_size?: number
  }) => apiClient.get<UserListResponse>('/users', { params }).then((r) => r.data),
  create: (data: Record<string, unknown>) =>
    apiClient.post<{ user: AppUser }>('/users', data).then((r) => r.data.user),
  update: (username: string, data: Record<string, unknown>) =>
    apiClient.put<{ user: AppUser }>(`/users/${username}`, data).then((r) => r.data.user),
  remove: (username: string) => apiClient.delete(`/users/${username}`).then((r) => r.data),
  setStatus: (username: string, status: string) =>
    apiClient.patch<{ user: AppUser }>(`/users/${username}/status`, { status }).then((r) => r.data.user),
  resetPassword: (username: string, new_password: string) =>
    apiClient.post(`/users/${username}/reset-password`, { new_password }).then((r) => r.data),
  duplicate: (username: string, new_username: string, new_password: string) =>
    apiClient.post(`/users/${username}/duplicate`, { new_username, new_password }).then((r) => r.data),
  batchUpdate: (data: { usernames: string[]; role?: string; status?: string; subject?: string }) =>
    apiClient.patch('/users/batch', data).then((r) => r.data),
  batchDelete: (usernames: string[]) =>
    apiClient.delete('/users/batch', { data: { usernames } }).then((r) => r.data),
  exportUsers: (usernames?: string) =>
    apiClient.get('/users/export', { params: usernames ? { usernames } : {} }).then((r) => r.data),
  importUsers: (payload: Record<string, unknown>) =>
    apiClient.post('/users/import', payload).then((r) => r.data),
  stats: (username: string) =>
    apiClient.get<UserStats>(`/users/${username}/stats`).then((r) => r.data),
}
