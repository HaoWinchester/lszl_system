import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const frontend = resolve(import.meta.dirname, '..')
const repo = resolve(frontend, '..')
const readRepo = (path) => readFileSync(resolve(repo, path), 'utf8')
const generatedPath = (page) => page === 'content-prep.html'
  ? 'content-prep-studio/dist/content-prep.html'
  : page
const readGenerated = (page) => readFileSync(resolve(frontend, 'public/new-legacy', generatedPath(page)), 'utf8')

const learnerPages = [
  'index.html',
  'workbench.html',
  'file-manager.html',
  'practice-mode.html',
  'knowledge-recall.html',
  'question-workspace.html',
  'question-training.html',
  'learning-path.html',
  'guided-learning-node.html',
  'guided-learning-placement-test.html',
]

const retiredRuntimePages = [
  'admin-console.html',
  'admin-operations.html',
  'admin-settings.html',
  'course-admin.html',
  'teacher-workbench.html',
]

const runtimePages = []

const directTeachingPages = ['admin-subjects.html', 'content-center.html', 'content-prep.html', ...retiredRuntimePages]

const directAccountPages = [
  'user-management.html',
  'system-settings.html',
  'question-bank.html',
  'paper-management.html',
]

test('runtime pages are an explicit minimal allowlist', () => {
  const policy = JSON.parse(readRepo('backend/app/web/runtime_page_policy.json'))
  const syncPolicy = JSON.parse(readRepo('frontend/scripts/runtime-page-policy.json'))
  assert.deepEqual(syncPolicy, policy, 'release harness policy mirror must match the backend source of truth')
  assert.deepEqual([...policy.runtimePages].sort(), runtimePages)
  for (const page of learnerPages) assert.equal(policy.runtimePages.includes(page), false, page)
})

test('direct pages keep auth bootstrap without loading the legacy runtime', () => {
  const directEntry = readRepo('frontend/scripts/new-legacy-assets/direct-entry.js')
  assert.match(directEntry, /__KG_DIRECT_BOOTSTRAP__/)
  assert.match(directEntry, /authenticated[,\s]/)
  assert.match(directEntry, /authUser:/)
  for (const page of [...learnerPages, ...directAccountPages, ...directTeachingPages]) {
    const html = readGenerated(page)
    assert.match(html, /kg-direct-bootstrap-anchor/, `${page} must expose the direct bootstrap anchor`)
    assert.doesNotMatch(html, /server-state-bootstrap\.js/, `${page} must not load legacy runtime`)
  }
})

test('retired admin runtime pages use direct bootstrap and never load runtime', () => {
  for (const page of retiredRuntimePages) {
    const html = readGenerated(page)
    assert.match(html, /kg-direct-bootstrap-anchor/, `${page} must expose the direct bootstrap anchor`)
    assert.doesNotMatch(html, /server-state-bootstrap\.js/, `${page} must not load retired runtime`)
  }
})

test('retired guided learning pages are redirect-only shells', () => {
  for (const page of ['learning-path.html', 'guided-learning-node.html', 'guided-learning-placement-test.html']) {
    const html = readRepo(`new-legacy/${page}`)
    assert.match(html, /location\.replace\(/, page)
    assert.match(html, /practice-mode\.html/, page)
    assert.doesNotMatch(html, /<script[^>]+src=/, page)
    assert.doesNotMatch(html, /guided-learning-(?:data|store|app|node|placement)/, page)
  }
  assert.doesNotMatch(readRepo('new-legacy/file-manager.html'), /href="learning-path\.html"/)
})

test('multi-question workspaces persist through the domain API adapter', () => {
  const adapter = readRepo('frontend/scripts/new-legacy-assets/canvas-workspace-adapter.js')
  const store = readRepo('new-legacy/src/65-canvas-workspace-store.js')
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) assert.match(adapter, new RegExp(`['"]${method}['"]`))
  assert.match(adapter, /\/api\/v1\/workspaces/)
  assert.doesNotMatch(adapter, /\/api\/v1\/runtime/)
  assert.match(adapter, /pmp-pattern-workspace/)
  assert.match(adapter, /stableHash\(username\)/)
  assert.match(adapter, /payload\?\.id\s*\|\|\s*remoteId/)
  assert.match(adapter, /inFlight\.values\(\)/)
  assert.match(adapter, /pagehide/)
  assert.match(adapter, /leaving\s*=\s*true/)
  assert.match(adapter, /keepalive:\s*true,\s*silent:\s*true/)
  assert.match(store, /replaceAllFromServer/)
  for (const page of ['file-manager.html', 'question-workspace.html']) {
    const html = readGenerated(page)
    assert.match(html, /canvas-workspace-adapter\.js/, page)
    assert.ok(html.indexOf('65-canvas-workspace-store.js') < html.indexOf('canvas-workspace-adapter.js'), page)
  }
})
