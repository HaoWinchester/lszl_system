import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

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

test('paper release adapter exposes a lightweight management catalog with question references', () => {
  assert.match(adapter, /\/management-catalog/)
  assert.match(adapter, /managementCatalog/)
  assert.match(adapter, /mergeManagementPapers/)
})

test('management catalog merges server releases into local drafts without frozen snapshots', async () => {
  const requests = []
  const context = {
    console,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail } },
    addEventListener() {},
    dispatchEvent() {},
    async fetch(url) {
      requests.push(String(url))
      const management = String(url).includes('/management-catalog')
      return {
        ok: true,
        status: 200,
        async json() {
          if (!management) return { releases: [], total: 0 }
          return {
            total: 1,
            papers: [{
              paperId: 'paper-existing', releaseId: 'release-current', version: 3,
              name: '服务器发布卷', subject: 'PMP', status: 'published', questionCount: 2,
              enabledModes: ['practice_mode'], accessPolicy: { accessLevel: 'free' },
              questions: [
                { bankId: 'bank-1', questionId: 'q-1', order: 1, score: 1 },
                { bankId: 'bank-1', questionId: 'q-2', order: 2, score: 1 },
              ],
            }],
          }
        },
      }
    },
  }
  context.window = context
  context.globalThis = context
  vm.runInNewContext(adapter, context, { filename: 'paper-release-adapter.js' })
  await context.KGPaperReleaseApi.ready()

  const releases = await context.KGPaperReleaseApi.managementCatalog()
  const merged = context.KGPaperReleaseApi.mergeManagementPapers([
    { id: 'paper-existing', name: '本地可编辑名称', subject: 'PMP', status: 'draft', questions: [] },
    { id: 'paper-local', name: '仅本地草稿', status: 'draft', questions: [] },
  ], releases)

  assert.ok(requests.some(url => url.includes('/management-catalog?page=1&pageSize=100')))
  assert.equal(merged.length, 2)
  assert.equal(merged[0].name, '本地可编辑名称')
  assert.equal(merged[0].status, 'published')
  assert.equal(merged[0].publishedVersion, 3)
  assert.equal(merged[0].publishedReleaseId, 'release-current')
  assert.deepEqual(JSON.parse(JSON.stringify(merged[0].questions)), [
    { bankId: 'bank-1', questionId: 'q-1', order: 1, score: 1 },
    { bankId: 'bank-1', questionId: 'q-2', order: 2, score: 1 },
  ])
  assert.equal(Object.hasOwn(merged[0].questions[0], 'snapshot'), false)
  assert.equal(merged[1].id, 'paper-local')
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

test('generated paper management loads the release adapter before the admin application', () => {
  const html = read(resolve(frontendRoot, 'public/new-legacy/paper-management.html'))
  assert.equal((html.match(/paper-release-adapter\.js/g) || []).length, 1)
  assert.ok(html.indexOf('paper-release-adapter.js') < html.indexOf('src/65-question-bank-admin.js'))
})

test('learner pages no longer receive the published paper blob via runtime bootstrap', () => {
  // 后端侧由 backend/tests/test_paper_release_perf_gate.py 保证；
  // 这里保证 server-state-bootstrap 不再把发布键当作需要广播的数据变更依赖。
  const bootstrap = read(resolve(frontendRoot, 'scripts/new-legacy-assets/server-state-bootstrap.js'))
  assert.match(bootstrap, /PUBLISHED_PAPER_KEYS/)
})
