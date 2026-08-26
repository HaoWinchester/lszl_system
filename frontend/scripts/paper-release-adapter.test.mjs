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
const recallQuestionSource = read(resolve(root, 'new-legacy/src/96-recall-question-source.js'))
const syncScript = read(resolve(frontendRoot, 'scripts/sync-new-legacy.js'))

test('deep recall source does not preload every paper on the multi-question page', async () => {
  let listAllRequests = 0
  const listeners = new Map()
  const publishedKey = ['kg', 'exam', 'papers', 'published', 'v1'].join('_')
  const historyKey = ['kg', 'exam', 'paper', 'release', 'history', 'v1'].join('_')
  const context = {
    console,
    Promise,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail } },
    document: { body: { classList: { contains: name => name === 'question-workspace-page' } } },
    addEventListener(type, listener) { listeners.set(type, listener) },
    dispatchEvent(event) { listeners.get(event.type)?.(event) },
    KGQuestionCatalogAdapter: { ready: Promise.resolve() },
    KGPublishedPaperRepository: {
      storageKey: publishedKey,
      historyKey,
      async ready() {},
      async listPublishedPapers() { listAllRequests += 1; return [] },
    },
  }
  context.window = context
  context.globalThis = context
  vm.runInNewContext(recallQuestionSource, context, { filename: '96-recall-question-source.js' })

  await new Promise(resolveTurn => setImmediate(resolveTurn))
  context.dispatchEvent(new context.CustomEvent('kg:published-papers-changed'))
  context.dispatchEvent(new context.CustomEvent('kg-app-storage-change', {
    detail: { key: publishedKey },
  }))
  await new Promise(resolveTurn => setImmediate(resolveTurn))

  assert.equal(listAllRequests, 0)
})

test('deep recall demand-loads only the active paper', async () => {
  const questionRequests = []
  const catalog = [
    { paperId: 'paper-1', releaseId: 'release-1', version: 1, name: '第一份试卷', status: 'published', availability: 'published', totalCount: 1, enabledModes: ['deep_recall'], allowedRoles: [], accessPolicy: { accessLevel: 'free' } },
    { paperId: 'paper-2', releaseId: 'release-2', version: 1, name: '第二份试卷', status: 'published', availability: 'published', totalCount: 1, enabledModes: ['deep_recall'], allowedRoles: [], accessPolicy: { accessLevel: 'free' } },
    { paperId: 'paper-3', releaseId: 'release-3', version: 1, name: '第三份试卷', status: 'published', availability: 'published', totalCount: 1, enabledModes: ['deep_recall'], allowedRoles: [], accessPolicy: { accessLevel: 'free' } },
  ]
  const listeners = new Map()
  const context = {
    console: { log: console.log, warn: console.warn, error() {} },
    Promise,
    document: { body: { classList: { contains: name => name === 'knowledge-recall-page' } } },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail } },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(listener)
    },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event) },
    KGQuestionCatalogAdapter: { ready: new Promise(() => {}) },
    KGPaperReleaseApi: {
      catalog: () => catalog,
      ready: async () => catalog,
      detail: async releaseId => catalog.find(row => row.releaseId === releaseId) || null,
      async fetchQuestions(releaseId) {
        questionRequests.push(releaseId)
        if (releaseId === 'release-3') throw new Error('network unavailable')
        const release = catalog.find(row => row.releaseId === releaseId)
        return {
          release,
          items: [{
            bankId: `bank-${releaseId}`,
            questionId: `question-${releaseId}`,
            order: 1,
            snapshot: { question: { id: `question-${releaseId}`, title: `${release.name}题目`, stemParts: [], options: [] } },
          }],
        }
      },
      invalidate() {},
    },
    KGRolePermissions: { currentRole: () => 'student', canAccessPublishedPaper: () => true, canOperateQuestion: () => true },
    KGPaperAccessService: { inspect: () => ({ allowed: true, accessLevel: 'free' }) },
  }
  context.window = context
  context.globalThis = context
  vm.runInNewContext(repository, context, { filename: '59-published-paper-repository.js' })
  vm.runInNewContext(resolver, context, { filename: '59a-published-question-resolver.js' })
  vm.runInNewContext(recallQuestionSource, context, { filename: '96-recall-question-source.js' })

  const collections = await context.KGRecallQuestionSource.rebuild({ paperId: 'paper-1', releaseId: 'release-1' })

  assert.deepEqual(questionRequests, ['release-1'])
  assert.equal(collections.length, 3)
  assert.equal(collections[0].questions.length, 1)
  assert.equal(collections[1].questions.length, 0)

  const switched = await context.KGRecallQuestionSource.loadCollection('paper-release:release-2')
  assert.deepEqual(questionRequests, ['release-1', 'release-2'])
  assert.equal(switched.questions.length, 1)

  await context.KGRecallQuestionSource.loadCollection('paper-release:release-1')
  assert.deepEqual(questionRequests, ['release-1', 'release-2'])

  await assert.rejects(
    context.KGRecallQuestionSource.loadCollection('paper-release:release-3'),
    /network unavailable/,
  )
  assert.deepEqual(questionRequests, ['release-1', 'release-2', 'release-3'])
})

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

