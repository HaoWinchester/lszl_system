import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')
const adapterPath = resolve(scriptsDir, 'new-legacy-assets', 'question-catalog-adapter.js')

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload } }
}

function loadAdapter({ mode = 'learning', fetchImpl }) {
  const events = []
  const document = {
    body: { dataset: { questionCatalogMode: mode } },
    dispatchEvent(event) { events.push(event) },
  }
  class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail }
  }
  const window = {
    document,
    fetch: fetchImpl,
    crypto: { randomUUID: () => 'client-instance-1' },
    dispatchEvent(event) { events.push(event) },
  }
  const context = vm.createContext({ window, document, fetch: fetchImpl, CustomEvent, URLSearchParams, JSON, Date, console })
  vm.runInContext(readFileSync(adapterPath, 'utf8'), context, { filename: adapterPath })
  return { adapter: window.KGQuestionCatalogAdapter, events }
}

test('managed and learning pages bootstrap the right in-memory catalog with cookies', async () => {
  for (const mode of ['managed', 'learning']) {
    const calls = []
    const { adapter } = loadAdapter({
      mode,
      fetchImpl: async (url, options = {}) => {
        calls.push({ url, options })
        return response(200, { banks: [{ id: `${mode}-bank` }], questions: [], catalogRevision: 'a'.repeat(64) })
      },
    })
    await adapter.ready
    assert.equal(calls[0].url, `/api/v1/question-catalog/bootstrap?mode=${mode}`)
    assert.equal(calls[0].options.credentials, 'include')
    assert.equal(adapter.banks()[0].id, `${mode}-bank`)
  }
})

test('reload replaces the module snapshot and returned values cannot mutate it', async () => {
  let revision = 1
  const { adapter, events } = loadAdapter({
    fetchImpl: async () => response(200, {
      banks: [{ id: `bank-${revision}` }], questions: [{ id: `q-${revision}`, bankId: `bank-${revision}` }], catalogRevision: String(revision).repeat(64),
    }),
  })
  await adapter.ready
  const exposed = adapter.snapshot()
  exposed.banks[0].id = 'tampered'
  assert.equal(adapter.banks()[0].id, 'bank-1')

  revision = 2
  await adapter.reload()
  assert.equal(adapter.banks()[0].id, 'bank-2')
  assert.equal(adapter.question('q-1'), null)
  assert.equal(adapter.question('q-2').bankId, 'bank-2')
  assert.ok(events.some(event => event.type === 'kg:question-catalog-ready'))
  assert.ok(events.some(event => event.type === 'kg:question-catalog-changed'))
})

test('401 requests login and 409 keeps the last good snapshot', async () => {
  let status = 200
  const { adapter, events } = loadAdapter({
    mode: 'managed',
    fetchImpl: async () => status === 200
      ? response(200, { banks: [{ id: 'safe-bank' }], questions: [], catalogRevision: 'b'.repeat(64) })
      : response(status, { detail: { code: 'STALE', message: '冲突' } }),
  })
  await adapter.ready
  status = 409
  await assert.rejects(adapter.reload(), error => error.status === 409)
  assert.equal(adapter.banks()[0].id, 'safe-bank')

  const auth = loadAdapter({ mode: 'managed', fetchImpl: async () => response(401, { detail: '未登录' }) })
  await assert.rejects(auth.adapter.ready, error => error.status === 401)
  assert.ok(auth.events.some(event => event.type === 'kg:auth-required'))
})

