'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const assetPath = path.join(ROOT, 'src', '31-learning-entry-chooser.js');
const directEntryPath = path.resolve(ROOT, '..', 'frontend', 'scripts', 'new-legacy-assets', 'direct-entry.js');
const CONSUMED_KEY = 'kg_learning_entry_chooser_consumed_v1';

class SharedStorage {
  constructor() { this.values = new Map(); this.windows = new Set(); }
  attach(window) { this.windows.add(window); }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(source, key, value) {
    key = String(key); value = String(value);
    const oldValue = this.getItem(key);
    this.values.set(key, value);
    for (const window of this.windows) {
      if (window !== source) window.dispatchEvent({ type: 'storage', key, oldValue, newValue: value, storageArea: window.localStorage });
    }
  }
  removeItem(source, key) {
    key = String(key);
    const oldValue = this.getItem(key);
    this.values.delete(key);
    for (const window of this.windows) {
      if (window !== source) window.dispatchEvent({ type: 'storage', key, oldValue, newValue: null, storageArea: window.localStorage });
    }
  }
}

class FakeBroadcastChannel {
  static channels = new Map();
  constructor(name) {
    this.name = name; this.closed = false; this.onmessage = null;
    const peers = FakeBroadcastChannel.channels.get(name) || new Set();
    peers.add(this); FakeBroadcastChannel.channels.set(name, peers);
  }
  postMessage(data) {
    for (const peer of FakeBroadcastChannel.channels.get(this.name) || []) {
      if (peer !== this && !peer.closed) peer.onmessage?.({ data });
    }
  }
  close() { this.closed = true; FakeBroadcastChannel.channels.get(this.name)?.delete(this); }
}

function locks() {
  const tails = new Map();
  return {
    request(name, _options, callback) {
      const previous = tails.get(name) || Promise.resolve();
      let release;
      const next = new Promise(resolve => { release = resolve; });
      tails.set(name, previous.then(() => next));
      return previous.then(async () => {
        try { return await callback(); } finally { release(); }
      });
    },
  };
}

function session(id = 'server-session-a') {
  return { authenticated: true, loginSessionId: id, user: { username: 'learner' } };
}

function createTab({ shared, authSession = session(), locksImpl = locks(), BroadcastChannelImpl = FakeBroadcastChannel, storageClaim, storageFlush, storageRefresh } = {}) {
  const listeners = new Map();
  const window = {
    crypto: webcrypto,
    TextEncoder,
    Uint8Array,
    navigator: locksImpl ? { locks: locksImpl } : {},
    ...(BroadcastChannelImpl ? { BroadcastChannel: BroadcastChannelImpl } : {}),
    document: {},
    location: { href: 'https://example.test/practice-mode.html' },
    localStorage: {
      getItem: key => shared.getItem(key),
      setItem(key, value) { shared.setItem(window, key, value); },
      removeItem(key) { shared.removeItem(window, key); },
    },
    addEventListener(type, listener) {
      const entries = listeners.get(type) || new Set(); entries.add(listener); listeners.set(type, entries);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); return true; },
    setTimeout,
    clearTimeout,
    queueMicrotask,
  };
  if (storageClaim) window.localStorage.claimLearningEntry = storageClaim;
  if (storageFlush) window.localStorage.flush = storageFlush;
  if (storageRefresh) window.localStorage.refresh = storageRefresh;
  shared.attach(window);
  const auth = { async getCurrentSession() { return authSession; } };
  const context = vm.createContext({
    window, document: window.document, location: window.location, localStorage: window.localStorage,
    navigator: window.navigator, crypto: window.crypto, BroadcastChannel: BroadcastChannelImpl,
    setTimeout, clearTimeout, queueMicrotask, Promise, JSON, Date, Math, TextEncoder, Uint8Array, console,
  });
  vm.runInContext(fs.readFileSync(assetPath, 'utf8'), context, { filename: assetPath });
  return { auth, authSession, init: () => window.KGLearningEntryChooser.init({ auth, document: window.document, location: window.location, storage: window.localStorage }), window };
}

test('does not claim when no authenticated server session exists', async () => {
  const tab = createTab({ shared: new SharedStorage(), authSession: { authenticated: false, user: null } });
  assert.equal((await tab.init()).shown, false);
});

test('does not synthesize an opaque login ID from an authenticated username', async () => {
  const tab = createTab({ shared: new SharedStorage(), authSession: { authenticated: true, user: { username: 'learner' } } });
  assert.equal((await tab.init()).shown, false);
});

