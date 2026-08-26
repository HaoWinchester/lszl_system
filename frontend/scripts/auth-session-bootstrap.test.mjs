import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const adapterPath = resolve('scripts/new-legacy-assets/auth-session-bootstrap.js')

function deferred() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

function response(status, payload = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload },
  }
}

function loadAdapter(fetchImpl) {
  const events = []
  const window = {
    fetch: fetchImpl,
    dispatchEvent(event) { events.push(event) },
  }
  window.window = window
  window.CustomEvent = class CustomEvent {
    constructor(type, options = {}) {
      this.type = type
      this.detail = options.detail
    }
  }
  const context = vm.createContext({ window, CustomEvent: window.CustomEvent })
  vm.runInContext(readFileSync(adapterPath, 'utf8'), context, { filename: adapterPath })
  return { api: window.KGAuthSessionBootstrap, events }
}

test('three concurrent auth consumers share one real session request', async () => {
  let fetchCalls = 0
  const { api } = loadAdapter(async (url, options) => {
    fetchCalls += 1
    assert.equal(url, '/api/v1/auth/me')
    assert.equal(options.method, 'GET')
    assert.equal(options.credentials, 'include')
    return response(200, {
      user: { username: 'alice', role: 'student', displayName: 'Alice' },
      loginSessionId: 'session-alice',
    })
  })

  const [entry, analytics, chooser] = await Promise.all([
    api.load(),
    api.load(),
    api.load(),
  ])

  assert.equal(fetchCalls, 1)
  assert.equal(entry.authenticated, true)
  assert.equal(entry.user.username, 'alice')
  assert.equal(entry.loginSessionId, 'session-alice')
  assert.deepEqual(entry, analytics)
  assert.deepEqual(entry, chooser)
  assert.deepEqual(api.peek(), entry)
})

test('a stale anonymous response cannot overwrite a refreshed authenticated session', async () => {
  const requests = []
  const { api } = loadAdapter(() => {
    const request = deferred()
    requests.push(request)
    return request.promise
  })

  const staleLoad = api.load()
  api.invalidate()
  const refreshedLoad = api.refresh()
  const coalescedRefresh = api.refresh()
  assert.equal(requests.length, 2)

  requests[1].resolve(response(200, {
    user: { username: 'alice', role: 'student' },
    loginSessionId: 'session-new',
  }))
  const [refreshed, coalesced] = await Promise.all([refreshedLoad, coalescedRefresh])
  assert.equal(refreshed.user.username, 'alice')
  assert.deepEqual(coalesced, refreshed)

  requests[0].resolve(response(401))
  await staleLoad

  assert.equal(api.peek().user.username, 'alice')
  assert.equal(api.peek().loginSessionId, 'session-new')
})

test('an unauthenticated response resolves to one stable anonymous snapshot', async () => {
  let fetchCalls = 0
  const { api } = loadAdapter(async () => {
    fetchCalls += 1
    return response(401)
  })

  const first = await api.load()
  const second = await api.load()

  assert.equal(fetchCalls, 1)
  assert.equal(first.authenticated, false)
  assert.equal(first.user, null)
  assert.equal(first.loginSessionId, '')
  assert.deepEqual(second, first)
})
