import { apiClient } from './client'

export interface FileMeta {
  id: string
  name: string
  description: string | null
  folderId: string | null
  ownerId: string
  status: string
  nodeCount: number
  linkCount: number
  byteSize: number
  revision: number
  source: string
  preview: { nodes?: unknown[]; links?: unknown[] } | null
  structureHash: string | null
  tag: { id: string; name: string; color: string } | null
  createdAt: string | null
  updatedAt: string | null
  lastOpenedAt: string | null
}

export interface OpenedFile {
  meta: FileMeta
  graphData: Record<string, unknown>
  learningState: Record<string, unknown> | null
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
  status: string
}

export interface Tag {
  id: string
  name: string
  color: string
}

export const filesApi = {
  list: (params: Record<string, unknown>) =>
    apiClient.get<{ files: FileMeta[]; total: number }>('/files', { params }).then((r) => r.data),
  create: (data: { name: string; graphData?: unknown; folderId?: string | null }) =>
    apiClient.post<{ file: FileMeta }>('/files', data).then((r) => r.data.file),
  open: (id: string) => apiClient.get<OpenedFile>(`/files/${id}`).then((r) => r.data),
  save: (id: string, graphData: unknown, learningState?: unknown) =>
    apiClient.put<{ file: FileMeta }>(`/files/${id}`, { graphData, learningState }).then((r) => r.data.file),
  rename: (id: string, name: string) =>
    apiClient.patch<{ file: FileMeta }>(`/files/${id}`, { name }).then((r) => r.data.file),
  move: (id: string, folderId: string | null) =>
    apiClient.patch<{ file: FileMeta }>(`/files/${id}`, { folderId }).then((r) => r.data.file),
  trash: (id: string) => apiClient.delete(`/files/${id}`).then((r) => r.data),
  restore: (id: string) => apiClient.post<{ file: FileMeta }>(`/files/${id}/restore`).then((r) => r.data.file),
  permanentDelete: (id: string) => apiClient.delete(`/files/${id}/permanent`).then((r) => r.data),
  duplicate: (id: string, name?: string) =>
    apiClient.post<{ file: FileMeta }>(`/files/${id}/duplicate`, { name }).then((r) => r.data.file),
  emptyTrash: () => apiClient.post('/files/trash/empty').then((r) => r.data),
  stats: () => apiClient.get('/files/stats').then((r) => r.data),
  current: () => apiClient.get<{ fileId: string | null }>('/files/current').then((r) => r.data.fileId),
  setCurrent: (fileId: string | null) => apiClient.put('/files/current', { fileId }).then((r) => r.data),
  importLegacy: (payload: Record<string, unknown>) =>
    apiClient.post('/files/import-legacy', payload).then((r) => r.data),
  folders: () => apiClient.get<{ folders: Folder[] }>('/files/folders').then((r) => r.data.folders),
  createFolder: (name: string, parentId?: string | null) =>
    apiClient.post<{ folder: Folder }>('/files/folders', { name, parentId }).then((r) => r.data.folder),
  renameFolder: (id: string, name: string) =>
    apiClient.patch<{ folder: Folder }>(`/files/folders/${id}`, { name }).then((r) => r.data.folder),
  deleteFolder: (id: string) => apiClient.delete(`/files/folders/${id}`).then((r) => r.data),
  tags: () => apiClient.get<{ tags: Tag[] }>('/files/tags').then((r) => r.data.tags),
  createTag: (name: string, color: string) =>
    apiClient.post<{ tag: Tag }>('/files/tags', { name, color }).then((r) => r.data.tag),
  deleteTag: (id: string) => apiClient.delete(`/files/tags/${id}`).then((r) => r.data),
  setFileTag: (fileId: string, tagId: string | null) =>
    apiClient.put(`/files/${fileId}/tag`, { tagId }).then((r) => r.data),
}
