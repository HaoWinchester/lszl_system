import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(scriptsDir, '..')
const adapterPath = resolve(scriptsDir, 'new-legacy-assets/paper-draft-adapter.js')
const adapter = readFileSync(adapterPath, 'utf8')
const syncScript = readFileSync(resolve(scriptsDir, 'sync-new-legacy.js'), 'utf8')

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload },
  }
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function domainApi(fetchImpl) {
  return {
    async request({ method = 'GET', path, body }) {
      const response = await fetchImpl(path, {
        method,
        credentials: 'include',
        headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const payload = await response.json()
      if (!response.ok) {
        const detail = payload?.detail
        const error = new Error(!Array.isArray(detail) && detail?.message ? detail.message : `HTTP ${response.status}`)
        error.status = response.status
        error.code = !Array.isArray(detail) && detail?.code ? detail.code : (response.status === 422 ? 'VALIDATION_ERROR' : `HTTP_${response.status}`)
        error.detail = detail
        if (!Array.isArray(detail) && detail?.currentRevision !== undefined) error.currentRevision = detail.currentRevision
        throw error
      }
      return payload
    },
  }
}

function loadAdapter(fetchImpl) {
  const events = []
  const context = {
    console,
    URLSearchParams,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail }
    },
    dispatchEvent(event) { events.push(event) },
    addEventListener() {},
    KGDomainApi: domainApi(fetchImpl),
  }
  context.window = context
  context.globalThis = context
  vm.runInNewContext(adapter, context, { filename: 'paper-draft-adapter.js' })
  return { api: context.KGPaperDraftApi, events, context }
}

test('adapter exposes the complete paper draft API without browser persistence', () => {
  for (const method of [
    'ready', 'list', 'detail', 'create', 'update', 'replaceQuestions', 'remove',
    'invalidatePaper', 'invalidateLists',
    'listCategories', 'createCategory', 'updateCategory', 'removeCategory',
    'importPreflight', 'importPaper', 'compositionPreflight', 'createCompositionBatch',
  ]) {
    assert.match(adapter, new RegExp(`\\b${method}\\b`), method)
  }
  assert.doesNotMatch(adapter, /localStorage/)
  assert.doesNotMatch(adapter, /sessionStorage/)
  assert.doesNotMatch(adapter, /indexedDB/i)
})

test('ready and paper detail share in-flight work and support explicit invalidation', async () => {
  const calls = []
  const { api } = loadAdapter(async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method })
    if (url === '/api/v1/papers') return response(200, { papers: [{ id: 'paper-1', name: '摘要' }] })
    if (url === '/api/v1/paper-categories') return response(200, { categories: [] })
    if (url === '/api/v1/papers/paper-1') return response(200, { paper: { id: 'paper-1', questions: [] } })
    throw new Error(`unexpected request: ${url}`)
  })

  await Promise.all([api.ready(), api.ready()])
  assert.equal(calls.filter(call => call.url === '/api/v1/papers').length, 1)
  assert.equal(calls.filter(call => call.url === '/api/v1/paper-categories').length, 1)

  await Promise.all([api.detail('paper-1'), api.detail('paper-1')])
  assert.equal(calls.filter(call => call.url === '/api/v1/papers/paper-1').length, 1)
  api.invalidatePaper('paper-1')
  await api.detail('paper-1')
  assert.equal(calls.filter(call => call.url === '/api/v1/papers/paper-1').length, 2)

  api.invalidateLists()
  await api.ready()
  assert.equal(calls.filter(call => call.url === '/api/v1/papers').length, 2)
  assert.equal(calls.filter(call => call.url === '/api/v1/paper-categories').length, 2)
})

test('failed detail loads are evicted so a later retry can recover', async () => {
  let attempts = 0
  const { api } = loadAdapter(async url => {
    if (url !== '/api/v1/papers/paper-retry') throw new Error(`unexpected request: ${url}`)
    attempts += 1
    return attempts === 1
      ? response(500, { detail: { message: '暂时失败' } })
      : response(200, { paper: { id: 'paper-retry', revision: 3 } })
  })

  await assert.rejects(api.detail('paper-retry'), error => error.status === 500)
  assert.equal((await api.detail('paper-retry')).revision, 3)
  assert.equal(attempts, 2)
})

