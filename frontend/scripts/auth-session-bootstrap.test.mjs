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

function loadAdapter(fetchImpl, extras = {}) {
  const events = []
  const window = {
    ...extras,
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


for (const failure of ['network', '503', 'bad JSON']) {
  for (const knownIdentity of [false, true]) {
    test(`${failure} keeps ${knownIdentity ? 'known identity' : 'initial identity uncertain'} and retries on next load`, async () => {
      let attempt = 0
      let fail = false
      const { api } = loadAdapter(async () => {
        attempt += 1
        if (fail) {
          if (failure === 'network') throw new Error('offline')
          if (failure === '503') return response(503)
          return { ok: true, status: 200, async json() { throw new SyntaxError('invalid JSON') } }
        }
        return response(200, { user: { username: 'alice', role: 'teacher' }, loginSessionId: 'session-alice' })
      })
      if (knownIdentity) await api.load()
      fail = true
      const failed = await (knownIdentity ? api.refresh() : api.load())
      assert.equal(failed.uncertain, true)
      assert.equal(failed.user?.username || null, knownIdentity ? 'alice' : null)
      assert.notEqual(failed.authenticated, false, 'temporary failure is not confirmed anonymous')
      fail = false
      const restored = await api.load()
      assert.equal(restored.user.username, 'alice')
      assert.equal(restored.loginSessionId, 'session-alice')
      assert.equal(restored.uncertain, undefined)
      assert.equal(attempt, knownIdentity ? 3 : 2)
    })
  }
}

test('all consumers of an invalidated valid response receive the latest session', async () => {
  const requests = []
  const { api } = loadAdapter(() => {
    const pending = deferred()
    requests.push(pending)
    return pending.promise
  })
  const old = api.load()
  api.invalidate()
  const current = api.load()
  requests[1].resolve(response(200, { user: { username: 'bob', role: 'teacher' }, loginSessionId: 'new' }))
  await current
  requests[0].resolve(response(200, { user: { username: 'alice', role: 'student' }, loginSessionId: 'old' }))
  assert.equal((await old).user.username, 'bob')
  assert.equal(api.peek().user.username, 'bob')
})

test('late 401 consumers get the current session and do not trigger recovery for a newer login', async () => {
  const requests = []
  const observations = []
  const identity = { username: 'alice', loginSessionId: 'old' }
  const { api } = loadAdapter(() => {
    const pending = deferred()
    requests.push(pending)
    return pending.promise
  }, { KGAuthRecovery: { capture: () => identity, observe: (...args) => observations.push(args) } })
  const old = api.load()
  api.invalidate()
  const current = api.refresh()
  requests[1].resolve(response(200, { user: { username: 'alice', role: 'teacher' }, loginSessionId: 'new' }))
  await current
  requests[0].resolve(response(401))
  assert.equal((await old).loginSessionId, 'new')
  assert.equal(observations.length, 0)
})

test('current genuine 401 is anonymous and informs the optional recovery coordinator', async () => {
  const observations = []
  const identity = { username: 'alice', loginSessionId: 'active' }
  const { api } = loadAdapter(async () => response(401), {
    KGAuthRecovery: { capture: () => identity, observe: (...args) => observations.push(args) },
  })
  assert.equal((await api.load()).authenticated, false)
  assert.equal(observations.length, 1)
  assert.equal(observations[0][1], identity)
  assert.equal(observations[0][2].source, 'session-bootstrap')
})
