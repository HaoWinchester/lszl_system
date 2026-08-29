'use strict'

;(function (global) {
  const api = global.KGDomainApi
  const roleApi = global.KGRolePermissions
  const subscriptionApi = global.KGSubscription
  const auth = global.KGAuthCore
  const wechatApi = global.KGWechatLogin
  if (!api || !roleApi || !subscriptionApi) return

  let userProfile = global.__KG_DIRECT_BOOTSTRAP__?.authenticated
    ? global.__KG_DIRECT_BOOTSTRAP__.authUser || null
    : null

  function request(method, path, body) {
    return api.request({ method, path, body })
  }

  function toLegacyTheme(theme = {}) {
    return Object.freeze({
      primary: theme.primary_color || theme.primary,
      accent: theme.accent_color || theme.accent,
      soft: theme.soft_color || theme.soft,
      text: theme.text_color || theme.text,
    })
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
    return Object.freeze(Object.fromEntries(
      plans.filter(plan => plan && (plan.planId || plan.id)).map(plan => {
        const planId = plan.planId || plan.id
        return [planId, Object.freeze({ ...plan, id: undefined, planId: undefined })]
      }),
    ))
  }

  function subscriptionTimestamp(value) {
    if (typeof value === 'number') return value
    const timestamp = Date.parse(value || '')
    return Number.isFinite(timestamp) ? timestamp : 0
  }

  function normalizeSubscription(subscription = {}) {
    return Object.freeze({
      ...subscription,
      username: subscription.username || userProfile?.username || '',
      startedAt: subscriptionTimestamp(subscription.startedAt || subscription.started_at),
      expiresAt: subscriptionTimestamp(subscription.expiresAt || subscription.expires_at),
      updatedAt: subscriptionTimestamp(subscription.updatedAt || subscription.updated_at),
    })
  }

  async function refreshUserProfile() {
    if (userProfile) return userProfile
    const payload = await request('GET', '/api/v1/auth/me')
    userProfile = payload?.user || null
    return userProfile
  }

  async function refreshRoleThemes() {
    const payload = await request('GET', '/api/v1/system/themes')
    const next = Object.freeze(Object.fromEntries(
      Object.entries(payload.themes || {}).map(([role, theme]) => [role, toLegacyTheme(theme)]),
    ))
    roleApi.hydrateThemes?.(next)
    return next
  }

  async function refreshPlans() {
    const payload = await request('GET', '/api/v1/subscriptions/plans')
    const next = planSettings(payload.plans || [])
    subscriptionApi.hydratePlanSettings?.(next)
    global.KGSubscriptionRemotePlanSettings = next
    global.dispatchEvent?.(new CustomEvent('kg-subscription-plan-change', { detail: { settings: next } }))
    return next
  }

  async function refreshSubscription() {
    const payload = await request('GET', '/api/v1/subscriptions/me')
    const subscription = payload.subscription ? normalizeSubscription(payload.subscription) : null
    subscriptionApi.hydrateSubscriptions?.(
      subscription?.username ? { [subscription.username]: subscription } : {},
      { merge: true },
    )
    global.KGServerEntitlements = Object.freeze({
      allExamPapers: payload.entitlements?.allExamPapers === true,
    })
    return subscription
  }

  async function refreshAdminSettings() {
    const [wechat, wechatPay] = await Promise.all([
      request('GET', '/api/v1/system/wechat-config'),
      request('GET', '/api/v1/system/wechat-pay-config'),
    ])
    wechatApi?.applyConfig?.(wechat.config || {})
    global.KGDirectSystemSettings = Object.freeze({
      wechatPayConfig: Object.freeze({ ...(wechatPay.config || {}) }),
    })
    return global.KGDirectSystemSettings
  }

  async function refreshAdminLogs() {
    const payload = await request('GET', '/api/v1/system/logs?limit=100')
    auth?.replaceAdminLogs?.(payload.logs || [])
    return payload.logs || []
  }

  async function clearAdminLogs() {
    await request('DELETE', '/api/v1/system/logs')
    auth?.replaceAdminLogs?.([])
    return []
  }

  async function refreshAuthenticatedContext() {
    await refreshPlans()
    try { await refreshUserProfile() } catch (_) { userProfile = null }
    if (!userProfile) {
      global.KGServerEntitlements = Object.freeze({ allExamPapers: false })
      return null
    }
    await Promise.all([refreshRoleThemes(), refreshSubscription()])
    if (userProfile.role === 'admin') await Promise.all([refreshAdminSettings(), refreshAdminLogs()])
    return userProfile
  }

  async function saveTheme(role, theme) {
    const payload = await request('PUT', `/api/v1/system/themes/${encodeURIComponent(role)}`, toServerTheme(theme))
    return roleApi.hydrateTheme?.(role, toLegacyTheme(payload.theme))
      || roleApi.saveTheme(role, toLegacyTheme(payload.theme))
  }

  async function resetTheme(role) {
    const fallback = roleApi.DEFAULT_THEMES?.[role] || {}
    return saveTheme(role, fallback)
  }

  async function saveWechatConfig(config) {
    const payload = await request('PUT', '/api/v1/system/wechat-config', config)
    wechatApi?.applyConfig?.(payload.config || {})
    return payload.config || {}
  }

  async function savePlan(planId, patch) {
    const payload = await request('PUT', `/api/v1/system/subscription-plans/${encodeURIComponent(planId)}`, patch)
    subscriptionApi.hydratePlanSettings?.({ [planId]: payload.plan || patch }, { merge: true })
    return subscriptionApi.planById?.(planId) || payload.plan || patch
  }

  async function saveAllPlans(settings = {}) {
    for (const planId of subscriptionApi.PLAN_ORDER || []) {
      await savePlan(planId, settings[planId] || subscriptionApi.PLANS?.[planId] || {})
    }
    return subscriptionApi.readPlanSettings?.() || settings
  }

  async function setStudentSubscription(username, patch = {}) {
    const payload = await request('PUT', `/api/v1/subscriptions/admin/${encodeURIComponent(username)}`, patch)
    const subscription = normalizeSubscription(payload.subscription || { ...patch, username })
    subscriptionApi.hydrateSubscriptions?.({ [username]: subscription }, { merge: true })
    return subscription
  }

  const domain = {
    refreshRoleThemes,
    refreshPlans,
    refreshSubscription,
    refreshAdminSettings,
    refreshAdminLogs,
    clearAdminLogs,
    refreshAuthenticatedContext,
    saveTheme,
    resetTheme,
    saveWechatConfig,
    savePlan,
    saveAllPlans,
    setStudentSubscription,
  }
  domain.ready = refreshAuthenticatedContext().catch(error => {
    console.error('[DirectSystemAdapter] initial hydration failed:', error)
    return null
  })
  global.KGSystemDomain = Object.freeze(domain)

  global.KGWechatPay = Object.freeze({
    createNativeOrder: planId => request('POST', '/api/v1/subscriptions/orders', { planId }),
    getNativeOrderStatus: orderId => request('GET', `/api/v1/subscriptions/orders/${encodeURIComponent(orderId)}/status`),
    cancelNativeOrder: orderId => request('POST', `/api/v1/subscriptions/orders/${encodeURIComponent(orderId)}/self-cancel`),
    syncSubscription(subscription) {
      const normalized = normalizeSubscription(subscription)
      if (normalized.username) subscriptionApi.hydrateSubscriptions?.({ [normalized.username]: normalized }, { merge: true })
      return normalized
    },
    nativeOrderQrCodeUrl: orderId => `/api/v1/subscriptions/orders/${encodeURIComponent(orderId)}/qrcode`,
  })

  roleApi.saveTheme = saveTheme
  roleApi.resetTheme = resetTheme
  if (wechatApi) wechatApi.saveConfig = saveWechatConfig
  subscriptionApi.setPlanSettings = savePlan
  subscriptionApi.resetPlanSettings = planId => savePlan(planId, subscriptionApi.PLANS?.[planId] || {})
  subscriptionApi.savePlanSettings = saveAllPlans
  subscriptionApi.setStudentSubscription = setStudentSubscription
  subscriptionApi.renewStudentSubscription = (username, planId, options = {}) => setStudentSubscription(username, {
    planId, status: options.status || 'active', note: options.note || '',
  })
  subscriptionApi.pauseStudentSubscription = (username, note = '') => setStudentSubscription(username, { status: 'paused', note })
  subscriptionApi.activateFreeSubscription = (username, note = '') => setStudentSubscription(username, { planId: 'free', status: 'active', note })

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('kg-auth-session-change', event => {
      const username = String(event?.detail?.username || '').trim()
      userProfile = null
      if (!username) {
        global.KGServerEntitlements = Object.freeze({ allExamPapers: false })
        subscriptionApi.hydrateSubscriptions?.({})
        return
      }
      refreshAuthenticatedContext().catch(error => console.error('[DirectSystemAdapter] auth refresh failed:', error))
    })
  }
})(window)
