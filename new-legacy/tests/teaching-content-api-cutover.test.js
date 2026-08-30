'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..');
const readSource = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const readRepo = relative => fs.readFileSync(path.join(REPO, relative), 'utf8');

const teachingSources = [
  'src/admin/42-teaching-content-server-gateway.js',
  'src/admin/53-recall-association-management.js',
  'content-prep-studio/src/js/45-server-events.js',
];
const completeTeachingBoundary = [
  'src/admin/31-subject-service.js',
  'src/admin/32-taxonomy-service.js',
  'src/admin/33-activity-service.js',
  'src/principles/principle-repository.js',
  'src/principles/synthesis-preset-repository.js',
];
const retiredTeachingKeys = /kg_(?:content_subjects|content_taxonomies|content_activity_overrides|principle_repository|synthesis_preset|recall_association_library)_v1/;

test('teaching repositories no longer read or write browser Runtime projections', () => {
  for (const relative of teachingSources) {
    const source = readSource(relative);
    assert.doesNotMatch(source, /localStorage/, relative);
    assert.doesNotMatch(source, retiredTeachingKeys, relative);
  }
  for (const relative of completeTeachingBoundary) {
    assert.doesNotMatch(readSource(relative), retiredTeachingKeys, relative);
  }
  for (const relative of [
    'src/principles/principle-repository.js',
    'src/principles/synthesis-preset-repository.js',
  ]) assert.doesNotMatch(readSource(relative), /localStorage/, relative);
});

test('Task 6 compatibility is limited to exact course and task repository resources', () => {
  const repository = readSource('src/admin/11-local-content-repository.js');
  const allowedUntilTask6 = [
    'kg_course_config_drafts_v1',
    'kg_course_config_releases_v1',
    'kg_course_config_active_release_v1',
    'kg_learning_tasks_v1',
  ];
  for (const key of allowedUntilTask6) assert.match(repository, new RegExp(key));
  assert.match(repository, /allowedUntilTask6/);
});

test('Task 5B compatibility lists only the exact synchronous teaching lifecycle keys', () => {
  const repository = readSource('src/admin/11-local-content-repository.js');
  const learning = readSource('src/91-learning-content-core.js');
  const organization = readSource('src/93-content-organization-core.js');
  const allowedUntilTask5B = [
    'kg_content_subjects_v1', 'kg_content_taxonomies_v1',
    'kg_content_activity_overrides_v1', 'kg_activity_tags_v1',
    'kg_activity_collections_v1',
  ];
  assert.match(repository, /allowedUntilTask5B/);
  for (const key of allowedUntilTask5B) assert.match(repository, new RegExp(key));
  for (const key of allowedUntilTask5B.slice(0, 3)) assert.match(learning, new RegExp(key));
  for (const key of allowedUntilTask5B.slice(3)) assert.match(organization, new RegExp(key));
});

