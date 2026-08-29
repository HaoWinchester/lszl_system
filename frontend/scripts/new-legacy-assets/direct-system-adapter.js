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
  let orderState = Object.freeze([])
  let redeemCodeState = Object.freeze([])
  let initialization = Object.freeze({ status: 'loading', error: null })

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

  function normalizeOrder(order = {}) {
    const amount = Number(order.amount)
    return Object.freeze({
      ...order,
      id: String(order.id || ''),
      username: String(order.username || ''),
      planId: String(order.planId || order.plan_id || ''),
      planName: String(order.planName || order.plan_name || ''),
      createdAt: subscriptionTimestamp(order.createdAt || order.created_at),
      updatedAt: subscriptionTimestamp(order.updatedAt || order.updated_at),
      approvedAt: subscriptionTimestamp(order.approvedAt || order.approved_at),
      amountText: Number.isFinite(amount) ? `￥${(amount / 100).toFixed(2)}` : '',
    })
  }

  function normalizeRedeemCode(code = {}) {
    return Object.freeze({
      ...code,
      id: String(code.id || ''),
      code: String(code.code || '').trim().toUpperCase(),
      planId: String(code.planId || code.plan_id || ''),
      planName: String(code.planName || code.plan_name || ''),
      createdAt: subscriptionTimestamp(code.createdAt || code.created_at),
      usedAt: subscriptionTimestamp(code.usedAt || code.used_at),
    })
  }

  function filteredRecords(records, options = {}) {
    return records.filter(record => Object.entries(options).every(([key, value]) => (
      value == null || value === '' || String(record[key] || '') === String(value)
    )))
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

  async function refreshOrders() {
    const payload = await request('GET', '/api/v1/subscriptions/orders')
    orderState = Object.freeze((payload.orders || []).map(normalizeOrder))
    global.dispatchEvent?.(new CustomEvent('kg-subscription-order-change', { detail: { orders: orderState } }))
    return orderState
  }

  async function refreshRedeemCodes() {
    const payload = await request('GET', '/api/v1/subscriptions/redeem-codes')
    redeemCodeState = Object.freeze((payload.codes || []).map(normalizeRedeemCode))
    global.dispatchEvent?.(new CustomEvent('kg-subscription-redeem-code-change', { detail: { codes: redeemCodeState } }))
    return redeemCodeState
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
    if (userProfile.role === 'admin') {
      await Promise.all([refreshAdminSettings(), refreshAdminLogs(), refreshOrders(), refreshRedeemCodes()])
    }
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
    const body = {}
    for (const key of ['planId', 'status', 'note']) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) body[key] = patch[key]
    }
    for (const key of ['startedAt', 'expiresAt']) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
      const timestamp = Number(patch[key]) || 0
      body[key] = timestamp ? new Date(timestamp).toISOString() : null
    }
    const payload = await request('PUT', `/api/v1/subscriptions/admin/${encodeURIComponent(username)}`, body)
    const subscription = normalizeSubscription(payload.subscription || { ...patch, username })
    subscriptionApi.hydrateSubscriptions?.({ [username]: subscription }, { merge: true })
    return subscription
  }

  async function approveOrder(orderId) {
    await request('POST', `/api/v1/subscriptions/orders/${encodeURIComponent(orderId)}/approve`)
    await refreshOrders()
    return { ok: true, order: orderState.find(order => order.id === String(orderId)) || null, message: '订阅申请已确认开通。' }
  }

  async function cancelOrder(orderId) {
    await request('POST', `/api/v1/subscriptions/orders/${encodeURIComponent(orderId)}/cancel`)
    await refreshOrders()
    return { ok: true, order: orderState.find(order => order.id === String(orderId)) || null, message: '订阅申请已取消。' }
  }

  async function generateRedeemCodes(options = {}) {
    const payload = await request('POST', '/api/v1/subscriptions/redeem-codes/generate', {
      planId: options.planId || 'monthly',
      count: Math.max(1, Math.min(500, Number(options.count) || 1)),
    })
    const generated = new Set((payload.codes || []).map(code => String(code).toUpperCase()))
    await refreshRedeemCodes()
    const codes = redeemCodeState.filter(code => generated.has(code.code))
    return { ok: true, codes, message: `已生成 ${codes.length} 张卡密。` }
  }

  async function redeemCode(input) {
    const payload = await request('POST', '/api/v1/subscriptions/redeem', { code: String(input || '').trim() })
    const subscription = normalizeSubscription(payload.subscription || {})
    if (subscription.username) subscriptionApi.hydrateSubscriptions?.({ [subscription.username]: subscription }, { merge: true })
    return { ok: true, subscription, message: '卡密兑换成功，会员权益已更新。' }
  }

  async function retryInitialization() {
    initialization = Object.freeze({ status: 'loading', error: null })
    try {
      const result = await refreshAuthenticatedContext()
      initialization = Object.freeze({ status: 'ready', error: null })
      return result
    } catch (error) {
      initialization = Object.freeze({ status: 'failed', error })
      throw error
    }
  }

  const domain = {
    refreshRoleThemes,
    refreshPlans,
    refreshSubscription,
    refreshAdminSettings,
    refreshAdminLogs,
    refreshOrders,
    refreshRedeemCodes,
    clearAdminLogs,
    refreshAuthenticatedContext,
    saveTheme,
    resetTheme,
    saveWechatConfig,
    savePlan,
    saveAllPlans,
    setStudentSubscription,
    retryInitialization,
    initializationState: () => initialization,
  }
  domain.ready = retryInitialization()
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
  subscriptionApi.orderList = options => filteredRecords(orderState, options)
    .slice().sort((left, right) => right.createdAt - left.createdAt)
  subscriptionApi.pendingOrders = () => subscriptionApi.orderList({ status: 'pending' })
  subscriptionApi.currentUserOrders = () => subscriptionApi.orderList({ username: userProfile?.username || '' })
  subscriptionApi.hasPendingOrder = (username, planId) => subscriptionApi.orderList({ username, planId, status: 'pending' }).length > 0
  subscriptionApi.approveOrder = approveOrder
  subscriptionApi.cancelOrder = cancelOrder
  subscriptionApi.redeemCodeList = options => filteredRecords(redeemCodeState, options)
    .slice().sort((left, right) => right.createdAt - left.createdAt)
  subscriptionApi.generateRedeemCodes = generateRedeemCodes
  subscriptionApi.redeemCode = redeemCode

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
