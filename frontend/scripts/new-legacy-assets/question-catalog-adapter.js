'use strict'

;(function (global) {
  const API_ROOT = '/api/v1'
  const mode = global.document?.body?.dataset?.questionCatalogMode === 'managed'
    ? 'managed'
    : 'learning'
  const clientInstanceId = global.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  let catalog = { banks: [], questions: [], catalogRevision: '' }

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
    return {
      banks: Array.isArray(payload?.banks) ? clone(payload.banks) : [],
      questions: Array.isArray(payload?.questions) ? clone(payload.questions) : [],
      catalogRevision: String(payload?.catalogRevision || ''),
    }
  }

  async function reload() {
    const next = normalizedSnapshot(await request(`/question-catalog/bootstrap?mode=${mode}`))
    catalog = next
    emit('kg:question-catalog-ready', { mode, catalogRevision: catalog.catalogRevision })
    emit('kg:question-catalog-changed', { mode, snapshot: clone(catalog) })
    return clone(catalog)
  }

  function snapshot() { return clone(catalog) }
  function banks() { return clone(catalog.banks) }
  function bank(id) { return clone(catalog.banks.find(item => String(item.id) === String(id)) || null) }
  function question(id) { return clone(catalog.questions.find(item => String(item.id) === String(id)) || null) }

  async function saveBank(input) {
    const existing = input?.id && catalog.banks.some(item => String(item.id) === String(input.id))
    const payload = await request(
      existing ? `/banks/${encodeURIComponent(input.id)}` : '/banks',
      { method: existing ? 'PUT' : 'POST', body: JSON.stringify(input || {}) },
    )
    await reload()
    return clone(payload.bank || null)
  }

  async function deleteBank(bankId) {
    const payload = await request(`/banks/${encodeURIComponent(bankId)}`, { method: 'DELETE' })
    await reload()
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
    await reload()
    return clone(payload.question || null)
  }

  async function deleteQuestion(questionId) {
    const payload = await request(`/questions/${encodeURIComponent(questionId)}`, { method: 'DELETE' })
    await reload()
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

  const ready = reload()
  ready.catch(() => {})
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
    deleteBank,
    saveQuestion,
    deleteQuestion,
    acquireQuestionLock,
    heartbeatQuestionLock,
    releaseQuestionLock,
  })
})(window)
