// GraphEditor iframe ↔ legacy 引擎 的 postMessage 协议类型与收发工具。
// 与 frontend/scripts/legacy-assets/bridge.js 的消息类型一一对应。

/** iframe→parent 消息 */
export type IframeToParent =
  | { type: 'kg:ready' }
  | { type: 'kg:loaded'; id?: string }
  | { type: 'kg:save'; requestId?: string; id: string; graphData: unknown; name?: string }
  | { type: 'kg:rename'; requestId?: string; id: string; name: string }
  | { type: 'kg:switch-file'; requestId?: string; id: string }
  | { type: 'kg:create-file'; requestId?: string; name?: string }
  | { type: 'kg:navigate'; to: string }
  | { type: 'kg:logout' }
  | { type: 'kg:dirty'; dirty: boolean }

/** parent→iframe 消息 */
export type ParentToIframe =
  | { type: 'kg:hello'; user: BridgeUser | null }
  | { type: 'kg:load'; meta: unknown; graphData: unknown; learningState?: unknown }
  | { type: 'kg:save-result'; requestId: string; meta?: unknown; error?: string }
  | { type: 'kg:meta-update'; meta: unknown }
  | { type: 'kg:auth-change'; user: BridgeUser | null }

export interface BridgeUser {
  username: string
  display_name?: string
  displayName?: string
  role?: string
  subject?: string
}

/** 从 window.message 事件中提取并校验本协议消息；非本协议返回 null。 */
export function parseBridgeMessage(e: MessageEvent): IframeToParent | null {
  if (e.origin !== window.location.origin) return null
  const data = e.data as { type?: string; __kgBridge?: unknown } | null
  if (!data || typeof data.type !== 'string' || !data.type.startsWith('kg:') || !data.__kgBridge) return null
  return data as unknown as IframeToParent
}

/** parent 向 iframe 发消息（带 __kgBridge 标记，与 bridge.js 的校验对应）。 */
export function postToIframe(win: Window, msg: ParentToIframe): void {
  win.postMessage({ ...msg, __kgBridge: 1 }, window.location.origin)
}

/** 生成 requestId（用于请求-响应配对）。 */
export function newRequestId(): string {
  const c = globalThis.crypto
  return c?.randomUUID ? c.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)
}