test('all recall authoring entry points await the relational save before success feedback', () => {
  const library = readSource('src/95-recall-association-library.js');
  assert.doesNotMatch(library, /SharedRuntimeState|localStorage|kg_recall_association_library_v1/);
  for (const relative of ['src/96-recall-association-admin.js', 'src/65-question-bank-admin.js']) {
    const source = readSource(relative);
    assert.match(source, /await (?:libraryApi|api)\.writeServer/);
    assert.doesNotMatch(source, /\.saveText\(/);
  }
});

test('principle editor awaits typed API persistence before rendering success', () => {
  const source = readSource('src/teacher/training-config/principle-preset-controller.js');
  assert.match(source, /async function savePrinciple/);
  assert.match(source, /await global\.KGTeachingContentApi\.savePrinciple/);
});

test('teaching adapter bootstraps relational snapshots and retries one stale taxonomy save', async () => {
  const calls = [];
  let putCount = 0;
  const initial = {
    subjectId: 'subject-pmp', contentRevision: 4,
    subjects: [{ id: 'subject-pmp', code: 'PMP', name: { zh: 'PMP' } }],
    taxonomies: [{ id: 'tax-v1', subjectId: 'subject-pmp', version: 1, status: 'published', nodes: [] }],
    knowledgeTree: { taxonomy: { id: 'tax-v1', subjectId: 'subject-pmp', version: 1, status: 'published', nodes: [] } },
    activityOverrides: [{ id: 'q-1' }], activityCollections: [],
    recallLibrary: { schemaVersion: 1, nodes: [], edges: [] },
    principles: { schemaVersion: 1, items: [{ id: 'p-1', name: '原则' }] },
    synthesisPresets: { schemaVersion: 1, items: [] }, tagConfig: {},
  };
  const window = {
    KGDomainApi: {
      async request(input) {
        calls.push(input);
        if (input.method === 'PUT') {
          putCount += 1;
          if (putCount === 1) throw Object.assign(new Error('stale'), { status: 409 });
          return { ...initial, contentRevision: 6, knowledgeTree: input.body.knowledgeTree };
        }
        return { ...initial, contentRevision: calls.length === 2 ? 5 : initial.contentRevision };
      },
    },
    location: { search: '?subjectId=subject-pmp' },
    dispatchEvent() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  };
  const context = vm.createContext({ window, URLSearchParams, structuredClone, Promise, console });
  vm.runInContext(readRepo('frontend/scripts/new-legacy-assets/teaching-content-adapter.js'), context);
  await window.KGTeachingContentApi.bootstrap('subject-pmp');
  assert.equal(JSON.stringify(window.KGTeachingContentApi.readResource('subjects')), JSON.stringify(initial.subjects));

  const saved = await window.KGTeachingContentApi.saveTaxonomy({
    id: 'tax-v2', subjectId: 'subject-pmp', version: 2, nodes: [],
  });
  assert.equal(saved.id, 'tax-v2');
  assert.equal(putCount, 2);
  assert.equal(calls.filter(call => call.method === 'PUT').length, 2);
  assert.equal(window.KGTeachingContentApi.snapshot().contentRevision, 6);
});

test('teaching adapter keeps late subject bootstrap from replacing the active subject', async () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  };
  const requests = new Map();
  const window = {
    KGDomainApi: {
      request(input) {
        const subject = new URL(input.path, 'http://local').searchParams.get('subjectId');
        const pending = deferred();
        requests.set(subject, pending);
        return pending.promise;
      },
    },
    location: { search: '' },
    dispatchEvent() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  };
  vm.runInContext(
    readRepo('frontend/scripts/new-legacy-assets/teaching-content-adapter.js'),
    vm.createContext({ window, URL, URLSearchParams, structuredClone, Promise, console }),
  );

  const subjectA = window.KGTeachingContentApi.bootstrap('subject-a');
  const subjectB = window.KGTeachingContentApi.bootstrap('subject-b');
  requests.get('subject-b').resolve({ subjectId: 'subject-b', contentRevision: 2, principles: { items: [{ id: 'b' }] } });
  await subjectB;
  requests.get('subject-a').resolve({ subjectId: 'subject-a', contentRevision: 1, principles: { items: [{ id: 'a' }] } });
  await subjectA;

  assert.equal(window.KGTeachingContentApi.snapshot().subjectId, 'subject-b');
  assert.equal(window.KGTeachingContentApi.readResource('principles').items[0].id, 'b');
  assert.equal(window.KGTeachingContentApi.snapshot('subject-a').subjectId, 'subject-a');
});

