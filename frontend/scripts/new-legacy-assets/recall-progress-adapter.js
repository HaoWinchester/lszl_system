'use strict'

/*
 * 深度回忆进度的专用数据库适配器。
 *
 * 浏览器只保留当前页的内存镜像；节点、边、视图、分支游标和互动指标以
 * recall_progress 为唯一真值。这样清理浏览器缓存或换设备不会丢失画布。
 */
;(function (global) {
  const API_ROOT = '/api/v1/recall/progress'
  const exploredByBank = new Map()

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value))
  }

  function questionId(question) {
    return String(question?.sourceQuestionId || question?.id || '').trim()
  }

  function hasPersistedQuestion(question) {
    const id = questionId(question)
    return Boolean(id && id !== 'unavailable')
  }

  function bankId(question, fallback = '') {
    return String(question?.sourceBankId || question?.bankId || fallback || '').trim()
  }

  function collectionId(question, fallback = '') {
    return String(question?.sourceCollectionId || fallback || bankId(question)).trim()
  }

  function signedIn() {
    return Boolean(global.KGRolePermissions?.currentUser?.())
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
      const message = typeof payload?.detail === 'string'
        ? payload.detail
        : `深度回忆进度请求失败 (${response.status})`
      const error = new Error(message)
      error.status = response.status
      throw error
    }
    return payload
  }

  async function read(question) {
    const id = questionId(question)
    if (!signedIn() || !hasPersistedQuestion(question)) return null
    try {
      const payload = await request(`/${encodeURIComponent(id)}`)
      return clone(payload.progress || null)
    } catch (error) {
      if (error?.status === 401 || error?.status === 404) return null
      throw error
    }
  }

  async function write(question, payload) {
    const id = questionId(question)
    if (!signedIn() || !hasPersistedQuestion(question)) return false
    const saved = await request(`/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload || {}),
    })
    const targetCollection = collectionId(question)
    if (targetCollection) {
      const ids = exploredByBank.get(targetCollection) || new Set()
      ids.add(id)
      exploredByBank.set(targetCollection, ids)
    }
    return clone(saved.progress || null)
  }

  async function remove(question) {
    const id = questionId(question)
    if (!signedIn() || !hasPersistedQuestion(question)) return false
    const payload = await request(`/${encodeURIComponent(id)}`, { method: 'DELETE' })
    exploredByBank.get(collectionId(question))?.delete(id)
    return Boolean(payload.deleted)
  }

  async function loadExplored(scope, questions = []) {
    const id = String(scope || '').trim()
    const questionIds = Array.isArray(questions)
      ? questions.filter(hasPersistedQuestion).map(questionId).slice(0, 200)
      : []
    if (!signedIn() || !id || !questionIds.length) return new Set()
    try {
      const query = new URLSearchParams()
      questionIds.forEach((questionId) => query.append('question_ids', questionId))
      const payload = await request(`?${query.toString()}`)
      const ids = new Set((Array.isArray(payload.questionIds) ? payload.questionIds : []).map(String))
      exploredByBank.set(id, ids)
      return new Set(ids)
    } catch (error) {
      if (error?.status === 401) return new Set()
      throw error
    }
  }

  function exploredSet(bank) {
    return new Set(exploredByBank.get(String(bank || '').trim()) || [])
  }

  global.KGRecallProgressAdapter = Object.freeze({
    ready: Promise.resolve(),
    read,
    write,
    remove,
    loadExplored,
    exploredSet,
  })
})(window)
