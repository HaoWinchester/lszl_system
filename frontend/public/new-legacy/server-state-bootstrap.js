'use strict'

;(function (global) {
  const params = new URLSearchParams(global.location.search || '')
  const token = params.get('frameToken') || ''
  const page = global.location.pathname.split('/').pop() || ''
  let entry = null

  try {
    const registry = global.parent?.__KG_NEW_LEGACY_BOOTSTRAP__
    const candidate = token && registry ? registry[token] : null
    if (candidate && candidate.page === page) {
      entry = candidate
      delete registry[token]
    }
  } catch (error) {
    entry = null
  }

  try {
    const authUser = entry?.state?.authUser
    if (entry?.username && authUser && typeof authUser === 'object') {
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

  const initial = entry?.state?.storage
  const values = new Map()
  if (initial && typeof initial === 'object' && !Array.isArray(initial)) {
    Object.entries(initial).forEach(([key, value]) => values.set(String(key), String(value)))
  }

  let pending = false
  let lastMutation = { operation: 'bootstrap', key: '', value: null }

  function snapshot() {
    return Object.fromEntries(values.entries())
  }

  function emit(operation, key, value) {
    lastMutation = { operation, key: String(key || ''), value: value == null ? null : String(value) }
    if (pending) return
    pending = true
    queueMicrotask(() => {
      pending = false
      try {
        global.parent.postMessage({
          channel: 'kg:new-legacy',
          version: 1,
          page,
          type: 'state:changed',
          payload: { ...lastMutation, storage: snapshot() },
        }, global.location.origin)
      } catch (error) {
        // React 宿主不可用时只保留当前页面内存，不回退到浏览器持久化。
      }
    })
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
      values.clear()
      emit('clear', '', null)
    },
    key(index) {
      return Array.from(values.keys())[Number(index)] ?? null
    },
  }
  Object.defineProperty(storage, 'length', { enumerable: true, get: () => values.size })
  global.KGServerStateStorage = storage
  global.KGServerStateBootstrap = Object.freeze({ page, username: entry?.username || null, state: entry?.state || {} })
})(window)
