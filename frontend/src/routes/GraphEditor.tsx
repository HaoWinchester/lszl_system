import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { filesApi } from '../api/files'
import { useAuth } from '../store/auth'
import { parseBridgeMessage, postToIframe, type BridgeUser, type IframeToParent } from '../iframe/graphBridge'
import { pmpSampleGraph } from './pmpSample'

const WORKBENCH = '/new-legacy/workbench.html'

type CurrentUser = { username: string; display_name?: string | null; role?: string | null; subject?: string | null }

function toBridgeUser(u: CurrentUser | null | undefined): BridgeUser | null {
  if (!u) return null
  return {
    username: u.username,
    display_name: u.display_name || undefined,
    role: u.role || undefined,
    subject: u.subject || undefined,
  }
}

/**
 * 图谱编辑器：iframe 承载 legacy 原版引擎（public/legacy/workbench.html），
 * 通过 postMessage + bridge.js 把持久化/认证/导航桥接到后端与 React 路由。
 * 这样连线、缩放手感、大图模式等全部原版功能与原版完全一致（见 CLAUDE.md 硬约束）。
 */
export default function GraphEditor() {
  const navigate = useNavigate()
  const me = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const ioRef = useRef<HTMLIFrameElement | null>(null)

  // iframe src 带 user query：bridge.js 同步读取，保证 legacy 30-auth-guards 加载时即识别为"已登录"
  const src = me
    ? `${WORKBENCH}?mode=free&u=${encodeURIComponent(me.username)}&d=${encodeURIComponent(me.display_name || me.username)}&r=${encodeURIComponent(me.role)}&s=${encodeURIComponent(me.subject || 'PMP')}`
    : `${WORKBENCH}?mode=free`

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = parseBridgeMessage(e)
      if (!msg) return
      void handle(msg)
    }

    const handle = async (msg: IframeToParent) => {
      const win = ioRef.current?.contentWindow
      switch (msg.type) {
        case 'kg:ready': {
          if (win) postToIframe(win, { type: 'kg:hello', user: toBridgeUser(me) })
          if (me) {
            await loadCurrentFile(win)
          } else if (win) {
            postToIframe(win, {
              type: 'kg:load',
              meta: { id: 'guest-preview', name: 'PMP知识点关系图谱', ownerId: 'guest' },
              graphData: pmpSampleGraph(),
            })
          }
          break
        }
        case 'kg:save': {
          if (!me) {
            if (win) postToIframe(win, { type: 'kg:save-result', requestId: msg.requestId || '', error: '登录后才能保存图谱' })
            break
          }
          try {
            const meta = await filesApi.save(msg.id, msg.graphData)
            if (win) postToIframe(win, { type: 'kg:save-result', requestId: msg.requestId || '', meta })
          } catch (err) {
            console.error('[GraphEditor] 保存失败', err)
            if (win) postToIframe(win, { type: 'kg:save-result', requestId: msg.requestId || '', error: err instanceof Error ? err.message : '保存失败' })
          }
          break
        }
        case 'kg:rename': {
          if (!me) break
          try {
            const meta = await filesApi.rename(msg.id, msg.name)
            if (win) postToIframe(win, { type: 'kg:meta-update', meta })
          } catch (err) {
            console.error('[GraphEditor] 重命名失败', err)
          }
          break
        }
        case 'kg:switch-file': {
          if (!me) break
          await openFileInto(win, msg.id)
          break
        }
        case 'kg:create-file': {
          if (!me) break
          try {
            const created = await filesApi.create({ name: msg.name || '新图谱', graphData: pmpSampleGraph() })
            await filesApi.setCurrent(created.id)
            const opened = await filesApi.open(created.id)
            if (win) postToIframe(win, { type: 'kg:load', meta: opened.meta, graphData: opened.graphData, learningState: opened.learningState })
          } catch (err) {
            console.error('[GraphEditor] 新建文件失败', err)
          }
          break
        }
        case 'kg:navigate': {
          navigate(msg.to)
          break
        }
        case 'kg:logout': {
          logout()
          navigate('/login')
          break
        }
        case 'kg:loaded':
        case 'kg:dirty':
          break
      }
    }

    const loadCurrentFile = async (win: Window | null | undefined) => {
      if (!win) return
      try {
        let id = await filesApi.current()
        if (!id) {
          const created = await filesApi.create({ name: 'PMP知识点关系图谱', graphData: pmpSampleGraph() })
          id = created.id
          await filesApi.setCurrent(id)
        }
        await openFileInto(win, id)
      } catch (err) {
        console.error('[GraphEditor] 加载当前文件失败', err)
      }
    }

    const openFileInto = async (win: Window | null | undefined, id: string) => {
      if (!win) return
      const opened = await filesApi.open(id)
      await filesApi.setCurrent(id)
      postToIframe(win, { type: 'kg:load', meta: opened.meta, graphData: opened.graphData, learningState: opened.learningState })
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [me, navigate, logout])

  return (
    <iframe
      ref={ioRef}
      src={src}
      title="知识图谱编辑器"
      allow="fullscreen"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0, display: 'block' }}
    />
  )
}
