'use strict'

;(function (global) {
  const entry = global.__KG_DIRECT_BOOTSTRAP__ || {}
  const page = entry.page || global.location.pathname.split('/').pop() || 'learning-path.html'
  const namespace = entry.namespace || 'page'
  let revision = Number(entry.revision || 0)
  let contentRevision = Number.isSafeInteger(Number(entry.contentRevision))
    ? Number(entry.contentRevision)
    : 0

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
  let flushPromise = null
  let remoteReloadTarget = 0
  let remoteReloadPromise = null
  let remoteRetryTimer = 0
  let remoteRetryDelay = 250
  let remoteRetryStopped = false
  const pendingMutations = new Map()
  let lastMutation = { operation: 'bootstrap', key: '', value: null }

  function snapshot(source = values) {
    return Object.fromEntries(source.entries())
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

  function payload(batch = pendingMutations, storage = snapshot()) {
    const mutations = Array.from(batch.values())
    const latestMutation = mutations.at(-1) || lastMutation
    return {
      page,
      namespace,
      ...latestMutation,
      storage,
      snapshotMode: 'full',
      mutations,
      requestId: requestId(),
      revision,
      contentRevision,
    }
  }

  function applyPendingMutations() {
    for (const mutation of pendingMutations.values()) {
      if (mutation.operation === 'setItem') values.set(mutation.key, String(mutation.value ?? ''))
      if (mutation.operation === 'removeItem') values.delete(mutation.key)
    }
  }

  function discardBatch(batch) {
    for (const [key, mutation] of batch) {
      if (pendingMutations.get(key) === mutation) pendingMutations.delete(key)
    }
  }

  function splitBatch(batch) {
    const entries = Array.from(batch.entries())
    const middle = Math.max(1, Math.floor(entries.length / 2))
    return [new Map(entries.slice(0, middle)), new Map(entries.slice(middle))]
  }

  function applyMutation(target, mutation) {
    if (mutation.operation === 'setItem') target.set(mutation.key, String(mutation.value ?? ''))
    if (mutation.operation === 'removeItem') target.delete(mutation.key)
  }

  async function fetchServerSnapshot() {
    const latest = await fetch('/api/v1/runtime/state', {
      method: 'GET',
      credentials: 'include',
    })
    if (!latest.ok) throw new Error(`重新加载保存版本失败 (${latest.status})`)
    const serverState = await latest.json()
    const nextRevision = Number(serverState.revision || 0)
    const nextContentRevision = Number(serverState.contentRevision)
    if (nextRevision < revision
      || (Number.isSafeInteger(nextContentRevision) && nextContentRevision < contentRevision)) {
      return null
    }
    revision = nextRevision
    contentRevision = Number.isSafeInteger(nextContentRevision)
      ? nextContentRevision
      : contentRevision
    return new Map(
      Object.entries(serverState.storage || {}).map(([key, value]) => [String(key), String(value)]),
    )
  }

  function staleSnapshotError() {
    const error = new Error('服务器状态快照仍在同步，请稍后重试')
    error.retryable = false
    return error
  }

  function teardownError() {
    const error = new Error('页面已关闭，停止后续保存请求')
    error.retryable = false
    return error
  }

  async function reloadServerState({ announce = false } = {}) {
    const serverValues = await fetchServerSnapshot()
    if (!serverValues) throw staleSnapshotError()
    values.clear()
    for (const [key, value] of serverValues) values.set(key, value)
    applyPendingMutations()
    dirty = pendingMutations.size > 0
    if (announce) {
      try {
        global.dispatchEvent(new CustomEvent('kg:server-state-reloaded', {
          detail: { revision, contentRevision },
        }))
      } catch (error) {}
    }
  }

  function acceptReturnedRevisions(result, { publish = false } = {}) {
    revision = Number(result.revision ?? revision)
    const nextContentRevision = Number(result.contentRevision)
    if (!Number.isSafeInteger(nextContentRevision) || nextContentRevision < 0) return
    const advanced = nextContentRevision > contentRevision
    contentRevision = Math.max(contentRevision, nextContentRevision)
    if (publish && advanced) {
      global.KGTeachingContentSync?.publish?.({
        revision: contentRevision,
        source: 'runtime-state',
        page,
        namespace,
      })
    }
  }

  async function submitIsolatedBatch(batch) {
    let serverValues = await fetchServerSnapshot()
    if (!serverValues) throw staleSnapshotError()
    const rejected = []

    async function submitPart(part, conflictAttempt = 0) {
      if (remoteRetryStopped) throw teardownError()
      const candidate = new Map(serverValues)
      for (const mutation of part.values()) applyMutation(candidate, mutation)
      const response = await fetch('/api/v1/runtime/state', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload(part, snapshot(candidate))),
      })
      if (remoteRetryStopped && !response.ok) throw teardownError()
      if (response.status === 409) {
        if (conflictAttempt >= 1) {
          const error = new Error('教学内容持续变化，请确认最新版本后重试')
          error.retryable = false
          throw error
        }
        serverValues = await fetchServerSnapshot()
        if (!serverValues) throw staleSnapshotError()
        return submitPart(part, conflictAttempt + 1)
      }
      if (response.status === 403 || response.status === 422) {
        if (part.size === 1) {
          rejected.push(part.values().next().value)
          discardBatch(part)
          return
        }
        const [left, right] = splitBatch(part)
        await submitPart(left)
        await submitPart(right)
        return
      }
      if (!response.ok) {
        const error = new Error(`保存失败 (${response.status})`)
        error.retryable = response.status >= 500
        throw error
      }
      const result = await response.json()
      acceptReturnedRevisions(result, { publish: true })
      serverValues = candidate
      discardBatch(part)
    }

    await submitPart(batch)
    if (!remoteRetryStopped) serverValues = await fetchServerSnapshot() || serverValues
    values.clear()
    for (const [key, value] of serverValues) values.set(key, value)
    applyPendingMutations()
    dirty = pendingMutations.size > 0
    return rejected
  }

  async function sendOnce(conflictAttempt = 0) {
    const batch = new Map(pendingMutations)
    const outgoing = payload(batch)
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
      if (remoteRetryStopped && !response.ok) return 'stopped'
      if (response.status === 409) {
        retryable = false
        if (conflictAttempt >= 1) {
          const error = new Error('教学内容持续变化，请确认最新版本后重试')
          error.retryable = false
          throw error
        }
        await reloadServerState()
        saveEvent('retrying', { page, namespace, revision })
        return 'retry'
      }
      if (response.status===403||response.status===422) {
        const rejected = await submitIsolatedBatch(batch)
        if (!rejected.length) {
          saveEvent('saved', { page, namespace, revision })
          return 'saved'
        }
        const error = new Error(`${rejected.length} 项保存被拒绝 (${response.status})`)
        error.retryable = dirty
        throw error
      }
      if (!response.ok) {
        const error = new Error(`保存失败 (${response.status})`)
        error.retryable = response.status >= 500
        throw error
      }
      const result = await response.json()
      acceptReturnedRevisions(result, { publish: true })
      discardBatch(batch)
      dirty = pendingMutations.size > 0
      saveEvent('saved', { page, namespace, revision })
      return 'saved'
    } catch (error) {
      retryable = retryable && error?.retryable !== false
      dirty = pendingMutations.size > 0
      saveEvent('error', { page, namespace, message: error instanceof Error ? error.message : '保存失败' })
      throw error
    } finally {
      inFlight = false
      if (dirty && retryable && !remoteRetryStopped) {
        timer = global.setTimeout(() => { flush().catch(() => {}) }, 800)
      }
    }
  }

  async function flushLoop() {
    let conflictAttempt = 0
    while (dirty && !remoteRetryStopped) {
      const result = await sendOnce(conflictAttempt)
      if (result === 'stopped' || remoteRetryStopped) break
      if (result === 'retry') {
        conflictAttempt += 1
        continue
      }
      conflictAttempt = 0
      if (result !== 'retry' && !dirty) break
    }
    return true
  }

  function flush() {
    if (remoteRetryStopped || !entry.authenticated || entry.readOnly || !dirty) return Promise.resolve(true)
    global.clearTimeout(timer)
    timer = 0
    if (!flushPromise) {
      const precedingRemoteReload = remoteReloadPromise
      flushPromise = (async () => {
        if (precedingRemoteReload) await precedingRemoteReload
        return flushLoop()
      })().finally(() => {
        flushPromise = null
      })
    }
    return flushPromise
  }

  async function refresh() {
    const precedingFlush = flushPromise
    if (precedingFlush) await precedingFlush
    else if (dirty) await flush()
    await reloadServerState()
    return true
  }

  async function claimLearningEntry() {
    const response = await fetch('/api/v1/runtime/learning-entry-claim', {
      method: 'POST',
      credentials: 'include',
    })
    if (!response.ok) throw new Error(`学习入口状态保存失败 (${response.status})`)
    const result = await response.json()
    const key = typeof result.key === 'string' ? result.key : ''
    if (!key) throw new Error('学习入口状态响应无效')
    const value = result.value == null ? null : String(result.value)
    if (value == null) values.delete(key)
    else values.set(key, value)
    const nextRevision = Number(result.revision)
    if (Number.isSafeInteger(nextRevision) && nextRevision >= 0) revision = nextRevision
    return { claimed: result.claimed === true, key, value, revision }
  }

  function emit(operation, key, value) {
    lastMutation = { operation, key: String(key || ''), value: value == null ? null : String(value) }
    pendingMutations.delete(lastMutation.key)
    pendingMutations.set(lastMutation.key, lastMutation)
    dirty = true
    if (remoteRetryStopped || !entry.authenticated || entry.readOnly) return
    if (flushPromise || inFlight) return
    global.clearTimeout(timer)
    timer = global.setTimeout(() => { flush().catch(() => {}) }, 120)
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
  storage.claimLearningEntry = claimLearningEntry
  storage.flush = flush
  storage.refresh = refresh

  Object.defineProperty(global, 'localStorage', {
    configurable: true,
    enumerable: true,
    value: storage,
  })

  function sendLatestBeacon() {
    if (!entry.authenticated || entry.readOnly || !dirty || !global.navigator?.sendBeacon) return
    const blob = new Blob([JSON.stringify(payload())], { type: 'application/json' })
    global.navigator.sendBeacon('/api/v1/runtime/state', blob)
  }

  global.addEventListener('pagehide', () => {
    remoteRetryStopped = true
    global.clearTimeout(timer)
    timer = 0
    global.clearTimeout(remoteRetryTimer)
    global.queueMicrotask(sendLatestBeacon)
  })

  const teachingSync = global.KGTeachingContentSync
  const teachingManager = entry.authenticated
    && ['admin', 'teacher'].includes(String(entry.authUser?.role || ''))
  if (teachingSync && teachingManager) {
    function scheduleRemoteRetry() {
      if (remoteRetryStopped || remoteRetryTimer) return
      const delay = remoteRetryDelay
      remoteRetryDelay = Math.min(remoteRetryDelay * 2, 10000)
      remoteRetryTimer = global.setTimeout(() => {
        remoteRetryTimer = 0
        reloadRemoteRevision({ revision: remoteReloadTarget, source: 'retry' })
      }, delay)
    }
    function reloadRemoteRevision(detail) {
      if (remoteRetryStopped) return
      const remoteRevision = Number(detail?.revision)
      if (!Number.isSafeInteger(remoteRevision) || remoteRevision <= contentRevision) return
      global.clearTimeout(remoteRetryTimer)
      remoteRetryTimer = 0
      remoteReloadTarget = Math.max(remoteReloadTarget, remoteRevision)
      if (!remoteReloadPromise) {
        const precedingFlush = flushPromise
        remoteReloadPromise = (async () => {
          if (precedingFlush) await precedingFlush.catch(() => {})
          let failures = 0
          while (!remoteRetryStopped && remoteReloadTarget > contentRevision) {
            const previousRevision = contentRevision
            try {
              await reloadServerState({ announce: true })
              if (remoteRetryStopped) return
              failures = 0
            } catch (error) {
              failures += 1
              if (failures > 2) throw error
              await new Promise(resolve => global.setTimeout(resolve, failures * 80))
              continue
            }
            if (contentRevision <= previousRevision) break
          }
          if (remoteReloadTarget <= contentRevision) remoteRetryDelay = 250
          else scheduleRemoteRetry()
        })().catch(() => {
          scheduleRemoteRetry()
        }).finally(() => {
          remoteReloadPromise = null
        })
      }
      return remoteReloadPromise
    }
    teachingSync.subscribe(reloadRemoteRevision)
    teachingSync.startPolling({
      intervalMs: 10000,
      async getRevision() {
        const response = await global.fetch('/api/v1/question-catalog/revision', {
          method: 'GET',
          credentials: 'include',
        })
        if (!response.ok) throw new Error(`教学内容版本请求失败 (${response.status})`)
        return response.json()
      },
    })
  }

  global.KGServerStateStorage = storage
  global.KGServerStateBootstrap = Object.freeze({ ...entry, page, namespace })
})(window)
