'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const clientPath = path.resolve(__dirname, '../../frontend/scripts/new-legacy-assets/domain-api-client.js')

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

function bootClient(fetch) {
  const runtime = { console, Promise, setTimeout, clearTimeout, AbortController, fetch }
  runtime.window = runtime
  runtime.globalThis = runtime
  vm.createContext(runtime)
  vm.runInContext(fs.readFileSync(clientPath, 'utf8'), runtime, { filename: clientPath })
  return runtime
}

test('request sends credentials and revision and exposes 409 details', async () => {
  let received
  const runtime = bootClient(async (path, init) => {
    received = { path, init }
    return response(409, { detail: { code: 'REVISION_CONFLICT', currentRevision: 8 } })
  })

  await assert.rejects(
    runtime.KGDomainApi.request({ method: 'PUT', path: '/api/v1/example/1', body: { name: 'x' }, revision: 7 }),
    error => error.status === 409 && error.code === 'REVISION_CONFLICT' && error.detail.currentRevision === 8,
  )
  assert.equal(received.path, '/api/v1/example/1')
  assert.equal(received.init.credentials, 'include')
  assert.deepEqual(JSON.parse(received.init.body), { name: 'x', revision: 7 })
  assert.deepEqual(JSON.parse(JSON.stringify(received.init.headers)), {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  })
})

test('request timeout rejects a write once instead of retrying it', async () => {
  let attempts = 0
  const runtime = bootClient((_path, init) => new Promise((_resolve, reject) => {
    attempts += 1
    init.signal.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  }))

  await assert.rejects(
    runtime.KGDomainApi.request({ method: 'POST', path: '/api/v1/example', body: {}, timeoutMs: 5 }),
    error => error.code === 'REQUEST_TIMEOUT' && error.retryable === true,
  )
  assert.equal(attempts, 1)
})

test('request preserves an external cancellation instead of reporting a retryable timeout', async () => {
  const controller = new AbortController()
  const runtime = bootClient((_path, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
  }))

  const pending = runtime.KGDomainApi.request({ path: '/api/v1/example', signal: controller.signal, timeoutMs: 50 })
  controller.abort(new Error('caller cancelled'))
  await assert.rejects(pending, error => error.message === 'caller cancelled' && error.code === undefined)
})