test('first visit consumes exactly the server session and refresh stays consumed', async () => {
  const shared = new SharedStorage();
  const tab = createTab({ shared });
  assert.equal((await tab.init()).shown, true);
  assert.equal((await tab.init()).shown, false);
  const marker = JSON.parse(shared.getItem(CONSUMED_KEY));
  assert.deepEqual(Object.keys(marker).sort(), ['consumedAt', 'consumedDigest', 'schemaVersion']);
  assert.equal(marker.schemaVersion, 1);
  assert.equal(marker.consumedDigest, '22b1cd8d13f99dc13e0bb4c7f4d9096424fe72867aeba5039fbc5da40db6e7db');
  assert.equal(typeof marker.consumedAt, 'number');
  assert.equal(JSON.stringify(marker).includes('server-session-a'), false);
});

test('lock-backed VM tabs race to one winning claim', async () => {
  const shared = new SharedStorage();
  const sharedLocks = locks();
  const a = createTab({ shared, locksImpl: sharedLocks });
  const b = createTab({ shared, locksImpl: sharedLocks });
  const [first, second] = await Promise.all([a.init(), b.init()]);
  assert.equal(Number(first.shown) + Number(second.shown), 1);
  assert.equal((await a.init()).shown, false);
});

test('atomic server claims allow exactly one independent-map tab without Web Locks', async () => {
  const claimedSessions = new Set();
  let lockRequests = 0;
  const forbiddenLocks = { request() { lockRequests += 1; throw new Error('Web Locks must not run'); } };
  function atomicTab() {
    return createTab({
      shared: new SharedStorage(),
      locksImpl: forbiddenLocks,
      storageClaim: async () => {
        const claimed = !claimedSessions.has('server-session-a');
        claimedSessions.add('server-session-a');
        return { claimed, key: CONSUMED_KEY, value: 'server-marker', revision: claimedSessions.size };
      },
    });
  }
  const [first, second] = await Promise.all([atomicTab().init(), atomicTab().init()]);
  assert.equal(Number(first.shown) + Number(second.shown), 1);
  assert.equal(lockRequests, 0);
});

test('atomic server claims allow different login sessions to win independently', async () => {
  const claimedSessions = new Set();
  let claimCalls = 0;
  let lockRequests = 0;
  function atomicTab(loginSessionId) {
    return createTab({
      shared: new SharedStorage(),
      authSession: session(loginSessionId),
      locksImpl: { request() { lockRequests += 1; throw new Error('Web Locks must not run'); } },
      storageClaim: async () => {
        claimCalls += 1;
        const claimed = !claimedSessions.has(loginSessionId);
        claimedSessions.add(loginSessionId);
        return { claimed, key: CONSUMED_KEY, value: `marker-${loginSessionId}`, revision: claimedSessions.size };
      },
    });
  }
  assert.equal((await atomicTab('login-a').init()).shown, true);
  assert.equal((await atomicTab('login-b').init()).shown, true);
  assert.equal(claimCalls, 2);
  assert.equal(lockRequests, 0);
});

test('a false atomic server claim never displays the chooser', async () => {
  const tab = createTab({
    shared: new SharedStorage(),
    storageClaim: async () => false,
  });
  assert.equal((await tab.init()).shown, false);
});

test('a rejected atomic server claim never displays the chooser', async () => {
  const tab = createTab({
    shared: new SharedStorage(),
    storageClaim: async () => { throw new Error('claim unavailable'); },
  });
  assert.equal((await tab.init()).shown, false);
});

test('lock-backed tabs with independent runtime maps refresh from one backend before claiming', async () => {
  const backend = new Map();
  const sharedLocks = locks();
  let refreshes = 0;
  let flushes = 0;
  function serverTab() {
    const local = new SharedStorage();
    return createTab({
      shared: local,
      locksImpl: sharedLocks,
      storageFlush: async () => {
        flushes += 1;
        backend.clear();
        for (const [key, value] of local.values) backend.set(key, value);
        return true;
      },
      storageRefresh: async () => {
        refreshes += 1;
        local.values = new Map(backend);
        return true;
      },
    });
  }
  const a = serverTab();
  const b = serverTab();
  const [first, second] = await Promise.all([a.init(), b.init()]);
  assert.equal(Number(first.shown) + Number(second.shown), 1);
  assert.equal(refreshes, 2);
  assert.equal(flushes, 1);
});

