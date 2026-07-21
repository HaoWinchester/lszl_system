import type { NewLegacyPage } from './newLegacyBridge'

export interface FrameBootstrapEntry {
  page: NewLegacyPage
  username: string | null
  state: Record<string, unknown>
  createdAt: number
}

declare global {
  interface Window {
    __KG_NEW_LEGACY_BOOTSTRAP__?: Record<string, FrameBootstrapEntry>
  }
}

function registry(): Record<string, FrameBootstrapEntry> {
  if (!window.__KG_NEW_LEGACY_BOOTSTRAP__) window.__KG_NEW_LEGACY_BOOTSTRAP__ = {}
  return window.__KG_NEW_LEGACY_BOOTSTRAP__
}

export function registerFrameBootstrap(
  page: NewLegacyPage,
  username: string | null,
  state: Record<string, unknown>,
): string {
  const token = globalThis.crypto.randomUUID()
  registry()[token] = { page, username, state, createdAt: Date.now() }
  return token
}

export function consumeFrameBootstrap(
  token: string,
  expectedPage: NewLegacyPage,
): FrameBootstrapEntry | null {
  const entries = registry()
  const entry = entries[token]
  if (!entry || entry.page !== expectedPage) return null
  delete entries[token]
  return entry
}

export function clearFrameBootstraps(): void {
  window.__KG_NEW_LEGACY_BOOTSTRAP__ = {}
}
