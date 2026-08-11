'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

global.window = global;
global.addEventListener = () => {};
global.KGAuthCore = { currentUser: () => ({ username: 'student', role: 'student' }) };
global.KGRolePermissions = {
  currentRole: () => 'student',
  canOperateQuestion: () => true,
};
global.KGSubscription = { canUse: () => false };
global.KGServerEntitlements = { allExamPapers: false };

const storage = new Map();
global.KGAppStorage = {
  readString: (key, fallback = '') => storage.has(key) ? storage.get(key) : fallback,
};

const modePath = path.resolve(__dirname, '../src/59a-paper-learning-modes.js');
const accessPath = path.resolve(__dirname, '../src/58-paper-access-service.js');
const repositoryPath = path.resolve(__dirname, '../src/59-published-paper-repository.js');
for (const file of [modePath, accessPath, repositoryPath]) delete require.cache[file];
require(modePath);
require(accessPath);

const question = {
  id: 'q-1',
  stemParts: [{ text: '冻结题干' }],
  options: [{ id: 'A', text: '正确', correct: true }, { id: 'B', text: '错误' }],
};
const ref = { bankId: 'bank-1', questionId: 'q-1', order: 1 };
const snapshot = { bankId: 'bank-1', questionId: 'q-1', question };

storage.set('kg_exam_papers_published_v1', JSON.stringify([
  {
    id: 'release-vip-v2', paperId: 'paper-vip', releaseId: 'release-vip-v2', version: 2,
    name: 'VIP 当前卷', status: 'published', publishedAt: 20,
    accessPolicy: { accessLevel: 'member' }, enabledModes: ['practice_mode'], modeConfigVersion: 2,
    totalCount: 1, configuredCount: 1, questions: [], questionSnapshots: [], contentRestricted: true,
  },
  {
    id: 'release-recall', paperId: 'paper-recall', releaseId: 'release-recall', version: 1,
    name: '仅回忆卷', status: 'published', publishedAt: 10,
    accessPolicy: { accessLevel: 'free' }, enabledModes: ['deep_recall'], modeConfigVersion: 2,
    questions: [ref], questionSnapshots: [snapshot],
  },
]));
storage.set('kg_exam_paper_release_history_v1', JSON.stringify([
  {
    id: 'release-vip-v1', paperId: 'paper-vip', releaseId: 'release-vip-v1', version: 1,
    name: 'VIP 历史卷', status: 'published', publishedAt: 5,
    accessPolicy: { accessLevel: 'member' }, enabledModes: ['practice_mode'], modeConfigVersion: 2,
    questions: [ref], questionSnapshots: [snapshot],
  },
]));

const repository = require(repositoryPath);

const catalog = repository.listCatalogEntries({ mode: 'practice_mode' });
assert.equal(catalog.length, 1);
assert.equal(catalog[0].questionCount, 1, '受限目录仍应显示配置题量');
assert.equal(catalog[0].access.allowed, false);
assert.equal(catalog[0].access.code, 'MEMBERSHIP_REQUIRED');

const denied = repository.inspectRelease(
  { paperId: 'paper-vip', releaseId: 'release-vip-v2' },
  { mode: 'practice_mode' },
);
assert.equal(denied.ok, false);
assert.equal(denied.code, 'MEMBERSHIP_REQUIRED');

const disabled = repository.inspectRelease(
  { paperId: 'paper-recall', releaseId: 'release-recall' },
  { mode: 'practice_mode' },
);
assert.equal(disabled.ok, false);
assert.equal(disabled.code, 'MODE_DISABLED');

const historical = repository.getPublishedPaper(
  { paperId: 'paper-vip', releaseId: 'release-vip-v1' },
  { includeHistory: true },
);
assert.equal(historical.releaseId, 'release-vip-v1');
assert.equal(historical.availability, 'superseded');

console.log('v90-p43 published paper policy tests passed');
