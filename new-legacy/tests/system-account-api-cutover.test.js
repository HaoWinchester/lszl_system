'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const sourceRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(sourceRoot, '..')
const readRepo = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8')

const businessModules = [
  'new-legacy/src/29-auth-core.js',
  'new-legacy/src/31-admin-utils.js',
  'new-legacy/src/33-user-center.js',
  'new-legacy/src/34-role-permissions.js',
  'new-legacy/src/35-user-management.js',
  'new-legacy/src/36-system-settings.js',
  'new-legacy/src/37-subscription-core.js',
]

test('account, role, and subscription modules never persist business records in browser storage', () => {
  const forbiddenKeys = /kg_(?:local_users|role_themes|student_subscriptions|user_admin_logs)/
  for (const relative of businessModules) {
    const source = readRepo(relative)
    assert.doesNotMatch(
      source,
      forbiddenKeys,
      `${relative} must receive business state from FastAPI-backed memory stores`,
    )
    assert.doesNotMatch(
      source,
      /localStorage\.(?:setItem|removeItem)\([^\n]*(?:kg_local_users|kg_role_themes|kg_student_subscriptions|kg_user_admin_logs)/,
      `${relative} must not mutate retired business keys`,
    )
  }
})

test('only the completed account and system pages are absent from identical runtime policies', () => {
  const backend = readRepo('backend/app/web/runtime_page_policy.json')
  const frontend = readRepo('frontend/scripts/runtime-page-policy.json')
  assert.equal(frontend, backend)
  const policy = JSON.parse(backend)
  for (const page of ['user-management.html', 'system-settings.html']) {
    assert.equal(policy.runtimePages.includes(page), false, page)
  }
  assert.equal(policy.runtimePages.includes('admin-settings.html'), true)
})

function runAdapter(relative, context) {
  context.window = context
  context.CustomEvent ||= class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail }
  }
  context.addEventListener ||= () => {}
  context.dispatchEvent ||= () => {}
  vm.runInNewContext(readRepo(relative), context)
}

test('user mutations go through KGDomainApi and a failed save preserves the visible user state', async () => {
  const calls = []
  const existing = {
    learner: { username: 'learner', role: 'student', status: 'active', displayName: '旧名称' },
  }
  let failUpdate = false
  const service = {
    normalizeUsers: users => ({ ...users }),
    updateUser: (users, username, patch) => ({ ok: true, users: { ...users, [username]: { ...users[username], ...patch } } }),
  }
  const context = {
    console,
    Object,
    Array,
    String,
    Number,
    URLSearchParams,
    KGUserAdminService: service,
    KGAuthCore: { normalizeUser: (username, user) => ({ ...user, username }) },
    KGDomainApi: {
      async request(options) {
        calls.push(options)
        if (failUpdate) throw new Error('后端暂时不可用')
        return { user: { username: 'learner', role: 'student', status: 'active', display_name: '新名称' } }
      },
    },
  }
  runAdapter('frontend/scripts/new-legacy-assets/direct-admin-adapter.js', context)

  const saved = await service.updateUser(existing, 'learner', { displayName: '新名称' })
  assert.equal(saved.ok, true)
  assert.equal(saved.users.learner.displayName, '新名称')
  assert.equal(calls[0].method, 'PUT')
  assert.equal(calls[0].path, '/api/v1/users/learner')
  assert.equal(calls[0].body.display_name, '新名称')

  failUpdate = true
  const failed = await service.updateUser(existing, 'learner', { displayName: '不应用的名称' })
  assert.equal(failed.ok, false)
  assert.equal(failed.message, '后端暂时不可用')
  assert.deepEqual(failed.users, existing)
})

