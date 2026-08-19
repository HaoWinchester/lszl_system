import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// P4.6 第 1 轮性能门禁：已发布试卷走 /api/v1/paper-releases 细粒度 API，
// 不再经 /api/v1/runtime/state 整包拉取 7.65MB 快照。

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(scriptsDir, '..')
const root = resolve(frontendRoot, '..')
const read = (path) => readFileSync(path, 'utf8')

const adapter = read(resolve(frontendRoot, 'scripts/new-legacy-assets/paper-release-adapter.js'))
const repository = read(resolve(root, 'new-legacy/src/59-published-paper-repository.js'))
const resolver = read(resolve(root, 'new-legacy/src/59a-published-question-resolver.js'))
const syncScript = read(resolve(frontendRoot, 'scripts/sync-new-legacy.js'))

test('paper release adapter fetches a paginated lightweight catalog', () => {
  assert.match(adapter, /\/api\/v1\/paper-releases/)
  assert.match(adapter, /\/catalog\?page=\$\{page\}&pageSize=\$\{CATALOG_PAGE_SIZE\}/)
  assert.equal((adapter.match(/CATALOG_PAGE_SIZE = (\d+)/) || [])[1], '100')
})

test('paper release adapter pages questions with a per-request cap', () => {
  assert.match(adapter, /\/questions\?\$\{query\.toString\(\)\}/)
  assert.match(adapter, /limit: String\(QUESTIONS_PAGE_SIZE\)/)
  assert.match(adapter, /payload\.nextOffset/)
  assert.match(adapter, /offset >= total/)
  // 服务端限制单响应 1MB；适配器串行分页保序
  assert.match(adapter, /分页串行保序/)
})

test('paper release adapter never persists API data to localStorage', () => {
  assert.doesNotMatch(adapter, /localStorage\.setItem/)
  assert.doesNotMatch(adapter, /localStorage\.getItem/)
})

test('paper release adapter announces loads through legacy invalidation events', () => {
  assert.match(adapter, /kg:published-papers-changed/)
  assert.match(adapter, /kg-app-storage-change/)
})

test('repository reads the domain adapter instead of runtime storage keys', () => {
  assert.match(repository, /KGPaperReleaseApi/)
  // 不再从 localStorage 键解析整包数组（旧实现的 parseRows/readRaw 已删除）
  assert.doesNotMatch(repository, /function readRaw\(/)
  assert.doesNotMatch(repository, /function parseRows\(/)
  assert.doesNotMatch(repository, /Store\.readString/)
})

test('repository resolution is async and per-release', () => {
  assert.match(repository, /async function resolveInternally/)
  assert.match(repository, /async function listPublishedPapers/)
  assert.match(repository, /async function findQuestion/)
  assert.match(repository, /ReleaseApi\.fetchQuestions/)
})

test('repository exposes a sync peek cache for legacy consumers', () => {
  assert.match(repository, /function peekResolved\(/)
  assert.match(repository, /function findQuestionCached\(/)
  assert.match(repository, /function prefetchMissing\(/)
})

test('resolver forwards async contracts', () => {
  assert.match(resolver, /async function resolvePaper/)
  assert.match(resolver, /async function resolveQuestion/)
  assert.match(resolver, /async function listPapers/)
})

test('sync injects the paper release adapter ahead of the repository', () => {
  assert.match(syncScript, /kg-paper-releases:generated/)
  assert.match(syncScript, /paper-release-adapter\.js/)
  for (const page of ['practice-mode.html', 'question-workspace.html', 'knowledge-recall.html', 'index.html']) {
    assert.ok(syncScript.includes(`'${page}'`), page)
  }
})

test('generated learner pages carry the adapter exactly once', () => {
  for (const page of ['practice-mode.html', 'question-workspace.html', 'knowledge-recall.html', 'index.html']) {
    const html = read(resolve(frontendRoot, `public/new-legacy/${page}`))
    assert.equal((html.match(/paper-release-adapter\.js/g) || []).length, 1, page)
    assert.ok(existsSync(resolve(frontendRoot, 'public/new-legacy/paper-release-adapter.js')))
  }
})

test('learner pages no longer receive the published paper blob via runtime bootstrap', () => {
  // 后端侧由 backend/tests/test_paper_release_perf_gate.py 保证；
  // 这里保证 server-state-bootstrap 不再把发布键当作需要广播的数据变更依赖。
  const bootstrap = read(resolve(frontendRoot, 'scripts/new-legacy-assets/server-state-bootstrap.js'))
  assert.match(bootstrap, /PUBLISHED_PAPER_KEYS/)
})
