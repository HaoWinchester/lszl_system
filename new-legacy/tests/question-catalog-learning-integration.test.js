'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const bankSource = read('src/60-question-bank.js');
const repositorySource = read('src/61-question-repository.js');
const trainingSource = read('src/72-question-training-page.js');
const workspaceSource = read('src/77-multi-question-workspace.js');
const recallSource = read('src/86-knowledge-recall.js');
const recallQuestionSource = read('src/96-recall-question-source.js');
const practiceSource = read('src/100-practice-mode.js');

assert.match(bankSource, /const QB_CATALOG=window\.KGQuestionCatalogAdapter/);
assert.match(bankSource, /function qbLoadBanks\(\)[\s\S]*?QB_CATALOG\.snapshot\(\)/);
assert.match(bankSource, /function qbLoadLegacyBanksForMigrationPreview\(\)[\s\S]*?qbReadJSON\(qbBanksKey\(\)/);
assert.equal((bankSource.match(/qbBanksKey\(\)/g) || []).length, 3, 'legacy bank key may only be declared, preview-read, and inspected by save guard');
assert.doesNotMatch(bankSource, /qbWriteJSON\(qbBanksKey\(|qbReadJSON\(QUESTION_PUBLISHED_BANKS_KEY/);
assert.match(bankSource, /function qbSaveBanks\(\)[\s\S]*?return false/);
assert.doesNotMatch(bankSource.match(/function qbCurrentQuestion\(\)[^\n]*/)?.[0] || '', /qbDefaultBank/);

assert.match(repositorySource, /const catalog=global\.KGQuestionCatalogAdapter/);
assert.match(repositorySource, /function sourceQuestion\(\)[\s\S]*?catalog\.snapshot\(\)/);
assert.doesNotMatch(repositorySource, /function current\(\)[\s\S]*?appliedQuestion\(\)\|\|sourceQuestion/);

for (const [name, source, initializer] of [
  ['training', trainingSource, 'initQuestionTrainingPage'],
  ['workspace', workspaceSource, 'init'],
  ['recall', recallSource, 'init'],
  ['practice', practiceSource, 'init'],
]) {
  assert.match(source, new RegExp(`async function ${initializer}\\(\\)[\\s\\S]*?await (?:window|global)\\.KGQuestionCatalogAdapter\\.ready`), `${name} must await the catalog before rendering`);
}

assert.match(recallQuestionSource, /const catalogReady=Promise\.resolve\(global\.KGQuestionCatalogAdapter\?\.ready\)/);
assert.match(recallQuestionSource, /function list\(\)\{if\(!catalogLoaded\)return \[\]/);
assert(recallQuestionSource.includes('questionSnapshots') || practiceSource.includes('questionSnapshots'), 'published release snapshots must remain immutable inputs');
assert(practiceSource.includes('questionSnapshots'), 'practice mode must keep release snapshots');

const snapshot = {
  banks: [
    { id: 'public-bank', name: '公开题库', subject: 'PMP', visibility: 'published', accessMode: 'public' },
    { id: 'private-bank', name: '私有题库', subject: 'PMP', visibility: 'private', accessMode: 'private' },
  ],
  questions: [
    { id: 'public-active', bankId: 'public-bank', title: '公开正常题', scope: 'public', lifecycle: { status: 'active' }, options: [] },
    { id: 'internal-active', bankId: 'public-bank', title: '内部题', scope: 'internal', lifecycle: { status: 'active' }, options: [] },
    { id: 'public-deleted', bankId: 'public-bank', title: '已删除题', scope: 'public', lifecycle: { status: 'deleted' }, options: [] },
    { id: 'private-question', bankId: 'private-bank', title: '私有题', scope: 'public', lifecycle: { status: 'active' }, options: [] },
  ],
};
const storage = { getItem: () => null, setItem() {}, removeItem() {} };
const window = {
  KGQuestionCatalogAdapter: { snapshot: () => JSON.parse(JSON.stringify(snapshot)), ready: Promise.resolve(snapshot) },
  KGAppStorage: { readJSON: (_key, fallback) => fallback, readString: (_key, fallback) => fallback },
  KGStorageKeys: { PREFIXES: {} },
  KGPublishedPaperRepository: { listReleases: () => [] },
  localStorage: storage,
  addEventListener() {},
  dispatchEvent() {},
};
const context = vm.createContext({ window, localStorage: storage, console, Date, JSON, Math, CustomEvent: class CustomEvent {} });
vm.runInContext(bankSource, context, { filename: '60-question-bank.js' });
const learningBanks = vm.runInContext('qbLoadBanks()', context);
assert.equal(learningBanks.length, 1);
assert.equal(learningBanks[0].id, 'public-bank');
assert.deepEqual(Array.from(learningBanks[0].questions, question => question.id), ['public-active']);
assert.equal(vm.runInContext('qbCurrentQuestion().id', context), 'public-active');

console.log('question-catalog-learning-integration-ok');
