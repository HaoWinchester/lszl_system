import { apiClient } from './client'

export interface Bank {
  id: string
  name: string
  subject: string
  description: string | null
  questionCount: number
  createdAt: string | null
  updatedAt: string | null
}

export interface QuestionOption {
  id: string
  text: string
  trap?: string
  correct?: boolean
}

export interface Question {
  id: string
  bankId: string
  title: string
  type: string
  subject: string | null
  difficulty: string | null
  domain: string | null
  topic: string | null
  tags: string[]
  stemParts: { text: string; clue?: string }[]
  options: QuestionOption[]
  correctAnswer: string | null
  analysis: string | null
  clues: Record<string, unknown>[]
  concepts: Record<string, unknown>[]
  reasoningSteps: Record<string, unknown>[]
  status: Record<string, unknown>
  createdAt: string | null
  updatedAt: string | null
}

export interface Paper {
  id: string
  name: string
  subject: string
  description: string | null
  totalCount: number
  status: string
  quotas: Record<string, number>
  questionCount: number
  publishedAt: string | null
  questions?: Question[]
  createdAt: string | null
}

export const banksApi = {
  list: (subject?: string) =>
    apiClient.get<{ banks: Bank[] }>('/banks', { params: subject ? { subject } : {} }).then((r) => r.data.banks),
  create: (data: Record<string, unknown>) =>
    apiClient.post<{ bank: Bank }>('/banks', data).then((r) => r.data.bank),
  update: (id: string, patch: Record<string, unknown>) =>
    apiClient.put<{ bank: Bank }>(`/banks/${id}`, patch).then((r) => r.data.bank),
  remove: (id: string) => apiClient.delete(`/banks/${id}`).then((r) => r.data),
  listQuestions: (bankId: string, params: Record<string, unknown>) =>
    apiClient.get<{ questions: Question[]; total: number }>(`/banks/${bankId}/questions`, { params }).then((r) => r.data),
  createQuestion: (bankId: string, data: Record<string, unknown>) =>
    apiClient.post<{ question: Question }>(`/banks/${bankId}/questions`, data).then((r) => r.data.question),
  updateQuestion: (id: string, patch: Record<string, unknown>) =>
    apiClient.put<{ question: Question }>(`/questions/${id}`, patch).then((r) => r.data.question),
  removeQuestion: (id: string) => apiClient.delete(`/questions/${id}`).then((r) => r.data),
}

export const papersApi = {
  list: (status?: string) =>
    apiClient.get<{ papers: Paper[] }>('/papers', { params: status ? { status } : {} }).then((r) => r.data.papers),
  create: (data: Record<string, unknown>) =>
    apiClient.post<{ paper: Paper }>('/papers', data).then((r) => r.data.paper),
  get: (id: string) => apiClient.get<{ paper: Paper }>(`/papers/${id}`).then((r) => r.data.paper),
  update: (id: string, patch: Record<string, unknown>) =>
    apiClient.put<{ paper: Paper }>(`/papers/${id}`, patch).then((r) => r.data.paper),
  remove: (id: string) => apiClient.delete(`/papers/${id}`).then((r) => r.data),
  compose: (id: string, bankIds: string[], quotas: Record<string, number>) =>
    apiClient.post(`/papers/${id}/compose`, { bankIds, quotas }).then((r) => r.data),
  publish: (id: string) => apiClient.post<{ paper: Paper }>(`/papers/${id}/publish`).then((r) => r.data.paper),
  unpublish: (id: string) => apiClient.post<{ paper: Paper }>(`/papers/${id}/unpublish`).then((r) => r.data.paper),
}
