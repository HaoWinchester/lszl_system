'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..');
const assetPath = path.join(REPO, 'frontend/scripts/new-legacy-assets/teaching-content-sync.js');
const bootstrapPath = path.join(REPO, 'frontend/scripts/new-legacy-assets/server-state-bootstrap.js');
const catalogPath = path.join(REPO, 'frontend/scripts/new-legacy-assets/question-catalog-adapter.js');

assert.ok(fs.existsSync(assetPath), 'teaching-content-sync.js must exist');
const asset = fs.readFileSync(assetPath, 'utf8');

class FakeBroadcastChannel {
  static channels = new Map();

  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this.closed = false;
    const peers = FakeBroadcastChannel.channels.get(name) || new Set();
    peers.add(this);
    FakeBroadcastChannel.channels.set(name, peers);
  }

  postMessage(data) {
    for (const peer of FakeBroadcastChannel.channels.get(this.name) || []) {
      if (peer !== this && !peer.closed) peer.onmessage?.({ data });
    }
  }

  close() {
    this.closed = true;
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

function makeWindow({ BroadcastChannelImpl = FakeBroadcastChannel, localStorage } = {}) {
  const listeners = new Map();
  const document = { visibilityState: 'visible' };
  const window = {
    document,
    ...(BroadcastChannelImpl ? { BroadcastChannel: BroadcastChannelImpl } : {}),
    ...(localStorage ? { localStorage } : {}),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener(type, listener) {
      const entries = listeners.get(type) || new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type, event = { type }) { for (const listener of listeners.get(type) || []) listener(event); },
  };
  document.addEventListener = window.addEventListener.bind(window);
  document.removeEventListener = window.removeEventListener.bind(window);
  const context = vm.createContext({ window, document, BroadcastChannel: BroadcastChannelImpl, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, console });
  vm.runInContext(asset, context, { filename: assetPath });
  return window;
}

async function wait(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function loadServerState({ fetchImpl, contentRevision = 7, role = 'teacher' }) {
  const listeners = new Map();
  const events = [];
  const published = [];
  let syncListener = null;
  const browserValues = new Map();
  const browserStorage = {
    getItem(key) { return browserValues.has(String(key)) ? browserValues.get(String(key)) : null; },
    setItem(key, value) { browserValues.set(String(key), String(value)); },
    removeItem(key) { browserValues.delete(String(key)); },
    clear() { browserValues.clear(); },
    key(index) { return Array.from(browserValues.keys())[Number(index)] ?? null; },
  };
  const window = {
    __KG_DIRECT_BOOTSTRAP__: {
      authenticated: true,
      authUser: { username: 'test-user', role },
      readOnly: false,
      page: 'question-bank.html',
      namespace: 'questions',
      revision: 1,
      contentRevision,
      storage: {},
    },
    crypto: { randomUUID: () => `request-${Math.random()}` },
    navigator: {},
    document: { visibilityState: 'visible', addEventListener() {} },
    localStorage: browserStorage,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    addEventListener(type, listener) {
      const entries = listeners.get(type) || new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    dispatchEvent(event) { events.push(event); },
    KGTeachingContentSync: {
      publish(detail) { published.push(detail); },
      subscribe(listener) { syncListener = listener; return () => { syncListener = null; }; },
      startPolling(options) { window.pollingOptions = options; },
      stopPolling() {},
    },
  };
  class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  }
  class Blob { constructor(parts) { this.parts = parts; } }
  const context = vm.createContext({ window, document: window.document, fetch: fetchImpl, CustomEvent, Blob, JSON, Date, Math, Map, Object, Number, Promise, console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask });
  vm.runInContext(fs.readFileSync(bootstrapPath, 'utf8'), context, { filename: bootstrapPath });
  return {
    window, storage: window.KGServerStateStorage, browserStorage, published, events,
    remote: detail => syncListener?.(detail),
    pagehide: () => { for (const listener of listeners.get('pagehide') || []) listener({ type: 'pagehide' }); },
  };
}

function loadCatalog({ fetchImpl }) {
  let syncListener = null;
  const published = [];
  const listeners = new Map();
  const window = {
    document: { body: { dataset: { questionCatalogMode: 'managed' } } },
    crypto: { randomUUID: () => 'catalog-client' },
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    dispatchEvent() {},
    addEventListener(type, listener) { const rows = listeners.get(type) || []; rows.push(listener); listeners.set(type, rows); },
    KGTeachingContentSync: {
      publish(detail) { published.push(detail); },
      subscribe(listener) { syncListener = listener; return () => { syncListener = null; }; },
    },
  };
  class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  }
  const context = vm.createContext({ window, document: window.document, fetch: fetchImpl, CustomEvent, URLSearchParams, JSON, Date, Math, console });
  vm.runInContext(fs.readFileSync(catalogPath, 'utf8'), context, { filename: catalogPath });
  return {
    adapter: window.KGQuestionCatalogAdapter,
    published,
    remote: detail => syncListener?.(detail),
    pagehide: () => { for (const listener of listeners.get('pagehide') || []) listener({ type: 'pagehide' }); },
  };
}

async function run() {
  const first = makeWindow();
  const second = makeWindow();
  for (const name of ['publish', 'subscribe', 'startPolling', 'stopPolling']) {
    assert.equal(typeof first.KGTeachingContentSync?.[name], 'function', `sync API must expose ${name}()`);
  }

  const received = [];
  second.KGTeachingContentSync.subscribe(detail => received.push(detail.revision));
  first.KGTeachingContentSync.publish({ revision: 2, source: 'test' });
  first.KGTeachingContentSync.publish({ revision: 2, source: 'duplicate' });
  await wait(120);
  assert.deepEqual(received, [2], 'a remote revision must reload once and duplicate revisions must be ignored');

  const pollingWindow = makeWindow();
  let polledRevision = 4;
  let pollingCalls = 0;
  const pollingReceived = [];
  const pollingAdvances = [];
  pollingWindow.KGTeachingContentSync.subscribe(detail => pollingReceived.push(detail.revision));
  pollingWindow.KGTeachingContentSync.startPolling({
    intervalMs: 1000,
    getRevision: async () => { pollingCalls += 1; return { revision: polledRevision }; },
    onAdvance: detail => pollingAdvances.push(detail.revision),
  });
  await wait(120);
  assert.deepEqual(pollingReceived, [4], 'polling must perform an immediate visible revision check');
  assert.deepEqual(pollingAdvances, [4]);
  pollingWindow.document.visibilityState = 'hidden';
  polledRevision = 5;
  pollingWindow.dispatch('focus');
  await wait(120);
  assert.deepEqual(pollingReceived, [4], 'hidden pages must not poll');
  pollingWindow.document.visibilityState = 'visible';
  pollingWindow.dispatch('visibilitychange');
  await wait(120);
  assert.deepEqual(pollingReceived, [4, 5], 'becoming visible must check immediately');
  pollingWindow.dispatch('pagehide');
  const callsAtPagehide = pollingCalls;
  polledRevision = 6;
  pollingWindow.dispatch('focus');
  pollingWindow.dispatch('visibilitychange');
  await wait(20);
  assert.equal(pollingCalls, callsAtPagehide, 'pagehide must stop polling and focus/visibility checks');

  const stoppedPollingWindow = makeWindow();
  let stoppedPollingCalls = 0;
  stoppedPollingWindow.KGTeachingContentSync.startPolling({
    intervalMs: 1000,
    getRevision: async () => { stoppedPollingCalls += 1; return { revision: 1 }; },
  });
  stoppedPollingWindow.KGTeachingContentSync.stopPolling();
  stoppedPollingWindow.dispatch('focus');
  await wait(20);
  assert.equal(stoppedPollingCalls, 0, 'stopPolling must cancel the immediate check and future focus checks');
  stoppedPollingWindow.dispatch('pagehide');

  const malformedSender = makeWindow();
  const malformedReceiver = makeWindow();
  const malformedReceived = [];
  malformedReceiver.KGTeachingContentSync.subscribe(detail => malformedReceived.push(detail.revision));
  for (const revision of ['7', true, -1, 1.5, Number.NaN]) {
    assert.equal(malformedSender.KGTeachingContentSync.publish({ revision }), false, `malformed revision ${String(revision)} must be rejected`);
  }
  malformedSender.KGTeachingContentSync.publish({ revision: 7 });
  await wait(120);
  assert.deepEqual(malformedReceived, [7], 'a valid integer revision must still work after malformed messages');
  malformedSender.dispatch('pagehide');
  malformedReceiver.dispatch('pagehide');

  let storageFirst;
  let storageSecond;
  const firstStorage = {
    setItem(key, value) { storageSecond?.dispatch('storage', { key, newValue: value }); },
    removeItem(key) { storageSecond?.dispatch('storage', { key, newValue: null }); },
  };
  const secondStorage = {
    setItem(key, value) { storageFirst?.dispatch('storage', { key, newValue: value }); },
    removeItem(key) { storageFirst?.dispatch('storage', { key, newValue: null }); },
  };
  storageFirst = makeWindow({ BroadcastChannelImpl: null, localStorage: firstStorage });
  storageSecond = makeWindow({ BroadcastChannelImpl: null, localStorage: secondStorage });
  const fallbackReceived = [];
  storageSecond.KGTeachingContentSync.subscribe(detail => fallbackReceived.push(detail.revision));
  storageFirst.KGTeachingContentSync.publish({ revision: 6, source: 'storage-fallback' });
  await wait(120);
  assert.deepEqual(fallbackReceived, [6], 'storage events must provide cross-tab sync when BroadcastChannel is unavailable');
  storageSecond.dispatch('pagehide');
  storageSecond.KGTeachingContentSync.subscribe(detail => fallbackReceived.push(detail.revision));
  storageFirst.KGTeachingContentSync.publish({ revision: 7, source: 'after-pagehide' });
  await wait(120);
  assert.deepEqual(fallbackReceived, [6], 'pagehide must remove the storage listener and reject later subscriptions');
  storageFirst.dispatch('pagehide');

  let resolveLatePoll;
  const latePollWindow = makeWindow();
  const latePollReceived = [];
  latePollWindow.KGTeachingContentSync.subscribe(detail => latePollReceived.push(detail.revision));
  latePollWindow.KGTeachingContentSync.startPolling({
    getRevision: () => new Promise(resolve => { resolveLatePoll = resolve; }),
  });
  await wait(0);
  latePollWindow.dispatch('pagehide');
  resolveLatePoll({ revision: 9 });
  await wait(120);
  assert.deepEqual(latePollReceived, [], 'a poll that resolves after pagehide must not notify consumers');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-teaching-sync-'));
  const output = path.join(tempRoot, 'site');
  try {
    const result = spawnSync(process.execPath, [
      path.join(REPO, 'frontend/scripts/sync-new-legacy.js'),
      '--source', ROOT,
      '--out', output,
    ], { cwd: REPO, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(output, 'teaching-content-sync.js')), 'sync asset must be copied to generated pages');
    const questionPage = fs.readFileSync(path.join(output, 'question-bank.html'), 'utf8');
    const syncIndex = questionPage.indexOf('teaching-content-sync.js');
    const stateIndex = questionPage.indexOf('server-state-bootstrap.js');
    const catalogIndex = questionPage.indexOf('question-catalog-adapter.js');
    assert.ok(syncIndex >= 0 && syncIndex < stateIndex && stateIndex < catalogIndex, 'sync must load before state and catalog consumers');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const prepTemplate = fs.readFileSync(path.join(ROOT, 'content-prep-studio/src/index.template.html'), 'utf8');
  assert.ok(
    prepTemplate.indexOf('/teaching-content-sync.js') >= 0
      && prepTemplate.indexOf('/teaching-content-sync.js') < prepTemplate.indexOf('kg-direct-bootstrap-anchor'),
    'Content Prep must load the optional application sync asset before direct bootstrap injection',
  );
  assert.equal(prepTemplate.includes('/server-state-bootstrap.js'), false);

  const receivedBeforeClose = [...received];
  first.dispatch('pagehide');
  second.dispatch('pagehide');
  const afterPagehide = makeWindow();
  afterPagehide.KGTeachingContentSync.publish({ revision: 3, source: 'after-pagehide' });
  await wait(120);
  assert.deepEqual(received, receivedBeforeClose, 'pagehide must unsubscribe and close the BroadcastChannel');
  afterPagehide.dispatch('pagehide');

  const runtimeCalls = [];
  const runtime = loadServerState({
    fetchImpl: async (url, options = {}) => {
      runtimeCalls.push({ url, options });
      if (options.method === 'GET') return response(200, { storage: {}, revision: 2, contentRevision: 9 });
      return response(200, { ok: true, revision: 2, contentRevision: 8 });
    },
  });
  runtime.storage.setItem('kg_course_config_drafts_v1', '[]');
  await runtime.storage.flush();
  const runtimePayload = JSON.parse(runtimeCalls.find(call => call.options.method === 'PUT').options.body);
  assert.equal(runtimePayload.contentRevision, 7, 'teaching Runtime State writes must carry the exact bootstrap content revision');
  assert.equal(typeof runtimePayload.contentRevision, 'number', 'contentRevision must satisfy the backend StrictInt contract');
  assert.deepEqual(runtime.published.map(item => item.revision), [8], 'a successful teaching Runtime State write must publish its returned revision');
  const callsBeforeLocalPreference = runtimeCalls.length;
  runtime.storage.setItem('prep.lastDraftId', 'draft-1');
  await wait(180);
  assert.equal(runtime.browserStorage.getItem('prep.lastDraftId'), 'draft-1', 'Prep lastDraftId must stay in browser-only preference storage');
  assert.equal(runtimeCalls.length, callsBeforeLocalPreference, 'browser-only preferences must not be uploaded to Runtime State');

  const chooserMarker = '{"schemaVersion":1,"consumedDigest":"server-digest","consumedAt":1786424000000}';
  const refreshCalls = [];
  const refreshRuntime = loadServerState({
    fetchImpl: async (url, options = {}) => {
      refreshCalls.push({ url, options });
      return response(200, {
        storage: { kg_learning_entry_chooser_consumed_v1: chooserMarker },
        revision: 2,
        contentRevision: 7,
      });
    },
  });
  assert.equal(typeof refreshRuntime.storage.refresh, 'function', 'server-state storage must expose refresh()');
  await refreshRuntime.storage.refresh();
  assert.equal(refreshCalls.length, 1);
  assert.equal(refreshCalls[0].url, '/api/v1/runtime/state');
  assert.equal(refreshCalls[0].options.method, 'GET');
  assert.equal(refreshCalls[0].options.credentials, 'include');
  assert.equal(refreshRuntime.storage.getItem('kg_learning_entry_chooser_consumed_v1'), chooserMarker);

  let refreshFailureGets = 0;
  const refreshFailureRuntime = loadServerState({
    fetchImpl: async (_url, options = {}) => {
      if (options.method === 'GET') {
        refreshFailureGets += 1;
        return response(200, { storage: {}, revision: 2, contentRevision: 7 });
      }
      return response(500, { detail: 'save failed' });
    },
  });
  refreshFailureRuntime.storage.setItem('pending-before-refresh', 'must flush first');
  await assert.rejects(refreshFailureRuntime.storage.refresh(), /保存失败 \(500\)/);
  assert.equal(refreshFailureGets, 0, 'refresh must not GET after its preceding flush fails');
  refreshFailureRuntime.pagehide();

  const atomicClaimCalls = [];
  const atomicMarker = '{"schemaVersion":1,"consumedDigest":"atomic-digest","consumedAt":1786425000000}';
  const atomicClaimRuntime = loadServerState({
    fetchImpl: async (url, options = {}) => {
      atomicClaimCalls.push({ url, options });
      if (url === '/api/v1/runtime/learning-entry-claim') {
        return response(200, { claimed: false, key: 'kg_learning_entry_chooser_consumed_v1', value: atomicMarker, revision: 6 });
      }
      return response(200, { ok: true, revision: 7, contentRevision: 7 });
    },
  });
  assert.equal(typeof atomicClaimRuntime.storage.claimLearningEntry, 'function');
  const atomicClaim = await atomicClaimRuntime.storage.claimLearningEntry();
  assert.equal(atomicClaim.claimed, false);
  assert.equal(atomicClaimCalls[0].url, '/api/v1/runtime/learning-entry-claim');
  assert.equal(atomicClaimCalls[0].options.method, 'POST');
  assert.equal(atomicClaimCalls[0].options.credentials, 'include');
  assert.equal(atomicClaimRuntime.storage.getItem('kg_learning_entry_chooser_consumed_v1'), atomicMarker);
  atomicClaimRuntime.storage.setItem('after-atomic-claim', 'saved');
  await atomicClaimRuntime.storage.flush();
  const afterAtomicPayload = JSON.parse(atomicClaimCalls.find(call => call.options.method === 'PUT').options.body);
  assert.equal(afterAtomicPayload.revision, 6, 'atomic claim revision must become the next Runtime State write base');

  runtime.storage.setItem('pending-local-key', 'local draft');
  await runtime.remote({ revision: 9, source: 'remote' });
  assert.equal(runtime.storage.getItem('pending-local-key'), 'local draft', 'remote snapshots must reapply pending local mutations');
  assert.ok(runtime.events.some(event => event.type === 'kg:server-state-reloaded'), 'remote snapshots must announce completion');
  await wait(150);
  runtime.storage.setItem('kg_course_config_drafts_v1', '[{"id":"after-remote"}]');
  await runtime.storage.flush();
  const afterRemotePayload = JSON.parse(runtimeCalls.filter(call => call.options.method === 'PUT').at(-1).options.body);
  assert.equal(afterRemotePayload.contentRevision, 9, 'an older personal-write response must not roll back a newer observed teaching revision');

  const studentRuntime = loadServerState({
    role: 'student',
    fetchImpl: async () => response(403, { detail: '无权限' }),
  });
  assert.equal(studentRuntime.window.pollingOptions, undefined, 'student pages must not poll the manager-only teaching revision endpoint');

  let conflictPuts = 0;
  let conflictRevision = 10;
  const conflictRuntime = loadServerState({
    contentRevision: conflictRevision,
    fetchImpl: async (_url, options = {}) => {
      if (options.method === 'GET') {
        conflictRevision += 1;
        return response(200, { storage: {}, revision: 1, contentRevision: conflictRevision });
      }
      conflictPuts += 1;
      return response(409, { detail: { currentContentRevision: conflictRevision + 1 } });
    },
  });
  conflictRuntime.storage.setItem('kg_course_config_drafts_v1', '[{"id":"draft"}]');
  await assert.rejects(conflictRuntime.storage.flush(), /\u6559\u5b66\u5185\u5bb9\u6301\u7eed\u53d8\u5316/);
  await wait(250);
  assert.equal(conflictPuts, 2, 'a continuously stale teaching write must stop after one reload retry');

  let interleavedRuntime;
  let interleavedPuts = 0;
  let insertedMutation = false;
  const interleavedRevision = { value: 20 };
  interleavedRuntime = loadServerState({
    contentRevision: interleavedRevision.value,
    fetchImpl: async (_url, options = {}) => {
      if (options.method === 'GET') {
        interleavedRevision.value += 1;
        if (!insertedMutation) {
          insertedMutation = true;
          interleavedRuntime.storage.setItem('personal-between-conflicts', 'keep me');
        }
        return response(200, { storage: {}, revision: 1, contentRevision: interleavedRevision.value });
      }
      interleavedPuts += 1;
      return response(409, { detail: { currentContentRevision: interleavedRevision.value + 1 } });
    },
  });
  interleavedRuntime.storage.setItem('kg_course_config_drafts_v1', '[{"id":"draft"}]');
  await assert.rejects(interleavedRuntime.storage.flush(), /教学内容持续变化/);
  await wait(250);
  assert.equal(interleavedPuts, 2, 'a local mutation between conflicts must not reset the in-flight retry budget');

  let staleConflictPuts = 0;
  let staleConflictGets = 0;
  const staleConflictRuntime = loadServerState({
    contentRevision: 1,
    fetchImpl: async (_url, options = {}) => {
      if (options.method === 'GET') {
        staleConflictGets += 1;
        return staleConflictGets === 1
          ? response(200, { storage: {}, revision: 2, contentRevision: 2 })
          : response(200, { storage: {}, revision: 1, contentRevision: 1 });
      }
      staleConflictPuts += 1;
      return response(409, { detail: { currentContentRevision: 3 } });
    },
  });
  staleConflictRuntime.storage.setItem('kg_course_config_drafts_v1', '[{"id":"stale-conflict"}]');
  await assert.rejects(staleConflictRuntime.storage.flush(), /\u6559\u5b66\u5185\u5bb9\u6301\u7eed\u53d8\u5316/);
  await wait(1000);
  assert.equal(staleConflictPuts, 2, 'a stale GET after the second 409 must not reset the one-retry budget');
  assert.equal(staleConflictGets, 1, 'the second 409 must stop before issuing an unnecessary stale reload GET');

  let isolatedConflictPuts = 0;
  let isolatedConflictGets = 0;
  const isolatedConflictRuntime = loadServerState({
    contentRevision: 1,
    fetchImpl: async (_url, options = {}) => {
      if (options.method === 'GET') {
        isolatedConflictGets += 1;
        if (isolatedConflictGets === 1) return response(200, { storage: {}, revision: 2, contentRevision: 2 });
        if (isolatedConflictGets === 2) return response(200, { storage: {}, revision: 3, contentRevision: 3 });
        return response(200, { storage: {}, revision: 2, contentRevision: 2 });
      }
      isolatedConflictPuts += 1;
      if (isolatedConflictPuts === 1) return response(422, { detail: { code: 'ISOLATE_MUTATION' } });
      return response(409, { detail: { currentContentRevision: 4 } });
    },
  });
  isolatedConflictRuntime.storage.setItem('kg_course_config_drafts_v1', '[{"id":"isolated-conflict"}]');
  await assert.rejects(isolatedConflictRuntime.storage.flush(), /\u6559\u5b66\u5185\u5bb9\u6301\u7eed\u53d8\u5316/);
  await wait(1000);
  assert.equal(isolatedConflictPuts, 3, 'isolated mutation conflicts must also stop after one retry');
  assert.equal(isolatedConflictGets, 2, 'isolated mutation conflicts must not reload after the retry budget is exhausted');

  let isolatedPutCalls = 0;
  let isolatedGetCalls = 0;
  const isolatedPutBodies = [];
  const isolatedRuntime = loadServerState({
    contentRevision: 1,
    fetchImpl: async (_url, options = {}) => {
      if (options.method === 'GET') {
        isolatedGetCalls += 1;
        if (isolatedGetCalls === 1) return response(200, { storage: {}, revision: 2, contentRevision: 2 });
        return response(200, { storage: {}, revision: 2, contentRevision: 2 });
      }
      isolatedPutCalls += 1;
      isolatedPutBodies.push(JSON.parse(options.body));
      if (isolatedPutCalls === 1) return response(422, { detail: { code: 'ISOLATE_MUTATION' } });
      if (isolatedPutCalls === 2) return response(200, { ok: true, revision: 3, contentRevision: 3 });
      return response(200, { ok: true, revision: 4, contentRevision: 4 });
    },
  });
  isolatedRuntime.storage.setItem('kg_course_config_drafts_v1', '[{"id":"isolated"}]');
  await isolatedRuntime.storage.flush();
  assert.equal(
    isolatedRuntime.storage.getItem('kg_course_config_drafts_v1'),
    '[{"id":"isolated"}]',
    'a stale GET after an isolated PUT must not replace the committed local value with an older snapshot',
  );
  isolatedRuntime.storage.setItem('kg_course_config_drafts_v1', '[{"id":"next"}]');
  await isolatedRuntime.storage.flush();
  assert.equal(
    isolatedPutBodies.at(-1).contentRevision,
    3,
    'a stale GET after an isolated PUT must not roll the exact contentRevision CAS token backward',
  );
  assert.equal(isolatedPutBodies.at(-1).revision, 3, 'a stale GET after an isolated PUT must not roll the Runtime State revision backward');

  const runtimeReloads = [];
  const racingRuntime = loadServerState({
    contentRevision: 1,
    fetchImpl: async (_url, options = {}) => {
      if (options.method === 'GET') return new Promise(resolve => runtimeReloads.push(resolve));
      return response(200, { ok: true, revision: 1, contentRevision: 1 });
    },
  });
  const runtimeRevisionTwo = racingRuntime.remote({ revision: 2, source: 'remote-2' });
  await wait(0);
  const runtimeRevisionThree = racingRuntime.remote({ revision: 3, source: 'remote-3' });
  await wait(0);
  assert.equal(runtimeReloads.length, 1, 'remote Runtime State refreshes must serialize while one GET is in flight');
  runtimeReloads.shift()(response(200, { storage: { shared: 'revision-2' }, revision: 2, contentRevision: 2 }));
  await wait(0);
  assert.equal(runtimeReloads.length, 1, 'a queued newer Runtime State revision must GET after the first response');
  runtimeReloads.shift()(response(200, { storage: { shared: 'revision-3' }, revision: 3, contentRevision: 3 }));
  await Promise.all([runtimeRevisionTwo, runtimeRevisionThree]);
  assert.equal(racingRuntime.storage.getItem('shared'), 'revision-3', 'an older Runtime State response must never overwrite a newer remote snapshot');

  let transientRuntimeReads = 0;
  const transientRuntime = loadServerState({
    contentRevision: 1,
    fetchImpl: async (_url, options = {}) => {
      if (options.method !== 'GET') return response(200, { revision: 1, contentRevision: 1 });
      transientRuntimeReads += 1;
      if (transientRuntimeReads === 1) return response(503, { detail: '暂时不可用' });
      return response(200, { storage: { recovered: 'yes' }, revision: 2, contentRevision: 2 });
    },
  });
  await transientRuntime.remote({ revision: 2, source: 'remote' });
  assert.equal(transientRuntime.storage.getItem('recovered'), 'yes', 'Runtime State must retry a transient remote reload failure');
  assert.equal(transientRuntimeReads, 2);

  let extendedRuntimeReads = 0;
  const extendedRuntime = loadServerState({
    contentRevision: 1,
    fetchImpl: async (_url, options = {}) => {
      if (options.method !== 'GET') return response(200, { revision: 1, contentRevision: 1 });
      extendedRuntimeReads += 1;
      if (extendedRuntimeReads <= 3) return response(503, { detail: '暂时不可用' });
      return response(200, { storage: { recoveredLater: 'yes' }, revision: 2, contentRevision: 2 });
    },
  });
  await extendedRuntime.remote({ revision: 2, source: 'remote' });
  await wait(400);
  assert.equal(extendedRuntime.storage.getItem('recoveredLater'), 'yes', 'Runtime State must retain and retry a revision after the short retry budget');

  let staleRuntimeReads = 0;
  const staleRuntime = loadServerState({
    contentRevision: 1,
    fetchImpl: async (_url, options = {}) => {
      if (options.method !== 'GET') return response(200, { revision: 1, contentRevision: 1 });
      staleRuntimeReads += 1;
      if (staleRuntimeReads === 1) return response(200, { storage: { stale: 'replica-lag' }, revision: 1, contentRevision: 1 });
      return response(200, { storage: { recoveredFromLag: 'yes' }, revision: 2, contentRevision: 2 });
    },
  });
  await staleRuntime.remote({ revision: 2, source: 'remote' });
  await wait(400);
  assert.equal(staleRuntime.storage.getItem('recoveredFromLag'), 'yes', 'a successful but stale Runtime State snapshot must keep the target retryable');

  let hiddenRuntimeReads = 0;
  const hiddenRuntime = loadServerState({
    contentRevision: 1,
    fetchImpl: async (_url, options = {}) => {
      if (options.method !== 'GET') return response(200, { revision: 1, contentRevision: 1 });
      hiddenRuntimeReads += 1;
      return response(503, { detail: '页面关闭前失败' });
    },
  });
  const hiddenRuntimeRefresh = hiddenRuntime.remote({ revision: 2, source: 'remote' });
  await wait(0);
  hiddenRuntime.pagehide();
  await hiddenRuntimeRefresh;
  await wait(200);
  assert.equal(hiddenRuntimeReads, 1, 'Runtime State pagehide must stop an in-flight retry loop before a second GET');

  let pagehidePuts = 0;
  const pagehideRuntime = loadServerState({
    contentRevision: 1,
    fetchImpl: async (_url, options = {}) => {
      if (options.method === 'PUT') pagehidePuts += 1;
      return response(200, { storage: {}, revision: 2, contentRevision: 2 });
    },
  });
  pagehideRuntime.storage.setItem('kg_course_config_drafts_v1', '[{"id":"pagehide"}]');
  pagehideRuntime.pagehide();
  await wait(250);
  assert.equal(pagehidePuts, 0, 'pagehide must cancel pending Runtime State debounce saves');

  let resolvePagehidePut;
  let inFlightPagehidePuts = 0;
  let inFlightPagehideGets = 0;
  const inFlightPagehideRuntime = loadServerState({
    contentRevision: 1,
    fetchImpl: async (_url, options = {}) => {
      if (options.method === 'GET') {
        inFlightPagehideGets += 1;
        return response(200, { storage: {}, revision: 2, contentRevision: 2 });
      }
      inFlightPagehidePuts += 1;
      if (inFlightPagehidePuts === 1) return new Promise(resolve => { resolvePagehidePut = resolve; });
      return response(200, { ok: true, revision: 3, contentRevision: 3 });
    },
  });
  inFlightPagehideRuntime.storage.setItem('kg_course_config_drafts_v1', '[{"id":"in-flight-pagehide"}]');
  const inFlightPagehideFlush = inFlightPagehideRuntime.storage.flush();
  await wait(0);
  inFlightPagehideRuntime.pagehide();
  resolvePagehidePut(response(409, { detail: { currentContentRevision: 2 } }));
  await inFlightPagehideFlush;
  await wait(100);
  assert.equal(inFlightPagehidePuts, 1, 'pagehide must not start a retry PUT after an in-flight request settles');
  assert.equal(inFlightPagehideGets, 0, 'pagehide must not reload a conflict after teardown');

  let resolveRemoteBeforePut;
  let orderedPuts = 0;
  const orderedRuntime = loadServerState({
    contentRevision: 1,
    fetchImpl: async (_url, options = {}) => {
      if (options.method === 'GET') return new Promise(resolve => { resolveRemoteBeforePut = resolve; });
      orderedPuts += 1;
      return response(200, { ok: true, revision: 3, contentRevision: 3 });
    },
  });
  const remoteBeforePut = orderedRuntime.remote({ revision: 2, source: 'remote' });
  await wait(0);
  orderedRuntime.storage.setItem('kg_course_config_drafts_v1', '[{"id":"committed-local"}]');
  const putAfterRemote = orderedRuntime.storage.flush();
  await wait(0);
  assert.equal(orderedPuts, 0, 'a local PUT must wait for an older in-flight remote snapshot to apply');
  resolveRemoteBeforePut(response(200, { storage: { shared: 'old-snapshot' }, revision: 2, contentRevision: 2 }));
  await Promise.all([remoteBeforePut, putAfterRemote]);
  assert.equal(orderedPuts, 1);
  assert.equal(
    orderedRuntime.storage.getItem('kg_course_config_drafts_v1'),
    '[{"id":"committed-local"}]',
    'an old remote snapshot must not erase a local value committed after it',
  );

  let bootstrapRevision = 1;
  const catalogCalls = [];
  const catalog = loadCatalog({
    fetchImpl: async (url, options = {}) => {
      catalogCalls.push({ url, options });
      if (url.includes('/bootstrap')) {
        return response(200, { banks: [], questions: [], catalogRevision: String(bootstrapRevision).repeat(64), contentRevision: bootstrapRevision });
      }
      bootstrapRevision = 2;
      return response(200, { bank: { id: 'bank-1' }, contentRevision: 2 });
    },
  });
  await catalog.adapter.ready;
  await catalog.adapter.saveBank({ name: '共享题库' });
  assert.deepEqual(catalog.published.map(item => item.revision), [2], 'catalog commits must publish the revision returned by the refreshed server catalog');
  bootstrapRevision = 3;
  await catalog.remote({ revision: 3, source: 'remote' });
  assert.equal(catalog.adapter.snapshot().contentRevision, 3, 'managed catalog pages must reload after a remote commit');

  let committedReloadCalls = 0;
  const committedThenReloadFails = loadCatalog({
    fetchImpl: async (url) => {
      if (url.includes('/bootstrap')) {
        committedReloadCalls += 1;
        if (committedReloadCalls === 2) return response(503, { detail: '暂时不可用' });
        if (committedReloadCalls > 2) {
          return response(200, { banks: [{ id: 'committed-bank' }], questions: [], catalogRevision: '2'.repeat(64), contentRevision: 2 });
        }
        return response(200, { banks: [], questions: [], catalogRevision: '1'.repeat(64), contentRevision: 1 });
      }
      return response(200, { bank: { id: 'committed-bank' }, contentRevision: 2 });
    },
  });
  await committedThenReloadFails.adapter.ready;
  const committedBank = await committedThenReloadFails.adapter.saveBank({ name: '已提交题库' });
  await wait(120);
  assert.equal(committedBank.id, 'committed-bank', 'a committed mutation must not be reported as a failed save when only local refresh failed');
  assert.equal(
    committedThenReloadFails.adapter.snapshot().contentRevision,
    2,
    'the committing tab must route a failed local refresh through the retained retry target',
  );
  assert.deepEqual(
    committedThenReloadFails.published.map(item => item.revision),
    [2],
    'a committed mutation must publish its exact response revision even if the local reload fails',
  );

  let staleCommitBootstraps = 0;
  const staleCommitCatalog = loadCatalog({
    fetchImpl: async (url) => {
      if (!url.includes('/bootstrap')) return response(200, { bank: { id: 'stale-commit-bank' }, contentRevision: 2 });
      staleCommitBootstraps += 1;
      if (staleCommitBootstraps <= 2) {
        return response(200, { banks: [], questions: [], catalogRevision: '1'.repeat(64), contentRevision: 1 });
      }
      return response(200, { banks: [{ id: 'stale-commit-bank' }], questions: [], catalogRevision: '2'.repeat(64), contentRevision: 2 });
    },
  });
  await staleCommitCatalog.adapter.ready;
  await staleCommitCatalog.adapter.saveBank({ name: '副本滞后提交' });
  await wait(400);
  assert.equal(staleCommitBootstraps, 3, 'a successful but stale local-commit bootstrap must retain the committed revision target');
  assert.equal(staleCommitCatalog.adapter.snapshot().contentRevision, 2, 'the committing tab must converge after a stale bootstrap');

  let interleavedCatalogReads = 0;
  let resolveOldCatalogRead;
  const interleavedCatalog = loadCatalog({
    fetchImpl: async (url) => {
      if (!url.includes('/bootstrap')) return response(200, { bank: { id: 'local-rev-3' }, contentRevision: 3 });
      interleavedCatalogReads += 1;
      if (interleavedCatalogReads === 1) return response(200, { banks: [], questions: [], catalogRevision: '1'.repeat(64), contentRevision: 1 });
      if (interleavedCatalogReads === 2) return new Promise(resolve => { resolveOldCatalogRead = resolve; });
      return response(200, { banks: [{ id: 'local-rev-3' }], questions: [], catalogRevision: '3'.repeat(64), contentRevision: 3 });
    },
  });
  await interleavedCatalog.adapter.ready;
  const oldRemoteCatalog = interleavedCatalog.remote({ revision: 2, source: 'remote' });
  await wait(0);
  await interleavedCatalog.adapter.saveBank({ name: '本地 rev3' });
  assert.equal(interleavedCatalog.adapter.snapshot().contentRevision, 3);
  resolveOldCatalogRead(response(200, { banks: [{ id: 'old-rev-2' }], questions: [], catalogRevision: '2'.repeat(64), contentRevision: 2 }));
  await oldRemoteCatalog;
  assert.equal(interleavedCatalog.adapter.snapshot().contentRevision, 3, 'a delayed remote catalog GET must not roll back a newer local commit refresh');
  assert.equal(interleavedCatalog.adapter.snapshot().banks[0].id, 'local-rev-3');

  const catalogReloads = [];
  let catalogBootstrapCalls = 0;
  const racingCatalog = loadCatalog({
    fetchImpl: async (url) => {
      if (!url.includes('/bootstrap')) return response(200, {});
      catalogBootstrapCalls += 1;
      if (catalogBootstrapCalls === 1) {
        return response(200, { banks: [{ id: 'initial' }], questions: [], catalogRevision: '1'.repeat(64), contentRevision: 1 });
      }
      return new Promise(resolve => catalogReloads.push(resolve));
    },
  });
  await racingCatalog.adapter.ready;
  const catalogRevisionTwo = racingCatalog.remote({ revision: 2, source: 'remote-2' });
  await wait(0);
  const catalogRevisionThree = racingCatalog.remote({ revision: 3, source: 'remote-3' });
  await wait(0);
  assert.equal(catalogReloads.length, 1, 'remote catalog refreshes must serialize while one request is in flight');
  catalogReloads.shift()(response(200, { banks: [{ id: 'revision-2' }], questions: [], catalogRevision: '2'.repeat(64), contentRevision: 2 }));
  await wait(0);
  assert.equal(catalogReloads.length, 1, 'a queued newer revision must reload after the first response');
  catalogReloads.shift()(response(200, { banks: [{ id: 'revision-3' }], questions: [], catalogRevision: '3'.repeat(64), contentRevision: 3 }));
  await Promise.all([catalogRevisionTwo, catalogRevisionThree]);
  assert.equal(racingCatalog.adapter.snapshot().contentRevision, 3, 'an older catalog response must never overwrite a newer remote revision');

  let transientCatalogReads = 0;
  const transientCatalog = loadCatalog({
    fetchImpl: async (url) => {
      if (!url.includes('/bootstrap')) return response(200, {});
      transientCatalogReads += 1;
      if (transientCatalogReads === 1) {
        return response(200, { banks: [], questions: [], catalogRevision: '1'.repeat(64), contentRevision: 1 });
      }
      if (transientCatalogReads === 2) return response(503, { detail: '暂时不可用' });
      return response(200, { banks: [{ id: 'recovered' }], questions: [], catalogRevision: '2'.repeat(64), contentRevision: 2 });
    },
  });
  await transientCatalog.adapter.ready;
  await transientCatalog.remote({ revision: 2, source: 'remote' });
  assert.equal(transientCatalog.adapter.snapshot().contentRevision, 2, 'catalog must retry a transient remote reload failure');
  assert.equal(transientCatalogReads, 3);

  let extendedCatalogReads = 0;
  const extendedCatalog = loadCatalog({
    fetchImpl: async (url) => {
      if (!url.includes('/bootstrap')) return response(200, {});
      extendedCatalogReads += 1;
      if (extendedCatalogReads === 1) {
        return response(200, { banks: [], questions: [], catalogRevision: '1'.repeat(64), contentRevision: 1 });
      }
      if (extendedCatalogReads <= 4) return response(503, { detail: '暂时不可用' });
      return response(200, { banks: [{ id: 'recovered-later' }], questions: [], catalogRevision: '2'.repeat(64), contentRevision: 2 });
    },
  });
  await extendedCatalog.adapter.ready;
  await extendedCatalog.remote({ revision: 2, source: 'remote' });
  await wait(400);
  assert.equal(extendedCatalog.adapter.snapshot().contentRevision, 2, 'catalog must retain and retry a revision after the short retry budget');

  let hiddenCatalogReads = 0;
  const hiddenCatalog = loadCatalog({
    fetchImpl: async (url) => {
      if (!url.includes('/bootstrap')) return response(200, {});
      hiddenCatalogReads += 1;
      if (hiddenCatalogReads === 1) return response(200, { banks: [], questions: [], catalogRevision: '1'.repeat(64), contentRevision: 1 });
      return response(503, { detail: '页面关闭前失败' });
    },
  });
  await hiddenCatalog.adapter.ready;
  const hiddenCatalogRefresh = hiddenCatalog.remote({ revision: 2, source: 'remote' });
  await wait(0);
  hiddenCatalog.pagehide();
  await hiddenCatalogRefresh;
  await wait(200);
  assert.equal(hiddenCatalogReads, 2, 'catalog pagehide must stop an in-flight retry loop before another bootstrap GET');

  console.log('teaching-content-live-sync-ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
