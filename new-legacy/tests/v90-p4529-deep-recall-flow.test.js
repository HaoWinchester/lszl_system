'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loadAssociationLibrary() {
  const persistenceCalls = [];
  const forbidden = new Proxy({}, {
    get(_target, property) {
      persistenceCalls.push(String(property));
      throw new Error('learner association library must come from the session snapshot');
    },
  });
  const context = {
    console,
    localStorage: forbidden,
    KGAppStorage: forbidden,
    KGAuthCore: { currentUsername: () => 'student' },
    globalThis: null,
    window: null,
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('src/95-recall-association-library.js'), context, {
    filename: '95-recall-association-library.js',
  });
  return { api: context.KGRecallAssociationLibrary, persistenceCalls };
}

test('session-bound formal Recall resolves stable ID, Chinese, English and aliases without persistence', () => {
  const { api, persistenceCalls } = loadAssociationLibrary();
  const library = {
    schemaVersion: 1,
    nodes: [{
      id: 'recall:mitochondria',
      title: '线粒体',
      titleEn: 'Mitochondrion',
      aliases: ['动力工厂'],
    }],
    edges: [],
  };

  api.setSessionLibrary(library, 'a'.repeat(64));
  const bound = api.read('PMP');

  assert.equal(api.resolve(bound, 'recall:mitochondria').id, 'recall:mitochondria');
  assert.equal(api.resolve(bound, '线粒体').id, 'recall:mitochondria');
  assert.equal(api.resolve(bound, 'mitochondrion').id, 'recall:mitochondria');
  assert.equal(api.resolve(bound, '动力工厂').id, 'recall:mitochondria');
  assert.equal(api.resolve(bound, '我的口诀'), null);
  assert.strictEqual(api.index(bound), api.index(bound), '同一快照必须复用索引');
  assert.deepEqual(persistenceCalls, []);
});

test('recommendations exclude the current node, parent and every ancestor', () => {
  const Flow = require('../src/recall/deep-recall-flow-model.js');
  const nodes = [
    { instanceId: 'root', dataId: 'recall:root', parentId: null },
    { instanceId: 'n1', dataId: 'recall:one', parentId: 'root' },
    { instanceId: 'n2', dataId: 'recall:two', parentId: 'n1' },
    { instanceId: 'n3', dataId: 'recall:three', parentId: 'n2' },
  ];
  const choices = [
    { next: 'recall:root' },
    { next: 'recall:one' },
    { next: 'recall:two' },
    { next: 'recall:three' },
    { next: 'recall:forward' },
  ];

  assert.deepEqual(
    Flow.filterAncestorChoices(nodes, 'n3', choices),
    [{ next: 'recall:forward' }],
  );
  assert.match(Flow.personalNodeId('question/1', 'fixed-token'), /^personal:question-1:fixed-token$/);
});

test('core priority is semantic only and learner markup exposes one shared keyword class', () => {
  const Keyword = require('../src/question-keyword/keyword-runtime-service.js');
  const normal = { id: 'normal', text: '风险', keywordLevel: 'normal' };
  const core = { id: 'core', text: '风险应对', keywordLevel: 'core' };

  assert.equal([normal, core].sort(Keyword.compare)[0].id, 'core');
  assert.equal(Keyword.learnerClass(normal), 'kr-keyword-token');
  assert.equal(Keyword.learnerClass(core), 'kr-keyword-token');
  assert.equal(Keyword.learnerClass(normal), Keyword.learnerClass(core));
});

test('learner page starts hidden and offers one explicit reveal action', () => {
  const html = read('knowledge-recall.html');
  const css = read('styles/knowledge-recall-p4529.css');
  const controller = read('src/86-knowledge-recall.js');

  assert.match(html, /id="krRevealKeywordsBtn"[^>]*>\s*揭示关键词\s*</);
  assert.match(html, /id="krVersionChoice"/);
  assert.match(html, /src\/question-keyword\/keyword-runtime-service\.js/);
  assert.match(html, /src\/recall\/deep-recall-flow-model\.js/);
  assert.match(controller, /keywordsRevealed=false/);
  assert.match(controller, /function revealKeywords\(/);
  assert.match(controller, /window\.opener\?\.KGRecallStorage\?\.readCurrent/);
  assert.doesNotMatch(controller, /is-core|data-core/);
  assert.doesNotMatch(css, /is-core|data-core/);
});
