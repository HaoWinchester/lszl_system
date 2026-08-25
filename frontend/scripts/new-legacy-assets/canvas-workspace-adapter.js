'use strict'

;(function (global) {
  const store = global.KGCanvasWorkspaceStore
  if (!store) return

  const endpoint = '/api/v1/workspaces'
  const remoteIds = new Map()
  const inFlight = new Map()
  const pending = new Map()
  const timers = new Map()
  let hydrating = true
  let leaving = false

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

  function stableHash(value) {
    let hash = 2166136261
    for (const character of String(value || 'guest')) {
      hash ^= character.charCodeAt(0)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36)
  }

  function requestedRemoteId(workspace) {
    const id = String(workspace?.id || '')
    if (id !== 'pmp-pattern-workspace') return id
    const username = String(global.__KG_DIRECT_BOOTSTRAP__?.username || global.KGAuthCore?.currentUsername?.() || 'guest')
    return `${id}-${stableHash(username)}`
  }

  function bodyFor(workspace, remoteId) {
    return {
      id: String(remoteId || workspace.id),
      title: String(workspace.title || '未命名画布'),
      schemaVersion: Number(workspace.schemaVersion || 10),
      payload: workspace,
    }
  }

  async function persistWorkspace(workspace, options = {}) {
    const id = String(workspace?.id || '')
    if (!id) return null
    const remoteId = remoteIds.get(id) || requestedRemoteId(workspace)
    const body = bodyFor(workspace, remoteId)
    if (remoteIds.has(id)) {
      return request('PUT', `/${encodeURIComponent(remoteId)}`, body, options)
    }
    try {
      const payload = await request('POST', '', body, options)
      remoteIds.set(id, String(payload?.workspace?.id || remoteId))
      return payload
    } catch (error) {
      if (error.status !== 400 || !/工作区 ID 已存在/.test(String(error.message || ''))) throw error
      const payload = await request('PUT', `/${encodeURIComponent(remoteId)}`, body, options)
      remoteIds.set(id, remoteId)
      return payload
    }
  }

  async function flushOne(id, options = {}) {
    clearTimeout(timers.get(id))
    timers.delete(id)
    const workspace = pending.get(id)
    pending.delete(id)
    if (!workspace) return null
    const previous = inFlight.get(id) || Promise.resolve()
    const operation = previous.catch(() => null).then(() => persistWorkspace(workspace, options))
    inFlight.set(id, operation)
    try {
      return await operation
    } catch (error) {
      pending.set(id, workspace)
      if (!options.silent && !leaving) console.error('[CanvasWorkspaceAdapter] save failed:', error)
      return null
    } finally {
      if (inFlight.get(id) === operation) inFlight.delete(id)
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
    const activeWrite = inFlight.get(id)
    if (activeWrite) await activeWrite.catch(() => null)
    const remoteId = remoteIds.get(id)
    if (!remoteId) return
    try {
      await request('DELETE', `/${encodeURIComponent(remoteId)}`)
      remoteIds.delete(id)
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
      const clientWorkspaces = workspaces.map(item => {
        const remoteId = String(item?.id || '')
        const clientId = String(item?.payload?.id || remoteId)
        if (clientId && remoteId) remoteIds.set(clientId, remoteId)
        return { ...item, id: clientId }
      })
      if (clientWorkspaces.length) {
        store.replaceAllFromServer?.(clientWorkspaces)
      } else {
        localBefore.forEach(workspace => enqueue(workspace, true))
      }
      return clientWorkspaces
    } catch (error) {
      if (error.status !== 401) console.error('[CanvasWorkspaceAdapter] hydrate failed:', error)
      return []
    } finally {
      hydrating = false
    }
  }

  const ready = hydrate()
  async function flush(options = {}) {
    const queuedWrites = [...pending.keys()].map(id => flushOne(id, options))
    await Promise.all(queuedWrites)
    return Promise.all([...inFlight.values()].map(write => write.catch(() => null)))
  }
  // Browsers may cancel a keepalive write while the document is being discarded.
  // The canonical store has already retained the pending workspace locally, so an
  // unload cancellation is expected recovery state rather than a console error.
  global.addEventListener?.('pagehide', () => {
    leaving = true
    void flush({ keepalive: true, silent: true })
    unsubscribe?.()
  })
  global.addEventListener?.('pageshow', () => { leaving = false })
  global.KGCanvasWorkspaceAdapter = Object.freeze({ ready, flush, refresh: hydrate })
})(window)
