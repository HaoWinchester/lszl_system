import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const frontendDir = resolve(import.meta.dirname, '..')
const directAuthSource = readFileSync(
  resolve(frontendDir, 'scripts/new-legacy-assets/direct-auth-adapter.js'),
  'utf8',
)
const graphAuthGuardSource = readFileSync(
  resolve(frontendDir, '..', 'new-legacy/src/30-auth-guards.js'),
  'utf8',
)

function authRuntimeHarness() {
  const calls = { login: [], register: [] }
  const elements = new Map()
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: callback => callback(),
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type
        this.detail = options.detail
      }
    },
    document: {
      body: { classList: { toggle() {} } },
      getElementById(id) {
        if (!elements.has(id)) {
          elements.set(id, {
            classList: { toggle() {} },
            disabled: false,
            textContent: '',
          })
        }
        return elements.get(id)
      },
    },
    openNodeModal() {},
    createNodeAt() {},
    activateLinkSource() {},
    openLinkModal() {},
    deleteNode() {},
    applyNodeSize() {},
    applyLineStyle() {},
    applyLineColor() {},
  }
  sandbox.window = sandbox
  sandbox.KGSharedAuthDialog = {
    legalConsentVersion: '2026-08-13-v1',
    requireLegalConsent: () => true,
    message(text) {
      sandbox.document.getElementById('authMsg').textContent = String(text || '')
    },
  }
  sandbox.KGAuthCore = {
    cleanUsername: value => String(value || '').trim(),
    currentUser: () => null,
    currentUsername: () => '',
    providerStatus: () => ({ remote: true }),
    users: () => ({ new_student: { status: 'active' } }),
    async login(username, password, context) {
      calls.login.push({ username, password, context })
      return { ok: true, user: { username } }
    },
    async register(username, password, context) {
      calls.register.push({ username, password, context })
      return { ok: true, user: { username } }
    },
  }

  const context = vm.createContext(sandbox)
  vm.runInContext(directAuthSource, context, { filename: 'direct-auth-adapter.js' })
  vm.runInContext(graphAuthGuardSource, context, { filename: 'src/30-auth-guards.js' })
  return { context, calls }
}

test('homepage graph loading preserves the remote login handler', async () => {
  const { context, calls } = authRuntimeHarness()

  const result = await context.authLogin('remote_student', 'secret-123')

  assert.equal(result, true)
  assert.equal(calls.login.length, 1)
  assert.equal(calls.login[0].username, 'remote_student')
  assert.equal(calls.login[0].password, 'secret-123')
  assert.equal(calls.login[0].context.source, 'new-legacy-direct')
  assert.equal(calls.login[0].context.acceptedTermsVersion, '2026-08-13-v1')
})

test('homepage graph loading preserves the remote registration handler', async () => {
  const { context, calls } = authRuntimeHarness()

  const result = await context.authRegister('new_student', 'secret-123')

  assert.equal(result, true)
  assert.equal(calls.register.length, 1)
  assert.equal(calls.register[0].username, 'new_student')
  assert.equal(calls.register[0].password, 'secret-123')
  assert.equal(calls.register[0].context.source, 'new-legacy-direct')
  assert.equal(calls.register[0].context.acceptedTermsVersion, '2026-08-13-v1')
})