test('a false runtime refresh result cannot win or flush a lock-backed claim', async () => {
  const shared = new SharedStorage();
  let flushes = 0;
  const tab = createTab({
    shared,
    storageFlush: async () => { flushes += 1; return true; },
    storageRefresh: async () => false,
  });
  assert.equal((await tab.init()).shown, false);
  assert.equal(flushes, 0);
  assert.equal(shared.getItem(CONSUMED_KEY), null);
});

test('a rejected runtime refresh cannot win or flush a lock-backed claim', async () => {
  const shared = new SharedStorage();
  let flushes = 0;
  const tab = createTab({
    shared,
    storageFlush: async () => { flushes += 1; return true; },
    storageRefresh: async () => { throw new Error('runtime refresh failed'); },
  });
  assert.equal((await tab.init()).shown, false);
  assert.equal(flushes, 0);
  assert.equal(shared.getItem(CONSUMED_KEY), null);
});

test('a new server-issued login ID is eligible after the prior one was consumed', async () => {
  const shared = new SharedStorage();
  const tab = createTab({ shared });
  assert.equal((await tab.init()).shown, true);
  tab.authSession.loginSessionId = 'new-login-id';
  assert.equal((await tab.init()).shown, true);
});

test('logout does not claim and a corrupt consumed marker is overwritten only by a valid claim', async () => {
  const shared = new SharedStorage();
  const signedOut = createTab({ shared, authSession: { authenticated: false, user: null } });
  shared.values.set(CONSUMED_KEY, '{not-json');
  assert.equal((await signedOut.init()).shown, false);
  assert.equal(shared.getItem(CONSUMED_KEY), '{not-json');
  const signedIn = createTab({ shared });
  assert.equal((await signedIn.init()).shown, true);
  assert.equal(JSON.parse(shared.getItem(CONSUMED_KEY)).schemaVersion, 1);
});

test('fallback VM tabs with neither locks nor BroadcastChannel yield after shared storage claim readback', async () => {
  const shared = new SharedStorage();
  const a = createTab({ shared, locksImpl: null, BroadcastChannelImpl: null });
  const b = createTab({ shared, locksImpl: null, BroadcastChannelImpl: null });
  const [first, second] = await Promise.all([a.init(), b.init()]);
  assert.equal(Number(first.shown) + Number(second.shown), 1);
  assert.equal((await b.init()).shown, false);
  assert.equal(JSON.parse(shared.getItem(CONSUMED_KEY)).consumedDigest, '22b1cd8d13f99dc13e0bb4c7f4d9096424fe72867aeba5039fbc5da40db6e7db');
});

test('fallback race flushes only the nonce winner and never the losing tab', async () => {
  const shared = new SharedStorage();
  let aFlushes = 0;
  let bFlushes = 0;
  const a = createTab({ shared, locksImpl: null, BroadcastChannelImpl: null, storageFlush: async () => { aFlushes += 1; } });
  const b = createTab({ shared, locksImpl: null, BroadcastChannelImpl: null, storageFlush: async () => { bFlushes += 1; } });
  const [first, second] = await Promise.all([a.init(), b.init()]);
  assert.equal(Number(first.shown) + Number(second.shown), 1);
  assert.equal(aFlushes + bFlushes, 1);
  assert.equal(first.shown ? aFlushes : bFlushes, 1);
  assert.equal(first.shown ? bFlushes : aFlushes, 0);
});

test('a missing auth API may claim only from the server bootstrap session field', async () => {
  const shared = new SharedStorage();
  const tab = createTab({ shared });
  tab.window.__KG_DIRECT_BOOTSTRAP__ = { authUser: { username: 'learner', loginSessionId: 'bootstrap-session-id' } };
  assert.equal((await tab.window.KGLearningEntryChooser.init({ auth: {}, document: tab.window.document, location: tab.window.location, storage: tab.window.localStorage })).shown, true);
  assert.equal(JSON.parse(shared.getItem(CONSUMED_KEY)).consumedDigest, 'ec484f906c17ed7c7293483a396000f90e00faa3bb1b669d7a03a040418a081f');
});

test('winning init stays pending until deferred server-state storage flush resolves', async () => {
  const shared = new SharedStorage();
  let resolveFlush;
  let markFlushStarted;
  let flushCalls = 0;
  const flushGate = new Promise(resolve => { resolveFlush = resolve; });
  const flushStarted = new Promise(resolve => { markFlushStarted = resolve; });
  const tab = createTab({
    shared,
    storageFlush() { flushCalls += 1; markFlushStarted(); return flushGate; },
  });
  let result = 'pending';
  const initPromise = tab.init().then(value => { result = value; return value; });
  const firstOutcome = await Promise.race([flushStarted.then(() => 'flush-started'), initPromise.then(() => 'init-settled')]);
  assert.equal(firstOutcome, 'flush-started');
  assert.equal(flushCalls, 1);
  assert.equal(result, 'pending');
  resolveFlush(true);
  assert.equal((await initPromise).shown, true);
});

