'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = () => fs.readFileSync(
  path.join(root, 'src/99-deep-recall-server-adapter.js'),
  'utf8',
);
const storageSource = () => fs.readFileSync(
  path.join(root, 'src/97-recall-storage.js'),
  'utf8',
);

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function sessionFixture(overrides = {}) {
  return {
    questionId: 'q1',
    bankId: 'bank-1',
    versionState: 'current',
    currentQuestion: { id: 'q1', revision: 7, title: '题目' },
    historyQuestion: null,
    library: { contentHash: 'a'.repeat(64), payload: { nodes: [], edges: [] } },
    currentLibrary: { contentHash: 'a'.repeat(64), payload: { nodes: [], edges: [] } },
    progressRevision: 4,
    progress: {
      revision: 4,
      nodes: [], edges: [], customNodes: {}, activeKeywords: [],
      choiceOffsets: {}, transform: { x: 0, y: 0, scale: 1 }, metrics: {},
      graphSchemaVersion: 3, readOnly: false,
    },
    permissions: { canRead: true, canWrite: true, canReveal: true, canReset: true, readOnly: false },
    nodeLimit: 30,
    ...overrides,
  };
}

function graphFixture() {
  return {
    nodes: [{ instanceId: 'n1', dataId: 'personal:n1', title: '我的节点', custom: true }],
    edges: [],
    customNodes: { 'personal:n1': { title: '我的节点' } },
    activeKeywords: ['k1'],
    choiceOffsets: {},
    transform: { x: 1, y: 2, scale: 1 },
    metrics: { keywordClicks: 1 },
    graphSchemaVersion: 3,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadAdapter(fetchImpl) {
  const persistenceCalls = [];
  const throwingStorage = new Proxy({}, {
    get(_target, property) {
      persistenceCalls.push(`storage:${String(property)}`);
      throw new Error('browser persistence must not be touched');
    },
  });
  const context = {
    console,
    fetch: fetchImpl,
    localStorage: throwingStorage,
    sessionStorage: throwingStorage,
    indexedDB: throwingStorage,
    caches: throwingStorage,
    KGSharedRuntimeState: throwingStorage,
    setTimeout,
    clearTimeout,
    globalThis: null,
    window: null,
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source(), context, { filename: '99-deep-recall-server-adapter.js' });
  return { adapterApi: context.KGDeepRecallServerAdapter, persistenceCalls };
}

test('save sends the loaded optimistic revision and never touches browser persistence', async () => {
  const calls = [];
  const { adapterApi, persistenceCalls } = loadAdapter(async (url, init = {}) => {
    calls.push({ url, init });
    if (!init.method) return jsonResponse(sessionFixture());
    return jsonResponse({ ...graphFixture(), revision: 5, savedAt: '2026-08-14T00:00:00Z' });
  });
  const adapter = adapterApi.create({ questionId: 'q1' });

  await adapter.loadSession();
  const saved = await adapter.saveGraph(graphFixture());

  assert.equal(calls[0].url, '/api/v1/recall/session/q1');
  assert.equal(calls[1].url, '/api/v1/recall/progress/q1');
  assert.equal(calls[1].init.method, 'PUT');
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.expectedRevision, 4);
  assert.equal(body.questionRevision, 7);
  assert.equal(body.libraryHash, 'a'.repeat(64));
  assert.equal(saved.revision, 5);
  assert.equal(adapter.getState().progressRevision, 5);
  assert.equal(adapter.getState().saveState, 'saved');
  assert.deepEqual(persistenceCalls, []);
});

test('a conflict or network failure preserves the exact unsaved graph for recovery', async () => {
  let mode = 'conflict';
  const { adapterApi } = loadAdapter(async (_url, init = {}) => {
    if (!init.method) return jsonResponse(sessionFixture());
    if (mode === 'conflict') {
      return jsonResponse({ detail: { code: 'recall_revision_conflict', currentRevision: 8 } }, 409);
    }
    if (mode === 'network') throw new Error('offline');
    return jsonResponse({ ...graphFixture(), revision: 5 });
  });
  const adapter = adapterApi.create({ questionId: 'q1' });
  await adapter.loadSession();
  const graph = graphFixture();

  await assert.rejects(adapter.saveGraph(graph), error => error.status === 409);
  assert.equal(adapter.getState().saveState, 'conflict');
  assert.deepEqual(plain(adapter.getState().lastUnsavedGraph), graph);

  mode = 'network';
  await assert.rejects(adapter.saveGraph(graph), /offline/);
  assert.equal(adapter.getState().saveState, 'failed');
  assert.deepEqual(plain(adapter.getState().lastUnsavedGraph), graph);

  mode = 'success';
  await adapter.retryLastSave();
  assert.equal(adapter.getState().saveState, 'saved');
  assert.equal(adapter.getState().lastUnsavedGraph, null);
});

test('reset uses the loaded current question revision and advances progress revision', async () => {
  const calls = [];
  const { adapterApi } = loadAdapter(async (url, init = {}) => {
    calls.push({ url, init });
    if (!init.method) return jsonResponse(sessionFixture({ versionState: 'mismatch' }));
    return jsonResponse({
      revision: 5,
      nodes: [], edges: [], customNodes: {}, activeKeywords: [],
      choiceOffsets: {}, transform: { x: 0, y: 0, scale: 1 }, metrics: {},
      graphSchemaVersion: 3, readOnly: false,
    });
  });
  const adapter = adapterApi.create({ questionId: 'q1' });
  await adapter.loadSession();

  await adapter.resetToCurrent();

  assert.equal(calls[1].url, '/api/v1/recall/progress/q1/reset');
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    expectedRevision: 4,
    targetQuestionRevision: 7,
  });
  assert.equal(adapter.getState().session.versionState, 'current');
  assert.equal(adapter.getState().progressRevision, 5);
});

