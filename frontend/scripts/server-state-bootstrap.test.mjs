import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const adapterPath = resolve(frontendDir, 'scripts/new-legacy-assets/server-state-bootstrap.js')

function execute({ expectedPage = 'learning-path.html', entryPage = expectedPage } = {}) {
  const sent = []
  const registry = {
    token123: {
      page: entryPage,
      username: 'student',
      state: { storage: { alpha: '1', object: JSON.stringify({ ok: true }) } },
      createdAt: Date.now(),
    },
  }
  const parent = { __KG_NEW_LEGACY_BOOTSTRAP__: registry, postMessage: (message) => sent.push(message) }
  const context = {
    URLSearchParams,
    Map,
    Object,
    String,
    queueMicrotask,
    location: { search: '?frameToken=token123', pathname: `/new-legacy/${expectedPage}`, origin: 'http://app.test' },
    parent,
  }
  context.window = context
  vm.createContext(context)
  vm.runInContext(readFileSync(adapterPath, 'utf8'), context, { filename: adapterPath })
  return { context, registry, sent }
}

test('server state storage is preloaded, synchronous, and single-use', async () => {
  assert.ok(existsSync(adapterPath), 'expected server state bootstrap asset')
  const { context, registry, sent } = execute()
  const storage = context.KGServerStateStorage
  assert.equal(storage.getItem('alpha'), '1')
  assert.equal(storage.length, 2)
  assert.equal(registry.token123, undefined)
  storage.setItem('alpha', 2)
  await new Promise((resolvePromise) => queueMicrotask(resolvePromise))
  assert.equal(storage.getItem('alpha'), '2')
  assert.equal(sent.at(-1).type, 'state:changed')
  assert.equal(sent.at(-1).payload.key, 'alpha')
})

test('a frame cannot consume bootstrap data for a different page', () => {
  const { context, registry } = execute({ entryPage: 'question-workspace.html' })
  assert.equal(context.KGServerStateStorage.length, 0)
  assert.ok(registry.token123)
})

test('generated upstream scripts use memory storage instead of native localStorage', () => {
  const generated = resolve(frontendDir, 'public/new-legacy/src/88-guided-learning-store.js')
  assert.ok(existsSync(generated), 'run sync:new-legacy before this assertion')
  const source = readFileSync(generated, 'utf8')
  assert.doesNotMatch(source, /\blocalStorage\b/)
  assert.match(source, /KGServerStateStorage/)
})
