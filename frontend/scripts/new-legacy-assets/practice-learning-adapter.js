'use strict'

;(function (global) {
  const API_ROOT = '/api/v1/learning/practice'
  let overview = { mistakes: [], stats: emptyStats(), plan: null }
  let loading = null

  function text(value) { return String(value == null ? '' : value) }
  function clone(value) { return JSON.parse(JSON.stringify(value)) }
  function emptyStats() {
    return { total: 0, active: 0, pending: 0, needsRemediation: 0, verificationDue: 0, verificationWaiting: 0, mastered: 0 }
  }
  function currentUser() {
    try { return global.KGAuthCore?.currentUser?.() || null } catch (error) { return null }
  }
  function authenticated() { return Boolean(currentUser()) }
  function emit(type, detail) {
    try { global.dispatchEvent(new CustomEvent(type, { detail: clone(detail) })) } catch (error) {}
  }
  async function request(path, options = {}) {
    const response = await global.fetch(`${API_ROOT}${path}`, {
      ...options,
      credentials: 'include',
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
    })
    let payload = {}
    try { payload = await response.json() } catch (error) {}
    if (!response.ok) {
      const error = new Error(text(payload?.detail || `学习记录请求失败 (${response.status})`))
      error.status = response.status
      error.detail = payload
      if (response.status === 401) emit('kg:auth-required', { source: 'practice-learning' })
      throw error
    }
    return payload
  }
  function setOverview(next) {
    overview = {
      mistakes: Array.isArray(next?.mistakes) ? clone(next.mistakes) : [],
      stats: { ...emptyStats(), ...(next?.stats || {}) },
      plan: next?.plan ? clone(next.plan) : null,
    }
    emit('kg-practice-mistakes-change', overview)
    emit('kg-practice-learning-plan-change', overview.plan || {})
    return clone(overview)
  }
  async function refresh() {
    if (!authenticated()) return setOverview({})
    if (loading) return loading
    loading = request('/overview').then(setOverview).finally(() => { loading = null })
    return loading
  }
  function snapshot() { return clone(overview) }
  function list(options = {}) {
    const includeMastered = options.includeMastered !== false
    return overview.mistakes.filter(row => includeMastered || row.status !== 'mastered').map(clone)
  }
  function active() {
    const priority = { needs_remediation: 0, pending: 1, verification_due: 2 }
    const now = Date.now()
    const reviewDue = (row) => {
      if (row.status !== 'verification_due') return true
      const next = Date.parse(text(row.nextReviewAt || ''))
      return Number.isNaN(next) || next <= now
    }
    return overview.mistakes
      .filter(row => ['pending', 'needs_remediation', 'verification_due'].includes(row.status) && reviewDue(row))
      .sort((left, right) => (priority[left.status] ?? 9) - (priority[right.status] ?? 9)
        || Number(right.revengeWrongCount || 0) - Number(left.revengeWrongCount || 0)
        || Number(right.wrongCount || 0) - Number(left.wrongCount || 0))
      .map(clone)
  }
  function stats() { return clone(overview.stats) }
  function plan() { return clone(overview.plan) }
  async function answer(input) {
    const payload = await request('/answers', { method: 'POST', body: JSON.stringify(input || {}) })
    await refresh()
    return { correct: Boolean(payload.correct), mistake: clone(payload.mistake || null), completion: clone(payload.completion || null) }
  }
  async function upsertWrong(input) {
    const payload = await request('/mistakes', { method: 'POST', body: JSON.stringify(input || {}) })
    await refresh()
    return clone(payload.mistake || null)
  }
  async function answerRevenge(mistakeId, input) {
    const payload = await request(`/mistakes/${encodeURIComponent(mistakeId)}/revenge-answer`, { method: 'POST', body: JSON.stringify(input || {}) })
    await refresh()
    return clone(payload.mistake || null)
  }
  async function remediationReviewed(mistakeId) {
    const payload = await request(`/mistakes/${encodeURIComponent(mistakeId)}/remediation-reviewed`, { method: 'POST' })
    await refresh()
    return clone(payload.mistake || null)
  }
  async function verificationCandidate(mistakeId) {
    const payload = await request(`/mistakes/${encodeURIComponent(mistakeId)}/verification-candidate`)
    return clone(payload.candidate || null)
  }
  async function verify(mistakeId, input) {
    const payload = await request(`/mistakes/${encodeURIComponent(mistakeId)}/verification`, { method: 'POST', body: JSON.stringify(input || {}) })
    await refresh()
    return { mistake: clone(payload.mistake || null), verification: clone(payload.verification || null) }
  }
  async function recordSession(session) {
    const payload = await request('/sessions', {
      method: 'POST',
      body: JSON.stringify(session || {}),
    })
    return clone(payload.session || null)
  }
  async function listSessions() {
    if (!authenticated()) return []
    const payload = await request('/sessions')
    return Array.isArray(payload?.sessions) ? clone(payload.sessions) : []
  }
  async function clearSessions() {
    await request('/sessions', { method: 'DELETE' })
  }
  const api = Object.freeze({ refresh, snapshot, list, active, stats, plan, answer, upsertWrong, answerRevenge, remediationReviewed, verificationCandidate, verify, recordSession, listSessions, clearSessions })
  global.KGPracticeLearningApi = api
  global.addEventListener('kg-auth-session-change', () => { refresh().catch(() => setOverview({})) })
  if (authenticated()) refresh().catch(() => setOverview({}))
})(window)