test('legacy recall storage refuses progress reads and writes without touching storage APIs', () => {
  const calls = [];
  const forbidden = new Proxy({}, {
    get(_target, property) {
      calls.push(String(property));
      throw new Error('browser persistence accessed');
    },
  });
  const context = {
    console,
    localStorage: forbidden,
    indexedDB: forbidden,
    KGAppStorage: forbidden,
    KGAuthCore: { currentUsername: () => 'alice' },
    globalThis: null,
    window: null,
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(storageSource(), context, { filename: '97-recall-storage.js' });

  const storage = context.KGRecallStorage;
  assert.throws(
    () => storage.writeProgress({ id: 'q1' }, 'bank-1', graphFixture()),
    /KGDeepRecallServerAdapter/,
  );
  assert.throws(
    () => storage.readProgress({ id: 'q1' }, 'bank-1'),
    /KGDeepRecallServerAdapter/,
  );
  assert.deepEqual(calls, []);
});

test('teacher draft handoff stays transient and can be explicitly cleared', () => {
  const calls = [];
  const forbidden = new Proxy({}, {
    get(_target, property) {
      calls.push(String(property));
      throw new Error('browser persistence accessed');
    },
  });
  const context = {
    console,
    localStorage: forbidden,
    sessionStorage: forbidden,
    indexedDB: forbidden,
    KGAppStorage: forbidden,
    KGAuthCore: { currentUsername: () => 'alice' },
    globalThis: null,
    window: null,
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(storageSource(), context, { filename: '97-recall-storage.js' });

  const storage = context.KGRecallStorage;
  assert.equal(storage.writeCurrent({
    question: { id: 'draft-1' },
    previewMode: 'teacher-draft',
    previewToken: 'token-1',
  }), true);
  assert.equal(storage.readCurrent().sourceQuestionId, 'draft-1');
  assert.equal(storage.clearCurrent({ previewToken: 'wrong-token' }), false);
  assert.equal(storage.clearCurrent({ previewToken: 'token-1' }), true);
  assert.equal(storage.readCurrent(), null);
  assert.deepEqual(calls, []);
});

test('overlapping saves are serialized so the second request uses the first response revision', async () => {
  const revisions = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  let saveCount = 0;
  const { adapterApi } = loadAdapter(async (_url, init = {}) => {
    if (!init.method) return jsonResponse(sessionFixture());
    const body = JSON.parse(init.body);
    revisions.push(body.expectedRevision);
    saveCount += 1;
    if (saveCount === 1) await firstGate;
    return jsonResponse({ ...body, revision: 4 + saveCount });
  });
  const adapter = adapterApi.create({ questionId: 'q1' });
  await adapter.loadSession();

  const first = adapter.saveGraph(graphFixture());
  const secondGraph = graphFixture();
  secondGraph.nodes[0].title = '第二次编辑';
  const second = adapter.saveGraph(secondGraph);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(revisions, [4, 5]);
  assert.equal(adapter.getState().progressRevision, 6);
  assert.equal(adapter.getState().graph.nodes[0].title, '第二次编辑');
});
