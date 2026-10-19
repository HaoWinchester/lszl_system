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
  const graph = { ...graphFixture(), strokes: [], tables: [] };

  await assert.rejects(adapter.saveGraph(graph), error => error.status === 409);
  assert.equal(adapter.getState().saveState, 'conflict');
  assert.deepEqual(plain(adapter.getState().lastUnsavedGraph), graph);

  graph.strokes = [{ id: 's1', tool: 'pen', color: '#2563eb', width: 3, points: [[1, 2], [20, 30]] }];
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

test('answer selection and persistent correct marking survive the database adapter round trip', async () => {
  const controller = fs.readFileSync(path.join(root, 'src/86-knowledge-recall.js'), 'utf8');
  const functionSource = (name, next) => controller.slice(controller.indexOf(`  function ${name}(`), controller.indexOf(next, controller.indexOf(`  function ${name}(`)));
  const controllerContext = {
    window: {},
    state: { ...graphFixture(), strokes: [], tables: [], metrics: { keywordClicks: 2, choiceClicks: 1, nodeOpens: 3 } },
    krOptionState: { selected: 'A', persistent: 'A' },
    inkController: null,
    recallViewportRestored: false,
    isTeacherDraftPreview: () => false,
    cloneValue: plain,
    normalizeGraph: () => {},
    MIN_ZOOM: 0.01,
    MAX_ZOOM: 4,
  };
  vm.createContext(controllerContext);
  vm.runInContext(
    functionSource('progressPayload', '  async function writeProgressNow(') + '\n' +
    functionSource('loadProgress', '  async function resetProgress('),
    controllerContext,
  );
  let stored;
  const { adapterApi } = loadAdapter(async (_url, init = {}) => {
    if (!init.method) return jsonResponse(sessionFixture());
    stored = { ...JSON.parse(init.body), revision: 5 };
    return jsonResponse(stored);
  });
  const adapter = adapterApi.create({ questionId: 'q1' });
  await adapter.loadSession();
  await adapter.saveGraph(controllerContext.progressPayload());
  controllerContext.krOptionState = { selected: '', persistent: '' };
  controllerContext.loadProgress(plain(adapter.getState().graph));
  assert.deepEqual(plain(controllerContext.krOptionState), { selected: 'A', persistent: 'A' });
  assert.equal(stored.metrics.keywordClicks, 2);
  assert.equal(stored.metrics.choiceClicks, 1);
  assert.equal(stored.metrics.nodeOpens, 3);
});

