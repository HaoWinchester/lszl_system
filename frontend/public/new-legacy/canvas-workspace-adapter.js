'use strict'

;(function (global) {
  const store = global.KGCanvasWorkspaceStore
  if (!store) return

  const endpoint = '/api/v1/workspaces'
  const remoteIds = new Map()
  const payloadIds = new Map()
  const inFlight = new Map()
  const pending = new Map()
  const timers = new Map()
  const states = new Map()
  const sequences = new Map()
  function getState(id) { return { ...(states.get(String(id || '')) || { status: 'idle', error: '' }) } }
  function setState(id, status, error = '') {
    states.set(id, { status, error: String(error?.message || error || '') })
    global.dispatchEvent?.(new CustomEvent('kg-workspace-save-state', { detail: { workspaceId: id, ...getState(id) } }))
  }
  let serverReady = false
  let hydrating = true
  let hydrationEdited = false
  let leaving = false
  let generation = 0
  let owner = store.currentUserId?.() || 'guest'
  function canWrite() {
    const role = global.KGRolePermissions?.currentRole?.() || global.KGAuthCore?.currentUser?.()?.role
    return owner !== 'guest' && ['admin', 'teacher', 'student'].includes(role)
  }
  const controllers = new Set()
  function assertOwner(expectedOwner, expectedGeneration) {
    if (owner !== expectedOwner || generation !== expectedGeneration || (store.currentUserId?.() || 'guest') !== expectedOwner) {
      const error = new Error('账号已变更，旧画布请求已取消。')
      error.code = 'WORKSPACE_OWNER_CHANGED'
      throw error
    }
  }

  async function request(method, path = '', body, options = {}) {
    const requestOwner = owner, requestGeneration = generation
    assertOwner(requestOwner, requestGeneration)
    const controller = global.AbortController ? new global.AbortController() : null
    if (controller) controllers.add(controller)
    try {
      const response = await fetch(endpoint + path, {
        method,
        credentials: 'include',
        headers: body === undefined ? { Accept: 'application/json' } : {
          Accept: 'application/json', 'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        keepalive: options.keepalive === true,
        ...(controller ? { signal: controller.signal } : {}),
      })
      let payload = {}
      try { payload = await response.json() } catch (_) {}
      assertOwner(requestOwner, requestGeneration)
      if (!response.ok) {
        const error = new Error(String(payload?.detail || `工作区请求失败（${response.status}）`))
        error.status = response.status
        throw error
      }
      return payload
    } finally {
      if (controller) controllers.delete(controller)
    }
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
    const username = owner
    return `${id}-${stableHash(username)}`
  }

  function bodyFor(workspace, remoteId) {
    return {
      id: String(remoteId || workspace.id),
      title: String(workspace.title || '未命名画布'),
      schemaVersion: Number(workspace.schemaVersion || 10),
      // Client identity is the relational row ID. Retain the original payload
      // ID only as evidence for links created before rows became canonical.
      payload: { ...workspace, id: payloadIds.get(String(workspace.id)) || workspace.id },
    }
  }

  function resolveWorkspaceId(id, workspaces) {
    id = String(id || '')
    if (!id) return ''
    // The default ID was shared by historical guest/user rows. Prefer this
    // owner's established row before considering the bare default as an alias.
    if (id === 'pmp-pattern-workspace') {
      const ownDefault = requestedRemoteId({ id })
      if (workspaces.some(item => String(item?.id || '') === ownDefault)) return ownDefault
    }
    if (workspaces.some(item => String(item?.id || '') === id)) return id
    const aliases = workspaces
      .filter(item => String(item?.payload?.id || '') === id)
      .map(item => String(item?.id || ''))
      .filter(Boolean)
      .sort()
    return aliases[0] || ''
  }

  async function persistWorkspace(workspace, options = {}) {
    if (!canWrite()) throw new Error('当前账号仅可查看画布。')
    const id = String(workspace?.id || '')
    if (!id) return null
    if (!serverReady) throw new Error('服务器画布尚未加载，已阻止保存设备缓存，请重新打开后重试。')
    assertOwner(owner, generation)
    if (String(workspace.userId || '') !== owner) throw new Error('当前账号不能保存其他用户的画布。')
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
      // An unmapped ID can be an alias of a populated server canvas. Never
      // turn a failed create into a blind overwrite; refresh must hydrate it.
      throw new Error('工作区 ID 已存在，请刷新后重新打开，当前内容未覆盖服务器画布。')
    }
  }

  async function flushOne(id, options = {}) {
    clearTimeout(timers.get(id))
    timers.delete(id)
    const workspace = pending.get(id)
    pending.delete(id)
    if (!workspace) return null
    const sequence = sequences.get(id), writeGeneration = generation
    setState(id, 'saving')
    const previous = inFlight.get(id) || Promise.resolve()
    const operation = previous.catch(() => null).then(() => persistWorkspace(workspace, options))
    inFlight.set(id, operation)
    try {
      const result = await operation
      if (writeGeneration === generation && sequences.get(id) === sequence) setState(id, 'saved')
      return result
    } catch (error) {
      if (writeGeneration === generation && sequences.get(id) === sequence) {
        pending.set(id, workspace)
        setState(id, 'failed', error)
      }
      if (!options.silent && !leaving) console.error('[CanvasWorkspaceAdapter] save failed:', error)
      return null
    } finally {
      if (inFlight.get(id) === operation) inFlight.delete(id)
    }
  }

  function enqueue(workspace, immediate = false) {
    if (!canWrite()) return
    const id = String(workspace?.id || '')
    if (!id || String(workspace.userId || '') !== owner || (store.currentUserId?.() || 'guest') !== owner) return
    sequences.set(id, (sequences.get(id) || 0) + 1)
    pending.set(id, JSON.parse(JSON.stringify(workspace)))
    setState(id, 'pending')
    clearTimeout(timers.get(id))
    if (hydrating) return
    if (immediate) void flushOne(id)
    else timers.set(id, setTimeout(() => void flushOne(id), 350))
  }

  async function remove(id) {
    if (!canWrite()) return
    id = String(id || '')
    if (!id) return
    const removeOwner = owner, removeGeneration = generation
    clearTimeout(timers.get(id))
    timers.delete(id)
    pending.delete(id)
    sequences.set(id, (sequences.get(id) || 0) + 1)
    states.delete(id)
    const activeWrite = inFlight.get(id)
    if (activeWrite) await activeWrite.catch(() => null)
    try {
      assertOwner(removeOwner, removeGeneration)
      const remoteId = remoteIds.get(id)
      if (!remoteId) return
      await request('DELETE', `/${encodeURIComponent(remoteId)}`)
      assertOwner(removeOwner, removeGeneration)
      remoteIds.delete(id)
      payloadIds.delete(id)
    } catch (error) {
      if (error.code !== 'WORKSPACE_OWNER_CHANGED') console.error('[CanvasWorkspaceAdapter] delete failed:', error)
    }
  }

  store.subscribe?.((event) => {
    if (!canWrite()) return
    if (event?.reason === 'server-hydrated') return
    if (hydrating) hydrationEdited = true
    const deletedId = String(event?.detail?.deletedWorkspaceId || '')
    if (deletedId) void remove(deletedId)
    if (event?.workspace) enqueue(event.workspace, event.reason === 'workspace-created')
  })

  async function hydrate() {
    if (pending.size || inFlight.size) throw new Error('请先保存当前画布，再刷新服务器数据。')
    const hydrateGeneration = generation
    hydrating = true
    hydrationEdited = false
    try {
      const payload = await request('GET')
      const workspaces = Array.isArray(payload?.workspaces) ? payload.workspaces : []
      if (hydrationEdited) {
        const error = new Error('加载期间产生了本地修改，已保留修改，请先保存后再刷新。')
        error.code = 'WORKSPACE_EDIT_DURING_HYDRATE'
        throw error
      }
      // Preserve distinct rows even when old payloads share one logical ID.
      // Legacy links and cached active IDs resolve before ensure() can create
      // an empty alias; ordering by update time must never select another row.
      const url = global.location?.href ? new URL(global.location.href) : null
      const requestedId = url?.searchParams.get('workspace')
      const linkedId = resolveWorkspaceId(requestedId, workspaces)
      const activeId = linkedId || resolveWorkspaceId(store.getActiveWorkspaceId?.(), workspaces)
      if (linkedId && linkedId !== requestedId) {
        url.searchParams.set('workspace', linkedId)
        global.history?.replaceState?.(global.history.state, '', url.href)
      }
      remoteIds.clear()
      payloadIds.clear()
      const clientWorkspaces = workspaces.map(item => {
        const remoteId = String(item?.id || '')
        if (remoteId) {
          remoteIds.set(remoteId, remoteId)
          payloadIds.set(remoteId, String(item?.payload?.id || remoteId))
        }
        return { ...item, id: remoteId }
      })
      store.replaceAllFromServer?.(clientWorkspaces, { activeWorkspaceId: activeId })
      serverReady = true
      return clientWorkspaces
    } catch (error) {
      if (error.code === 'WORKSPACE_EDIT_DURING_HYDRATE') throw error
      if (hydrateGeneration !== generation || error.code === 'WORKSPACE_OWNER_CHANGED') return []
      if (error.status === 401 && owner === 'guest') return []
      console.error('[CanvasWorkspaceAdapter] hydrate failed:', error)
      throw error
    } finally {
      if (hydrateGeneration === generation) {
        hydrating = false
        for (const id of pending.keys()) if (!timers.has(id)) timers.set(id, setTimeout(() => void flushOne(id), 350))
      }
    }
  }

  let ready = hydrate()
  ready.catch(() => {})
  function ownerChanged() {
    const nextOwner = store.currentUserId?.() || 'guest'
    if (nextOwner === owner) return
    owner = nextOwner
    serverReady = false
    generation += 1
    for (const controller of controllers) controller.abort()
    controllers.clear()
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear(); pending.clear(); inFlight.clear(); states.clear(); sequences.clear(); remoteIds.clear(); payloadIds.clear()
    ready = hydrate()
    ready.catch(() => {})
  }
  global.addEventListener?.('kg-auth-session-change', ownerChanged)
  global.addEventListener?.('kg:auth-session-changed', ownerChanged)
  async function flush(options = {}) {
    const queuedWrites = [...pending.keys()].map(id => flushOne(id, options))
    await Promise.all(queuedWrites)
    const results = await Promise.all([...inFlight.values()].map(write => write.catch(() => null)))
    if (options.throwOnError && [...states.values()].some(state => state.status === 'failed')) throw new Error('画布尚未保存到服务器，请检查网络后点击保存重试。')
    return results
  }
  // Browsers may cancel a keepalive write while the document is being discarded.
  // Failed writes remain pending in this page; never report them as saved.
  global.addEventListener?.('pagehide', () => {
    leaving = true
    void flush({ keepalive: true, silent: true })
  })
  global.addEventListener?.('pageshow', () => { leaving = false })
  global.KGCanvasWorkspaceAdapter = Object.freeze({ get ready() { return ready }, flush, getState, isReady: () => serverReady, refresh: hydrate })
})(window)
