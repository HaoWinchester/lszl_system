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

const responses = new Map([
  ['/api/v1/system/themes', { themes: {} }],
  ['/api/v1/system/subscription-plans', { plans: [] }],
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

console.log('direct system entitlement adapter test passed')
