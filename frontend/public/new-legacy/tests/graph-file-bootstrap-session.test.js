'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const listeners = new Map();
let loadCount = 0;
let renderCount = 0;
let sessionAuthenticated = true;
let stateSeenByLoad = '';
const remote = {
  active: () => sessionAuthenticated,
  initialize: async () => ({ id: 'remote-file' }),
  handleSessionChange: async event => {
    sessionAuthenticated = event.detail.authenticated;
    return sessionAuthenticated ? { id: 'remote-file' } : null;
  },
};
const context = {
  console, Promise, setTimeout, clearTimeout,
  window: null,
  document: { getElementById: () => null },
  KGGraphFileRemoteAdapter: remote,
  KGGraphFileTabs: { init: async () => {}, refresh: async () => {} },
  KGGraphFileAutosave: { start: () => {} },
  KGAuthCore: { currentUser: () => sessionAuthenticated ? { username: 'alice' } : null },
  state: { meta: { title: '账号私有图谱' }, nodes: [{ id: 'secret' }], links: [] },
  lastSavedSnapshot: 'private-snapshot',
  baseState: () => ({ meta: { title: '访客默认图谱' }, nodes: [], links: [] }),
  load: () => { loadCount += 1; stateSeenByLoad = context.state.meta.title; return true; },
  render: () => { renderCount += 1; },
  authInstallGuards: () => {},
  authInstallQuestionReadonlyGuard: () => {},
  authRenderStatus: () => {},
  requestAnimationFrame: callback => callback(),
  addEventListener: (name, handler) => listeners.set(name, handler),
  bindQuestionTrainer: () => {},
  bindQuestionBankManager: () => {},
  bindQuestionTrainerSafe: () => {},
  ensureQuestionFontScale: () => {},
  $: () => null,
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'src/90-bootstrap.js'), 'utf8'), context, { filename: '90-bootstrap.js' });

(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  const initialLoads = loadCount;
  const initialRenders = renderCount;
  await listeners.get('kg:auth-session-changed')({ detail: { authenticated: false } });
  assert.strictEqual(loadCount, initialLoads + 1, 'logout must immediately load the guest graph state');
  assert.strictEqual(renderCount, initialRenders + 1, 'logout must immediately replace the authenticated canvas');
  assert.strictEqual(stateSeenByLoad, '访客默认图谱', 'authenticated graph data must never become the guest fallback');
  assert.strictEqual(context.lastSavedSnapshot, '', 'authenticated save snapshots must be discarded on logout');
  console.log('graph bootstrap logout session contract passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
