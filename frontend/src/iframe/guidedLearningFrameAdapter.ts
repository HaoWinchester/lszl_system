import { learningApi, type GuidedCoursePackage } from '../api/learning'
import type { NewLegacyFrameAdapter, NewLegacyMessage } from './newLegacyBridge'

const PROGRESS_PREFIX = 'kg_guided_learning_progress_v2__'
const LANGUAGE_KEY = 'kg_question_language_mode_v1'
const DEFAULT_MODE_KEY = 'kg_default_entry_mode_v1'

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

function nodeEntries(progress: Record<string, unknown> | null): Record<string, Record<string, unknown>> {
  const nodes = progress?.nodes
  return nodes && typeof nodes === 'object' && !Array.isArray(nodes)
    ? nodes as Record<string, Record<string, unknown>>
    : {}
}

function placementEntries(progress: Record<string, unknown> | null): Record<string, Record<string, unknown>> {
  const placements = progress?.placementTests
  return placements && typeof placements === 'object' && !Array.isArray(placements)
    ? placements as Record<string, Record<string, unknown>>
    : {}
}

function emptyProgress(pkg: GuidedCoursePackage, username: string): Record<string, unknown> {
  const nodes = Object.fromEntries(pkg.course.nodes.map((node, index) => [String(node.id), {
    status: index === 0 ? 'available' : 'locked',
    completedAt: null,
    metrics: null,
  }]))
  const now = Date.now()
  return {
    schemaVersion: 4,
    userId: username,
    courseId: pkg.course.id,
    currentNodeId: String(pkg.course.nodes[0]?.id ?? ''),
    nodes,
    placementTests: {},
    preferences: { languageMode: 'zh', defaultMode: 'learning' },
    createdAt: now,
    updatedAt: now,
  }
}

class GuidedLearningFrameAdapter implements NewLegacyFrameAdapter {
  private course: GuidedCoursePackage | null = null
  private serverProgress: Record<string, unknown> | null = null
  private revision = 0
  private progressKey = ''
  private queue: Promise<Record<string, unknown> | void> = Promise.resolve()
  private adminPreview = false

  async load(username: string | null, role?: string | null): Promise<Record<string, unknown>> {
    this.course = await learningApi.getGuidedCourse()
    this.adminPreview = role === 'admin'
    const progressUser = username ?? 'guest'
    if (username) {
      const response = await learningApi.getGuidedProgress(this.course.course.id, this.adminPreview)
      this.serverProgress = response.progress
      this.revision = response.revision
    } else {
      this.serverProgress = emptyProgress(this.course, progressUser)
      this.revision = 0
    }
    this.progressKey = `${PROGRESS_PREFIX}${encodeURIComponent(progressUser)}__${encodeURIComponent(this.course.course.id)}`
    const preferences = this.serverProgress.preferences as Record<string, unknown> | undefined
    return {
      guidedCoursePackage: this.course,
      guidedProgressKey: this.progressKey,
      storage: {
        [this.progressKey]: JSON.stringify(this.serverProgress),
        [LANGUAGE_KEY]: String(preferences?.languageMode ?? 'zh'),
        [DEFAULT_MODE_KEY]: String(preferences?.defaultMode ?? 'learning'),
      },
    }
  }

  async onMessage(
    message: NewLegacyMessage,
    username: string | null,
  ): Promise<Record<string, unknown> | void> {
    if (!username || !this.course || !this.serverProgress || message.type !== 'state:changed') return
    this.queue = this.queue.then(() => this.reconcile(message))
    return this.queue
  }

  private async reconcile(message: NewLegacyMessage): Promise<Record<string, unknown>> {
    if (!this.course || !this.serverProgress) return {}
    if (this.adminPreview) return this.resultPayload()
    const storage = message.payload.storage
    if (!storage || typeof storage !== 'object' || Array.isArray(storage)) return this.resultPayload()
    const values = storage as Record<string, unknown>
    const key = typeof message.payload.key === 'string' ? message.payload.key : ''
    const next = parseObject(values[this.progressKey])
    const courseId = this.course.course.id

    if (key === LANGUAGE_KEY || key === DEFAULT_MODE_KEY) {
      const response = await learningApi.saveGuidedProgress(courseId, {
        revision: this.revision,
        preferences: {
          languageMode: String(values[LANGUAGE_KEY] ?? 'zh'),
          defaultMode: String(values[DEFAULT_MODE_KEY] ?? 'learning'),
        },
      })
      this.serverProgress = response.progress
      this.revision = response.revision
      return this.resultPayload()
    }
    if (!next || key !== this.progressKey) return this.resultPayload()

    const serverNodes = nodeEntries(this.serverProgress)
    const nextNodes = nodeEntries(next)
    const serverCompleted = Object.values(serverNodes).filter((entry) => entry.status === 'completed').length
    const nextCompleted = Object.values(nextNodes).filter((entry) => entry.status === 'completed').length
    if (nextCompleted < serverCompleted) {
      const response = await learningApi.resetGuidedProgress(courseId)
      this.serverProgress = response.progress
      this.revision = response.revision
      return this.resultPayload()
    }

    const nextPlacements = placementEntries(next)
    const serverPlacements = placementEntries(this.serverProgress)
    const changedPlacement = Object.entries(nextPlacements).find(([partId, record]) => {
      const latest = record.latest as Record<string, unknown> | undefined
      const previous = serverPlacements[partId]?.latest as Record<string, unknown> | undefined
      return latest && Number(latest.completedAt ?? 0) !== Number(previous?.completedAt ?? 0)
    })
    if (changedPlacement) {
      const [partId, record] = changedPlacement
      const latest = record.latest as Record<string, unknown>
      const response = await learningApi.submitPlacementAttempt(courseId, partId, latest)
      this.serverProgress = response.progress
      this.revision = response.revision
      return this.resultPayload()
    }

    for (const node of this.course.course.nodes) {
      const nodeId = String(node.id)
      if (serverNodes[nodeId]?.status === 'completed' || nextNodes[nodeId]?.status !== 'completed') continue
      const response = await learningApi.completeGuidedNode(courseId, nodeId, {
        metrics: nextNodes[nodeId]?.metrics ?? null,
      })
      this.serverProgress = response.progress
      this.revision = response.revision
    }
    return this.resultPayload()
  }

  private resultPayload(): Record<string, unknown> {
    return {
      progress: this.serverProgress,
      progressKey: this.progressKey,
      revision: this.revision,
      adminPreview: this.adminPreview,
    }
  }
}

export const guidedLearningFrameAdapter = new GuidedLearningFrameAdapter()