test('adapter sends exact endpoints, credentials, headers, and payloads', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    const path = String(url)
    if (path === '/api/v1/papers' && options.method === 'GET') {
      return response(200, { papers: [{ id: 'paper-1', name: '草稿一' }] })
    }
    if (path === '/api/v1/paper-categories' && options.method === 'GET') {
      return response(200, { categories: [{ id: 'category-1', name: '模拟卷' }] })
    }
    if (path === '/api/v1/papers/paper-1' && options.method === 'GET') {
      return response(200, { paper: { id: 'paper-1', revision: 2 } })
    }
    if (path === '/api/v1/papers' && options.method === 'POST') {
      return response(200, { paper: { id: 'paper-2', revision: 1 } })
    }
    if (path === '/api/v1/papers/paper-2' && options.method === 'PUT') {
      return response(200, { paper: { id: 'paper-2', revision: 2 } })
    }
    if (path === '/api/v1/papers/paper-2/questions' && options.method === 'PUT') {
      return response(200, { paper: { id: 'paper-2', revision: 3 } })
    }
    if (path === '/api/v1/papers/import/preflight') {
      return response(200, { preflight: { canImport: true, preflightHash: 'a'.repeat(64) } })
    }
    if (path === '/api/v1/papers/import') {
      return response(200, { result: { paperId: 'paper-imported' } })
    }
    if (path === '/api/v1/papers/composition/preflight') {
      return response(200, { preflight: { feasible: true, planHash: 'b'.repeat(64) } })
    }
    if (path === '/api/v1/papers/composition/batches') {
      return response(200, { result: { paperIds: ['paper-a', 'paper-b', 'paper-c'] } })
    }
    if (path === '/api/v1/papers/paper-2?revision=3&reason=%E9%87%8D%E5%A4%8D') {
      return response(200, { ok: true, deletion: { id: 'paper-2' } })
    }
    throw new Error(`unexpected request: ${options.method} ${path}`)
  }
  const { api, events } = loadAdapter(fetchImpl)

  const ready = await api.ready()
  assert.deepEqual(JSON.parse(JSON.stringify(ready)), {
    papers: [{ id: 'paper-1', name: '草稿一' }],
    categories: [{ id: 'category-1', name: '模拟卷' }],
  })
  ready.papers[0].name = '篡改副本'
  assert.equal((await api.list())[0].name, '草稿一')
  assert.equal((await api.detail('paper-1')).revision, 2)
  await api.create({ name: '草稿二' })
  await api.update('paper-2', { revision: 1, name: '草稿二改' })
  await api.replaceQuestions('paper-2', { revision: 2, questions: [] })
  await api.importPreflight({ fileName: 'paper.json', package: { format: 'kg-paper-package-v1' } })
  await api.importPaper({ preflightHash: 'a'.repeat(64), conflictAction: 'create' })
  await api.compositionPreflight({ bankIds: ['bank-1'], variants: [] })
  await api.createCompositionBatch({ planHash: 'b'.repeat(64), idempotencyKey: 'batch-1' })
  await api.remove('paper-2', { revision: 3, reason: '重复' })

  for (const call of calls) {
    assert.equal(call.options.credentials, 'include')
    assert.equal(call.options.headers.accept, 'application/json')
    if (call.options.body !== undefined) {
      assert.equal(call.options.headers['content-type'], 'application/json')
      assert.doesNotThrow(() => JSON.parse(call.options.body))
    }
  }
  assert.ok(events.filter(event => event.type === 'kg:paper-drafts-changed').length >= 6)
  const createCall = calls.find(call => call.url === '/api/v1/papers' && call.options.method === 'POST')
  assert.deepEqual(JSON.parse(createCall.options.body), { name: '草稿二' })
})

test('adapter normalizes auth, permission, conflict, and validation errors', async () => {
  for (const [status, detail, expected] of [
    [401, { code: 'AUTH_REQUIRED', message: '请登录' }, { code: 'AUTH_REQUIRED' }],
    [403, { code: 'FORBIDDEN', message: '无权限' }, { code: 'FORBIDDEN' }],
    [409, { code: 'REVISION_CONFLICT', message: '请刷新', currentRevision: 7 }, { code: 'REVISION_CONFLICT', currentRevision: 7 }],
    [422, [{ loc: ['body', 'name'], msg: '必填' }], { code: 'VALIDATION_ERROR' }],
  ]) {
    const { api, events } = loadAdapter(async () => response(status, { detail }))
    await assert.rejects(
      api.detail('paper-1'),
      error => error.status === status
        && error.code === expected.code
        && error.currentRevision === expected.currentRevision
        && error.detail !== undefined,
    )
    if (status === 401) {
      assert.equal(events.filter(event => event.type === 'kg:auth-required').length, 1)
    }
  }
})

test('failed mutations reject and never synthesize successful paper rows', async () => {
  const { api, events } = loadAdapter(async () => response(500, {
    detail: { code: 'INTERNAL_ERROR', message: '写入失败' },
  }))
  await assert.rejects(api.create({ name: '不会成功' }), error => error.status === 500)
  assert.equal(events.filter(event => event.type === 'kg:paper-drafts-changed').length, 0)
})

