'use strict'

;(function (global) {
  let generation = 0
  let snapshot = null
  let inFlight = null

  function anonymousSnapshot() {
    return { authenticated: false, user: null, loginSessionId: '' }
  }

  function normalize(payload) {
    const user = payload?.user && typeof payload.user === 'object' ? payload.user : null
    if (!user?.username) throw new Error('会话响应不完整')
    return {
      authenticated: true,
      user,
      loginSessionId: String(payload?.loginSessionId || ''),
    }
  }

  function uncertainSnapshot() {
    return { ...(snapshot || { authenticated: null, user: null, loginSessionId: '' }), uncertain: true }
  }

  function request(requestGeneration) {
    const identity = global.KGAuthRecovery?.capture?.() || null
    let responsePromise
    try {
      responsePromise = global.fetch('/api/v1/auth/me', { method: 'GET', credentials: 'include' })
    } catch (error) {
      responsePromise = Promise.reject(error)
    }
    const operation = Promise.resolve(responsePromise)
      .then(async (response) => {
        if (response.status === 401) {
          if (requestGeneration === generation) {
            global.KGAuthRecovery?.observe?.(response, identity, { source: 'session-bootstrap', path: '/api/v1/auth/me' })
          }
          return anonymousSnapshot()
        }
        if (!response.ok) throw new Error('会话查询失败')
        return normalize(await response.json())
      })
      .catch(() => uncertainSnapshot())
      .then((next) => {
        // Every consumer must receive the current generation, not only peek().
        if (requestGeneration !== generation) return load()
        snapshot = next
        return next
      })
      .finally(() => {
        if (inFlight?.promise === operation) inFlight = null
      })
    inFlight = { generation: requestGeneration, promise: operation }
    return operation
  }

  function load() {
    if (inFlight?.generation === generation) return inFlight.promise
    if (snapshot && !snapshot.uncertain) return Promise.resolve(snapshot)
    return request(generation)
  }

  function invalidate() {
    generation += 1
    snapshot = null
    inFlight = null
  }

  function refresh() {
    if (inFlight?.generation === generation) return inFlight.promise
    generation += 1
    return request(generation)
  }

  function peek() {
    return snapshot
  }

  global.KGAuthSessionBootstrap = Object.freeze({ load, refresh, peek, invalidate })
})(window)
