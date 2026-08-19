'use strict'

;(function (global) {
  const browserLocalStorage = global.localStorage
  const browserOnlyKeys = new Set([
    'prep.lastDraftId',
    '__kg_admin_repository_probe__',
    '__kg_teaching_content_sync_v1__',
    'kg_remote_auth_session_v1',  // 认证会话必须写入真实 localStorage
  ])
  const path = global.location.pathname.split('/').pop() || 'learning-path.html'
  const namespaces = {
    'index.html': 'files',
    'learning-path.html': 'guided-learning',
    'question-training.html': 'training',
    'question-workspace.html': 'workspace',
    'question-bank.html': 'questions',
    'knowledge-recall.html': 'recall',
    'file-manager.html': 'files',
    'user-management.html': 'users',
    'system-settings.html': 'system',
    'admin-console.html': 'admin',
  }
  const page = path
  const namespace = namespaces[page] || 'page'
  const stateQuery = new URLSearchParams({
    mode: 'bootstrap',
    page,
  })
  // 优先消费 FastAPI 内联注入的会话元数据（__KG_DIRECT_BOOTSTRAP__），
  // 保证 revision/contentRevision 与页面渲染同一快照；无注入时回退本地推导。
  const injected = global.__KG_DIRECT_BOOTSTRAP__
  const entry = {
    page,
    namespace,
    revision: 0,
    contentRevision: 0,
    authenticated: false,
    readOnly: false,
    authUser: null,
    username: null,
    ...(injected && typeof injected === 'object' ? {
      page: String(injected.page || page),
      namespace: String(injected.namespace || namespace),
      revision: Number(injected.revision || 0),
      contentRevision: Number.isSafeInteger(Number(injected.contentRevision))
        ? Number(injected.contentRevision)
        : 0,
      authenticated: injected.authenticated === true,
      readOnly: injected.readOnly === true,
      authUser: injected.authUser || null,
      username: injected.username || null,
    } : {}),
  }
  let revision = Number(entry.revision || 0)
  let contentRevision = Number.isSafeInteger(Number(entry.contentRevision))
    ? Number(entry.contentRevision)
    : 0
  function currentSession() {
    try {
      const cached = global.localStorage?.getItem('kg_remote_auth_session_v1')
      if (!cached) return null
      const parsed = JSON.parse(cached)
      if (parsed && typeof parsed === 'object' && parsed.user && parsed.user.username) return parsed.user
      return null
    } catch (_error) {
      return null
    }
  }

  function sessionUser() {
    const user = currentSession()
    if (!user) return null
    return { user }
  }

  async function preloadSessionFromServer() {
    try {
      const response = await fetch('/api/v1/auth/me', { method: 'GET', credentials: 'include' })
      if (!response.ok) return null
      const me = await response.json()
      if (me && me.user && typeof me.user === 'object') return me
    } catch (_error) {
      // 会话同步失败时，保留本地缓存（如存在）避免首次渲染阻塞
    }
    return null
  }

  async function hydrateEntryFromSession() {
    const serverInjected = entry.authenticated === true && entry.authUser != null
    const cached = sessionUser()
    if (!serverInjected && cached?.user) {
      entry.authenticated = true
      entry.authUser = cached.user
      entry.username = cached.user.username || ''
      entry.revision = Number(cached.revision || 0) || 0
      entry.contentRevision = Number.isSafeInteger(Number(cached.contentRevision))
        ? Number(cached.contentRevision)
        : 0
      revision = entry.revision
      contentRevision = entry.contentRevision
    }
    const me = await preloadSessionFromServer()
    if (me?.user) {
      entry.authenticated = true
      entry.authUser = me.user
      entry.username = me.user.username || ''
      // 服务端注入的 revision 与页面渲染同一快照，必须保留；
      // 仅在无注入（如 content-prep 缓存路径）时才回退为 0 等待 bootstrap 拉取。
      if (!serverInjected) {
        entry.revision = 0
        entry.contentRevision = 0
        revision = entry.revision
        contentRevision = entry.contentRevision
      }
      try {
        global.localStorage?.setItem(
          'kg_remote_auth_session_v1',
          JSON.stringify({ user: me.user, token: '', loginSessionId: me.loginSessionId || '', issuedAt: Date.now() }),
        )
      } catch (_error) {}
      global.dispatchEvent(new CustomEvent('kg-auth-session-change', {
        detail: { username: me.user.username, provider: 'remote' }
      }))
    } else if (!serverInjected && cached?.user == null) {
      entry.authenticated = false
      entry.authUser = null
      entry.username = ''
      try {
        global.localStorage?.removeItem('kg_remote_auth_session_v1')
      } catch (_error) {}
    }
  }

  const values = new Map()

  // 提前暴露临时 bootstrap 对象，避免其他脚本访问 undefined
  global.KGServerStateBootstrap = Object.freeze({ ...entry, page, namespace })

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
  const nonPersistableKeys = new Set()
  let lastMutation = { operation: 'bootstrap', key: '', value: null }

  function snapshot(source = values) {
    return Object.fromEntries(source.entries())
  }

  function requestId() {
    return global.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }

  function isPersistableKey(key) {
    return !nonPersistableKeys.has(key)
  }

  function storageForPayload(batch = pendingMutations, source = values) {
    const mutationKeys = new Set(
      mutationsForPayload(batch)
        .filter((mutation) => mutation.operation === 'setItem')
        .map((mutation) => mutation.key),
    )
    return Object.fromEntries(
      Array.from(source.entries())
        .filter(([key]) => isPersistableKey(key) && mutationKeys.has(key)),
    )
  }

  function mutationsForPayload(source = pendingMutations) {
    return Array.from(source.values()).filter((mutation) => isPersistableKey(mutation.key))
  }

  async function extractRejectedKey(response) {
    if (!response?.text) return null
    try {
      const raw = await response.text()
      if (!raw) return null
      let detail = raw
      try {
        const parsed = JSON.parse(raw)
        if (typeof parsed === 'string') detail = parsed
        else if (parsed && typeof parsed.detail === 'string') detail = parsed.detail
      } catch (_error) {
        detail = raw
      }
      const match = String(detail).match(/\u5b58\u50a8\u952e\u672a\u767b\u8bb0[:\uff1a\:]\s*([^\s]+)/)
      return match ? match[1] : null
    } catch (_error) {
      return null
    }
  }

  function saveEvent(status, detail) {
    try {
      global.dispatchEvent(new CustomEvent('kg:save-state', { detail: { status, ...detail } }))
    } catch (error) {
      // 旧浏览器不支持 CustomEvent 时不影响业务提交。
    }
  }

  function payload(batch = pendingMutations, storage = values) {
    const mutations = mutationsForPayload(batch)
    if (!mutations.length) return null
    const latestMutation = mutations.at(-1) || lastMutation
    return {
      page,
      namespace,
      ...latestMutation,
      storage: storageForPayload(batch, storage),
      snapshotMode: 'merge',
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
    const latest = await fetch(`/api/v1/runtime/state?${stateQuery.toString()}`, {
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

  const PUBLISHED_PAPER_KEYS = new Set([
    'kg_exam_papers_published_v1',
    'kg_exam_paper_release_history_v1',
    'kg_synthesis_preset_repository_v1',
  ])

  async function reloadServerState({ announce = false } = {}) {
    const serverValues = await fetchServerSnapshot()
    if (!serverValues) throw staleSnapshotError()
    const prevPublishedPapers = values.get('kg_exam_papers_published_v1')
    values.clear()
    for (const [key, value] of serverValues) values.set(key, value)
    applyPendingMutations()
    dirty = pendingMutations.size > 0
    // 如果已发布试卷数据有变化，通知 KGRecallQuestionSource 等依赖方失效缓存
    if (prevPublishedPapers !== values.get('kg_exam_papers_published_v1')) {
      try {
        for (const key of PUBLISHED_PAPER_KEYS) {
          if (serverValues.has(key)) {
            global.dispatchEvent(new CustomEvent('kg-app-storage-change', {
              detail: { key, value: values.get(key) ?? null },
            }))
          }
        }
      } catch (error) {}
    }
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
      const outgoing = payload(part, candidate)
      if (!outgoing) {
        discardBatch(part)
        return
      }
      const response = await fetch('/api/v1/runtime/state', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(outgoing),
      })
      const rejectedKey =
        response.status === 403 || response.status === 422
          ? await extractRejectedKey(response)
          : null
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
        if (rejectedKey) {
          nonPersistableKeys.add(rejectedKey)
          const invalidMutation = part.get(rejectedKey)
          if (invalidMutation) {
            part.delete(rejectedKey)
            discardBatch(new Map([[rejectedKey, invalidMutation]]))
            if (part.size === 0) return
            return submitPart(part, conflictAttempt)
          }
          return submitPart(part, conflictAttempt)
        }
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
    if (!outgoing) {
      dirty = pendingMutations.size > 0
      return 'saved'
    }
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
      const rejectedKey =
        response.status === 403 || response.status === 422
          ? await extractRejectedKey(response)
          : null
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
        if (rejectedKey) {
          nonPersistableKeys.add(rejectedKey)
          const invalidMutation = batch.get(rejectedKey)
          if (invalidMutation) {
            const onlyInvalid = new Map([[rejectedKey, invalidMutation]])
            batch.delete(rejectedKey)
            discardBatch(onlyInvalid)
            if (batch.size === 0) {
              dirty = pendingMutations.size > 0
              return 'saved'
            }
          }
        }
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
      if (browserOnlyKeys.has(normalized)) {
        try { return browserLocalStorage?.getItem(normalized) ?? null } catch (_error) { return null }
      }
      return values.has(normalized) ? values.get(normalized) : null
    },
    setItem(key, value) {
      const normalized = String(key)
      const stringValue = String(value)
      if (browserOnlyKeys.has(normalized)) {
        try { browserLocalStorage?.setItem(normalized, stringValue) } catch (_error) {}
        return
      }
      values.set(normalized, stringValue)
      emit('setItem', normalized, stringValue)
    },
    removeItem(key) {
      const normalized = String(key)
      if (browserOnlyKeys.has(normalized)) {
        try { browserLocalStorage?.removeItem(normalized) } catch (_error) {}
        return
      }
      values.delete(normalized)
      emit('removeItem', normalized, null)
    },
    clear() {
      const keys = Array.from(values.keys())
      values.clear()
      keys.forEach((key) => emit('removeItem', key, null))
      for (const key of browserOnlyKeys) {
        try { browserLocalStorage?.removeItem(key) } catch (_error) {}
      }
    },
    key(index) {
      const keys = Array.from(values.keys())
      for (const key of browserOnlyKeys) {
        try {
          if (browserLocalStorage?.getItem(key) != null) keys.push(key)
        } catch (_error) {}
      }
      return keys[Number(index)] ?? null
    },
  }
  Object.defineProperty(storage, 'length', {
    enumerable: true,
    get: () => {
      let total = values.size
      for (const key of browserOnlyKeys) {
        try { if (browserLocalStorage?.getItem(key) != null) total += 1 } catch (_error) {}
      }
      return total
    },
  })
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
    const outgoing = payload()
    if (!outgoing) return
    const blob = new Blob([JSON.stringify(outgoing)], { type: 'application/json' })
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

  // 暴露原生浏览器 localStorage，供其他模块（如 auth-core）使用
  global.__nativeLocalStorage__ = browserLocalStorage

  // 异步初始化用户会话，完成后更新 bootstrap 对象并通知页面
  ;(async () => {
    await hydrateEntryFromSession().catch(() => {
      entry.authenticated = false
      entry.authUser = null
      entry.username = ''
    })
    global.KGServerStateBootstrap = Object.freeze({ ...entry, page, namespace })
    global.dispatchEvent(new CustomEvent('kg:bootstrap-ready', {
      detail: { authenticated: entry.authenticated, username: entry.username }
    }))
    if (entry.authenticated && !entry.readOnly) {
      global.setTimeout(() => {
        reloadServerState({ announce: true }).catch(() => {})
      }, 120)
    }
  })()
})(window)
