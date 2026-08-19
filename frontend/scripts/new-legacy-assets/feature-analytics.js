'use strict'

;(function (global) {
  // 仅在 session 与角色已确认时上报；不依赖服务端注入用户快照。
  const ENDPOINT = '/api/v1/analytics/feature-events'

  const FEATURE_BY_PAGE = {
    'index.html': 'graph',
    'workbench.html': 'graph',
    'file-manager.html': 'files',
    'question-bank.html': 'question_bank',
    'question-training.html': 'training',
    'knowledge-recall.html': 'recall',
    'learning-path.html': 'learning_path',
  }

  const FEATURES = new Set(['graph', 'files', 'question_bank', 'training', 'recall', 'learning_path'])
  const EVENT_TYPES = new Set(['opened', 'engaged', 'key_action', 'outcome'])
  const NO_ACTION_TYPES = new Set(['opened', 'engaged'])
  const MIN_ENGAGED_SECONDS = 10
  const MAX_ENGAGED_SECONDS = 1800

  let role = 'guest'
  let rolePromise

  function currentRole() {
    return role
  }

  function ensureRole() {
    if (role !== 'guest') return Promise.resolve(role)
    if (rolePromise) return rolePromise
    rolePromise = fetch('/api/v1/auth/me', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return 'guest'
        const meBody = await response.json().catch(() => ({}))
        role = String(meBody?.user?.role || 'guest')
        return role
      })
      .catch(() => 'guest')
      .finally(() => {
        rolePromise = null
      })
    return rolePromise
  }

  function isActive() {
    return currentRole() !== 'guest'
  }

  function warn(message, error) {
    try {
      if (global.console && global.console.warn) global.console.warn(message, error)
    } catch (_) { /* 静默 */ }
  }

  function send(body) {
    try {
      const result = global.fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (result && typeof result.catch === 'function') {
        result.catch((error) => warn('[FeatureAnalytics] event dropped', error))
      }
    } catch (error) {
      warn('[FeatureAnalytics] send failed', error)
    }
  }

  function buildBody(featureKey, eventType, actionKey, durationSeconds) {
    const body = { featureKey: featureKey, eventType: eventType }
    if (actionKey) body.actionKey = actionKey
    if (durationSeconds) body.durationSeconds = durationSeconds
    return body
  }

  function track(featureKey, eventType, actionKey) {
    if (!isActive()) return
    if (!FEATURES.has(featureKey) || !EVENT_TYPES.has(eventType)) return
    const hasAction = !!actionKey && !!String(actionKey).trim()
    if (NO_ACTION_TYPES.has(eventType)) {
      if (hasAction) return // opened/engaged 不允许携带动作
    } else if (!hasAction) {
      return // key_action/outcome 必须携带动作
    }
    send(buildBody(featureKey, eventType, actionKey, undefined))
  }

  function trackEngaged(featureKey, durationSeconds) {
    if (!isActive()) return
    const capped = Math.min(MAX_ENGAGED_SECONDS, Math.max(0, Math.floor(durationSeconds || 0)))
    if (capped < MIN_ENGAGED_SECONDS) return
    send(buildBody(featureKey, 'engaged', undefined, capped))
  }

  function pageFeature() {
    const path = String((global.location && global.location.pathname) || '').split('/').pop() || ''
    return FEATURE_BY_PAGE[path] || null
  }

  let installed = false
  function installPageEngagement() {
    if (installed || !isActive()) return
    const featureKey = pageFeature()
    if (!featureKey) return
    installed = true

    send(buildBody(featureKey, 'opened', undefined, undefined))

    let activeStart = global.document && global.document.visibilityState === 'visible' ? Date.now() : 0
    let accumulated = 0
    const startActive = () => { if (!activeStart) activeStart = Date.now() }
    const stopActive = () => {
      if (activeStart) {
        accumulated += Date.now() - activeStart
        activeStart = 0
      }
    }

    global.addEventListener('visibilitychange', () => {
      if (global.document && global.document.visibilityState === 'visible') startActive()
      else stopActive()
    })
    // pagehide 发送最终停留时长，keepalive 保证不阻塞导航。
    global.addEventListener('pagehide', () => {
      stopActive()
      trackEngaged(featureKey, Math.round(accumulated / 1000))
    })
  }

  global.KGFeatureAnalytics = Object.freeze({ track: track })

  function bindLifecycle() {
    if (global.document && global.document.readyState && global.document.readyState !== 'loading') {
      ensureRole().finally(() => installPageEngagement())
    } else if (global.document) {
      global.document.addEventListener('DOMContentLoaded', () => ensureRole().finally(installPageEngagement), { once: true })
    }

    if (typeof global.addEventListener === 'function') {
      global.addEventListener('kg-auth-session-change', () => {
        role = role !== 'guest' ? role : 'guest'
        ensureRole().finally(() => installPageEngagement())
      })
    }
  }

  bindLifecycle()
})(window)
