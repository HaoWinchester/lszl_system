'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const context = vm.createContext({
  console,
  Date,
  Math,
  JSON,
  globalThis: null,
});
context.globalThis = context;

for (const file of [
  'src/teacher/shared/domain-core.js',
  'src/59a-paper-learning-modes.js',
  'src/teacher/paper-management/paper-release-service.js',
]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
}

const releases = [];
const history = [];
const service = context.KGTeacherDomains.PaperManagement.PaperReleaseService.create({
  now: () => 123456,
  actor: () => ({ id: 'teacher-1', name: '教师一', role: 'teacher' }),
  categoryName: () => '冲刺卷',
  questionLookup: () => ({
    bank: { name: 'PMP 题库', subject: 'PMP' },
    question: { id: 'q-1', stem: '题目正文', lifecycle: { status: 'active' } },
  }),
  readCatalog: () => releases,
  writeCatalog: value => {
    releases.splice(0, releases.length, ...value);
    return true;
  },
  readHistory: () => history,
  writeHistory: value => {
    history.splice(0, history.length, ...value);
    return true;
  },
});

const paper = {
  id: 'paper-1',
  name: '会员冲刺卷',
  subject: 'PMP',
  categoryId: 'sprint',
  status: 'draft',
  publishedVersion: 2,
  accessPolicy: { accessLevel: 'premium' },
  enabledModes: ['deep_recall', 'single_deep_study'],
  modeConfigVersion: 2,
  questions: [{ bankId: 'bank-1', questionId: 'q-1' }],
};

const published = service.publish(paper);
assert.equal(published.ok, true);
assert.equal(published.value.version, 3);
assert.deepEqual(published.value.accessPolicy, { accessLevel: 'member' });
assert.deepEqual(Array.from(published.value.enabledModes), ['deep_recall', 'single_deep_study']);
assert.equal(published.value.questionSnapshots[0].question.stem, '题目正文');
assert.equal(paper.status, 'published');
assert.equal(paper.publishedVersion, 3);
assert.equal(releases.length, 1);
assert.equal(history.length, 1);

const withdrawn = service.withdraw(paper);
assert.equal(withdrawn.ok, true);
assert.equal(releases.length, 0);
assert.equal(history.length, 1, '撤回只下架当前版本，历史发布快照必须保留');

const invalid = service.validate({
  id: 'paper-empty-mode',
  enabledModes: [],
  modeConfigVersion: 2,
  questions: [{ bankId: 'bank-1', questionId: 'q-1' }],
});
assert.equal(invalid.ok, false);
assert(invalid.errors.includes('请至少选择一种学习模式后再发布。'));

console.log('v90-p43-paper-release-service-ok');
