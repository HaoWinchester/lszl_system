import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const syncScript = resolve(scriptsDir, 'sync-new-legacy.js')
const requiredPages = [
  'index.html',
  'learning-path.html',
  'guided-learning-node.html',
  'guided-learning-placement-test.html',
  'question-training.html',
  'question-workspace.html',
  'knowledge-recall.html',
]
const requiredFiles = [
  'src/01-runtime-config.js',
  'src/23-graph-file-store.js',
  'src/64-flow-orchestrator.js',
  'src/86-activity-schema-v1.js',
  'src/87-guided-learning-data.js',
  'src/88-guided-learning-store.js',
  'src/89-guided-learning-app.js',
  'src/90-guided-learning-node-app.js',
  'schemas/activity-schema-v1.json',
]

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function files(root, base = root) {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(root, entry.name)
      return entry.isDirectory() ? files(path, base) : [relative(base, path)]
    })
    .sort()
}

function hashTree(root) {
  const hash = createHash('sha256')
  for (const path of files(root)) {
    hash.update(path)
    hash.update(readFileSync(resolve(root, path)))
  }
  return hash.digest('hex')
}

function fixture({ omit } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'kg-new-legacy-sync-'))
  const upstream = resolve(root, 'new-legacy')
  const output = resolve(root, 'output')
  mkdirSync(upstream, { recursive: true })
  write(resolve(upstream, 'VERSION'), 'v8.6.0\n')
  for (const page of requiredPages) {
    if (page === omit) continue
    const authScript = page === 'index.html'
      ? '<script defer src="src/24-graph-file-autosave.js"></script><script defer src="src/30-auth-guards.js"></script>'
      : page === 'question-training.html'
        ? '<script defer src="src/72-question-training-page.js"></script>'
        : ''
    write(resolve(upstream, page), `<!doctype html><html><head></head><body><script defer src="src/01-runtime-config.js"></script>${authScript}</body></html>`)
  }
  for (const path of requiredFiles) {
    if (path === omit) continue
    const content = path.endsWith('.json')
      ? '{"type":"object"}\n'
      : path === 'src/64-flow-orchestrator.js'
        ? `'use strict';\n(function(global){\n  let active=null;\n  let runtimeKey='';\n  function useSession(session,reason='restore'){\n    active=session;\n    try{global.dispatchEvent(new CustomEvent('kg:learning-session-changed',{detail:{reason,session:active}}))}catch(e){}\n    return active;\n  }\n  function persist(current,saved){\n    active=saved;\n    runtimeKey=makeRuntimeKey(saved);\n    return saved;\n  }\n})(window);\n`
        : `'use strict';\n`
    write(resolve(upstream, path), content)
  }
  return { root, upstream, output }
}

function runSync(item) {
  return spawnSync(process.execPath, [syncScript, '--source', item.upstream, '--out', item.output], {
    encoding: 'utf8',
  })
}

test('sync copies v8.6.0 and injects the direct runtime without editing upstream', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  const before = hashTree(item.upstream)

  const result = runSync(item)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(hashTree(item.upstream), before)
  assert.equal(JSON.parse(readFileSync(resolve(item.output, 'manifest.json'), 'utf8')).version, 'v8.6.0')
  const page = readFileSync(resolve(item.output, 'learning-path.html'), 'utf8')
  assert.match(page, /server-state-bootstrap\.js/)
  assert.match(page, /direct-entry\.js/)
  assert.doesNotMatch(page, /new-legacy-navigation-bridge\.js/)
  assert.match(readFileSync(resolve(item.output, 'src/64-flow-orchestrator.js'), 'utf8'), /publishingSessionChange/)
  assert.match(readFileSync(resolve(item.output, 'src/64-flow-orchestrator.js'), 'utf8'), /if\(!saved\)return clone\(current\)/)
})

test('sync fails closed when a required page is missing', (t) => {
  const item = fixture({ omit: 'learning-path.html' })
  t.after(() => rmSync(item.root, { recursive: true, force: true }))

  const result = runSync(item)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /learning-path\.html/)
})

test('sync rejects an unregistered future business-storage key', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'src/23-graph-file-store.js'), "localStorage.setItem('kg_future_business_state_v1', '{}')\n")

  const result = runSync(item)

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /kg_future_business_state_v1/)
  assert.match(result.stderr, /未登记/)
})

test('sync is reproducible for the same source tree', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))

  assert.equal(runSync(item).status, 0)
  const first = hashTree(item.output)
  assert.equal(runSync(item).status, 0)
  assert.equal(hashTree(item.output), first)
})

test('sync preserves upstream javascript instead of parsing localStorage identifiers', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  const source = `'use strict';\nlocalStorage.setItem('kg_default_entry_mode_v1', 'free');\nconst escaped = value => value.replace(/[&<>'"]/g, '');\nlocalStorage.setItem('kg_question_language_mode_v1', 'zh');\n`
  write(resolve(item.upstream, 'src/65-question-bank-admin.js'), source)

  const result = runSync(item)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(resolve(item.output, 'src/65-question-bank-admin.js'), 'utf8'), source)
})

test('sync injects server storage before any upstream inline script', (t) => {
  const item = fixture()
  t.after(() => rmSync(item.root, { recursive: true, force: true }))
  write(resolve(item.upstream, 'learning-path.html'), `<!doctype html><html><head><script>localStorage.getItem('kg_default_entry_mode_v1')</script></head><body><script defer src="src/01-runtime-config.js"></script></body></html>`)

  const result = runSync(item)

  assert.equal(result.status, 0, result.stderr)
  const generated = readFileSync(resolve(item.output, 'learning-path.html'), 'utf8')
  assert.ok(generated.indexOf('server-state-bootstrap.js') < generated.indexOf("localStorage.getItem('kg_default_entry_mode_v1')"))
})