test('system adapter hydrates immutable UI stores from domain APIs and keeps prior state after refresh failure', async () => {
  const calls = []
  let failThemes = false
  let themes = {}
  let plans = {}
  let subscriptions = {}
  let logs = []
  let wechat = null
  const context = {
    console,
    Object,
    Array,
    String,
    Number,
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    __KG_DIRECT_BOOTSTRAP__: { authenticated: true, authUser: { username: 'admin', role: 'admin' } },
    KGDomainApi: {
      async request(options) {
        calls.push(options)
        if (options.path === '/api/v1/system/themes') {
          if (failThemes) throw new Error('主题服务不可用')
          return { themes: { admin: { primary_color: '#111111', accent_color: '#222222', soft_color: '#eeeeee', text_color: '#333333' } } }
        }
        if (options.path === '/api/v1/subscriptions/plans') return { plans: [{ planId: 'monthly', name: '月度会员' }] }
        if (options.path === '/api/v1/subscriptions/me') return { subscription: { username: 'admin', planId: 'free', status: 'active' }, entitlements: { allExamPapers: true } }
        if (options.path === '/api/v1/system/wechat-config') return { config: { enableOfficial: true } }
        if (options.path === '/api/v1/system/wechat-pay-config') return { config: { enableNativePay: true } }
        if (options.path === '/api/v1/system/logs?limit=100') return { logs: [{ id: 'log-1', action: '登录' }] }
        if (options.path === '/api/v1/subscriptions/orders') return { orders: [] }
        if (options.path === '/api/v1/subscriptions/redeem-codes') return { codes: [] }
        throw new Error(`unexpected ${options.path}`)
      },
    },
    KGAuthCore: {
      replaceAdminLogs(value) { logs = value },
    },
    KGRolePermissions: {
      hydrateThemes(value) { themes = value },
      getThemes() { return themes },
      DEFAULT_THEMES: {},
    },
    KGSubscription: {
      hydratePlanSettings(value) { plans = value },
      hydrateSubscriptions(value) { subscriptions = value },
      setStudentSubscription(username, patch) { subscriptions = { ...subscriptions, [username]: patch }; return patch },
      PLAN_ORDER: [],
      PLANS: {},
    },
    KGWechatLogin: { applyConfig(value) { wechat = value } },
  }
  runAdapter('frontend/scripts/new-legacy-assets/direct-system-adapter.js', context)

  await context.KGSystemDomain.ready
  assert.equal(themes.admin.primary, '#111111')
  assert.equal(plans.monthly.name, '月度会员')
  assert.equal(subscriptions.admin.planId, 'free')
  assert.equal(logs[0].action, '登录')
  assert.equal(wechat.enableOfficial, true)
  assert.equal(context.KGDirectSystemSettings.wechatPayConfig.enableNativePay, true)
  assert.equal(calls.some(call => call.path.includes('/api/v1/runtime/')), false)

  const before = themes
  failThemes = true
  await assert.rejects(context.KGSystemDomain.refreshRoleThemes(), /主题服务不可用/)
  assert.equal(themes, before)
})

