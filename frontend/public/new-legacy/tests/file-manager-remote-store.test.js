'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.resolve(__dirname, '../src/27-file-manager-store-bridge.js'),
  'utf8'
);

async function select({ remoteActive }) {
  const order = [];
  const local = { name: 'local' };
  const remote = {
    name: 'remote',
    active: () => remoteActive,
    initialize: async () => { order.push('initialize'); },
    refresh: async () => { order.push('refresh'); },
  };
  const context = {
    console,
    Promise,
    KGGraphFileStore: local,
    KGGraphFileRemoteStore: remote,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: '27-file-manager-store-bridge.js' });
  const store = await context.KGFileManagerStoreBridge.initialize();
  order.push('render');
  return { context, store, local, remote, order };
}

(async () => {
  const remote = await select({ remoteActive: true });
  assert.strictEqual(remote.store, remote.remote);
  assert.deepStrictEqual(remote.order, ['initialize', 'render'], 'remote cache must initialize before the page can render');
  await remote.context.KGFileManagerStoreBridge.invoke('refresh');
  assert.deepStrictEqual(remote.order, ['initialize', 'render', 'refresh']);

  const local = await select({ remoteActive: false });
  assert.strictEqual(local.store, local.local);
  assert.deepStrictEqual(local.order, ['render'], 'guest/local mode must not initialize the remote store');
  console.log('file manager store bridge contract passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
