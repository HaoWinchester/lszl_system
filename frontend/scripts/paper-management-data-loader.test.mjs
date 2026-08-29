import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const repoDir = resolve(scriptsDir, '..', '..')
const loaderPath = resolve(scriptsDir, 'new-legacy-assets', 'paper-management-data-loader.js')
const paperPageScriptPath = resolve(repoDir, 'new-legacy', 'src', '65-question-bank-admin.js')

function deferred() {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

function loadFactory() {
  const context = { console }
  context.window = context
  context.globalThis = context
  vm.runInNewContext(readFileSync(loaderPath, 'utf8'), context, { filename: loaderPath })
  return context.KGPaperManagementDataLoader
}

function catalogApi(overrides = {}) {
  return {
    ready: Promise.resolve(),
    snapshot: () => ({ banks: [{ id: 'bank-1', name: '题库一' }], questions: [] }),
    loadBankQuestionPage: async (bankId, options) => ({
      questions: [{ id: `${bankId}-q1` }], total: 1, page: options.page, pageSize: options.pageSize,
    }),
    ...overrides,
  }
}

test('initialize exposes five summaries before requesting only the selected detail', async () => {
  const selected = deferred()
  const detailCalls = []
  const changes = []
  const papers = Array.from({ length: 5 }, (_, index) => ({ id: `paper-${index + 1}`, name: `试卷 ${index + 1}` }))
  const loader = loadFactory().create({
    paperApi: {
      ready: async () => ({ papers, categories: [{ id: 'cat-1' }] }),
      detail: async id => { detailCalls.push(id); return selected.promise },
    },
    catalogApi: catalogApi(),
    onChange: snapshot => changes.push(snapshot),
  })

  const initializing = loader.initialize({ preferredPaperId: 'paper-3' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(changes.at(-1).papers.length, 5)
  assert.equal(changes.at(-1).selectedPaperId, 'paper-3')
  assert.equal(changes.at(-1).selectedPaper, null)
  assert.deepEqual(detailCalls, ['paper-3'])

  selected.resolve({ id: 'paper-3', questions: [{ questionId: 'q-1' }] })
  await initializing
  assert.equal(changes.at(-1).selectedPaper.id, 'paper-3')
})

test('late paper detail responses cannot overwrite the latest selection', async () => {
  const pendingA = deferred()
  const pendingB = deferred()
  const loader = loadFactory().create({
    paperApi: {
      ready: async () => ({ papers: [{ id: 'A' }, { id: 'B' }], categories: [] }),
      detail: id => id === 'A' ? pendingA.promise : pendingB.promise,
    },
    catalogApi: catalogApi(),
  })

  const initialize = loader.initialize({ preferredPaperId: '' })
  await new Promise(resolve => setTimeout(resolve, 0))
  const selectB = loader.selectPaper('B')
  pendingB.resolve({ id: 'B', questions: [] })
  await selectB
  pendingA.resolve({ id: 'A', questions: [] })
  await initialize
  assert.equal(loader.snapshot().selectedPaperId, 'B')
  assert.equal(loader.snapshot().selectedPaper.id, 'B')
})

test('an invalidated pending paper refresh cannot publish stale summaries or selection', async () => {
  const oldList = deferred()
  const newList = deferred()
  let listCalls = 0
  let oldIsCurrent = true
  const changes = []
  const loader = loadFactory().create({
    paperApi: {
      ready: async () => (++listCalls === 1 ? oldList.promise : newList.promise),
      detail: async id => ({ id, questions: [] }),
    },
    catalogApi: catalogApi(),
    onChange: snapshot => changes.push(snapshot),
  })

  const staleRefresh = loader.refreshPapers({ preferredPaperId: 'paper-old', shouldApply: () => oldIsCurrent })
  await Promise.resolve()
  oldIsCurrent = false
  oldList.resolve({ papers: [{ id: 'paper-old' }], categories: [] })
  await staleRefresh
  assert.equal(changes.some(snapshot => snapshot.selectedPaperId === 'paper-old'), false)

  const currentRefresh = loader.refreshPapers({ preferredPaperId: 'paper-new', shouldApply: () => true })
  newList.resolve({ papers: [{ id: 'paper-new' }], categories: [] })
  await currentRefresh
  assert.equal(loader.snapshot().selectedPaperId, 'paper-new')
})

test('invalidation while old detail is pending blocks every later old publish even when the replacement fails', async () => {
  const oldDetail = deferred()
  let readyCalls = 0
  let oldIsCurrent = true
  const changes = []
  const loader = loadFactory().create({
    paperApi: {
      ready: async () => {
        readyCalls += 1
        if (readyCalls === 1) return { papers: [{ id: 'paper-old' }], categories: [] }
        throw new Error('新一代刷新失败')
      },
      detail: id => id === 'paper-old' ? oldDetail.promise : Promise.resolve(null),
    },
    catalogApi: catalogApi(),
    onChange: snapshot => changes.push(snapshot),
  })

  const staleRefresh = loader.refreshPapers({
    preferredPaperId: 'paper-old',
    shouldApply: () => oldIsCurrent,
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(changes.at(-1).selectedPaperId, 'paper-old')
  assert.equal(changes.at(-1).selectedPaper, null)

  oldIsCurrent = false
  const publicationsAtInvalidation = changes.length
  const replacement = loader.refreshPapers({
    preferredPaperId: 'paper-new',
    shouldApply: () => true,
  })
  await assert.rejects(replacement, /新一代刷新失败/)

  oldDetail.resolve({ id: 'paper-old', revision: 1, questions: [] })
  await staleRefresh
  assert.equal(changes.length, publicationsAtInvalidation)
  assert.equal(loader.snapshot().selectedPaper, null)
})

test('bank page failure is isolated from paper summaries and selected detail', async () => {
  const loader = loadFactory().create({
    paperApi: {
      ready: async () => ({ papers: [{ id: 'paper-1' }], categories: [] }),
      detail: async () => ({ id: 'paper-1', questions: [] }),
    },
    catalogApi: catalogApi({
      loadBankQuestionPage: async () => { throw new Error('候选题加载失败') },
    }),
  })
  await loader.initialize()
  await assert.rejects(loader.selectBank('bank-1', { page: 1, pageSize: 12 }), /候选题加载失败/)
  const snapshot = loader.snapshot()
  assert.equal(snapshot.papers.length, 1)
  assert.equal(snapshot.selectedPaper.id, 'paper-1')
  assert.equal(snapshot.candidateError, '候选题加载失败')
})

test('revisiting a loaded paper or exact bank page reuses loader caches', async () => {
  let detailCalls = 0
  let bankCalls = 0
  const loader = loadFactory().create({
    paperApi: {
      ready: async () => ({ papers: [{ id: 'A' }, { id: 'B' }], categories: [] }),
      detail: async id => { detailCalls += 1; return { id, questions: [] } },
    },
    catalogApi: catalogApi({
      loadBankQuestionPage: async (bankId, options) => {
        bankCalls += 1
        return { questions: [{ id: `${bankId}-${options.page}` }], total: 1, page: options.page, pageSize: options.pageSize }
      },
    }),
  })

  await loader.initialize({ preferredPaperId: 'A' })
  await loader.selectPaper('B')
  await loader.selectPaper('A')
  await loader.selectBank('bank-1', { page: 1, pageSize: 12, search: '风险' })
  await loader.selectBank('bank-1', { page: 1, pageSize: 12, search: '风险' })
  assert.equal(detailCalls, 2)
  assert.equal(bankCalls, 1)
})

test('catalog revision changes invalidate loader-owned candidate pages', async () => {
  let revision = 1
  let bankCalls = 0
  const loader = loadFactory().create({
    paperApi: { ready: async () => ({ papers: [], categories: [] }), detail: async () => null },
    catalogApi: catalogApi({
      snapshot: () => ({ banks: [{ id: 'bank-1' }], questions: [], contentRevision: revision }),
      loadBankQuestionPage: async () => ({ questions: [{ id: `q-${++bankCalls}` }], total: 1, page: 1, pageSize: 12 }),
    }),
  })
  await loader.initialize()
  await loader.selectBank('bank-1', { page: 1, pageSize: 12 })
  await loader.selectBank('bank-1', { page: 1, pageSize: 12 })
  revision = 2
  await loader.selectBank('bank-1', { page: 1, pageSize: 12 })
  assert.equal(bankCalls, 2)
})

test('sync injects the loader after both API adapters and before the paper application', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'kg-paper-loader-'))
  const output = resolve(root, 'site')
  try {
    const result = spawnSync(process.execPath, [
      resolve(scriptsDir, 'sync-new-legacy.js'),
      '--source', resolve(repoDir, 'new-legacy'),
      '--out', output,
    ], { cwd: repoDir, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.ok(existsSync(resolve(output, 'paper-management-data-loader.js')))
    const html = readFileSync(resolve(output, 'paper-management.html'), 'utf8')
    const loaderIndex = html.indexOf('paper-management-data-loader.js')
    assert.ok(loaderIndex > html.indexOf('question-catalog-adapter.js'))
    assert.ok(loaderIndex > html.indexOf('paper-draft-adapter.js'))
    assert.ok(loaderIndex < html.indexOf('src/65-question-bank-admin.js'))
    assert.equal((html.match(/paper-management-data-loader\.js/g) || []).length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('paper page consumes selected detail, selected-bank pages, and preview-only full questions', () => {
  const source = readFileSync(paperPageScriptPath, 'utf8')
  assert.match(source, /KGPaperManagementDataLoader/)
  assert.match(source, /paperDataLoader\.selectPaper\(id,/)
  assert.match(source, /paperDataLoader\.selectBank\(state\.paperCandidateBankId,/)
  assert.match(source, /Catalog\.loadQuestion\(ref\.questionId\)/)
  assert.match(source, /Catalog\.loadBankQuestions\(bank\.id/)
  assert.doesNotMatch(source, /Promise\.all\(\(summaries\|\|\[\]\)\.map/)
  assert.match(source, /if\(!paperDataLoader\)return renderFullCatalogPaperCandidates\(\)/)
  assert.match(source, /<option value="" disabled>请选择题库<\/option>/)
})