test('paper mutation caches settle before change observers reload the selected paper', async () => {
  let listLoads = 0
  let detailLoads = 0
  const loaded = loadAdapter(async (url, options = {}) => {
    if (url === '/api/v1/papers' && options.method === 'GET') {
      listLoads += 1
      return response(200, { papers: listLoads === 1
        ? [{ id: 'paper-old', name: '旧试卷' }]
        : [{ id: 'paper-new', name: '新试卷' }, { id: 'paper-old', name: '旧试卷' }] })
    }
    if (url === '/api/v1/papers' && options.method === 'POST') {
      return response(200, { paper: { id: 'paper-new', name: '新试卷', revision: 1 } })
    }
    if (url === '/api/v1/papers/paper-new' && options.method === 'GET') {
      detailLoads += 1
      return response(200, { paper: { id: 'paper-new', name: '新试卷', revision: 1 } })
    }
    throw new Error(`unexpected request: ${options.method} ${url}`)
  })
  const { api, context } = loaded
  await api.list()
  let detailSeenByObserver
  let listSeenByObserver
  context.dispatchEvent = event => {
    if (event.type !== 'kg:paper-drafts-changed' || event.detail.action !== 'create') return
    detailSeenByObserver = api.detail(event.detail.payload.paper.id)
    listSeenByObserver = api.list()
  }

  const created = await api.create({ name: '新试卷' })
  assert.equal(created.id, 'paper-new')
  assert.equal((await detailSeenByObserver).id, 'paper-new')
  assert.equal((await listSeenByObserver)[0].id, 'paper-new')
  assert.equal(detailLoads, 0)
  assert.equal(listLoads, 2)
})

test('an older pending paper list cannot overwrite or detach the post-create generation', async () => {
  const oldList = deferred()
  const newList = deferred()
  let listLoads = 0
  const { api } = loadAdapter(async (url, options = {}) => {
    if (url === '/api/v1/papers' && options.method === 'GET') {
      listLoads += 1
      return listLoads === 1 ? oldList.promise : newList.promise
    }
    if (url === '/api/v1/papers' && options.method === 'POST') {
      return response(200, { paper: { id: 'paper-new', name: '新试卷', revision: 1 } })
    }
    throw new Error(`unexpected request: ${options.method} ${url}`)
  })

  const staleRequest = api.list()
  await Promise.resolve()
  await api.create({ name: '新试卷' })
  const currentRequest = api.list()
  oldList.resolve(response(200, { papers: [{ id: 'paper-old', name: '旧试卷' }] }))
  assert.equal((await staleRequest)[0].id, 'paper-old')

  const coalescedRequest = api.list()
  assert.equal(listLoads, 2)
  newList.resolve(response(200, { papers: [{ id: 'paper-new', name: '新试卷' }] }))
  assert.equal((await currentRequest)[0].id, 'paper-new')
  assert.equal((await coalescedRequest)[0].id, 'paper-new')
  assert.equal((await api.list())[0].id, 'paper-new')
  assert.equal(listLoads, 2)
})

test('an old paper detail cannot overwrite a mutation-cached detail', async () => {
  const oldDetail = deferred()
  let detailLoads = 0
  const { api } = loadAdapter(async (url, options = {}) => {
    if (url === '/api/v1/papers/paper-1' && options.method === 'GET') {
      detailLoads += 1
      return oldDetail.promise
    }
    if (url === '/api/v1/papers/paper-1' && options.method === 'PUT') {
      return response(200, { paper: { id: 'paper-1', revision: 2, name: '新修订' } })
    }
    throw new Error(`unexpected request: ${options.method} ${url}`)
  })

  const stale = api.detail('paper-1')
  await Promise.resolve()
  await api.update('paper-1', { revision: 1, name: '新修订' })
  oldDetail.resolve(response(200, { paper: { id: 'paper-1', revision: 1, name: '旧详情' } }))
  assert.equal((await stale).revision, 1)

  assert.equal((await api.detail('paper-1')).revision, 2)
  assert.equal(detailLoads, 1)
})