test('identical concurrent question loads share one pagination request', async () => {
  let releaseQuestions
  const gate = new Promise(resolveGate => { releaseQuestions = resolveGate })
  let questionRequests = 0
  const context = {
    console,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail } },
    addEventListener() {},
    dispatchEvent() {},
    async fetch(url) {
      if (String(url).includes('/questions?')) {
        questionRequests += 1
        await gate
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              total: 2,
              nextOffset: 2,
              release: { paperId: 'paper-1', releaseId: 'release-1', version: 1, questionCount: 2 },
              questions: [
                { bankId: 'bank-1', questionId: 'question-1', orderIndex: 1, question: { id: 'question-1' } },
                { bankId: 'bank-1', questionId: 'question-2', orderIndex: 2, question: { id: 'question-2' } },
              ],
            }
          },
        }
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { releases: [{ paperId: 'paper-1', releaseId: 'release-1', version: 1, questionCount: 2 }], total: 1 }
        },
      }
    },
  }
  context.window = context
  context.globalThis = context
  vm.runInNewContext(adapter, context, { filename: 'paper-release-adapter.js' })
  await context.KGPaperReleaseApi.ready()

  const first = context.KGPaperReleaseApi.fetchQuestions('release-1')
  const second = context.KGPaperReleaseApi.fetchQuestions('release-1')
  await Promise.resolve()
  assert.equal(questionRequests, 1)
  releaseQuestions()
  const [firstResult, secondResult] = await Promise.all([first, second])

  assert.deepEqual(Array.from(firstResult.items, item => item.questionId), ['question-1', 'question-2'])
  assert.deepEqual(Array.from(secondResult.items, item => item.questionId), ['question-1', 'question-2'])
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

test('publish payload returns the server-assigned release version and identity', async () => {
  const requests = []
  const context = {
    console,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail } },
    addEventListener() {},
    dispatchEvent() {},
    async fetch(url, options = {}) {
      requests.push({ url: String(url), options })
      if (options.method === 'POST') {
        return {
          ok: true,
          status: 200,
          async json() {
            return { release: { releaseId: 'server-release-v2', paperId: 'paper-stale', version: 2 } }
          },
        }
      }
      return { ok: true, status: 200, async json() { return { releases: [], total: 0 } } }
    },
  }
  context.window = context
  context.globalThis = context
  vm.runInNewContext(adapter, context, { filename: 'paper-release-adapter.js' })
  await context.KGPaperReleaseApi.ready()

  const release = await context.KGPaperReleaseApi.publishPayload({
    releaseId: 'client-release-v1', paperId: 'paper-stale', version: 1,
  })

  assert.equal(release.version, 2)
  assert.equal(release.releaseId, 'server-release-v2')
  const published = requests.find(item => item.options.method === 'POST')
  assert.equal(published.url, '/api/v1/paper-releases/publish-payload')
  assert.equal(published.options.headers['content-type'], 'application/json')
  assert.equal(JSON.parse(published.options.body).releaseId, 'client-release-v1')
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
    if (page === 'index.html') {
      const plan = JSON.parse(read(resolve(frontendRoot, 'scripts/homepage-bundles.json')))
      assert.equal(plan.groups.flatMap(group => group.scripts).filter(asset => asset === 'paper-release-adapter.js').length, 1, page)
      assert.match(read(resolve(frontendRoot, 'public/new-legacy/bundles/home-question.js')), /paper-release-adapter\.js/)
    } else {
      const html = read(resolve(frontendRoot, `public/new-legacy/${page}`))
      assert.equal((html.match(/paper-release-adapter\.js/g) || []).length, 1, page)
    }
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