test('failed flush rolls back the consumed marker and the same session can claim again', async () => {
  const shared = new SharedStorage();
  let flushCalls = 0;
  const tab = createTab({
    shared,
    storageFlush: async () => {
      flushCalls += 1;
      if (flushCalls === 1) return false;
      return true;
    },
  });
  assert.equal((await tab.init()).shown, false);
  assert.equal(shared.getItem(CONSUMED_KEY), null);
  assert.equal((await tab.init()).shown, true);
  assert.equal(flushCalls, 3);
});

class DomEvent {
  constructor(type, options = {}) { Object.assign(this, { type, bubbles: true, cancelable: true, defaultPrevented: false }, options); }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
}

class DomClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) { const next = force === undefined ? !this.contains(name) : !!force; if (next) this.add(name); else this.remove(name); return next; }
  toString() { return [...this.values].join(' '); }
}

class DomNodeList {
  constructor(values) { values.forEach((value, index) => { this[index] = value; }); this.length = values.length; }
  forEach(callback) { for (let index = 0; index < this.length; index += 1) callback(this[index], index, this); }
  [Symbol.iterator]() { let index = 0; return { next: () => index < this.length ? { value: this[index++], done: false } : { done: true } }; }
}

class DomElement {
  constructor(document, tagName = 'div') {
    this.ownerDocument = document; this.tagName = String(tagName).toUpperCase(); this.children = []; this.parentNode = null;
    this.attributes = new Map(); this.classList = new DomClassList(); this.dataset = {}; this.listeners = new Map();
    this.hidden = false; this.disabled = false; this.inert = false; this.textContent = ''; this.type = '';
  }
  set id(value) { this.setAttribute('id', value); }
  get id() { return this.getAttribute('id') || ''; }
  set className(value) { this.classList = new DomClassList(); String(value).split(/\s+/).filter(Boolean).forEach(name => this.classList.add(name)); }
  get className() { return this.classList.toString(); }
  setAttribute(name, value) { this.attributes.set(String(name), String(value)); if (name === 'class') this.className = value; if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(String(name)); }
  append(...nodes) { nodes.forEach(node => { node.parentNode = this; this.children.push(node); }); }
  appendChild(node) { this.append(node); return node; }
  remove() { if (!this.parentNode) return; this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  addEventListener(type, listener) { const entries = this.listeners.get(type) || new Set(); entries.add(listener); this.listeners.set(type, entries); }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) { event.target ||= this; event.currentTarget = this; for (const listener of this.listeners.get(event.type) || []) listener(event); if (event.bubbles && this.parentNode) this.parentNode.dispatchEvent(event); return !event.defaultPrevented; }
  focus() { if (!this.disabled && !this.inert) this.ownerDocument.activeElement = this; }
  matches(selector) {
    if (selector === 'button') return this.tagName === 'BUTTON';
    if (selector === '[data-learning-entry-choice]') return this.getAttribute('data-learning-entry-choice') !== null;
    if (selector === '[tabindex]') return this.getAttribute('tabindex') !== null;
    const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attribute) return this.getAttribute(attribute[1]) !== null && (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2]);
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    return false;
  }
  querySelectorAll(selector) { const result = []; const visit = node => { for (const child of node.children) { if (child.matches(selector)) result.push(child); visit(child); } }; visit(this); return new DomNodeList(result); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class DomDocument extends DomElement {
  constructor() { super(null, '#document'); this.ownerDocument = this; this.body = this.createElement('body'); this.append(this.body); this.activeElement = this.body; }
  createElement(tagName) { return new DomElement(this, tagName); }
  getElementById(id) { return this.querySelector(`#${id}`); }
}

function createChooserDomTab({ fetchImpl = async () => ({ ok: true, headers: { get: () => 'text/html' } }), injectFetch = true, storageFlush } = {}) {
  const shared = new SharedStorage();
  const document = new DomDocument();
  const graph = document.createElement('main'); graph.id = 'stage'; graph.setAttribute('tabindex', '-1'); document.body.append(graph);
  const listeners = new Map();
  const location = { href: 'https://example.test/index.html', assign(target) { this.href = `https://example.test/${target}`; } };
  const window = {
    crypto: webcrypto, TextEncoder, Uint8Array, navigator: { locks: locks() }, document, location, localStorage: {
      getItem: key => shared.getItem(key), setItem(key, value) { shared.setItem(window, key, value); }, removeItem(key) { shared.removeItem(window, key); },
    }, fetch: fetchImpl, CustomEvent: DomEvent, setTimeout, clearTimeout, queueMicrotask,
    addEventListener(type, listener) { const entries = listeners.get(type) || new Set(); entries.add(listener); listeners.set(type, entries); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); return !event.defaultPrevented; },
  };
  if (storageFlush) window.localStorage.flush = storageFlush;
  document.defaultView = window;
  const context = vm.createContext({ window, document, location, localStorage: window.localStorage, navigator: window.navigator, crypto: window.crypto, fetch: window.fetch, CustomEvent: DomEvent, setTimeout, clearTimeout, queueMicrotask, Promise, JSON, Date, Math, TextEncoder, Uint8Array, console });
  vm.runInContext(fs.readFileSync(assetPath, 'utf8'), context, { filename: assetPath });
  const auth = { async getCurrentSession() { return session('server-session-dom'); } };
  return { auth, document, graph, location, window, init: () => {
    const options = { auth, document, location, storage: window.localStorage };
    if (injectFetch) options.fetch = fetchImpl;
    return window.KGLearningEntryChooser.init(options);
  } };
}

