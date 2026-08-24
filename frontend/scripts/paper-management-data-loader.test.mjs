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
