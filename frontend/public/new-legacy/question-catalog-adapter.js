'use strict'

;(function (global) {
  const API_ROOT = '/api/v1'
  const mode = global.document?.body?.dataset?.questionCatalogMode === 'managed'
    ? 'managed'
    : 'learning'
  const clientInstanceId = global.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const QUESTION_PAGE_SIZE = 200
  let catalog = { banks: [], questions: [], catalogRevision: '', contentRevision: 0 }
  const bankQuestionCache = new Map()
  const bankQuestionLoad = new Map()

  class CatalogRequestError extends Error {
    constructor(message, { status = 0, code = '', detail = null } = {}) {
      super(message)
      this.name = 'CatalogRequestError'
      this.status = status
      this.code = code
      this.detail = detail
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function emit(type, detail) {
    try { global.dispatchEvent(new CustomEvent(type, { detail })) } catch (error) {}
  }

  async function request(path, options = {}) {
    const response = await global.fetch(`${API_ROOT}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    })
    let payload = {}
    try { payload = await response.json() } catch (error) {}
    if (!response.ok) {
      const detail = payload?.detail
      const body = detail && typeof detail === 'object' ? detail : {}
      const message = typeof detail === 'string'
        ? detail
        : String(body.message || payload?.message || `题目目录请求失败 (${response.status})`)
      const error = new CatalogRequestError(message, {
        status: response.status,
        code: String(body.code || payload?.code || ''),
        detail: payload,
      })
      if (response.status === 401) emit('kg:auth-required', { source: 'question-catalog', mode })
      throw error
    }
    return payload
  }

  function normalizedSnapshot(payload) {
    const snapshot = {
      banks: Array.isArray(payload?.banks) ? clone(payload.banks) : [],
      questions: Array.isArray(payload?.questions) ? clone(payload.questions) : [],
      catalogRevision: String(payload?.catalogRevision || ''),
      contentRevision: Number.isSafeInteger(Number(payload?.contentRevision))
        ? Number(payload.contentRevision)
        : 0,
    }
    const lookup = snapshot.questions.reduce((carry, item) => {
      const bankId = String(item?.bankId || '').trim()
      if (!bankId) return carry
      const list = carry.get(bankId) || []
      list.push(item)
      carry.set(bankId, list)
      return carry
    }, new Map())
    for (const [bankId, rows] of lookup.entries()) bankQuestionCache.set(bankId, clone(rows))
    return snapshot
  }

  async function loadBankQuestions(bankId, options = {}) {
    const id = String(bankId || '').trim()
    if (!id) return []
    if (options.forceReload !== true && bankQuestionCache.has(id)) {
      return clone(bankQuestionCache.get(id) || [])
    }
    if (bankQuestionLoad.has(id)) return bankQuestionLoad.get(id)

    const pageSize = Math.max(1, Math.min(200, Number(options.pageSize || QUESTION_PAGE_SIZE)))
    const maxQuestions = Number(options.maxQuestions || 0)
    const task = (async () => {
      const questions = []
      let page = 1
      let total = 0
      do {
        const result = await request(`/question-catalog/banks/${encodeURIComponent(id)}/questions?page=${page}&page_size=${pageSize}`)
        const rows = Array.isArray(result?.questions) ? result.questions : []
        questions.push(...rows)
        total = Number(result?.total || total || questions.length)
        page += 1
      } while (questions.length < total && rows.length > 0 && (maxQuestions <= 0 || questions.length < maxQuestions))
      const finalRows = maxQuestions > 0 ? questions.slice(0, maxQuestions) : questions
      bankQuestionCache.set(id, clone(finalRows))
      return clone(finalRows)
    })().finally(() => {
      bankQuestionLoad.delete(id)
    })
    bankQuestionLoad.set(id, task)
    return task
  }

  async function loadQuestion(questionId) {
    const direct = question(questionId)
    if (direct) return direct
    const payload = await request(`/question-catalog/questions/${encodeURIComponent(String(questionId || ''))}`)
    return payload?.question ? clone(payload.question) : null
  }

  async function reload(options = {}) {
    const query = new URLSearchParams({ mode })
    if (options.includeQuestions === true) query.set('include_questions', 'true')
    if (Number.isFinite(Number(options.questionPageSize))) query.set('page_size', String(Math.max(1, Number(options.questionPageSize))))
    const next = await request(`/question-catalog/bootstrap?${query.toString()}`)
    bankQuestionCache.clear()
    const snapshot = normalizedSnapshot(next)
    if (snapshot.contentRevision < catalog.contentRevision) return clone(catalog)
    catalog = snapshot
    const source = String(options.source || 'manual')
    emit('kg:question-catalog-ready', {
      mode,
      source,
      catalogRevision: catalog.catalogRevision,
      contentRevision: catalog.contentRevision,
    })
    emit('kg:question-catalog-changed', { mode, source, snapshot: clone(catalog) })
    return clone(catalog)
  }

  function snapshot() { return clone(catalog) }
  function banks() { return clone(catalog.banks) }
  function bank(id) { return clone(catalog.banks.find(item => String(item.id) === String(id)) || null) }
  function question(id) {
    const direct = catalog.questions.find(item => String(item.id) === String(id))
    if (direct) return clone(direct)
    for (const rows of bankQuestionCache.values()) {
      const found = rows.find(item => String(item.id) === String(id))
      if (found) return clone(found)
    }
    return null
  }

  function publishCommit(payload, detail = {}) {
    const revision = payload?.contentRevision
    if (!Number.isSafeInteger(revision) || revision < 0) return
    global.KGTeachingContentSync?.publish?.({
      revision,
      source: 'question-catalog',
      mode,
      ...detail,
    })
  }

  async function refreshAfterCommit(payload) {
    const revision = payload?.contentRevision
    try {
      await reload({ source: 'local-commit' })
    } catch (error) {}
    if (Number.isSafeInteger(revision) && revision > catalog.contentRevision) {
      reloadRemoteRevision({ revision, source: 'local-commit-retry' })
    }
  }

  async function saveBank(input) {
    const existing = input?.id && catalog.banks.some(item => String(item.id) === String(input.id))
    const payload = await request(
      existing ? `/banks/${encodeURIComponent(input.id)}` : '/banks',
      { method: existing ? 'PUT' : 'POST', body: JSON.stringify(input || {}) },
    )
    publishCommit(payload, { entityType: 'bank', entityId: payload.bank?.id || input?.id || '' })
    await refreshAfterCommit(payload)
    return clone(payload.bank || null)
  }

  async function importBanks(input) {
    const payload = await request('/banks/import', {
      method: 'POST',
      body: JSON.stringify({
        banks: Array.isArray(input?.banks) ? input.banks : [],
        confirmReplace: input?.confirmReplace === true,
        confirmDuplicateCleanup: input?.confirmDuplicateCleanup === true,
      }),
    })
    publishCommit(payload, {
      entityType: 'question-import',
      entityId: payload.banks?.at(-1)?.id || '',
      action: 'created',
    })
    await refreshAfterCommit(payload)
    return clone(payload)
  }

  async function deleteBank(bankId) {
    const payload = await request(`/banks/${encodeURIComponent(bankId)}`, { method: 'DELETE' })
    publishCommit(payload, { entityType: 'bank', entityId: bankId, action: 'deleted' })
    await refreshAfterCommit(payload)
    return Boolean(payload.ok)
  }

  async function saveQuestion(input, options = {}) {
    const questionId = String(input?.id || '')
    const existing = Number(options.baseRevision || input?.revision || 0) > 0
    let payload
    if (existing) {
      payload = await request(`/content-prep/questions/${encodeURIComponent(questionId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          idempotencyKey: options.idempotencyKey || `question-${clientInstanceId}-${questionId}-${Date.now()}`,
          clientInstanceId: options.clientInstanceId || clientInstanceId,
          creatorId: options.creatorId,
          prepVersion: options.prepVersion || 'new-legacy',
          workspaceVersion: options.workspaceVersion || '1',
          question: input,
          baseRevision: Number(options.baseRevision || input.revision),
          lockToken: options.lockToken,
          principles: options.principles || {},
          synthesisPresets: options.synthesisPresets || {},
          tagConfig: options.tagConfig || {},
        }),
      })
    } else {
      const bankId = String(options.bankId || input?.bankId || '')
      payload = await request(`/banks/${encodeURIComponent(bankId)}/questions`, {
        method: 'POST',
        body: JSON.stringify(input || {}),
      })
    }
    publishCommit(payload, { entityType: 'question', entityId: payload.question?.id || questionId })
    await refreshAfterCommit(payload)
    return clone(payload.question || null)
  }

  async function importQuestions(bankId, questions, options = {}) {
    const payload = await request(`/banks/${encodeURIComponent(bankId)}/questions/import`, {
      method: 'POST',
      body: JSON.stringify({
        questions: Array.isArray(questions) ? questions : [],
        confirmDuplicateCleanup: options.confirmDuplicateCleanup === true,
      }),
    })
    publishCommit(payload, { entityType: 'question-import', entityId: bankId, action: 'created' })
    await refreshAfterCommit(payload)
    return clone(payload)
  }

  async function deleteQuestion(questionId) {
    const payload = await request(`/questions/${encodeURIComponent(questionId)}`, { method: 'DELETE' })
    publishCommit(payload, { entityType: 'question', entityId: questionId, action: 'deleted' })
    await refreshAfterCommit(payload)
    return Boolean(payload.ok)
  }

  function acquireQuestionLock(questionId, options = {}) {
    return request(`/content-prep/locks/${encodeURIComponent(questionId)}`, {
      method: 'POST',
      body: JSON.stringify({
        clientInstanceId: options.clientInstanceId || clientInstanceId,
        creatorId: options.creatorId || null,
      }),
    })
  }

  function heartbeatQuestionLock(questionId, options = {}) {
    return request(`/content-prep/locks/${encodeURIComponent(questionId)}/heartbeat`, {
      method: 'PUT',
      body: JSON.stringify({
        clientInstanceId: options.clientInstanceId || clientInstanceId,
        lockToken: options.lockToken || '',
      }),
    })
  }

  function releaseQuestionLock(questionId, options = {}) {
    return request(`/content-prep/locks/${encodeURIComponent(questionId)}`, {
      method: 'DELETE',
      keepalive: Boolean(options.keepalive),
      body: JSON.stringify({
        clientInstanceId: options.clientInstanceId || clientInstanceId,
        lockToken: options.lockToken || '',
      }),
    })
  }

  const ready = reload({ source: 'bootstrap', includeQuestions: mode === 'managed' })
  ready.catch(() => {})
  let remoteReloadTarget = 0
  let remoteReloadPromise = null
  let remoteRetryTimer = 0
  let remoteRetryDelay = 250
  let remoteRetryStopped = false
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
    if (!Number.isSafeInteger(remoteRevision) || remoteRevision <= catalog.contentRevision) return
    global.clearTimeout(remoteRetryTimer)
    remoteRetryTimer = 0
    remoteReloadTarget = Math.max(remoteReloadTarget, remoteRevision)
    if (!remoteReloadPromise) {
      remoteReloadPromise = ready.catch(() => {}).then(async () => {
        let failures = 0
        while (!remoteRetryStopped && remoteReloadTarget > catalog.contentRevision) {
          const previousRevision = catalog.contentRevision
          try {
            await reload({ source: 'remote' })
            if (remoteRetryStopped) return
            failures = 0
          } catch (error) {
            failures += 1
            if (failures > 2) throw error
            await new Promise(resolve => global.setTimeout(resolve, failures * 80))
            continue
          }
          if (catalog.contentRevision <= previousRevision) break
        }
        if (remoteReloadTarget <= catalog.contentRevision) remoteRetryDelay = 250
        else scheduleRemoteRetry()
      }).catch(() => {
        scheduleRemoteRetry()
      }).finally(() => {
        remoteReloadPromise = null
      })
    }
    return remoteReloadPromise
  }
  const unsubscribe = global.KGTeachingContentSync?.subscribe?.(reloadRemoteRevision)
  global.addEventListener?.('pagehide', () => {
    remoteRetryStopped = true
    global.clearTimeout(remoteRetryTimer)
    unsubscribe?.()
  })
  global.KGQuestionCatalogAdapter = Object.freeze({
    ready,
    mode,
    clientInstanceId,
    snapshot,
    banks,
    bank,
    question,
    reload,
    saveBank,
    importBanks,
    importQuestions,
    deleteBank,
    saveQuestion,
    deleteQuestion,
    acquireQuestionLock,
    heartbeatQuestionLock,
    releaseQuestionLock,
  })
})(window)
