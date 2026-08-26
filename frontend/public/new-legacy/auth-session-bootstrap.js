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
    if (!user?.username) return anonymousSnapshot()
    return {
      authenticated: true,
      user,
      loginSessionId: String(payload?.loginSessionId || ''),
    }
  }

  function request(requestGeneration) {
    const operation = global.fetch('/api/v1/auth/me', {
      method: 'GET',
      credentials: 'include',
    })
      .then(async (response) => {
        if (response.status === 401) return anonymousSnapshot()
        if (!response.ok) throw new Error('会话查询失败')
        return normalize(await response.json().catch(() => ({})))
      })
      .catch(() => anonymousSnapshot())
      .then((next) => {
        if (requestGeneration === generation) snapshot = next
        return next
      })
      .finally(() => {
        if (inFlight?.promise === operation) inFlight = null
      })
    inFlight = { generation: requestGeneration, promise: operation }
    return operation
  }

  function load() {
    if (snapshot) return Promise.resolve(snapshot)
    if (inFlight?.generation === generation) return inFlight.promise
    return request(generation)
  }

  function invalidate() {
    generation += 1
    snapshot = null
    inFlight = null
  }

  function refresh() {
    if (inFlight?.generation === generation) return inFlight.promise
    if (snapshot) invalidate()
    return request(generation)
  }

  function peek() {
    return snapshot
  }

  global.KGAuthSessionBootstrap = Object.freeze({ load, refresh, peek, invalidate })
})(window)
