'use strict'

;(function (global) {
  const storage = global.KGServerStateStorage
  const roleApi = global.KGRolePermissions
  const wechatApi = global.KGWechatLogin
  const subscriptionApi = global.KGSubscription
  if (!storage || !roleApi || !wechatApi || !subscriptionApi) return

  function errorMessage(payload, status) {
    const detail = payload?.detail ?? payload?.message ?? payload?.error
    if (Array.isArray(detail)) return detail.map((item) => item?.msg || String(item)).join('；')
    return String(detail || `服务器请求失败（${status || 0}）`)
  }

  function request(method, path, body) {
    const xhr = new XMLHttpRequest()
    xhr.open(method, path, false)
    xhr.withCredentials = true
    xhr.setRequestHeader('Accept', 'application/json')
    if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.send(body === undefined ? null : JSON.stringify(body))
    let payload = {}
    try { payload = xhr.responseText ? JSON.parse(xhr.responseText) : {} } catch (_) {}
    if (xhr.status < 200 || xhr.status >= 300) {
      throw new Error(errorMessage(payload, xhr.status))
    }
    return payload
  }

  async function requestJson(method, path, body) {
    const response = await fetch(path, {
      method,
      credentials: 'include',
      headers: body === undefined ? { Accept: 'application/json' } : {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let payload = {}
    try { payload = await response.json() } catch (_) {}
    if (!response.ok) throw new Error(errorMessage(payload, response.status))
    return payload
  }

  global.KGWechatPay = {
    async createNativeOrder(planId) {
      return requestJson('POST', '/api/v1/subscriptions/orders', { planId })
    },
    async getNativeOrderStatus(orderId) {
      return requestJson('GET', `/api/v1/subscriptions/orders/${encodeURIComponent(orderId)}/status`)
    },
    syncSubscription,
    nativeOrderQrCodeUrl(orderId) {
      return `/api/v1/subscriptions/orders/${encodeURIComponent(orderId)}/qrcode`
    },
  }

  function toLegacyTheme(theme = {}) {
    return {
      primary: theme.primary_color || theme.primary,
      accent: theme.accent_color || theme.accent,
      soft: theme.soft_color || theme.soft,
      text: theme.text_color || theme.text,
    }
  }

  function toServerTheme(theme = {}) {
    return {
      primary_color: theme.primary,
      accent_color: theme.accent,
      soft_color: theme.soft,
      text_color: theme.text,
    }
  }

  function planSettings(plans = []) {
    return Object.fromEntries(
      plans
        .filter((plan) => plan && plan.planId)
        .map((plan) => [plan.planId, { ...plan, id: undefined, planId: undefined }]),
    )
  }

  function isAuthenticated() {
    return global.__KG_DIRECT_BOOTSTRAP__?.authenticated === true
  }

  function isAdmin() {
    return global.__KG_DIRECT_BOOTSTRAP__?.authUser?.role === 'admin'
  }

  function preloadPlans() {
    const plans = request('GET', '/api/v1/system/subscription-plans').plans || []
    storage.setItem('kg_subscription_plan_settings_v1', JSON.stringify(planSettings(plans)))
  }

  function subscriptionTimestamp(value) {
    const timestamp = Date.parse(value || '')
    return Number.isFinite(timestamp) ? timestamp : 0
  }

  function syncSubscription(subscription) {
    if (!subscription?.username || typeof subscriptionApi.setStudentSubscription !== 'function') return null
    return subscriptionApi.setStudentSubscription(subscription.username, {
      planId: subscription.planId,
      status: subscription.status,
      startedAt: subscriptionTimestamp(subscription.startedAt),
      expiresAt: subscriptionTimestamp(subscription.expiresAt),
      source: subscription.source,
      note: subscription.note || '',
    })
  }

  function preloadSubscription() {
    const payload = request('GET', '/api/v1/subscriptions/me')
    return syncSubscription(payload.subscription)
  }

  if (isAuthenticated()) {
    try {
      const themes = request('GET', '/api/v1/system/themes').themes || {}
      storage.setItem('kg_role_themes_v1', JSON.stringify(
        Object.fromEntries(Object.entries(themes).map(([role, theme]) => [role, toLegacyTheme(theme)])),
      ))
    } catch (error) {
      console.error('[DirectSystemAdapter] role themes preload failed:', error)
    }

    try {
      // 学员也需要读取套餐金额。
      preloadPlans()
      preloadSubscription()
    } catch (error) {
      console.error('[DirectSystemAdapter] subscription preload failed:', error)
    }
  }

  if (isAdmin()) {
    try {
      const wechat = request('GET', '/api/v1/system/wechat-config').config || {}
      storage.setItem('kg_wechat_login_config_v1', JSON.stringify(wechat))
      const wechatPay = request('GET', '/api/v1/system/wechat-pay-config').config || {}
      global.KGDirectSystemSettings = { wechatPayConfig: wechatPay }
    } catch (error) {
      console.error('[DirectSystemAdapter] admin settings preload failed:', error)
    }
  }

  const originalSaveTheme = roleApi.saveTheme.bind(roleApi)
  const originalResetTheme = roleApi.resetTheme.bind(roleApi)
  roleApi.saveTheme = function (role, theme) {
    const saved = request('PUT', `/api/v1/system/themes/${encodeURIComponent(role)}`, toServerTheme(theme)).theme
    return originalSaveTheme(role, toLegacyTheme(saved))
  }
  roleApi.resetTheme = function (role) {
    const fallback = roleApi.DEFAULT_THEMES?.[role] || {}
    const saved = request('PUT', `/api/v1/system/themes/${encodeURIComponent(role)}`, toServerTheme(fallback)).theme
    originalResetTheme(role)
    return originalSaveTheme(role, toLegacyTheme(saved))
  }

  const originalSaveConfig = wechatApi.saveConfig.bind(wechatApi)
  wechatApi.saveConfig = function (config) {
    const saved = request('PUT', '/api/v1/system/wechat-config', config).config
    return originalSaveConfig(saved)
  }

  const originalSetPlanSettings = subscriptionApi.setPlanSettings.bind(subscriptionApi)
  const originalResetPlanSettings = subscriptionApi.resetPlanSettings.bind(subscriptionApi)
  const originalSavePlanSettings = subscriptionApi.savePlanSettings.bind(subscriptionApi)
  subscriptionApi.setPlanSettings = function (planId, patch = {}) {
    const saved = request('PUT', `/api/v1/system/subscription-plans/${encodeURIComponent(planId)}`, patch).plan
    return originalSetPlanSettings(planId, saved || patch)
  }
  subscriptionApi.resetPlanSettings = function (planId) {
    const base = subscriptionApi.PLANS?.[planId] || {}
    request('PUT', `/api/v1/system/subscription-plans/${encodeURIComponent(planId)}`, base)
    return originalResetPlanSettings(planId)
  }
  subscriptionApi.savePlanSettings = function (settings = {}) {
    for (const planId of subscriptionApi.PLAN_ORDER || []) {
      const patch = settings[planId] || subscriptionApi.PLANS?.[planId] || {}
      request('PUT', `/api/v1/system/subscription-plans/${encodeURIComponent(planId)}`, patch)
    }
    return originalSavePlanSettings(settings)
  }
})(window)