test('a delayed explicit subject write cannot replace a newer active subject', async () => {
  let resolveWrite;
  const calls = [];
  const payload = subjectId => ({
    subjectId, contentRevision: subjectId === 'subject-a' ? 1 : 7,
    recallLibrary: { subjectId, nodes: [{ id: subjectId }], edges: [] },
    principles: { schemaVersion: 1, items: [] },
    synthesisPresets: { schemaVersion: 1, items: [] },
  });
  const window = {
    KGDomainApi: {
      request(input) {
        calls.push(structuredClone(input));
        if (input.method === 'PUT') {
          return new Promise(resolve => { resolveWrite = () => resolve({ ...payload('subject-a'), contentRevision: 2, recallLibrary: input.body.recallLibrary }); });
        }
        const subject = new URL(input.path, 'http://local').searchParams.get('subjectId');
        return Promise.resolve(payload(subject));
      },
    },
    location: { search: '' }, dispatchEvent() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  };
  vm.runInContext(
    readRepo('frontend/scripts/new-legacy-assets/teaching-content-adapter.js'),
    vm.createContext({ window, URL, URLSearchParams, structuredClone, Promise, console }),
  );

  await window.KGTeachingContentApi.bootstrap('subject-a');
  const writingA = window.KGTeachingContentApi.saveRecallLibrary('subject-a', { nodes: [{ id: 'saved-a' }], edges: [] });
  await new Promise(resolve => setImmediate(resolve));
  await window.KGTeachingContentApi.bootstrap('subject-b');
  resolveWrite();
  await writingA;

  const put = calls.find(call => call.method === 'PUT');
  assert.equal(put.body.subjectId, 'subject-a');
  assert.equal(window.KGTeachingContentApi.snapshot().subjectId, 'subject-b');
  assert.equal(window.KGTeachingContentApi.snapshot('subject-a').recallLibrary.nodes[0].id, 'saved-a');
});

test('recall save binds PMP alias to canonical subject and never retries a stale write', async () => {
  const calls = [];
  let rejectWrite = false;
  const canonical = {
    subjectId: 'subject-pmp', contentRevision: 12,
    recallLibrary: { id: 'recall-pmp', subjectId: 'subject-pmp', version: 1, nodes: [], edges: [] },
    principles: { schemaVersion: 1, items: [] }, synthesisPresets: { schemaVersion: 1, items: [] },
  };
  const window = {
    KGDomainApi: {
      async request(input) {
        calls.push(structuredClone(input));
        if (input.method === 'PUT') {
          if (rejectWrite) throw Object.assign(new Error('stale'), { status: 409, detail: { currentContentRevision: 13 } });
          return { ...canonical, contentRevision: 13, recallLibrary: input.body.recallLibrary };
        }
        return canonical;
      },
    },
    location: { search: '' }, dispatchEvent() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  };
  vm.runInContext(
    readRepo('frontend/scripts/new-legacy-assets/teaching-content-adapter.js'),
    vm.createContext({ window, URLSearchParams, structuredClone, Promise, console }),
  );
  await window.KGTeachingContentApi.bootstrap('PMP');
  await window.KGTeachingContentApi.saveRecallLibrary('PMP', { nodes: [{ id: 'saved' }], edges: [] });
  const saved = calls.find(call => call.method === 'PUT');
  assert.equal(saved.path, '/api/v1/content-prep/shared-content');
  assert.equal(saved.body.subjectId, 'subject-pmp');
  assert.equal(saved.body.contentRevision, 12);
  assert.equal(saved.body.recallLibrary.nodes[0].id, 'saved');

  rejectWrite = true;
  const putsBefore = calls.filter(call => call.method === 'PUT').length;
  await assert.rejects(
    window.KGTeachingContentApi.saveRecallLibrary('subject-pmp', { nodes: [{ id: 'stale' }], edges: [] }),
    error => error.status === 409,
  );
  assert.equal(calls.filter(call => call.method === 'PUT').length, putsBefore + 1);
});

test('principle controller waits for teaching readiness before first render and never seeds labels', async () => {
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  let seeded = 0;
  const listeners = {};
  const list = { innerHTML: 'loading', addEventListener() {} };
  const elements = { tqPrincipleList: list };
  const document = {
    getElementById: id => elements[id] || null,
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener(type, handler) { listeners[type] = handler; },
  };
  const context = vm.createContext({
    document,
    location: { search: '' }, URLSearchParams, Promise, console,
    setTimeout: (handler, delay) => { if (!delay) queueMicrotask(handler); return 1; },
    clearTimeout() {},
    addEventListener() {},
    KGTeachingContentApi: { ready: () => ready },
    KGQuestionBankAdminAPI: { getAllQuestions: () => [{ tags: ['原则：不应种子化'] }] },
    KGPrincipleRepository: {
      ensureFromLabels() { seeded += 1; },
      list: () => [{ id: 'remote-principle', name: '服务器原则', status: 'active', confusablePrincipleIds: [] }],
      get: id => id === 'remote-principle' ? { id, name: '服务器原则', status: 'active' } : null,
      findByName: () => null,
    },
    KGSynthesisPresetRepository: { list: () => [], getByPrincipleId: () => null },
  });
  vm.runInContext(readSource('src/teacher/training-config/principle-preset-controller.js'), context);
  listeners.DOMContentLoaded();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(list.innerHTML, 'loading');
  assert.equal(seeded, 0);
  resolveReady();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(list.innerHTML, /服务器原则/);
  assert.equal(seeded, 0);
});

