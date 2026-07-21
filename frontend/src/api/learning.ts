import { apiClient } from './client'

export interface LearningEventInput {
  questionId?: string
  eventType: string
  payload?: Record<string, unknown>
}

export interface CanvasWorkspace {
  id: string
  title: string
  schemaVersion: number
  payload: Record<string, unknown>
  createdAt: string | null
  updatedAt: string | null
}

export interface CanvasWorkspaceInput {
  id?: string
  title: string
  schemaVersion?: number
  payload: Record<string, unknown>
}

export interface GuidedCoursePackage {
  version: string
  activitySchemaVersion: number
  contentHash: string
  course: {
    id: string
    stages: Record<string, unknown>[]
    parts: Record<string, unknown>[]
    nodes: Record<string, unknown>[]
    placementTests: Record<string, Record<string, unknown>>
    [key: string]: unknown
  }
  activities: Record<string, unknown>[]
}

export interface GuidedProgressResponse {
  progress: Record<string, unknown>
  revision: number
  preview?: boolean
}

export const learningApi = {
  getSession: (questionId: string) =>
    apiClient.get(`/training/session/${questionId}`).then((response) => response.data.session),
  saveSession: (questionId: string, session: Record<string, unknown>) =>
    apiClient.put(`/training/session/${questionId}`, session).then((response) => response.data.session),
  appendEvent: (event: LearningEventInput) =>
    apiClient.post('/learning/events', event).then((response) => response.data.event),
  listEvents: (params?: { question_id?: string; page?: number; page_size?: number }) =>
    apiClient.get('/learning/events', { params }).then((response) => response.data.events),
  listWorkspaces: () =>
    apiClient.get<{ workspaces: CanvasWorkspace[] }>('/workspaces').then((response) => response.data.workspaces),
  getWorkspace: (workspaceId: string) =>
    apiClient.get<{ workspace: CanvasWorkspace }>(`/workspaces/${workspaceId}`).then((response) => response.data.workspace),
  createWorkspace: (input: CanvasWorkspaceInput) =>
    apiClient.post<{ workspace: CanvasWorkspace }>('/workspaces', input).then((response) => response.data.workspace),
  updateWorkspace: (workspaceId: string, input: Partial<CanvasWorkspaceInput>) =>
    apiClient.put<{ workspace: CanvasWorkspace }>(`/workspaces/${workspaceId}`, input).then((response) => response.data.workspace),
  deleteWorkspace: (workspaceId: string) =>
    apiClient.delete(`/workspaces/${workspaceId}`).then((response) => response.data),
  getGuidedCourse: () =>
    apiClient.get<GuidedCoursePackage>('/guided-learning/courses/default').then((response) => response.data),
  getGuidedProgress: (courseId: string, preview = false) =>
    apiClient.get<GuidedProgressResponse>(`/guided-learning/courses/${courseId}/progress`, {
      params: preview ? { preview: true } : {},
    }).then((response) => response.data),
  saveGuidedProgress: (courseId: string, input: Record<string, unknown>) =>
    apiClient.put<GuidedProgressResponse>(`/guided-learning/courses/${courseId}/progress`, input).then((response) => response.data),
  resetGuidedProgress: (courseId: string) =>
    apiClient.put<GuidedProgressResponse>(`/guided-learning/courses/${courseId}/progress`, { reset: true }).then((response) => response.data),
  completeGuidedNode: (courseId: string, nodeId: string, input: Record<string, unknown>, preview = false) =>
    apiClient.post<GuidedProgressResponse>(`/guided-learning/courses/${courseId}/nodes/${nodeId}/complete`, input, {
      params: preview ? { preview: true } : {},
    }).then((response) => response.data),
  submitPlacementAttempt: (courseId: string, partId: string, input: Record<string, unknown>, preview = false) =>
    apiClient.post<GuidedProgressResponse & { result: Record<string, unknown> }>(
      `/guided-learning/courses/${courseId}/parts/${partId}/placement-attempt`,
      input,
      { params: preview ? { preview: true } : {} },
    ).then((response) => response.data),
}
