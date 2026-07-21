import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const source = readFileSync(resolve(scriptsDir, 'new-legacy-assets', 'server-state-bootstrap.js'), 'utf8')

test('direct bootstrap consumes the FastAPI-injected payload', () => {
  assert.match(source, /__KG_DIRECT_BOOTSTRAP__/)
  assert.doesNotMatch(source, /__KG_NEW_LEGACY_BOOTSTRAP__/)
})

test('direct state persistence never posts to a parent window', () => {
  assert.doesNotMatch(source, /parent\.postMessage/)
  assert.match(source, /fetch\(['"]\/api\/v1\/runtime\/state['"]/)
  assert.match(source, /credentials:\s*['"]include['"]/)
})

test('direct storage exposes save state and pagehide recovery', () => {
  assert.match(source, /kg:save-state/)
  assert.match(source, /snapshotMode:\s*['"]full['"]/) // full coalesced snapshot
  assert.match(source, /pagehide/)
  assert.match(source, /sendBeacon/)
})

test('direct storage replaces page localStorage and exposes an awaitable flush', () => {
  assert.match(source, /Object\.defineProperty\(global,\s*['"]localStorage['"]/)
  assert.match(source, /storage\.flush\s*=\s*flush/)
  assert.match(source, /return\s+flushPromise/)
})

test('pagehide waits for upstream graph handlers before taking its beacon snapshot', () => {
  assert.match(source, /queueMicrotask/)
  assert.match(source, /sendLatestBeacon/)
})

test('a revision conflict reloads server state before retrying', () => {
  assert.match(source, /response\.status\s*===\s*409/)
  assert.match(source, /method:\s*['"]GET['"]/)
  assert.match(source, /serverState\.storage/)
  assert.match(source, /pendingMutations/)
  assert.match(source, /applyPendingMutations/)
})

test('the original user-management service writes real backend accounts', () => {
  const adapter = readFileSync(resolve(frontendDir, 'scripts/new-legacy-assets/direct-admin-adapter.js'), 'utf8')
  assert.match(adapter, /XMLHttpRequest/)
  assert.match(adapter, /\/api\/v1\/users/)
  assert.match(adapter, /canEnterUserManagement/)
  for (const action of ['createUser', 'updateUser', 'resetPassword', 'setStatus', 'duplicateUser', 'deleteUsers', 'batchUpdate', 'importUsers']) {
    assert.match(adapter, new RegExp(`service\\.${action}`))
  }
  const userPage = readFileSync(resolve(frontendDir, 'public/new-legacy/user-management.html'), 'utf8')
  const servicePosition = userPage.indexOf('src/35-user-management-service.js')
  const adapterPosition = userPage.indexOf('direct-admin-adapter.js')
  const uiPosition = userPage.indexOf('src/35-user-management.js')
  assert.ok(servicePosition >= 0 && servicePosition < adapterPosition)
  assert.ok(adapterPosition < uiPosition)
})

test('graph and training login use remote authentication then reload account state', () => {
  const adapter = readFileSync(resolve(frontendDir, 'scripts/new-legacy-assets/direct-auth-adapter.js'), 'utf8')
  assert.match(adapter, /KGAuthCore/)
  assert.match(adapter, /core\.login/)
  assert.match(adapter, /core\.register/)
  assert.match(adapter, /core\.logout/)
  for (const pageName of ['index.html', 'question-training.html']) {
    const page = readFileSync(resolve(frontendDir, `public/new-legacy/${pageName}`), 'utf8')
    assert.match(page, /direct-auth-adapter\.js/)
  }
  const entry = readFileSync(resolve(frontendDir, 'scripts/new-legacy-assets/direct-entry.js'), 'utf8')
  assert.match(entry, /kg-auth-session-change/)
  assert.match(entry, /location\.reload/)
})
