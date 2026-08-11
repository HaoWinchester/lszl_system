'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const assetPath = path.join(ROOT, 'src', '31-learning-entry-chooser.js');
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

function createTab({ shared, authSession = session(), locksImpl = locks(), BroadcastChannelImpl = FakeBroadcastChannel } = {}) {
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

test('a missing auth API may claim only from the server bootstrap session field', async () => {
  const shared = new SharedStorage();
  const tab = createTab({ shared });
  tab.window.__KG_DIRECT_BOOTSTRAP__ = { authUser: { username: 'learner', loginSessionId: 'bootstrap-session-id' } };
  assert.equal((await tab.window.KGLearningEntryChooser.init({ auth: {}, document: tab.window.document, location: tab.window.location, storage: tab.window.localStorage })).shown, true);
  assert.equal(JSON.parse(shared.getItem(CONSUMED_KEY)).consumedDigest, 'ec484f906c17ed7c7293483a396000f90e00faa3bb1b669d7a03a040418a081f');
});
