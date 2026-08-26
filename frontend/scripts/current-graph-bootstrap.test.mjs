import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const storeSource = readFileSync(resolve('../new-legacy/src/23-graph-file-remote-store.js'), 'utf8')
const adapterSource = readFileSync(resolve('../new-legacy/src/23-graph-file-remote-adapter.js'), 'utf8')

function harness({ currentId = 'graph-1', catalogFails = false } = {}) {
  const calls = []
  const graph = { meta: { title: '当前图谱' }, nodes: [{ id: 'n1' }], links: [] }
  const fileMeta = { id: 'graph-1', name: '当前图谱', owner: 'alice', revision: 2 }
  const api = {
    isRemote: () => true,
    getCurrent: async () => { calls.push('getCurrent'); return { fileId: currentId } },
    get: async (id) => { calls.push(`get:${id}`); return { meta: fileMeta, graphData: graph, learningState: { ready: true } } },
    listFiles: async (status) => {
      calls.push(`listFiles:${status}`)
      if (catalogFails) throw new Error('catalog unavailable')
      return { files: status === 'active' ? [fileMeta] : [] }
    },
    listFolders: async (status) => { calls.push(`listFolders:${status}`); return { folders: [] } },
    listTags: async () => { calls.push('listTags'); return { tags: [] } },
    create: async () => { calls.push('create'); throw new Error('must not create') },
    setCurrent: async () => { calls.push('setCurrent'); throw new Error('must not set current') },
  }
  const window = {
    KGGraphFileApi: api,
    KGAuthCore: { currentUsername: () => 'alice' },
    KGGraphDefaultFactory: () => ({ meta: { title: '空白' }, nodes: [], links: [] }),
    addEventListener() {},
    dispatchEvent() {},
  }
  window.window = window
  const context = vm.createContext({ window, console, CustomEvent: class CustomEvent {} })
  vm.runInContext(storeSource, context)
  vm.runInContext(adapterSource, context)
  return { window, calls, graph }
}

test('current graph initialization coalesces and hydrates exactly one graph body', async () => {
  const item = harness()
  const adapter = item.window.KGGraphFileRemoteAdapter
  const [first, second] = await Promise.all([adapter.initializeCurrent(), adapter.initializeCurrent()])

  assert.deepEqual(item.calls, ['getCurrent', 'get:graph-1'])
  assert.equal(first.id, 'graph-1')
  assert.equal(second.id, 'graph-1')
  assert.equal(adapter.getLoadedGraph().nodes[0].id, 'n1')
  assert.equal(item.window.KGGraphFileRemoteStore.getCurrentFileId(), 'graph-1')
  assert.equal((await item.window.KGGraphFileRemoteStore.getFile('graph-1', 'alice')).graphData.nodes[0].id, 'n1')
  assert.deepEqual(item.calls, ['getCurrent', 'get:graph-1'])
})

test('missing current graph stays blank without listing, creating, saving, or setting current', async () => {
  const item = harness({ currentId: '' })
  const result = await item.window.KGGraphFileRemoteAdapter.initializeCurrent()

  assert.equal(result, null)
  assert.deepEqual(item.calls, ['getCurrent'])
  assert.equal(item.window.KGGraphFileRemoteStore.getCurrentFileId(), '')
})

test('catalog loading is explicit, coalesced, and preserves the seeded graph after failure', async () => {
  const item = harness({ catalogFails: true })
  await item.window.KGGraphFileRemoteAdapter.initializeCurrent()
  const store = item.window.KGGraphFileRemoteStore
  const first = store.ensureCatalog()
  const second = store.ensureCatalog()
  assert.equal(first, second)
  await assert.rejects(first, /catalog unavailable/)

  assert.equal(item.calls.filter((call) => call === 'listFiles:active').length, 1)
  assert.equal(item.calls.filter((call) => call === 'listFiles:trashed').length, 1)
  assert.equal(store.getCurrentFileId(), 'graph-1')
  assert.equal((await store.getFile('graph-1', 'alice')).graphData.nodes[0].id, 'n1')
})
