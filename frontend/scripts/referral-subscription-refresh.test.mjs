import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Only the transport/cache resource boundary is recorded. Run the actual shared
// system adapter so old-owner entitlements cannot be restored by a late response.
async function adapter() {
  let current = { username: 'owner-A', role: 'student' }
  const pending = [], hydrated = [], listeners = new Map()
  const win = {
    __KG_DIRECT_BOOTSTRAP__: { authenticated: true, authUser: current },
    KGAuthCore: { currentUser: () => current }, KGRolePermissions: { hydrateThemes() {} },
    KGSubscription: { hydrateSubscriptions: value => hydrated.push(value), hydratePlanSettings() {} },
    KGDomainApi: { request: async ({path}) => {
      if (path.endsWith('/plans')) return { plans: [] }
      if (path.endsWith('/auth/me')) return { user: current }
      if (path.endsWith('/themes')) return { themes: {} }
      if (path.endsWith('/subscriptions/me')) return new Promise(resolve => pending.push(resolve))
      throw new Error('Unexpected API: ' + path)
    } },
    addEventListener: (key, fn) => listeners.set(key, fn), dispatchEvent() {}, location: { pathname: '/practice-mode.html' },
  }
  vm.runInNewContext(readFileSync(new URL('./new-legacy-assets/direct-system-adapter.js', import.meta.url), 'utf8'), { window: win, console, CustomEvent: class {} })
  const tick = () => new Promise(resolve => setImmediate(resolve))
  await tick()
  pending.shift()({ subscription: {username: 'owner-A', planId: 'free'}, entitlements: {allExamPapers: false} })
  await win.KGSystemDomain.ready
  pending.length = 0
  return {win, pending, hydrated, listeners, tick, setCurrent: value => {current = value}}
}

test('shared subscription refresh discards a previous owner response after switching account', async () => {
  const {win,pending,hydrated,listeners,tick,setCurrent}=await adapter()
  const old = win.KGSystemDomain.refreshSubscription()
  setCurrent({username: 'owner-B', role: 'student'})
  listeners.get('kg-auth-session-change')({detail: {username: 'owner-B'}})
  await tick()
  assert.equal(pending.length, 2)
  pending[1]({subscription: {username: 'owner-B', planId: 'free'}, entitlements: {allExamPapers: false}})
  await tick()
  pending[0]({subscription: {username: 'owner-A', planId: 'monthly'}, entitlements: {allExamPapers: true}})
  await old
  assert.equal(win.KGServerEntitlements.allExamPapers, false)
  assert.equal(hydrated.some(value => value['owner-A']?.planId === 'monthly'), false)
})


test('same-owner overlapping refreshes share a successful response rather than rendering old cache', async () => {
  const {win,pending,tick}=await adapter()
  const first=win.KGSystemDomain.refreshSubscription(),second=win.KGSystemDomain.refreshSubscription()
  await tick()
  assert.equal(pending.length,1,'overlapping consumers must await the same current subscription')
  pending[0]({subscription:{username:'owner-A',planId:'monthly'},entitlements:{allExamPapers:true}})
  const [one,two]=await Promise.all([first,second])
  assert.equal(one.planId,'monthly');assert.equal(two.planId,'monthly')
})
