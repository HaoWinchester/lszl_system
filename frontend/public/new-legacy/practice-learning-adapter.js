'use strict'

;(function (global) {
  const API_ROOT = '/api/v1/learning/practice'
  let overview = { mistakes: [], stats: emptyStats(), revengeStats: emptyStats(), revengeCandidates: [], plan: null }
  let loading = null

  function text(value) { return String(value == null ? '' : value) }
  function clone(value) { return JSON.parse(JSON.stringify(value)) }
  function emptyStats() {
    return { total: 0, active: 0, pending: 0, needsRemediation: 0, verificationDue: 0, verificationWaiting: 0, mastered: 0, unavailable: 0 }
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
      const detail = payload?.detail || payload
      const message = typeof detail === 'object' ? detail?.message : detail
      const error = new Error(text(message || `学习记录请求失败 (${response.status})`))
      error.status = response.status
      error.detail = payload?.detail || payload
      if (response.status === 401) emit('kg:auth-required', { source: 'practice-learning' })
      throw error
    }
    return payload
  }
  function setOverview(next) {
    overview = {
      mistakes: Array.isArray(next?.mistakes) ? clone(next.mistakes) : [],
      stats: { ...emptyStats(), ...(next?.stats || {}) },
      revengeStats: { ...emptyStats(), ...(next?.revengeStats || next?.stats || {}) },
      revengeCandidates: Array.isArray(next?.revengeCandidates) ? clone(next.revengeCandidates) : [],
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
  function active() { return overview.revengeCandidates.map(clone) }
  function stats() { return clone(overview.revengeStats) }
  function plan() { return clone(overview.plan) }
  async function answer(input, options = {}) {
    // P4.5.37：keepalive 让 pagehide 时的批量同步请求可在页面卸载后存活
    const payload = await request('/answers', { method: 'POST', body: JSON.stringify(input || {}), keepalive: true })
    if (options.skipRefresh !== true) await refresh()
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
    return { mistake: clone(payload.mistake || null), verification: clone(payload.verification || null), answer: clone(payload.answer || null) }
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
  async function startSession(input) {
    const payload = await request('/sessions/start', { method: 'POST', body: JSON.stringify(input || {}) })
    return clone(payload.session || null)
  }
  async function getActiveSessions(filters = {}) {
    const params = new URLSearchParams()
    if (filters.releaseId) params.set('releaseId', text(filters.releaseId))
    if (filters.mode) params.set('mode', text(filters.mode))
    const query = params.toString() ? `?${params}` : ''
    const payload = await request('/sessions/active' + query)
    return Array.isArray(payload.sessions) ? clone(payload.sessions) : []
  }
  async function getSession(sessionId) {
    const payload = await request(`/sessions/${encodeURIComponent(sessionId)}`)
    return clone(payload.session || null)
  }
  async function updateState(sessionId, input) {
    const payload = await request(`/sessions/${encodeURIComponent(sessionId)}/state`, { method: 'PATCH', body: JSON.stringify(input || {}) })
    return clone(payload.session || null)
  }
  async function answerSession(sessionId, input) {
    const payload = await request(`/sessions/${encodeURIComponent(sessionId)}/answers`, { method: 'POST', body: JSON.stringify(input || {}) })
    return clone(payload)
  }
  async function remediationSession(sessionId, mistakeId, input) {
    return clone(await request(`/sessions/${encodeURIComponent(sessionId)}/mistakes/${encodeURIComponent(mistakeId)}/remediation`, { method: 'POST', body: JSON.stringify(input || {}) }))
  }
  async function verifySession(sessionId, mistakeId, input) {
    return clone(await request(`/sessions/${encodeURIComponent(sessionId)}/mistakes/${encodeURIComponent(mistakeId)}/verification`, { method: 'POST', body: JSON.stringify(input || {}) }))
  }
  async function pauseSession(sessionId, input, options = {}) {
    const payload = await request(`/sessions/${encodeURIComponent(sessionId)}/pause`, { method: 'POST', body: JSON.stringify(input || {}), keepalive: options.keepalive === true })
    return clone(payload.session || null)
  }
  async function completeSession(sessionId, input, options = {}) {
    return clone(await request(`/sessions/${encodeURIComponent(sessionId)}/complete`, { method: 'POST', body: JSON.stringify(input || {}), keepalive: options.keepalive === true }))
  }
  async function abandonSession(sessionId, input, options = {}) {
    const payload = await request(`/sessions/${encodeURIComponent(sessionId)}/abandon`, { method: 'POST', body: JSON.stringify(input || {}), keepalive: options.keepalive === true })
    return clone(payload.session || null)
  }
  async function getReport(sessionId) {
    const payload = await request(`/sessions/${encodeURIComponent(sessionId)}/report`)
    return clone(payload.report || null)
  }
  const api = Object.freeze({
    refresh, snapshot, list, active, stats, plan, answer, upsertWrong,
    answerRevenge, remediationReviewed, verificationCandidate, verify,
    recordSession, listSessions, clearSessions, startSession, getActiveSessions,
    getSession, updateState, answerSession, remediationSession, verifySession, pauseSession, completeSession,
    abandonSession, getReport,
  })
  global.KGPracticeLearningApi = api
  global.addEventListener('kg-auth-session-change', () => { refresh().catch(() => setOverview({})) })
  if (authenticated()) refresh().catch(() => setOverview({}))
})(window)
