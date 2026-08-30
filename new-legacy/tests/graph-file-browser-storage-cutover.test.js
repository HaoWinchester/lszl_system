'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.resolve(__dirname, '../src/23-graph-file-store.js'),
  'utf8'
);

function load(mode) {
  const values = new Map();
  const calls = [];
  const localStorage = {
    getItem(key) { calls.push(['get', key]); return values.get(key) ?? null; },
    setItem(key, value) { calls.push(['set', key]); values.set(key, String(value)); },
    removeItem(key) { calls.push(['remove', key]); values.delete(key); },
  };
  const context = {
    console,
    JSON,
    Date,
    Math,
    Map,
    Set,
    TextEncoder,
    setTimeout,
    clearTimeout,
    localStorage,
    KGAuthCore: {
      providerConfig: () => ({ mode }),
      currentUsername: () => '',
    },
    KGAppStorage: {
      readJSON(key, fallback) {
        calls.push(['app-read', key]);
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      },
      writeJSON(key, value) {
        calls.push(['app-write', key]);
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      },
      remove(key) {
        calls.push(['app-remove', key]);
        localStorage.removeItem(key);
        return true;
      },
    },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; },
    dispatchEvent() {},
    addEventListener() {},
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: '23-graph-file-store.js' });
  return { store: context.KGGraphFileStore, calls, values };
}

const remote = load('remote');
remote.store.ensureInitialized({
  fallbackGraphData: { meta: { title: '访客图谱' }, nodes: [], links: [] },
});
assert.deepStrictEqual(
  remote.calls,
  [],
  '联网版在未登录或退出后只能使用页面内存，不得读写浏览器图谱业务存储'
);
assert.strictEqual(remote.store.listFiles({ owner: 'guest' }).length, 1);

const demo = load('local-demo');
demo.store.ensureInitialized({
  fallbackGraphData: { meta: { title: '本地演示图谱' }, nodes: [], links: [] },
});
assert.ok(demo.calls.some(([action]) => action === 'set' || action === 'app-write'));
assert.ok(demo.values.has('kg_graph_file_index_v2'));

console.log('graph file browser storage cutover contract passed');
