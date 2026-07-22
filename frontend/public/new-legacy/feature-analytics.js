'use strict'

;(function (global) {
  // 仅读取后端注入的 bootstrap 负载做认证判断；身份由服务端会话决定，
  // 客户端不携带、不存储任何用户标识或自由字段。
  const ENTRY = global.__KG_DIRECT_BOOTSTRAP__ || {}
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

  function currentRole() {
    return String((ENTRY.authUser && ENTRY.authUser.role) || 'guest')
  }

  function isActive() {
    return !!ENTRY.authenticated && !ENTRY.readOnly && currentRole() !== 'guest'
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
    const path = String((global.location && global.location.pathname) || '').split('/').pop() || String(ENTRY.page || '')
    return FEATURE_BY_PAGE[path] || null
  }

  function installPageEngagement() {
    if (!isActive()) return
    const featureKey = pageFeature()
    if (!featureKey) return

    send(buildBody(featureKey, 'opened', undefined, undefined))

    let activeStart = global.document && global.document.visibilityState === 'visible' ? Date.now() : 0
    let accumulated = 0
    const startActive = () => { if (!activeStart) activeStart = Date.now() }
    const stopActive = () => { if (activeStart) { accumulated += Date.now() - activeStart; activeStart = 0 } }

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

  if (global.document && global.document.readyState && global.document.readyState !== 'loading') {
    installPageEngagement()
  } else if (global.document) {
    global.document.addEventListener('DOMContentLoaded', installPageEngagement, { once: true })
  }
})(window)