test('teaching consumers await readiness and bulk principle mutations use the shared adapter', () => {
  const controller = readSource('src/teacher/training-config/principle-preset-controller.js');
  assert.doesNotMatch(controller, /global\.fetch\(/);
  for (const operation of ['updatePrincipleStatuses', 'importPrinciples', 'deletePrinciples']) {
    assert.match(controller, new RegExp(`await global\\.KGTeachingContentApi\\.${operation}`));
  }
  const boundaries = [
    ['src/96-recall-association-admin.js', /await global\.KGTeachingContentApi\?\.ready/],
    ['src/admin/53-recall-association-management.js', /await global\.KGTeachingContentApi\?\.ready/],
    ['src/65-question-bank-admin.js', /await window\.KGTeachingContentApi\?\.ready/],
    ['src/77-multi-question-workspace.js', /await global\.KGTeachingContentApi\?\.ready/],
    ['content-prep-studio/src/js/45-server-events.js', /await window\.KGTeachingContentApi\?\.ready/],
  ];
  for (const [relative, pattern] of boundaries) assert.match(readSource(relative), pattern, relative);
});

test('admin teaching gateway keeps ordered writes moving after one API failure', async () => {
  const attempts = [];
  let rejectFirst = true;
  const window = {
    KGTeachingContentApi: {
      async importActivities(rows) {
        attempts.push(rows.map(row => row.id).join(','));
        if (rejectFirst) {
          rejectFirst = false;
          throw new Error('temporary outage');
        }
        return { imported: rows.length };
      },
      snapshot() { return {}; },
    },
    addEventListener() {},
    dispatchEvent() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  };
  const context = vm.createContext({ window, Promise, console });
  vm.runInContext(readSource('src/admin/42-teaching-content-server-gateway.js'), context);
  const services = {
    taxonomies: { currentForSubject() { return null; } },
    legacyContent: { getSubjects() { return []; } },
  };
  const gateway = window.KGCreateAdminTeachingContentGateway({
    services,
    reconcileServerProjection() { return { valid: true }; },
  });

  const first = gateway.persistResource('activityOverrides', [{ id: 'first' }]);
  const second = gateway.persistResource('activityOverrides', [{ id: 'second' }]);
  await assert.rejects(first, /temporary outage/);
  await second;
  await gateway.flush();
  assert.deepEqual(attempts, ['first', 'second']);
});

test('Task 5B repository writes remain synchronous for transaction rollback safety', () => {
  const window = {
    KGAdminCore: { clone: structuredClone, nowIso: () => '2026-08-30T00:00:00Z' },
    KGAppStorage: { writeJSON() { return true; }, readJSON(_key, fallback) { return fallback; } },
    KGContentRepository: { assertRepository() {} },
  };
  const context = vm.createContext({ window, structuredClone, Promise });
  vm.runInContext(readSource('src/admin/11-local-content-repository.js'), context);
  const repository = new window.KGLocalContentRepository();
  const result = repository.write('taxonomies', [{ id: 'tax-v2' }]);
  assert.equal(result, true);
  assert.equal(typeof result?.then, 'undefined');
});

test('phase A keeps the three pages on Runtime policy until Task 6', () => {
  for (const relative of [
    'frontend/scripts/runtime-page-policy.json',
    'backend/app/web/runtime_page_policy.json',
  ]) {
    const policy = JSON.parse(readRepo(relative));
    for (const page of ['admin-subjects.html', 'content-prep.html', 'content-center.html']) {
      assert.equal(policy.runtimePages.includes(page), true, `${relative}:${page}`);
    }
  }
});
