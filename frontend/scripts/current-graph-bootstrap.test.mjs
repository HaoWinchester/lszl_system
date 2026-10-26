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

// Exercise real editor state, adapter and session bootstrap; only the DOM renderer
// is replaced here. The companion browser test checks the actual rendered canvas.
async function editorHarness({ currentId = null, fails = false, remote = true } = {}) {
  const listeners = new Map(), writes = [], renders = []
  const c = {
    console, Promise, setTimeout, clearTimeout, URLSearchParams,
    document: { getElementById: () => null }, matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null },
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    requestAnimationFrame: fn => fn(), CustomEvent: class {},
    addEventListener: (name, fn) => { const list = listeners.get(name) || []; list.push(fn); listeners.set(name, list) },
    dispatchEvent() {},
    KGAuthCore: { providerConfig: () => ({ mode: 'remote' }), currentUser: () => remote ? { username: 'alice' } : null, currentUsername: () => remote ? 'alice' : '' },
    KGGraphFileApi: {
      isRemote: () => remote,
      getCurrent: async () => { if (fails) throw new Error('offline'); return { fileId: currentId } },
      get: async () => ({ meta: { id: currentId, revision: 1 }, graphData: { meta: { title: '个人内容' }, nodes: [{ id: 'personal', title: '自己的卡片' }], links: [] } }),
      create: async input => { writes.push(['create', input]); return { file: { id: 'created', name: input.name, revision: 1 } } },
      setCurrent: async id => { writes.push(['current', id]); return {} },
      save: async (id, input) => { writes.push(['save', input]); return { file: { id, revision: 2 } } },
    },
  }
  for (const name of ['openNodeModal', 'createNodeAt', 'activateLinkSource', 'openLinkModal', 'deleteNode', 'applyNodeSize', 'applyLineStyle', 'applyLineColor']) c[name] = () => {}
  c.window = c; c.globalThis = c
  vm.createContext(c)
  const run = text => vm.runInContext(text, c)
  for (const file of ['graph/graph-model.js', 'graph/edge-geometry.js', 'graph/graph-persistence.js', '00-config-state.js', '23-graph-file-remote-adapter.js', '30-auth-guards.js'])
    run(readFileSync(resolve('../new-legacy/src', file), 'utf8'))
  c.render = () => renders.push(JSON.parse(run('JSON.stringify(state)')))
  c.authInstallGuards = c.authInstallQuestionReadonlyGuard = c.authRenderStatus = c.fitView = () => {}
  run(readFileSync(resolve('../new-legacy/src/90-bootstrap.js'), 'utf8'))
  await c.KGHomepageGraphBootstrap
  return { c, run, writes, renders, session: async () => {
    currentId = null; fails = false; remote = true
    for (const fn of listeners.get('kg:auth-session-changed') || []) await fn({ detail: { authenticated: true } })
  } }
}

for (const scenario of ['initial-null', 'recovered-library-null', 'account-switch', 'login']) {
  test(`editor renders blank for ${scenario} and creates only blank-origin edits`, async () => {
    const h = await editorHarness({ currentId: scenario === 'account-switch' ? 'personal' : null, remote: scenario !== 'login' })
    if (scenario === 'account-switch' || scenario === 'login') await h.session()
    assert.equal(h.renders.at(-1).nodes.length, 0, 'session completion must render before legacy auth reset')
    h.run('authLoadCurrentSpace()')
    const rendered = h.renders.at(-1)
    assert.equal(rendered.nodes.length, 0)
    assert.equal(rendered.links.length, 0)
    assert.equal(h.run('previewContentSnapshot === graphContentSnapshot(saveableState())'), true)
    h.run('state.viewport.x += 20; state.viewport.scale = 1.5')
    await h.run('persistCurrentGraphNow({force:true})')
    assert.deepEqual(h.writes, [])
    h.run("state.nodes.push(makeNode('第一张自己的卡片',0,0,'#64748b'))")
    assert.equal(await h.run('persistCurrentGraphNow()'), true)
    assert.deepEqual(h.writes.map(([kind]) => kind), ['create', 'current', 'save'])
    assert.equal(h.writes[0][1].graphData.nodes.length, 1)
    assert.equal(h.writes[0][1].graphData.nodes[0].title, '第一张自己的卡片')
    assert.equal(h.writes[0][1].graphData.links.length, 0)
  })
}

test('personal restore survives while failed initialization and guest keep their existing canvas', async () => {
  const restored = await editorHarness({ currentId: 'personal' })
  assert.equal(restored.renders.at(-1).nodes[0].id, 'personal')
  assert.equal(restored.renders.at(-1).nodes.length, 1)
  for (const options of [{ fails: true }, { remote: false }]) {
    const h = await editorHarness(options)
    assert.equal(h.renders.at(-1).nodes.length, 11)
    assert.deepEqual(h.writes, [])
  }
})
