'use strict';

// teaching-content-live-sync：只覆盖仍活跃的 teaching-content-sync 广播/轮询
// 与 question-catalog-adapter 契约。Runtime State（server-state-bootstrap）
// 已随在线 KV 退役删除（24195fa），相关历史断言一并移除。

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..');
const assetPath = path.join(REPO, 'frontend/scripts/new-legacy-assets/teaching-content-sync.js');
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

function loadCatalog({ fetchImpl }) {
  let syncListener = null;
  const published = [];
  const listeners = new Map();
  const window = {
    document: { body: { dataset: { questionCatalogMode: 'managed' } } },
    crypto: { randomUUID: () => 'catalog-client' },
    fetch: fetchImpl,
    // adapter 已走 KGDomainApi：把 fetch 桩适配成 DomainApi.request 契约
    KGDomainApi: {
      async request({ method = 'GET', path }) {
        const res = await fetchImpl(path, { method });
        const payload = await res.json();
        if (!res.ok) throw Object.assign(new Error('request failed'), { status: res.status, detail: payload });
        return payload;
      },
    },
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
    const catalogIndex = questionPage.indexOf('question-catalog-adapter.js');
    assert.ok(syncIndex >= 0 && syncIndex < catalogIndex, 'sync must load before catalog consumers');
    assert.equal(questionPage.includes('server-state-bootstrap.js'), false, 'retired runtime bootstrap must not be injected');
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
