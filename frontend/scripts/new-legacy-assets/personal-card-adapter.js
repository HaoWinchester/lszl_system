'use strict'

;(function (global) {
  const API_ROOT = '/api/v1/learning/personal-cards'
  let activeCards = []
  let archivedCards = []
  let loadingActive = null
  let loadingArchived = null

  function text(value) { return String(value == null ? '' : value) }
  function clone(value) { return JSON.parse(JSON.stringify(value)) }
  function currentUser() {
    try { return global.KGAuthCore?.currentUser?.() || null } catch (error) { return null }
  }
  function authenticated() { return Boolean(currentUser()) }
  function emit() {
    const detail = snapshot()
    try { global.dispatchEvent(new CustomEvent('kg-personal-synthesis-cards-change', { detail })) } catch (error) {}
  }
  function errorMessage(payload, status) {
    const detail = payload?.detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail.message === 'string') return detail.message
    return `个人归纳卡请求失败 (${status})`
  }
  async function request(path = '', options = {}) {
    const owner=String(currentUser()?.username||'')
    const response = await (global.KGAuthRecovery?.fetch || global.fetch)(`${API_ROOT}${path}`, {
      ...options,
      credentials: 'include',
      headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
    })
    let payload = {}
    try { payload = await response.json() } catch (error) {}
    if(owner!==String(currentUser()?.username||'')){
      const error=new Error('登录账号已变化，已丢弃上一账号的归纳卡响应。');error.status=409;throw error
    }
    if (!response.ok) {
      const error = new Error(errorMessage(payload, response.status))
      error.status = response.status
      error.detail = payload?.detail ?? payload
      if (response.status === 401) {
        try { (global.document || global).dispatchEvent(new CustomEvent('kg:auth-required', { detail: { source: 'personal-cards' }, bubbles: true })) } catch (eventError) {}
      }
      throw error
    }
    return payload
  }
  function snapshot() {
    return { active: clone(activeCards), archived: clone(archivedCards) }
  }
  function list(options = {}) {
    return clone(options.archived ? archivedCards : activeCards)
  }
  async function loadArchived(archived) {
    if (!authenticated()) {
      if (archived) archivedCards = []
      else activeCards = []
      emit()
      return list({ archived })
    }
    const loading = archived ? loadingArchived : loadingActive
    if (loading) return loading
    const operation = request(archived ? '?archived=true' : '')
      .then((payload) => {
        const cards = Array.isArray(payload?.cards) ? clone(payload.cards) : []
        if (archived) archivedCards = cards
        else activeCards = cards
        emit()
        return clone(cards)
      })
      .finally(() => {
        if (archived) loadingArchived = null
        else loadingActive = null
      })
    if (archived) loadingArchived = operation
    else loadingActive = operation
    return operation
  }
  async function refresh(options = {}) {
    const active = await loadArchived(false)
    if (options.includeArchived) await loadArchived(true)
    return { active, archived: clone(archivedCards) }
  }
  async function get(cardId) {
    const payload = await request(`/${encodeURIComponent(text(cardId))}`)
    return clone(payload.card || null)
  }
  async function create(input) {
    const payload = await request('', { method: 'POST', body: JSON.stringify(input || {}) })
    return adoptAcknowledgedCard(payload.card)
  }
  async function update(cardId, input) {
    const payload = await request(`/${encodeURIComponent(text(cardId))}`, {
      method: 'PUT',
      body: JSON.stringify(input || {}),
    })
    return adoptAcknowledgedCard(payload.card)
  }
  async function archive(cardId) {
    const payload = await request(`/${encodeURIComponent(text(cardId))}/archive`, { method: 'POST' })
    return adoptAcknowledgedCard(payload.card)
  }
  async function restore(cardId) {
    const payload = await request(`/${encodeURIComponent(text(cardId))}/restore`, { method: 'POST' })
    return adoptAcknowledgedCard(payload.card)
  }
  function adoptAcknowledgedCard(value) {
    if (!value?.id) return null
    const card = clone(value)
    activeCards = activeCards.filter(item => item.id !== card.id)
    archivedCards = archivedCards.filter(item => item.id !== card.id)
    ;(card.archivedAt ? archivedCards : activeCards).unshift(card)
    emit()
    return clone(card)
  }

  global.KGPersonalSynthesisCardApi = Object.freeze({ refresh, snapshot, list, get, create, update, archive, restore })
  global.addEventListener('kg-auth-session-change', () => {
    activeCards = []
    archivedCards = []
    refresh().catch(() => emit())
  })
  if (authenticated()) refresh().catch(() => emit())
})(window)