test('winning claim renders the update-style dismissible four-choice dialog in the actual VM DOM', async () => {
  const tab = createChooserDomTab();
  assert.equal((await tab.init()).shown, true);
  const dialog = tab.document.querySelector('[role="dialog"]');
  assert.ok(dialog, 'the winning claim must create a dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(dialog.getAttribute('aria-labelledby'), 'learningEntryTitle');
  assert.equal(tab.document.getElementById('learningEntryTitle').textContent, '从这里开始学习');
  const choices = tab.document.querySelectorAll('[data-learning-entry-choice]');
  assert.deepEqual(Array.from(choices, button => [button.getAttribute('data-learning-entry-choice'), button.getAttribute('data-destination')]), [
    ['知识图谱', 'index.html'], ['知识回忆', 'knowledge-recall.html'], ['知识归纳', 'question-workspace.html'], ['知识巩固', 'practice-mode.html'],
  ]);
  assert.deepEqual(Array.from(choices, button => button.getAttribute('data-description')), [
    '梳理知识结构与关系 · 当前首页', '主动回忆关键词与知识线索 · 深度回忆', '多题比较、归纳与连接 · 多题画布', '通过做题检验并巩固掌握 · 做题模式',
  ]);
  assert.equal(tab.document.querySelector('[aria-label="关闭学习入口"]'), null, 'the dialog no longer renders a close control');
  assert.equal(tab.document.activeElement, choices[0], 'the first choice receives initial focus');
  assert.equal(tab.graph.inert, true, 'the graph is inert while the dialog is open');
  const escape = new DomEvent('keydown', { key: 'Escape' }); tab.document.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(tab.document.querySelector('[role="dialog"]'), null, 'Escape closes the entry dialog');
  assert.equal(tab.graph.inert, false);
  assert.equal(tab.document.activeElement, tab.graph);
});

test('failed server-state storage flush neither renders nor reports a winning claim', async () => {
  const tab = createChooserDomTab({
    storageFlush: async () => { throw new Error('server persistence failed'); },
  });
  const result = await tab.init();
  assert.equal(result.shown, false);
  assert.equal(tab.document.querySelector('[role="dialog"]'), null);
});

test('selection fetches only the fixed same-origin HTML destination before navigating and graph selection restores focus', async () => {
  const calls = [];
  const tab = createChooserDomTab({ fetchImpl: async (target, options) => { calls.push([target, options]); return { ok: true, headers: { get: () => 'text/html; charset=utf-8' } }; } });
  await tab.init();
  const choices = tab.document.querySelectorAll('[data-learning-entry-choice]');
  choices[1].dispatchEvent(new DomEvent('click'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'knowledge-recall.html');
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.equal(tab.location.href, 'https://example.test/knowledge-recall.html');

  const graphTab = createChooserDomTab(); await graphTab.init();
  graphTab.document.querySelectorAll('[data-learning-entry-choice]')[0].dispatchEvent(new DomEvent('click'));
  assert.equal(graphTab.document.querySelector('[role="dialog"]'), null);
  assert.equal(graphTab.graph.inert, false);
  assert.equal(graphTab.document.activeElement, graphTab.graph);
});

test('native window fetch keeps its window receiver before navigation', async () => {
  let expectedWindow;
  let receiverWasWindow = false;
  let calls = 0;
  const receiverSensitiveFetch = function () {
    calls += 1;
    receiverWasWindow = this === expectedWindow;
    if (this !== expectedWindow) throw new TypeError('Illegal invocation');
    return Promise.resolve({ ok: true, headers: { get: () => 'text/html' } });
  };
  const tab = createChooserDomTab({ fetchImpl: receiverSensitiveFetch, injectFetch: false });
  expectedWindow = tab.window;
  await tab.init();
  tab.document.querySelectorAll('[data-learning-entry-choice]')[1].dispatchEvent(new DomEvent('click'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  assert.equal(receiverWasWindow, true);
  assert.equal(tab.location.href, 'https://example.test/knowledge-recall.html');
});

test('a failed destination verification keeps the choice dialog open, restores the selected button, and exposes the exact error', async () => {
  const tab = createChooserDomTab({ fetchImpl: async () => ({ ok: false, headers: { get: () => 'text/plain' } }) });
  await tab.init();
  const recall = tab.document.querySelectorAll('[data-learning-entry-choice]')[1];
  recall.dispatchEvent(new DomEvent('click'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(tab.document.querySelector('[role="dialog"]'));
  assert.equal(recall.disabled, false);
  assert.equal(tab.document.activeElement, recall);
  assert.equal(tab.document.getElementById('learningEntryChooserError').textContent, '该学习页面暂时不可用，请稍后重试');
});

test('source markup and execution order keep the chooser after auth core and before graph initialization', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const auth = html.indexOf('src/29-auth-core.js');
  const chooser = html.indexOf('src/31-learning-entry-chooser.js');
  const graph = html.indexOf('src/10-graph-editor.js');
  assert.ok(auth >= 0 && chooser > auth && graph > chooser, 'chooser must execute after auth core and before graph initialization');
});

function directEntryVm(bootstrap) {
  const listeners = new Map();
  const actions = [];
  const document = { readyState: 'loading', getElementById() { return null; } };
  const window = {
    __KG_DIRECT_BOOTSTRAP__: bootstrap,
    document,
    location: { search: '', reload() { actions.push('reload'); } },
    KGLearningEntryChooser: { async init() { actions.push('show'); return { shown: true }; } },
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    setTimeout,
  };
  const context = vm.createContext({ window, document, URLSearchParams, Promise, setTimeout, console });
  vm.runInContext(fs.readFileSync(directEntryPath, 'utf8'), context, { filename: directEntryPath });
  return {
    actions,
    async dispatch(type, detail = {}) {
      for (const listener of listeners.get(type) || []) listener({ type, detail });
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

test('guest index login reloads before authenticated DOMContentLoaded shows the chooser', async () => {
  const guest = directEntryVm({ authenticated: false, username: '', authUser: null });
  await guest.dispatch('kg:auth-session-changed', { authenticated: true, username: 'learner', loginSessionId: 'login-a' });
  await guest.dispatch('kg-auth-session-change', { username: 'learner', provider: 'remote' });
  assert.deepEqual(guest.actions, ['reload']);

  const authenticated = directEntryVm({ authenticated: true, username: 'learner', authUser: { username: 'learner', role: 'student' } });
  await authenticated.dispatch('DOMContentLoaded');
  assert.deepEqual(authenticated.actions, ['show']);
});

test('a login for a different bootstrap user reloads without pre-showing the chooser', async () => {
  const page = directEntryVm({ authenticated: true, username: 'teacher', authUser: { username: 'teacher', role: 'teacher' } });
  await page.dispatch('kg:auth-session-changed', { authenticated: true, username: 'learner', loginSessionId: 'login-a' });
  await page.dispatch('kg-auth-session-change', { username: 'learner', provider: 'remote' });
  assert.deepEqual(page.actions, ['reload']);
});

test('same-user authenticated session rotation may show without reloading', async () => {
  const page = directEntryVm({ authenticated: true, username: 'learner', authUser: { username: 'learner', role: 'student' } });
  await page.dispatch('kg:auth-session-changed', { authenticated: true, username: 'learner', loginSessionId: 'login-b' });
  await page.dispatch('kg-auth-session-change', { username: 'learner', provider: 'remote' });
  assert.deepEqual(page.actions, ['show']);
});
