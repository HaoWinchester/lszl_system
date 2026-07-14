import { apiClient } from './client'

export interface HealthResponse {
  status: string
  db: string
  time: string
  db_time: string | null
}

export const getHealth = () =>
  apiClient.get<HealthResponse>('/health').then((r) => r.data)