function loadRecallDraftLifecycle(overrides = {}) {
  const controller = fs.readFileSync(path.join(root, 'src/86-knowledge-recall.js'), 'utf8');
  const start = controller.indexOf('  function commitPersonalDraft(');
  assert.ok(start >= 0, 'personal card drafts need a reusable commit entry point');
  const inputs = { krPersonalTitle: { value: '更新的标题', focus() {} }, krPersonalContent: { value: '未点保存的正文' } };
  const calls = [];
  const context = {
    state: { activeNodeId: 'n1', nodes: [{ instanceId: 'n1', dataId: 'personal:n1', title: '旧标题', custom: true }], customNodes: { 'personal:n1': { title: '旧标题', hint: '旧正文' } } },
    $: id => inputs[id],
    getNodeData: id => context.state.customNodes[id],
    nodeLayer: { querySelector: () => null },
    cssAttr: value => value,
    isRecallReadonly: () => false,
    isTeacherDraftPreview: () => false,
    inkController: { hasTextDraft: () => true, commitText: async () => { calls.push('ink'); return true; } },
    saveProgress: () => calls.push('pending'),
    writeProgressNow: async () => { calls.push('save'); return true; },
    notifyRecallLimit: message => calls.push(message),
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(controller.slice(start, controller.indexOf('  async function writeProgressNow(', start)), context);
  return { context, inputs, calls };
}

test('leaving commits personal card drafts and ink before awaiting the progress save', async () => {
  const { context, calls } = loadRecallDraftLifecycle();
  assert.equal(await context.prepareRecallLeave(), true);
  assert.deepEqual(plain(context.state.customNodes['personal:n1']), { title: '更新的标题', hint: '未点保存的正文' });
  assert.equal(context.state.nodes[0].title, '更新的标题');
  assert.deepEqual(calls, ['pending', 'ink', 'save']);
});

test('empty personal titles block leaving and preserve the editable draft', async () => {
  const { context, inputs, calls } = loadRecallDraftLifecycle();
  inputs.krPersonalTitle.value = '  ';
  assert.equal(await context.prepareRecallLeave(), false);
  assert.equal(context.state.customNodes['personal:n1'].title, '旧标题');
  assert.equal(inputs.krPersonalContent.value, '未点保存的正文');
  assert.equal(calls.includes('save'), false);
  assert.equal(calls.includes('ink'), false);
});

test('read only recall can leave, while failed ink and progress commits prevent leaving', async () => {
  const readOnly = loadRecallDraftLifecycle({ isRecallReadonly: () => true });
  assert.equal(await readOnly.context.prepareRecallLeave(), true);
  assert.deepEqual(readOnly.calls, []);
  const inkFailure = loadRecallDraftLifecycle({ inkController: { hasTextDraft: () => true, commitText: async () => false } });
  assert.equal(await inkFailure.context.prepareRecallLeave(), false);
  assert.equal(inkFailure.calls.includes('save'), false);
  const saveFailure = loadRecallDraftLifecycle({ writeProgressNow: async () => false });
  assert.equal(await saveFailure.context.prepareRecallLeave(), false);
});

test('unload protection reports only editable unsaved drafts, pending saves, or save failures', () => {
  const { context, inputs } = loadRecallDraftLifecycle({
    isRecallSessionReadonly: () => false,
    inkController: { hasTextDraft: () => false },
    progressSaveTimer: 0,
    recallAdapter: { getState: () => ({ saveState: 'saved' }) },
  });
  assert.equal(typeof context.hasRecallDraft, 'function');
  assert.equal(context.hasRecallDraft(), true, 'edited personal fields require protection');
  inputs.krPersonalTitle.value = '旧标题';
  inputs.krPersonalContent.value = '旧正文';
  assert.equal(context.hasRecallDraft(), false, 'saved fields do not interrupt refreshing');
  context.progressSaveTimer = 1;
  assert.equal(context.hasRecallDraft(), true);
  context.progressSaveTimer = 0;
  for (const saveState of ['saving', 'failed', 'conflict']) {
    context.recallAdapter = { getState: () => ({ saveState }) };
    assert.equal(context.hasRecallDraft(), true, saveState);
  }
  context.isRecallSessionReadonly = () => true;
  assert.equal(context.hasRecallDraft(), false);
});


test('opening mismatched historical progress never resets the graph and binds historical snapshots', async () => {
  const controller = fs.readFileSync(path.join(root, 'src/86-knowledge-recall.js'), 'utf8');
  const historic = sessionFixture({versionState:'mismatch', historyQuestion:{id:'q1',revision:6}, progress:{...graphFixture(), revision:4}});
  let resets=0;
  const context={question:{id:'q1',sourceReleaseId:'release-old'},recallAdapter:null,lastLibraryHash:'',
    requestedQuestionId:()=> 'q1',renderSaveState(){},
    window:{KGDeepRecallServerAdapter:{create:()=>({subscribe(){},loadSession:async()=>historic,getState:()=>({session:historic})})},KGLearningLoading:{hide(){}}},
    adoptCurrentVersion:async()=>{resets++;return sessionFixture()},
  };
  vm.createContext(context);
  const start=controller.indexOf('  async function loadDatabaseSessionData(');
  vm.runInContext(controller.slice(start,controller.indexOf('  /* 失败回退',start)),context);
  const prepared=await context.loadDatabaseSessionData('q1');
  assert.equal(resets,0,'merely reopening must not issue destructive reset');
  assert.equal(prepared.history,true);
  assert.equal(prepared.latest.progress.nodes[0].instanceId,'n1');
});

test('server question hydration retains the resolved release and collection identity', () => {
  const controller=fs.readFileSync(path.join(root,'src/86-knowledge-recall.js'),'utf8');
  const context={question:{id:'q1',sourceReleaseId:'release-1',sourceCollectionId:'collection-1',sourcePaperId:'paper-1'},cloneValue:plain,fallbackQuestion:{}};
  vm.createContext(context);
  const start=controller.indexOf('  function sessionQuestion(');
  vm.runInContext(controller.slice(start,controller.indexOf('  function applyServerSession(',start)),context);
  const result=context.sessionQuestion({id:'q1',bankId:'bank-1',title:'frozen question'});
  assert.equal(result.sourceReleaseId,'release-1');
  assert.equal(result.sourceCollectionId,'collection-1');
  assert.equal(result.sourcePaperId,'paper-1');
  assert.equal(context.sessionQuestion({id:'other',bankId:'bank-2'}).sourceReleaseId,undefined,'unrelated questions must not inherit the previous release');
});
