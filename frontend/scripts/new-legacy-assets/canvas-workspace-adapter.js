'use strict'

;(function (global) {
  const store = global.KGCanvasWorkspaceStore
  if (!store) return

  const endpoint = '/api/v1/workspaces'
  const knownIds = new Set()
  const pending = new Map()
  const timers = new Map()
  let hydrating = true

  async function request(method, path = '', body, options = {}) {
    const response = await fetch(endpoint + path, {
      method,
      credentials: 'include',
      headers: body === undefined ? { Accept: 'application/json' } : {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive: options.keepalive === true,
    })
    let payload = {}
    try { payload = await response.json() } catch (_) {}
    if (!response.ok) {
      const error = new Error(String(payload?.detail || `工作区请求失败（${response.status}）`))
      error.status = response.status
      throw error
    }
    return payload
  }

  function bodyFor(workspace) {
    return {
      id: String(workspace.id),
      title: String(workspace.title || '未命名画布'),
      schemaVersion: Number(workspace.schemaVersion || 10),
      payload: workspace,
    }
  }

  async function persistWorkspace(workspace, options = {}) {
    const id = String(workspace?.id || '')
    if (!id) return null
    const body = bodyFor(workspace)
    if (knownIds.has(id)) {
      return request('PUT', `/${encodeURIComponent(id)}`, body, options)
    }
    try {
      const payload = await request('POST', '', body, options)
      knownIds.add(id)
      return payload
    } catch (error) {
      if (error.status !== 400) throw error
      const payload = await request('PUT', `/${encodeURIComponent(id)}`, body, options)
      knownIds.add(id)
      return payload
    }
  }

  async function flushOne(id, options = {}) {
    clearTimeout(timers.get(id))
    timers.delete(id)
    const workspace = pending.get(id)
    pending.delete(id)
    if (!workspace) return null
    try {
      return await persistWorkspace(workspace, options)
    } catch (error) {
      pending.set(id, workspace)
      console.error('[CanvasWorkspaceAdapter] save failed:', error)
      return null
    }
  }

  function enqueue(workspace, immediate = false) {
    const id = String(workspace?.id || '')
    if (!id) return
    pending.set(id, JSON.parse(JSON.stringify(workspace)))
    clearTimeout(timers.get(id))
    if (immediate) void flushOne(id)
    else timers.set(id, setTimeout(() => void flushOne(id), 350))
  }

  async function remove(id) {
    id = String(id || '')
    if (!id) return
    clearTimeout(timers.get(id))
    timers.delete(id)
    pending.delete(id)
    if (!knownIds.has(id)) return
    try {
      await request('DELETE', `/${encodeURIComponent(id)}`)
      knownIds.delete(id)
    } catch (error) {
      console.error('[CanvasWorkspaceAdapter] delete failed:', error)
    }
  }

  const unsubscribe = store.subscribe?.((event) => {
    if (hydrating) return
    const deletedId = String(event?.detail?.deletedWorkspaceId || '')
    if (deletedId) void remove(deletedId)
    if (event?.workspace) enqueue(event.workspace, event.reason === 'workspace-created')
  })

  async function hydrate() {
    const localBefore = store.listWorkspaces?.() || []
    try {
      const payload = await request('GET')
      const workspaces = Array.isArray(payload?.workspaces) ? payload.workspaces : []
      workspaces.forEach(item => knownIds.add(String(item.id || '')))
      if (workspaces.length) {
        store.replaceAllFromServer?.(workspaces)
      } else {
        localBefore.forEach(workspace => enqueue(workspace, true))
      }
      return workspaces
    } catch (error) {
      if (error.status !== 401) console.error('[CanvasWorkspaceAdapter] hydrate failed:', error)
      return []
    } finally {
      hydrating = false
    }
  }

  const ready = hydrate()
  async function flush(options = {}) {
    return Promise.all([...pending.keys()].map(id => flushOne(id, options)))
  }
  global.addEventListener?.('pagehide', () => { void flush({ keepalive: true }); unsubscribe?.() })
  global.KGCanvasWorkspaceAdapter = Object.freeze({ ready, flush, refresh: hydrate })
})(window)
