import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

global.window = global
global.__KG_DIRECT_BOOTSTRAP__ = {
  authenticated: true,
  authUser: { username: 'student', role: 'student' },
}
global.KGServerStateStorage = {
  setItem() {},
}
global.KGRolePermissions = {
  saveTheme() {},
  resetTheme() {},
  DEFAULT_THEMES: {},
}
global.KGWechatLogin = {
  saveConfig() {},
}
global.KGSubscription = {
  PLAN_ORDER: [],
  PLANS: {},
  setStudentSubscription(_username, value) { return value },
  setPlanSettings() {},
  resetPlanSettings() {},
  savePlanSettings() {},
}
global.CustomEvent = class FakeCustomEvent {
  constructor(type, init) { this.type = type; this.detail = init?.detail }
}
global.dispatchEvent = () => true
const listeners = new Map()
global.addEventListener = (type, listener) => { listeners.set(type, listener) }
global.fetch = async (url) => ({
  ok: url === '/api/v1/auth/me',
  status: url === '/api/v1/auth/me' ? 200 : 404,
  async json() {
    return url === '/api/v1/auth/me'
      ? { user: { username: 'student', role: 'student' } }
      : { detail: 'not found' }
  },
})

const responses = new Map([
  ['/api/v1/system/themes', { themes: {} }],
  ['/api/v1/subscriptions/plans', { plans: [] }],
  ['/api/v1/subscriptions/me', {
    subscription: {
      username: 'student',
      planId: 'monthly',
      status: 'active',
      startedAt: '2026-08-01T00:00:00+00:00',
      expiresAt: '2026-09-01T00:00:00+00:00',
      source: 'wechat_pay',
    },
    entitlements: { allExamPapers: true },
  }],
])

global.XMLHttpRequest = class FakeXMLHttpRequest {
  open(_method, url) { this.url = url }
  setRequestHeader() {}
  send() {
    this.status = responses.has(this.url) ? 200 : 404
    this.responseText = JSON.stringify(responses.get(this.url) || { detail: 'not found' })
  }
}

const adapterPath = path.resolve(__dirname, '../new-legacy-assets/direct-system-adapter.js')
delete global.KGServerEntitlements
await import(`${pathToFileURL(adapterPath).href}?entitlements-test=1`)

assert.deepEqual(global.KGServerEntitlements, { allExamPapers: true })
assert.equal(Object.isFrozen(global.KGServerEntitlements), true)

listeners.get('kg-auth-session-change')({
  detail: { username: 'student', provider: 'remote' },
})
await new Promise(resolve => setImmediate(resolve))
assert.deepEqual(
  global.KGServerEntitlements,
  { allExamPapers: true },
  'restoring an authenticated member session must not clear server entitlements',
)

console.log('direct system entitlement adapter test passed')
