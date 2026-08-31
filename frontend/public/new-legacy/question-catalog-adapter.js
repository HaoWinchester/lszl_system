'use strict'

;(function (global) {
  const API_ROOT = '/api/v1'
  const DomainApi = global.KGDomainApi
  const mode = global.document?.body?.dataset?.questionCatalogMode === 'managed'
    ? 'managed'
    : 'learning'
  const summaryOnly = global.document?.body?.dataset?.paperManagementPage === 'true'
  const clientInstanceId = global.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const QUESTION_PAGE_SIZE = 200
  let catalog = { banks: [], questions: [], catalogRevision: '', contentRevision: 0 }
  const bankQuestionCache = new Map()
  const bankQuestionLoad = new Map()
  const bankQuestionPageCache = new Map()
  const bankQuestionPageLoad = new Map()
  const questionCache = new Map()
  const questionLoad = new Map()

  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function emit(type, detail) {
    try { global.dispatchEvent(new CustomEvent(type, { detail })) } catch (error) {}
  }

  async function request(path, options = {}) {
    if (!DomainApi?.request) throw new Error('题目目录 API 未加载，请刷新页面后重试。')
    let body = options.body
    if (typeof body === 'string') body = JSON.parse(body)
    try {
      return await DomainApi.request({
        method: options.method || 'GET',
        path: `${API_ROOT}${path}`,
        body,
      })
    } catch (error) {
      if (error?.status === 401) emit('kg:auth-required', { source: 'question-catalog', mode })
      throw error
    }
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
    for (const item of snapshot.questions) questionCache.set(String(item.id), clone(item))
    return snapshot
  }

  function invalidateQuestionCache() {
    bankQuestionCache.clear()
    bankQuestionLoad.clear()
    bankQuestionPageCache.clear()
    bankQuestionPageLoad.clear()
    questionCache.clear()
    questionLoad.clear()
  }

  async function loadBankQuestionPage(bankId, options = {}) {
    const id = String(bankId || '').trim()
    if (!id) return { questions: [], total: 0, page: 1, pageSize: 20 }
    const page = Math.max(1, Math.trunc(Number(options.page || 1)))
    const pageSize = Math.max(1, Math.min(200, Math.trunc(Number(options.pageSize || 20))))
    const search = String(options.search || '').trim()
    const questionType = String(options.questionType || '').trim()
    const cacheKey = JSON.stringify([catalog.contentRevision, id, page, pageSize, search, questionType])
    if (options.forceReload !== true && bankQuestionPageCache.has(cacheKey)) {
      return clone(bankQuestionPageCache.get(cacheKey))
    }
    if (bankQuestionPageLoad.has(cacheKey)) return clone(await bankQuestionPageLoad.get(cacheKey))

    const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
    if (search) query.set('search', search)
    if (questionType) query.set('question_type', questionType)
    const task = request(`/question-catalog/banks/${encodeURIComponent(id)}/questions?${query.toString()}`)
      .then(payload => {
        const result = {
          questions: Array.isArray(payload?.questions) ? clone(payload.questions) : [],
          total: Math.max(0, Number(payload?.total || 0)),
          page: Math.max(1, Number(payload?.page || page)),
          pageSize: Math.max(1, Number(payload?.pageSize || pageSize)),
        }
        for (const item of result.questions) questionCache.set(String(item.id), clone(item))
        bankQuestionPageCache.set(cacheKey, clone(result))
        return result
      })
      .finally(() => bankQuestionPageLoad.delete(cacheKey))
    bankQuestionPageLoad.set(cacheKey, task)
    return clone(await task)
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
      for (const item of finalRows) questionCache.set(String(item.id), clone(item))
      return clone(finalRows)
    })().finally(() => {
      bankQuestionLoad.delete(id)
    })
    bankQuestionLoad.set(id, task)
    return task
  }

  async function loadQuestion(questionId, options = {}) {
    const id = String(questionId || '').trim()
    if (!id) return null
    const direct = options.forceReload === true ? null : question(id)
    if (direct) return direct
    if (questionLoad.has(id)) return clone(await questionLoad.get(id))
    const task = request(`/question-catalog/questions/${encodeURIComponent(id)}`)
      .then(payload => {
        const loaded = payload?.question ? clone(payload.question) : null
        if (loaded) questionCache.set(id, clone(loaded))
        return loaded
      })
      .finally(() => questionLoad.delete(id))
    questionLoad.set(id, task)
    return clone(await task)
  }

  async function reload(options = {}) {
    const query = new URLSearchParams({ mode })
    if (options.includeQuestions === true) query.set('include_questions', 'true')
    if (Number.isFinite(Number(options.questionPageSize))) query.set('page_size', String(Math.max(1, Number(options.questionPageSize))))
    const next = await request(`/question-catalog/bootstrap?${query.toString()}`)
    invalidateQuestionCache()
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
    const cached = questionCache.get(String(id))
    if (cached) return clone(cached)
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
      // 题库管理页仍依赖全量题目；试卷管理页通过分页接口按需加载。
      await reload({ source: 'local-commit', includeQuestions: mode === 'managed' && !summaryOnly })
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

  async function clearBankTestRecords(bankId) {
    return clone(await request(`/banks/${encodeURIComponent(bankId)}/test-learning-records/clear`, { method: 'POST' }))
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

  const ready = reload({ source: 'bootstrap', includeQuestions: mode === 'managed' && !summaryOnly })
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
            await reload({ source: 'remote', includeQuestions: mode === 'managed' && !summaryOnly })
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
    loadBankQuestions,
    loadBankQuestionPage,
    loadQuestion,
    invalidateQuestionCache,
    reload,
    saveBank,
    importBanks,
    importQuestions,
    deleteBank,
    clearBankTestRecords,
    saveQuestion,
    deleteQuestion,
    acquireQuestionLock,
    heartbeatQuestionLock,
    releaseQuestionLock,
  })
})(window)
