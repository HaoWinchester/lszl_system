import { apiClient } from './client'

export const trainingApi = {
  getProgress: (qid: string) =>
    apiClient.get(`/training/progress/${qid}`).then((r) => r.data.progress),
  saveProgress: (qid: string, data: Record<string, unknown>) =>
    apiClient.put(`/training/progress/${qid}`, data).then((r) => r.data.progress),
  recallQuestion: (qid: string) =>
    apiClient.get(`/recall/question/${qid}`).then((r) => r.data.question),
  getRecall: (qid: string) =>
    apiClient.get(`/recall/progress/${qid}`).then((r) => r.data.progress),
  saveRecall: (qid: string, data: Record<string, unknown>) =>
    apiClient.put(`/recall/progress/${qid}`, data).then((r) => r.data.progress),
}