test('lock methods carry client identity and lock token without persistent storage', async () => {
  const calls = []
  const { adapter } = loadAdapter({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options })
      if (url.includes('/bootstrap')) return response(200, { banks: [], questions: [], catalogRevision: 'c'.repeat(64) })
      if (options.method === 'DELETE') return response(200, { ok: true })
      return response(200, { questionId: 'q-1', lockToken: 'token-1', heartbeatIntervalSeconds: 30, leaseSeconds: 300 })
    },
  })
  await adapter.ready
  await adapter.acquireQuestionLock('q-1', { clientInstanceId: 'client-1', creatorId: 'creator_001' })
  await adapter.heartbeatQuestionLock('q-1', { clientInstanceId: 'client-1', lockToken: 'token-1' })
  await adapter.releaseQuestionLock('q-1', { clientInstanceId: 'client-1', lockToken: 'token-1' })

  assert.deepEqual(calls.slice(1).map(call => call.options.method), ['POST', 'PUT', 'DELETE'])
  assert.match(calls[1].options.body, /client-1/)
  assert.match(calls[2].options.body, /token-1/)
  const source = readFileSync(adapterPath, 'utf8')
  assert.doesNotMatch(source, /localStorage|sessionStorage|kg_question_banks_v1__|kg_question_banks_published_v1/)
})

test('save methods use the canonical bank routes and reload the snapshot', async () => {
  const calls = []
  const { adapter } = loadAdapter({
    mode: 'managed',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options })
      if (url.includes('/bootstrap')) return response(200, { banks: [{ id: 'bank-1' }], questions: [], catalogRevision: 'd'.repeat(64) })
      if (url === '/api/v1/banks') return response(200, { bank: { id: 'bank-2' } })
      if (url === '/api/v1/banks/bank-1') return response(200, { bank: { id: 'bank-1' } })
      if (url === '/api/v1/banks/bank-1/questions') return response(200, { question: { id: 'q-new' } })
      return response(200, { question: { id: 'q-existing' } })
    },
  })
  await adapter.ready
  await adapter.saveBank({ name: 'new bank' })
  await adapter.saveBank({ id: 'bank-1', name: 'existing bank' })
  await adapter.saveQuestion({ id: 'q-new', title: 'new' }, { bankId: 'bank-1' })
  await adapter.saveQuestion({ id: 'q-existing', title: 'existing', revision: 2 }, {
    baseRevision: 2, lockToken: 'lock', creatorId: 'creator_001', idempotencyKey: 'save-existing',
  })
  assert.ok(calls.some(call => call.url === '/api/v1/banks' && call.options.method === 'POST'))
  assert.ok(calls.some(call => call.url === '/api/v1/banks/bank-1' && call.options.method === 'PUT'))
  assert.ok(calls.some(call => call.url === '/api/v1/banks/bank-1/questions' && call.options.method === 'POST'))
  assert.ok(calls.some(call => call.url === '/api/v1/content-prep/questions/q-existing' && call.options.method === 'PUT'))
})

test('sync injects the adapter before each page question repository and marks its mode', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'kg-catalog-adapter-'))
  const output = resolve(root, 'site')
  try {
    const result = spawnSync(process.execPath, [
      resolve(scriptsDir, 'sync-new-legacy.js'),
      '--source', resolve(repoDir, 'new-legacy'),
      '--out', output,
    ], { cwd: repoDir, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.ok(existsSync(resolve(output, 'question-catalog-adapter.js')))
    const pages = new Map([
      ['question-bank.html', ['managed', 'src/65-question-bank-admin.js']],
      ['paper-management.html', ['managed', 'src/65-question-bank-admin.js']],
      ['question-training.html', ['learning', 'src/59-published-paper-repository.js']],
      ['question-workspace.html', ['learning', 'src/59-published-paper-repository.js']],
      ['knowledge-recall.html', ['learning', 'src/59-published-paper-repository.js']],
      ['practice-mode.html', ['learning', 'src/59-published-paper-repository.js']],
      ['index.html', ['learning', 'src/60-question-bank.js']],
    ])
    for (const [page, [mode, marker]] of pages) {
      const html = readFileSync(resolve(output, page), 'utf8')
      assert.match(html, new RegExp(`data-question-catalog-mode="${mode}"`))
      assert.ok(html.indexOf('question-catalog-adapter.js') < html.indexOf(marker), `${page} adapter order`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
