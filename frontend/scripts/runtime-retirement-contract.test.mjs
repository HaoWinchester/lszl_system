import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import test from 'node:test'

const frontend = resolve(import.meta.dirname, '..')
const repo = resolve(frontend, '..')
const readRepo = (path) => readFileSync(resolve(repo, path), 'utf8')
const generatedPath = (page) => page === 'content-prep.html'
  ? 'content-prep-studio/dist/content-prep.html'
  : page
const readGenerated = (page) => readFileSync(resolve(frontend, 'public/new-legacy', generatedPath(page)), 'utf8')

function walkFiles(root) {
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function applicationFiles(root) {
  return walkFiles(root).filter(path => {
    const pathFromRoot = relative(root, path)
    return /\.(?:html|js)$/.test(path) && !/(^|[/\\])tests?([/\\]|$)/.test(pathFromRoot)
  })
}

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

const directTeachingPages = ['admin-subjects.html', 'content-center.html', 'content-prep.html', ...retiredRuntimePages]

const directAccountPages = [
  'user-management.html',
  'system-settings.html',
  'question-bank.html',
  'paper-management.html',
]

test('runtime retirement removes policy and executable bootstrap assets', () => {
  const asset = (path) => resolve(frontend, 'scripts/new-legacy-assets', path)
  assert.equal(existsSync(resolve(repo, 'backend/app/web/runtime_page_policy.json')), false)
  assert.equal(existsSync(resolve(frontend, 'scripts/runtime-page-policy.json')), false)
  assert.equal(existsSync(asset('server-state-bootstrap.js')), false)
  assert.deepEqual(JSON.parse(readFileSync(asset('runtime-retirement.json'), 'utf8')), {
    schemaVersion: 1,
    status: 'retired',
    runtimeRequests: 0,
  })
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

test('all generated application pages are free of the retired Runtime bootstrap', () => {
  for (const page of [...learnerPages, ...directAccountPages, ...directTeachingPages]) {
    assert.doesNotMatch(readGenerated(page), /server-state-bootstrap\.js/, page)
  }
})

test('recursive generated and source application scan has no Runtime route or asset', () => {
  const generatedRoot = resolve(frontend, 'public/new-legacy')
  const generatedHtml = applicationFiles(generatedRoot).filter(path => path.endsWith('.html'))
  assert.ok(generatedHtml.length > 0)
  assert.ok(
    generatedHtml.some(path => relative(generatedRoot, path) === 'content-prep-studio/dist/content-prep.html'),
    'nested generated HTML must be included',
  )
  for (const root of [generatedRoot, resolve(repo, 'new-legacy'), resolve(frontend, 'scripts/new-legacy-assets')]) {
    for (const path of applicationFiles(root)) {
      const source = readFileSync(path, 'utf8')
      assert.doesNotMatch(source, /\/api\/v1\/runtime\//, path)
      assert.doesNotMatch(source, /server-state-bootstrap\.js/, path)
    }
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
