import { learningApi, type CanvasWorkspace } from '../api/learning'
import type { NewLegacyFrameAdapter, NewLegacyMessage } from './newLegacyBridge'

const CATALOG_PREFIX = 'kg_canvas_workspace_catalog_v2__'
const WORKSPACE_PREFIX = 'kg_canvas_workspace_v1__'

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function milliseconds(value: string | null): number {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function workspacePayload(workspace: CanvasWorkspace, username: string): Record<string, unknown> {
  return {
    ...workspace.payload,
    schemaVersion: workspace.schemaVersion,
    id: workspace.id,
    userId: username,
    title: workspace.title,
    createdAt: milliseconds(workspace.createdAt),
    updatedAt: milliseconds(workspace.updatedAt),
  }
}

function summary(payload: Record<string, unknown>): Record<string, unknown> {
  const nodes = payload.nodes && typeof payload.nodes === 'object' && !Array.isArray(payload.nodes)
    ? Object.values(payload.nodes as Record<string, Record<string, unknown>>)
    : []
  return {
    id: payload.id,
    title: payload.title,
    nodeCount: nodes.length,
    questionCount: nodes.filter((node) => node.nodeType === 'question-reference').length,
    synthesisCount: nodes.filter((node) => node.nodeType === 'synthesis-card').length,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  }
}

class WorkspaceFrameAdapter implements NewLegacyFrameAdapter {
  private knownWorkspaceIds = new Set<string>()
  private queue: Promise<void> = Promise.resolve()

  async load(username: string | null): Promise<Record<string, unknown>> {
    this.knownWorkspaceIds.clear()
    if (!username) return { storage: {} }
    const workspaces = await learningApi.listWorkspaces()
    const encodedUser = encodeURIComponent(username)
    const storage: Record<string, string> = {}
    const payloads = workspaces.map((workspace) => workspacePayload(workspace, username))
    workspaces.forEach((workspace, index) => {
      this.knownWorkspaceIds.add(workspace.id)
      storage[`${WORKSPACE_PREFIX}${encodedUser}__${encodeURIComponent(workspace.id)}`] = JSON.stringify(payloads[index])
    })
    if (payloads.length) {
      storage[`${CATALOG_PREFIX}${encodedUser}`] = JSON.stringify({
        schemaVersion: 6,
        userId: username,
        activeWorkspaceId: payloads[0].id,
        workspaces: payloads.map(summary),
        createdAt: payloads[0].createdAt,
        updatedAt: Date.now(),
      })
    }
    return { storage }
  }

  async onMessage(message: NewLegacyMessage, username: string | null): Promise<void> {
    if (!username || message.type !== 'state:changed') return
    const storage = message.payload.storage
    if (!storage || typeof storage !== 'object' || Array.isArray(storage)) return
    this.queue = this.queue.then(() => this.reconcile(storage as Record<string, unknown>, username))
    return this.queue
  }

  private async reconcile(storage: Record<string, unknown>, username: string): Promise<void> {
    const encodedUser = encodeURIComponent(username)
    const workspacePrefix = `${WORKSPACE_PREFIX}${encodedUser}__`
    const catalog = parseObject(storage[`${CATALOG_PREFIX}${encodedUser}`])
    const catalogIds = new Set(
      Array.isArray(catalog?.workspaces)
        ? catalog.workspaces.map((item) => String((item as Record<string, unknown>)?.id ?? '')).filter(Boolean)
        : [],
    )
    const local = Object.entries(storage)
      .filter(([key]) => key.startsWith(workspacePrefix))
      .map(([, value]) => parseObject(value))
      .filter((workspace): workspace is Record<string, unknown> => Boolean(workspace))
      .filter((workspace) => catalogIds.size === 0 || catalogIds.has(String(workspace.id ?? '')))

    const localIds = new Set<string>()
    for (const workspace of local) {
      const id = String(workspace.id ?? '')
      if (!id) continue
      localIds.add(id)
      const input = {
        id,
        title: String(workspace.title ?? '未命名画布'),
        schemaVersion: Number(workspace.schemaVersion ?? 6),
        payload: workspace,
      }
      if (this.knownWorkspaceIds.has(id)) await learningApi.updateWorkspace(id, input)
      else {
        await learningApi.createWorkspace(input)
        this.knownWorkspaceIds.add(id)
      }
    }

    for (const id of [...this.knownWorkspaceIds]) {
      if (localIds.has(id)) continue
      await learningApi.deleteWorkspace(id)
      this.knownWorkspaceIds.delete(id)
    }
  }
}

export const workspaceFrameAdapter = new WorkspaceFrameAdapter()