test('an old paper detail cannot detach or overwrite a newer detail load for the same id', async () => {
  const oldDetail = deferred()
  const newDetail = deferred()
  let detailLoads = 0
  const { api } = loadAdapter(async (url, options = {}) => {
    if (url !== '/api/v1/papers/paper-1' || options.method !== 'GET') throw new Error(`unexpected request: ${options.method} ${url}`)
    detailLoads += 1
    return detailLoads === 1 ? oldDetail.promise : newDetail.promise
  })

  const stale = api.detail('paper-1')
  await Promise.resolve()
  api.invalidatePaper('paper-1')
  const current = api.detail('paper-1')
  oldDetail.resolve(response(200, { paper: { id: 'paper-1', revision: 1 } }))
  await stale
  const coalesced = api.detail('paper-1')
  assert.equal(detailLoads, 2)

  newDetail.resolve(response(200, { paper: { id: 'paper-1', revision: 2 } }))
  assert.equal((await current).revision, 2)
  assert.equal((await coalesced).revision, 2)
  assert.equal((await api.detail('paper-1')).revision, 2)
})

test('an old category list cannot overwrite post-create categories or detach newer work', async () => {
  const oldCategories = deferred()
  const newCategories = deferred()
  let categoryLoads = 0
  const { api } = loadAdapter(async (url, options = {}) => {
    if (url === '/api/v1/paper-categories' && options.method === 'GET') {
      categoryLoads += 1
      return categoryLoads === 1 ? oldCategories.promise : newCategories.promise
    }
    if (url === '/api/v1/paper-categories' && options.method === 'POST') {
      return response(200, { category: { id: 'category-new', name: '新分类', revision: 1 } })
    }
    throw new Error(`unexpected request: ${options.method} ${url}`)
  })

  const stale = api.listCategories()
  await Promise.resolve()
  await api.createCategory({ name: '新分类' })
  const current = api.listCategories()
  oldCategories.resolve(response(200, { categories: [{ id: 'category-old', name: '旧分类' }] }))
  await stale
  const coalesced = api.listCategories()
  assert.equal(categoryLoads, 2)

  newCategories.resolve(response(200, { categories: [{ id: 'category-new', name: '新分类' }] }))
  assert.equal((await current)[0].id, 'category-new')
  assert.equal((await coalesced)[0].id, 'category-new')
  assert.equal((await api.listCategories())[0].id, 'category-new')
})

test('an old rejected ready cannot clear a newer ready promise', async () => {
  const oldPapers = deferred()
  const oldCategories = deferred()
  const newPapers = deferred()
  const newCategories = deferred()
  let paperLoads = 0
  let categoryLoads = 0
  const { api } = loadAdapter(async (url, options = {}) => {
    if (options.method !== 'GET') throw new Error(`unexpected request: ${options.method} ${url}`)
    if (url === '/api/v1/papers') {
      paperLoads += 1
      if (paperLoads === 1) return oldPapers.promise
      if (paperLoads === 2) return newPapers.promise
      return response(200, { papers: [{ id: 'paper-unexpected' }] })
    }
    if (url === '/api/v1/paper-categories') {
      categoryLoads += 1
      if (categoryLoads === 1) return oldCategories.promise
      if (categoryLoads === 2) return newCategories.promise
      return response(200, { categories: [{ id: 'category-unexpected' }] })
    }
    throw new Error(`unexpected request: ${options.method} ${url}`)
  })

  const stale = api.ready()
  await Promise.resolve()
  const current = api.ready({ forceReload: true })
  newPapers.resolve(response(200, { papers: [{ id: 'paper-new' }] }))
  newCategories.resolve(response(200, { categories: [{ id: 'category-new' }] }))
  assert.equal((await current).papers[0].id, 'paper-new')

  oldPapers.resolve(response(500, { detail: { message: '旧 ready 失败' } }))
  oldCategories.resolve(response(200, { categories: [{ id: 'category-old' }] }))
  await assert.rejects(stale, /old|HTTP 500|ready|\u65e7/)

  const cached = await api.ready()
  assert.equal(cached.papers[0].id, 'paper-new')
  assert.equal(cached.categories[0].id, 'category-new')
  assert.equal(paperLoads, 2)
  assert.equal(categoryLoads, 2)
})

test('sync injects the adapter exactly once before paper management application code', () => {
  assert.match(syncScript, /paper-draft-adapter\.js/)
  assert.match(syncScript, /kg-paper-drafts:generated/)
  const generated = readFileSync(resolve(frontendRoot, 'public/new-legacy/paper-management.html'), 'utf8')
  assert.equal((generated.match(/paper-draft-adapter\.js/g) || []).length, 1)
  assert.ok(generated.indexOf('paper-draft-adapter.js') < generated.indexOf('src/65-question-bank-admin.js'))
  const questionBank = readFileSync(resolve(frontendRoot, 'public/new-legacy/question-bank.html'), 'utf8')
  assert.equal((questionBank.match(/paper-draft-adapter\.js/g) || []).length, 1)
  assert.ok(questionBank.indexOf('paper-draft-adapter.js') < questionBank.indexOf('src/65-question-bank-admin.js'))
})
