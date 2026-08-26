'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function load({ remoteActive }) {
  const calls = [];
  const local = {
    listFiles: () => [{ id: 'local-1' }],
    openFile: id => { calls.push(['local-open', id]); return { id, graphData: { nodes: [] } }; },
    createFile: input => { calls.push(['local-create', input.name]); return { id: 'local-created', graphData: input.graphData }; },
  };
  const remote = {
    active: () => remoteActive,
    initialize: async () => { calls.push(['remote-initialize']); return true; },
    listFiles: () => [{ id: 'remote-1' }],
    openFile: async id => { calls.push(['remote-open', id]); return { id, revision: 4, graphData: { nodes: [{ id: 'server-node' }] }, learningState: {} }; },
    createFile: async input => { calls.push(['remote-create', input.name]); return { id: 'remote-created', revision: 1 }; },
  };
  const adapter = {
    adoptFile: file => { calls.push(['adopt', file.id]); return file; },
  };
  const context = { console, Promise, KGGraphFileStore: local, KGGraphFileRemoteStore: remote, KGGraphFileRemoteAdapter: adapter };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(root, 'src/23-graph-file-editor-store-bridge.js'), 'utf8'),
    context,
    { filename: '23-graph-file-editor-store-bridge.js' }
  );
  return { bridge: context.KGGraphFileEditorStoreBridge, calls };
}

(async () => {
  const remote = load({ remoteActive: true });
  await remote.bridge.initializeCurrent();
  assert.deepStrictEqual(remote.calls, [], 'current-only initialization must select the seeded remote store without listing its catalog');
  await remote.bridge.initialize();
  assert.deepStrictEqual(remote.calls, [['remote-initialize']], 'remote mode must initialize only the Files API cache');
  assert.strictEqual(remote.bridge.current().listFiles()[0].id, 'remote-1');

  const opened = await remote.bridge.openFile('remote-1');
  assert.strictEqual(opened.graphData.nodes[0].id, 'server-node');
  assert.deepStrictEqual(remote.calls.slice(-2), [['remote-open', 'remote-1'], ['adopt', 'remote-1']], 'opening a remote tab must hydrate and adopt the same server file');

  const created = await remote.bridge.createFile({ name: '远端新图谱', graphData: { nodes: [] } });
  assert.strictEqual(created.id, 'remote-created');
  assert.deepStrictEqual(remote.calls.slice(-3), [['remote-create', '远端新图谱'], ['remote-open', 'remote-created'], ['adopt', 'remote-created']], 'remote create must never fall through to the local store');
  assert.strictEqual(remote.calls.some(call => call[0].startsWith('local-')), false);

  const local = load({ remoteActive: false });
  await local.bridge.initialize();
  const localCreated = await local.bridge.createFile({ name: '访客图谱', graphData: { nodes: [] } });
  assert.strictEqual(localCreated.id, 'local-created');
  assert.deepStrictEqual(local.calls, [['local-create', '访客图谱']], 'guest mode must retain the original local store');
  console.log('graph editor store bridge contract passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
