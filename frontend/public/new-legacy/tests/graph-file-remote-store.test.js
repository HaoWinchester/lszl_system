'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const calls = [];
let files = [{
  id: 'f1',
  ownerId: 'alice',
  name: '远端图谱',
  folderId: 'd1',
  restoreFolderId: null,
  favorite: true,
  status: 'active',
  revision: 4,
  order: 1000,
  tag: { id: 't1', name: '重点', color: '#ef4444' },
  createdAt: '2026-08-24T00:00:00+00:00',
  updatedAt: '2026-08-24T01:00:00+00:00',
  lastOpenedAt: null,
}];
let folders = [{
  id: 'd1', name: '第一章', parentId: null, restoreParentId: null,
  status: 'active', order: 1000,
  createdAt: '2026-08-24T00:00:00+00:00',
  updatedAt: '2026-08-24T01:00:00+00:00',
}];
let tags = [{ id: 't1', name: '重点', color: '#ef4444' }];

const api = {
  isRemote: () => true,
  listFiles: async (status) => ({ files: files.filter(file => file.status === status) }),
  listFolders: async (status) => ({ folders: folders.filter(folder => folder.status === status) }),
  listTags: async () => ({ tags }),
  getCurrent: async () => ({ fileId: 'f1' }),
  create: async input => { calls.push(['create', input]); const file = { ...files[0], id: 'f2', name: input.name, favorite: false, tag: null, revision: 1 }; files.push(file); return { file }; },
  get: async id => ({ meta: files.find(file => file.id === id), graphData: { meta: { title: id }, nodes: [], links: [] }, learningState: {} }),
  setCurrent: async id => { calls.push(['current', id]); return { ok: true }; },
  patchFile: async (id, patch) => { calls.push(['patchFile', id, patch]); const index = files.findIndex(file => file.id === id); files[index] = { ...files[index], ...patch }; return { file: files[index] }; },
  trashFile: async id => { calls.push(['trashFile', id]); const file = files.find(item => item.id === id); file.status = 'trashed'; return { ok: true }; },
  restoreFile: async id => { calls.push(['restoreFile', id]); const file = files.find(item => item.id === id); file.status = 'active'; return { file }; },
  deleteFilePermanent: async id => { calls.push(['deleteFilePermanent', id]); files = files.filter(file => file.id !== id); return { ok: true }; },
  duplicateFile: async (id, name) => { calls.push(['duplicateFile', id, name]); const file = { ...files.find(item => item.id === id), id: 'f-copy', name }; files.push(file); return { file }; },
  emptyTrash: async () => ({ deletedFiles: 1, deletedFolders: 0 }),
  createFolder: async input => { const folder = { ...input, id: 'd2', status: 'active', order: 2000 }; folders.push(folder); return { folder }; },
  patchFolder: async (id, patch) => { const folder = folders.find(item => item.id === id); Object.assign(folder, patch); return { folder }; },
  trashFolder: async id => { folders.find(item => item.id === id).status = 'trashed'; return { ok: true }; },
  restoreFolder: async id => { const folder = folders.find(item => item.id === id); folder.status = 'active'; return { folder }; },
  deleteFolderPermanent: async id => { folders = folders.filter(folder => folder.id !== id); return { ok: true }; },
  createTag: async input => { const tag = { ...input, id: 't2' }; tags.push(tag); return { tag }; },
  updateTag: async (id, patch) => { const tag = tags.find(item => item.id === id); Object.assign(tag, patch); return { tag }; },
  deleteTag: async id => { tags = tags.filter(tag => tag.id !== id); return { ok: true }; },
  setFileTag: async (id, tagId) => { const file = files.find(item => item.id === id); file.tag = tags.find(tag => tag.id === tagId) || null; return { ok: true }; },
};

const context = {
  console, Promise, Date, JSON, setTimeout, clearTimeout,
  KGGraphFileApi: api,
  KGAuthCore: { currentUsername: () => 'alice' },
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(root, 'src/23-graph-file-remote-store.js'), 'utf8'),
  context,
  { filename: '23-graph-file-remote-store.js' }
);

(async () => {
  const store = context.KGGraphFileRemoteStore;
  assert.strictEqual(store.active(), true);
  await store.initialize();

  const listed = store.listFiles({ owner: 'alice' });
  assert.strictEqual(listed.length, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(listed[0].tags)), ['重点']);
  assert.strictEqual(listed[0].favorite, true);
  assert.strictEqual(listed[0].createdAt, Date.parse('2026-08-24T00:00:00+00:00'));
  assert.strictEqual(store.getCurrentFileId('alice'), 'f1');
  assert.strictEqual(store.listFolders({ owner: 'alice' })[0].createdAt, Date.parse('2026-08-24T00:00:00+00:00'));

  const created = await store.createFile({ name: '新文件', graphData: { meta: { title: '新文件' }, nodes: [], links: [] } }, { makeCurrent: true });
  assert.strictEqual(created.id, 'f2');
  assert.strictEqual(store.getCurrentFileId('alice'), 'f2');
  assert(calls.some(call => call[0] === 'current' && call[1] === 'f2'));

  const favorite = await store.setFileFavorite('f2', true);
  assert.strictEqual(favorite.favorite, true);
  const moved = await store.moveFile('f2', 'd1');
  assert.strictEqual(moved.folderId, 'd1');
  const copy = await store.duplicateFile('f2', { name: '新文件 副本', makeCurrent: false });
  assert.strictEqual(copy.id, 'f-copy');

  const tag = await store.createTag('复习', '#2563eb');
  await store.setFileTags('f2', [tag.name]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(store.getFileTags('f2'))), ['复习']);

  await store.deleteFile('f2');
  assert(store.listFiles({ status: 'trashed', includeTrash: true }).some(file => file.id === 'f2'));
  await store.restoreFile('f2');
  assert(store.listFiles({ status: 'active' }).some(file => file.id === 'f2'));

  store.clearSession();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(store.listFiles({ owner: 'alice' }))), []);
  assert.strictEqual(store.getCurrentFileId('alice'), '');
  console.log('graph remote store contract passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
