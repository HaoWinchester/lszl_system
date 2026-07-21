'use strict'

;(function (global) {
  const entry = global.__KG_DIRECT_BOOTSTRAP__ || {}
  const page = entry.page || global.location.pathname.split('/').pop() || 'learning-path.html'
  const namespace = entry.namespace || 'page'
  let revision = Number(entry.revision || 0)

  try {
    const authUser = entry.authUser
    if (entry.username && authUser && typeof authUser === 'object') {
      global.sessionStorage.setItem('kg_remote_auth_session_v1', JSON.stringify({
        user: {
          ...authUser,
          username: entry.username,
          displayName: authUser.display_name || authUser.displayName || entry.username,
        },
        issuedAt: Date.now(),
      }))
    } else {
      global.sessionStorage.removeItem('kg_remote_auth_session_v1')
    }
  } catch (error) {
    // sessionStorage 不可用时，远程认证仍可通过登录接口恢复。
  }

  const initial = entry.storage
  const values = new Map()
  if (initial && typeof initial === 'object' && !Array.isArray(initial)) {
    Object.entries(initial).forEach(([key, value]) => values.set(String(key), String(value)))
  }

  let timer = 0
  let inFlight = false
  let dirty = false
  const pendingMutations = new Map()
  let lastMutation = { operation: 'bootstrap', key: '', value: null }

  function snapshot() {
    return Object.fromEntries(values.entries())
  }

  function requestId() {
    return global.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }

  function saveEvent(status, detail) {
    try {
      global.dispatchEvent(new CustomEvent('kg:save-state', { detail: { status, ...detail } }))
    } catch (error) {
      // 旧浏览器不支持 CustomEvent 时不影响业务提交。
    }
  }

  function payload() {
    return {
      page,
      namespace,
      ...lastMutation,
      storage: snapshot(),
      snapshotMode: 'full',
      requestId: requestId(),
      revision,
    }
  }

  function applyPendingMutations() {
    for (const mutation of pendingMutations.values()) {
      if (mutation.operation === 'setItem') values.set(mutation.key, String(mutation.value ?? ''))
      if (mutation.operation === 'removeItem') values.delete(mutation.key)
    }
  }

  async function flush() {
    if (!entry.authenticated || entry.readOnly || inFlight || !dirty) return
    const batch = new Map(pendingMutations)
    const outgoing = payload()
    let retryable = true
    inFlight = true
    saveEvent('saving', { page, namespace })
    try {
      const response = await fetch('/api/v1/runtime/state', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(outgoing),
      })
      if (response.status === 409) {
        const latest = await fetch('/api/v1/runtime/state', {
          method: 'GET',
          credentials: 'include',
        })
        if (!latest.ok) throw new Error(`重新加载保存版本失败 (${latest.status})`)
        const serverState = await latest.json()
        values.clear()
        Object.entries(serverState.storage || {}).forEach(([key, value]) => values.set(String(key), String(value)))
        applyPendingMutations()
        revision = Number(serverState.revision || 0)
        dirty = pendingMutations.size > 0
        saveEvent('retrying', { page, namespace, revision })
        return
      }
      if (!response.ok) {
        const error = new Error(`保存失败 (${response.status})`)
        error.retryable = response.status >= 500
        throw error
      }
      const result = await response.json()
      revision = Number(result.revision ?? revision)
      for (const [key, mutation] of batch) {
        if (pendingMutations.get(key) === mutation) pendingMutations.delete(key)
      }
      dirty = pendingMutations.size > 0
      saveEvent('saved', { page, namespace, revision })
    } catch (error) {
      retryable = error?.retryable !== false
      dirty = pendingMutations.size > 0
      saveEvent('error', { page, namespace, message: error instanceof Error ? error.message : '保存失败' })
    } finally {
      inFlight = false
      if (dirty && retryable) timer = global.setTimeout(flush, 800)
    }
  }

  function emit(operation, key, value) {
    lastMutation = { operation, key: String(key || ''), value: value == null ? null : String(value) }
    pendingMutations.delete(lastMutation.key)
    pendingMutations.set(lastMutation.key, lastMutation)
    dirty = true
    if (!entry.authenticated || entry.readOnly) return
    global.clearTimeout(timer)
    timer = global.setTimeout(flush, 120)
  }

  const storage = {
    getItem(key) {
      const normalized = String(key)
      return values.has(normalized) ? values.get(normalized) : null
    },
    setItem(key, value) {
      const normalized = String(key)
      const stringValue = String(value)
      values.set(normalized, stringValue)
      emit('setItem', normalized, stringValue)
    },
    removeItem(key) {
      const normalized = String(key)
      values.delete(normalized)
      emit('removeItem', normalized, null)
    },
    clear() {
      const keys = Array.from(values.keys())
      values.clear()
      keys.forEach((key) => emit('removeItem', key, null))
    },
    key(index) {
      return Array.from(values.keys())[Number(index)] ?? null
    },
  }
  Object.defineProperty(storage, 'length', { enumerable: true, get: () => values.size })

  global.addEventListener('pagehide', () => {
    if (!entry.authenticated || entry.readOnly || !dirty || !global.navigator?.sendBeacon) return
    const blob = new Blob([JSON.stringify(payload())], { type: 'application/json' })
    global.navigator.sendBeacon('/api/v1/runtime/state', blob)
  })

  global.KGServerStateStorage = storage
  global.KGServerStateBootstrap = Object.freeze({ ...entry, page, namespace })
})(window)
