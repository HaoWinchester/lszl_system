'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const calls = [];
const local = {
  currentOwner: () => 'alice',
  getCurrentFileId: () => 'local-current',
  createFile: () => { calls.push('local-create'); return { id: 'local-created', name: '错误本地文件', graphData: { meta: {}, nodes: [], links: [] } }; },
  listFiles: () => [],
};
const remote = {
  currentOwner: () => 'alice',
  getCurrentFileId: () => 'remote-current',
  listFiles: () => [],
};
const created = { id: 'remote-created', name: '远端新图谱', graphData: { meta: { title: '远端新图谱' }, nodes: [], links: [] } };
const bridge = {
  current: () => remote,
  isRemote: () => true,
  createFile: async input => { calls.push(['remote-create', input.name]); return created; },
};
const context = {
  console, Promise, Date, JSON, setTimeout, clearTimeout,
  state: { meta: {}, nodes: [], links: [] },
  lastSavedSnapshot: '',
  document: { getElementById: () => null, documentElement: { dataset: {} } },
  sessionStorage: { getItem: () => null, setItem: () => {} },
  addEventListener: () => {},
  dispatchEvent: () => {},
  CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
  prompt: () => '远端新图谱',
  authRequire: () => true,
  templateState: () => ({ meta: {}, nodes: [], links: [] }),
  sanitizeState: value => value,
  saveableState: () => ({ meta: {}, nodes: [], links: [] }),
  render: () => { calls.push('render'); },
  resetGraphHistory: () => {},
  KGGraphFileStore: local,
  KGGraphFileEditorStoreBridge: bridge,
  KGGraphFileAutosave: { saveBeforeSwitch: async () => true, clearDirty: () => {} },
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(root, 'src/25-graph-file-tabs.js'), 'utf8'),
  context,
  { filename: '25-graph-file-tabs.js' }
);

(async () => {
  const result = await context.KGGraphFileTabs.createFile();
  assert.strictEqual(result.id, 'remote-created');
  assert.deepStrictEqual(calls[0], ['remote-create', '远端新图谱'], 'remote editor tabs must create through the bridge');
  assert.strictEqual(calls.includes('local-create'), false, 'remote editor tabs must never write the legacy local store');
  assert.strictEqual(context.state.meta.title, '远端新图谱', 'created remote graph must become the live canvas state');
  console.log('graph file tabs remote contract passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
