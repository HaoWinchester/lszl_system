'use strict';

// V9.0-P4.5.31 · 联想库服务器链路合同测试。
// 事故：管理端导入/发布只写浏览器 localStorage，而深度回忆会话只读服务器
// SharedRuntimeState 快照——库永远到不了学员端，关键词卡牌退化显示 recallNodeId。
// 断言：① 95 提供服务器读写 API；② 管理台发布与内容中心保存都同步服务器；
// ③ 深度回忆教师预览在本地无库时从服务器兜底；④ 管理台空本地时回填服务器库。

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const library = read('src/95-recall-association-library.js');
const admin = read('src/admin/53-recall-association-management.js');
const contentCenter = read('src/96-recall-association-admin.js');
const recall = read('src/86-knowledge-recall.js');
const test = require('node:test');

// ① 共享库模块提供服务器读写（credentials 包含登录会话）
assert.match(library, /const SHARED_CONTENT_PATH='\/api\/v1\/content-prep\/shared-content'/);
assert.match(library, /async function readServer\(subjectId='PMP'\)/);
assert.match(library, /async function writeServer\(subjectId='PMP',library=\{\}\)/);
assert.match(library, /credentials:'include'/);
assert.match(library, /readServer,writeServer\}\);/);

// ② 管理台发布必须同步服务器，失败要有可见警告（不能静默只留本浏览器）
assert.match(admin, /await Library\.writeServer\(state\.subjectCode,candidate\)/);
assert.match(admin, /serverSynced:true/);
assert.match(admin, /服务器同步失败/);
assert.match(admin, /error\?\.status===409/);
// 空本地时以服务器正式库为基线
assert.match(admin, /async function hydrateFromServer\(\)/);
assert.match(admin, /Library\.readServer\(state\.subjectCode\)/);

// ③ 内容中心保存同步服务器
assert.match(contentCenter, /await libraryApi\.writeServer\(subject\.code,result\.library\)/);
assert.match(contentCenter, /学员端尚未同步/);

// ④ 深度回忆教师预览：本地无库时从服务器兜底并重建关键词映射
assert.match(recall, /async function hydratePreviewLibrary\(\)/);
assert.match(recall, /readServer\?\.\(subject\)/);
assert.match(recall, /if\(isTeacherDraftPreview\(\)\)return/);
assert.match(recall, /await hydratePreviewLibrary\(\);/);

test('server recall publication keeps the current library identity and revision', async () => {
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const payload = (init.method || 'GET') === 'PUT'
      ? { contentRevision: 18, recallLibrary: { id: 'recall-current-v2', version: 2, status: 'published', nodes: [{ id: 'updated' }], edges: [] } }
      : { contentRevision: 17, recallLibrary: { id: 'recall-current-v2', version: 2, status: 'published', nodes: [{ id: 'before' }], edges: [] } };
    return { ok: true, status: 200, async json() { return payload; } };
  };
  try {
    delete require.cache[require.resolve('../src/95-recall-association-library.js')];
    const api = require('../src/95-recall-association-library.js');
    const saved = await api.writeServer('PMP', { nodes: [{ id: 'updated' }], edges: [] });
    const put = calls.find(call => call.init.method === 'PUT');
    assert.ok(put);
    const body = JSON.parse(put.init.body);
    assert.equal(body.contentRevision, 17);
    assert.equal(body.recallLibrary.id, 'recall-current-v2');
    assert.equal(body.recallLibrary.version, 2);
    assert.equal(saved.identity.id, 'recall-current-v2');
  } finally {
    global.fetch = previousFetch;
  }
});

console.log('deep-recall-association-server-sync-ok');
