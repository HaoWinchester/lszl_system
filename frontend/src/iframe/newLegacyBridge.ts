export const NEW_LEGACY_CHANNEL = 'kg:new-legacy' as const
export const NEW_LEGACY_VERSION = 1 as const

export type NewLegacyPage =
  | 'learning-path.html'
  | 'workbench.html'
  | 'question-training.html'
  | 'question-workspace.html'
  | 'guided-learning-node.html'
  | 'guided-learning-placement-test.html'

export type NewLegacyMessageType =
  | 'ready'
  | 'navigation'
  | 'logout'
  | 'state:changed'
  | 'save:pending'
  | 'save:success'
  | 'save:error'

export interface NewLegacyMessage<TPayload = Record<string, unknown>> {
  channel: typeof NEW_LEGACY_CHANNEL
  version: typeof NEW_LEGACY_VERSION
  requestId?: string
  page: NewLegacyPage
  type: NewLegacyMessageType
  payload: TPayload
}

export interface NewLegacyFrameAdapter {
  load: (username: string | null, role?: string | null) => Promise<Record<string, unknown>>
  onMessage: (
    message: NewLegacyMessage,
    username: string | null,
    role?: string | null,
  ) => Promise<Record<string, unknown> | void>
}

const ALLOWED_MESSAGE_TYPES = new Set<NewLegacyMessageType>([
  'ready',
  'navigation',
  'logout',
  'state:changed',
  'save:pending',
  'save:success',
  'save:error',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseNewLegacyMessage(
  event: MessageEvent,
  expectedPage: NewLegacyPage,
): NewLegacyMessage | null {
  if (event.origin !== window.location.origin) return null
  if (!isRecord(event.data)) return null
  const data = event.data
  if (data.channel !== NEW_LEGACY_CHANNEL) return null
  if (data.version !== NEW_LEGACY_VERSION) return null
  if (data.page !== expectedPage) return null
  if (typeof data.type !== 'string' || !ALLOWED_MESSAGE_TYPES.has(data.type as NewLegacyMessageType)) return null
  if (data.requestId !== undefined && typeof data.requestId !== 'string') return null
  if (data.payload !== undefined && !isRecord(data.payload)) return null
  return {
    channel: NEW_LEGACY_CHANNEL,
    version: NEW_LEGACY_VERSION,
    requestId: data.requestId as string | undefined,
    page: expectedPage,
    type: data.type as NewLegacyMessageType,
    payload: (data.payload as Record<string, unknown> | undefined) ?? {},
  }
}

export function postNewLegacyMessage<TPayload extends Record<string, unknown>>(
  target: Window,
  message: Omit<NewLegacyMessage<TPayload>, 'channel' | 'version'>,
): void {
  target.postMessage({
    ...message,
    channel: NEW_LEGACY_CHANNEL,
    version: NEW_LEGACY_VERSION,
  }, window.location.origin)
}

export function newBridgeRequestId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
