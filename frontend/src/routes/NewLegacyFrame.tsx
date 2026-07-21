import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import {
  newBridgeRequestId,
  parseNewLegacyMessage,
  postNewLegacyMessage,
  type NewLegacyFrameAdapter,
  type NewLegacyPage,
} from '../iframe/newLegacyBridge'
import { clearFrameBootstraps, registerFrameBootstrap } from '../iframe/frameBootstrap'
import { useAuth } from '../store/auth'

interface Props {
  adapter?: NewLegacyFrameAdapter
  page: NewLegacyPage
  src: string
  title: string
}

async function saveWithRetry(
  adapter: NewLegacyFrameAdapter,
  message: Parameters<NewLegacyFrameAdapter['onMessage']>[0],
  username: string | null,
  role: string | null,
): Promise<Record<string, unknown> | void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await adapter.onMessage(message, username, role)
    } catch (error) {
      lastError = error
      if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 180))
    }
  }
  throw lastError
}

export default function NewLegacyFrame({ adapter, page, src, title }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const initialized = useAuth((state) => state.initialized)
  const init = useAuth((state) => state.init)
  const logout = useAuth((state) => state.logout)
  const user = useAuth((state) => state.user)
  const [failed, setFailed] = useState(false)
  const [frameToken, setFrameToken] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!initialized) void init()
  }, [init, initialized])

  useEffect(() => {
    if (!initialized) return
    let cancelled = false
    setFrameToken(null)
    clearFrameBootstraps()
    const username = user?.username ?? null
    void (async () => {
      try {
        const state = adapter ? await adapter.load(username, user?.role ?? null) : { storage: {} }
        if (cancelled) return
        setFrameToken(registerFrameBootstrap(page, username, { ...state, authUser: user }))
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      clearFrameBootstraps()
    }
  }, [adapter, initialized, page, reloadKey, user])

  const source = useMemo(() => {
    if (!frameToken) return ''
    const url = new URL(src, window.location.origin)
    new URLSearchParams(location.search).forEach((value, key) => url.searchParams.set(key, value))
    url.searchParams.set('frameToken', frameToken)
    return `${url.pathname}${url.search}${url.hash}`
  }, [frameToken, location.search, src])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      const message = parseNewLegacyMessage(event, page)
      if (!message) return
      if (message.type === 'navigation') {
        const to = message.payload.to
        if (typeof to === 'string' && to.startsWith('/')) navigate(to)
      } else if (message.type === 'logout') {
        void logout().finally(() => navigate('/login'))
      } else if (message.type === 'state:changed' && adapter) {
        const requestId = message.requestId ?? newBridgeRequestId()
        void saveWithRetry(adapter, message, user?.username ?? null, user?.role ?? null).then((result) => {
          if (!frameRef.current?.contentWindow) return
          postNewLegacyMessage(frameRef.current.contentWindow, {
            requestId,
            page,
            type: 'save:success',
            payload: result ?? {},
          })
        }).catch((error: unknown) => {
          if (!frameRef.current?.contentWindow) return
          postNewLegacyMessage(frameRef.current.contentWindow, {
            requestId,
            page,
            type: 'save:error',
            payload: { message: error instanceof Error ? error.message : '保存失败' },
          })
        })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [adapter, logout, navigate, page, user?.role, user?.username])

  if (failed) {
    return (
      <main className="new-legacy-load-error" role="alert">
        <h1>{title}加载失败</h1>
        <p>页面资源或服务器数据没有正确加载，请重试。</p>
        <button type="button" onClick={() => { setFailed(false); setReloadKey((value) => value + 1) }}>重新加载</button>
      </main>
    )
  }

  if (!source) return <main className="new-legacy-loading" aria-label={`${title}加载中`} />

  return (
    <iframe
      ref={frameRef}
      key={`${reloadKey}:${frameToken}`}
      src={source}
      title={title}
      allow="fullscreen"
      onError={() => setFailed(true)}
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0, display: 'block' }}
    />
  )
}
