import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const frontend = resolve(import.meta.dirname, '..')
const repo = resolve(frontend, '..')
const readSource = (path) => readFileSync(resolve(repo, path), 'utf8')

test('wechat login starts OAuth at the backend and never exchanges codes in the browser', () => {
  const source = readSource('new-legacy/src/32-wechat-login.js')

  assert.match(source, /\/api\/v1\/auth\/wechat\/auth-url/)
  assert.match(source, /credentials:\s*['"]include['"]/)
  assert.doesNotMatch(source, /backendExchangeUrl/)
  assert.doesNotMatch(source, /WECHAT_PENDING_KEY/)
  assert.doesNotMatch(source, /completeLogin\s*\(/)
})

test('user center offers server-backed WeChat binding and unbinding', () => {
  const source = readSource('new-legacy/src/33-user-center.js')
  const login = readSource('new-legacy/src/32-wechat-login.js')

  assert.match(source, /startOfficialLogin\(['"]bind['"]\)/)
  assert.match(source, /api\.unbind\(\)/)
  assert.match(login, /\/api\/v1\/auth\/wechat\/binding/)
  assert.match(login, /method:\s*['"]DELETE['"]/)
})

test('system settings do not expose an obsolete browser code-exchange setting', () => {
  const source = readSource('new-legacy/src/36-system-settings.js')

  assert.doesNotMatch(source, /wxBackendExchangeUrl/)
  assert.doesNotMatch(source, /backendExchangeUrl/)
  assert.doesNotMatch(source, /buildOfficialAuthUrl/)
})