test('subscription order and redeem-code mutations reload authoritative API state', async () => {
  const calls = []
  let orderStatus = 'pending'
  let codes = [{ id: 'code-1', code: 'VIP-ONE', planId: 'monthly', planName: '月度会员', status: 'unused', createdAt: '2026-08-29T00:00:00Z' }]
  const subscriptions = {
    orderList: () => [{ id: 'memory-order', status: 'pending' }],
    redeemCodeList: () => [{ id: 'memory-code', code: 'MEMORY' }],
    approveOrder: () => ({ ok: true, order: { id: 'memory-order' } }),
    cancelOrder: () => ({ ok: true, order: { id: 'memory-order' } }),
    generateRedeemCodes: () => ({ ok: true, codes: [{ code: 'MEMORY' }] }),
    redeemCode: () => ({ ok: true, code: { code: 'MEMORY' } }),
    hydratePlanSettings() {},
    hydrateSubscriptions() {},
    PLAN_ORDER: [],
    PLANS: {},
  }
  const context = {
    console,
    Object,
    Array,
    String,
    Number,
    Date,
    Promise,
    URLSearchParams,
    __KG_DIRECT_BOOTSTRAP__: { authenticated: true, authUser: { username: 'admin', role: 'admin' } },
    KGDomainApi: {
      async request(options) {
        calls.push(options)
        if (options.path === '/api/v1/subscriptions/plans') return { plans: [] }
        if (options.path === '/api/v1/system/themes') return { themes: {} }
        if (options.path === '/api/v1/subscriptions/me') return { subscription: null, entitlements: {} }
        if (options.path === '/api/v1/system/wechat-config') return { config: {} }
        if (options.path === '/api/v1/system/wechat-pay-config') return { config: {} }
        if (options.path === '/api/v1/system/logs?limit=100') return { logs: [] }
        if (options.path === '/api/v1/subscriptions/orders' && (!options.method || options.method === 'GET')) {
          return { orders: [{ id: 'db-order', username: 'learner', planId: 'monthly', planName: '月度会员', status: orderStatus, createdAt: '2026-08-29T00:00:00Z' }] }
        }
        if (options.path === '/api/v1/subscriptions/orders/db-order/approve') {
          orderStatus = 'approved'
          return { order: { id: 'db-order', status: orderStatus } }
        }
        if (options.path === '/api/v1/subscriptions/redeem-codes') return { codes }
        if (options.path === '/api/v1/subscriptions/redeem-codes/generate') {
          codes = [{ id: 'code-2', code: 'VIP-TWO', planId: 'monthly', planName: '月度会员', status: 'unused', createdAt: '2026-08-29T01:00:00Z' }, ...codes]
          return { codes: ['VIP-TWO'] }
        }
        throw new Error(`unexpected ${options.method || 'GET'} ${options.path}`)
      },
    },
    KGAuthCore: { replaceAdminLogs() {} },
    KGRolePermissions: { hydrateThemes() {}, DEFAULT_THEMES: {} },
    KGSubscription: subscriptions,
    KGWechatLogin: { applyConfig() {} },
  }
  runAdapter('frontend/scripts/new-legacy-assets/direct-system-adapter.js', context)

  await context.KGSystemDomain.ready
  assert.equal(subscriptions.orderList({})[0].id, 'db-order')
  assert.equal(subscriptions.redeemCodeList({})[0].code, 'VIP-ONE')

  const approved = await subscriptions.approveOrder('db-order')
  assert.equal(approved.ok, true)
  assert.equal(subscriptions.orderList({})[0].status, 'approved')

  const generated = await subscriptions.generateRedeemCodes({ planId: 'monthly', count: 1 })
  assert.equal(generated.ok, true)
  assert.equal(subscriptions.redeemCodeList({})[0].code, 'VIP-TWO')
  assert.equal(calls.some(call => call.path.includes('/api/v1/runtime/')), false)
})

test('initial system hydration rejects with a retry that replaces failed defaults', async () => {
  let failPlans = true
  let hydratedPlans = null
  const context = {
    console,
    Object,
    Array,
    String,
    Number,
    Date,
    Promise,
    __KG_DIRECT_BOOTSTRAP__: { authenticated: true, authUser: { username: 'admin', role: 'admin' } },
    KGDomainApi: {
      async request({ path }) {
        if (path === '/api/v1/subscriptions/plans') {
          if (failPlans) throw new Error('套餐初始化失败')
          return { plans: [{ planId: 'monthly', name: '数据库月度会员' }] }
        }
        if (path === '/api/v1/system/themes') return { themes: {} }
        if (path === '/api/v1/subscriptions/me') return { subscription: null, entitlements: {} }
        if (path === '/api/v1/system/wechat-config' || path === '/api/v1/system/wechat-pay-config') return { config: {} }
        if (path === '/api/v1/system/logs?limit=100') return { logs: [] }
        if (path === '/api/v1/subscriptions/orders' || path === '/api/v1/subscriptions/redeem-codes') return path.endsWith('orders') ? { orders: [] } : { codes: [] }
        throw new Error(`unexpected ${path}`)
      },
    },
    KGAuthCore: { replaceAdminLogs() {} },
    KGRolePermissions: { hydrateThemes() {}, DEFAULT_THEMES: {} },
    KGSubscription: {
      hydratePlanSettings(value) { hydratedPlans = value },
      hydrateSubscriptions() {},
      PLAN_ORDER: [],
      PLANS: {},
    },
    KGWechatLogin: { applyConfig() {} },
  }
  runAdapter('frontend/scripts/new-legacy-assets/direct-system-adapter.js', context)

  await assert.rejects(context.KGSystemDomain.ready, /套餐初始化失败/)
  assert.equal(context.KGSystemDomain.initializationState().status, 'failed')
  assert.equal(hydratedPlans, null)

  failPlans = false
  await context.KGSystemDomain.retryInitialization()
  assert.equal(context.KGSystemDomain.initializationState().status, 'ready')
  assert.equal(hydratedPlans.monthly.name, '数据库月度会员')
})
