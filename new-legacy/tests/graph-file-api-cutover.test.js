'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.resolve(__dirname, '../src/23-graph-file-api.js'),
  'utf8'
);

function loadContext({ authenticated, enabled, mode = 'remote', currentUser = null }) {
  const listeners = {};
  const context = {
    console,
    JSON,
    Promise,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    localStorage: { getItem: () => null },
    __KG_DIRECT_BOOTSTRAP__: {
      authenticated,
      authUser: authenticated ? { username: 'bootstrap-user' } : null,
      graphFilesApiCutoverEnabled: enabled,
    },
    KGAuthCore: {
      providerConfig: () => ({ mode }),
      currentUser: () => currentUser,
    },
    addEventListener: (name, handler) => { (listeners[name] ||= []).push(handler); },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: '23-graph-file-api.js' });
  context.emit = (name, detail) => (listeners[name] || []).forEach(handler => handler({ detail }));
  return context;
}
function load(options) { return loadContext(options).KGGraphFileApi.isRemote(); }

assert.strictEqual(
  load({ authenticated: true, enabled: true }),
  true,
  'authenticated users use Files API only after the server enables cutover'
);
assert.strictEqual(
  load({ authenticated: true, enabled: false }),
  false,
  'deployed code must stay on runtime storage before migration is verified'
);
assert.strictEqual(
  load({ authenticated: false, enabled: true }),
  false,
  'guests must keep the local graph store'
);
assert.strictEqual(
  load({ authenticated: true, enabled: true, mode: 'local-demo' }),
  false,
  'local-demo mode must never call the remote Files API'
);

const loggedOut = loadContext({ authenticated: true, enabled: true });
assert.strictEqual(loggedOut.KGGraphFileApi.isRemote(), true);
loggedOut.emit('kg:auth-session-changed', { authenticated: false });
assert.strictEqual(loggedOut.KGGraphFileApi.isRemote(), false, 'logout must override stale HTML bootstrap authentication');

console.log('graph files cutover gate contract passed');
