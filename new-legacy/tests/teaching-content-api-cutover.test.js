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
  'question-studio/knowledge-taxonomy-v1.js',
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

test('Task 7 compatibility is limited to exact course and task repository resources', () => {
  const repository = readSource('src/admin/11-local-content-repository.js');
  const allowedUntilTask7 = [
    'kg_course_config_drafts_v1',
    'kg_course_config_releases_v1',
    'kg_course_config_active_release_v1',
    'kg_learning_tasks_v1',
  ];
  for (const key of allowedUntilTask7) assert.match(repository, new RegExp(key));
  assert.match(repository, /allowedUntilTask7/);
});

test('Task 5B retires all five synchronous teaching lifecycle keys', () => {
  const repository = readSource('src/admin/11-local-content-repository.js');
  const learning = readSource('src/91-learning-content-core.js');
  const organization = readSource('src/93-content-organization-core.js');
  const questionStudio = readSource('question-studio/knowledge-taxonomy-v1.js');
  const allowedUntilTask5B = [
    'kg_content_subjects_v1', 'kg_content_taxonomies_v1',
    'kg_content_activity_overrides_v1', 'kg_activity_tags_v1',
    'kg_activity_collections_v1',
  ];
  assert.doesNotMatch(repository, /allowedUntilTask5B/);
  for (const key of allowedUntilTask5B) {
    assert.doesNotMatch(repository, new RegExp(key));
    assert.doesNotMatch(learning, new RegExp(key));
    assert.doesNotMatch(organization, new RegExp(key));
    assert.doesNotMatch(questionStudio, new RegExp(key));
  }
});

test('content center never creates a misleading local paper from activity ids', () => {
  const source = readSource('src/93-content-organization-app.js');
  assert.doesNotMatch(source, /Org\.savePaper/);
  assert.doesNotMatch(source, /paper-management\.html&paper=/);
  assert.match(source, /当前不支持从活动直接生成试卷/);
});

test('content organization waits for rejected catalog saves and shows the API error', async () => {
  let rejectSave;
  let domReady;
  const handlers = new Map();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id, value: '', checked: false, dataset: {}, innerHTML: '', textContent: '',
      addEventListener(type, handler) { handlers.set(`${id}:${type}`, handler); },
      close() {}, showModal() {}, focus() {}, dispatchEvent() {},
    });
    return elements.get(id);
  };
  const messages = [];
  const window = {
    KGLearningContent: {},
    KGContentCenterApp: { getSubjectId: () => 'subject-pmp', toast: message => messages.push(message), rerender() {}, clearSelection() {} },
    KGContentOrganization: {
      summary: () => ({ tags: 0, collections: 0, favorites: 0, papers: 0, tasks: 0 }),
      getTags: () => [], getCollections: () => [],
      saveTag: () => new Promise((_resolve, reject) => { rejectSave = reject; }),
    },
  };
  const document = {
    getElementById: element,
    querySelectorAll: () => [],
    addEventListener(type, handler) { if (type === 'DOMContentLoaded') domReady = handler; },
  };
  vm.runInContext(readSource('src/93-content-organization-app.js'), vm.createContext({ window, document, Promise, console, requestAnimationFrame: callback => callback(), Event: class {}, confirm: () => true, prompt: () => null }));
  domReady();
  element('ccTagName').value = '待保存标签';
  handlers.get('ccSaveTagBtn:click')();
  await Promise.resolve();
  assert.deepEqual(messages, []);
  rejectSave(new Error('服务器暂时不可用'));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(messages.at(-1), /标签保存失败：服务器暂时不可用/);
});

test('teaching adapter hydrates course relationships and awaits catalog persistence', async () => {
  const calls = [];
  let resolvePut;
  const shared = {
    subjectId: 'subject-pmp', contentRevision: 8,
    subjects: [{ id: 'subject-pmp', code: 'PMP', name: { zh: 'PMP' } }],
    taxonomies: [], activityOverrides: [], activityTags: [], activityCollections: [],
    principles: { items: [] }, synthesisPresets: { items: [] }, recallLibrary: { nodes: [], edges: [] },
  };
  const window = {
    KGDomainApi: {
      request(input) {
        calls.push(structuredClone(input));
        if (input.method === 'PUT') return new Promise(resolve => { resolvePut = () => resolve({ ...shared, contentRevision: 9, subjects: input.body.subjects }); });
        if (input.path.includes('/course-management/drafts')) return Promise.resolve({ drafts: [{ id: 'draft-1', name: '课程', status: 'draft', revision: 3, structure: { subjectId: 'subject-pmp', nodes: [{ id: 'n', activityIds: ['a-1'] }] } }] });
        if (input.path.includes('/course-management/releases')) return Promise.resolve({ releases: [{ id: 'release-1', version: 1, course: { id: 'course-1', subjectId: 'subject-pmp', nodes: [] } }] });
        if (input.path.includes('/course-management/tasks')) return Promise.resolve({ tasks: [{ id: 'task-1', title: '任务', status: 'published', revision: 2, content: { subjectId: 'subject-pmp', sourceActivityIds: ['a-1'] } }] });
        if (input.path.includes('/questions/reference-snapshot')) return Promise.resolve({ papers: [{ id: 'paper-1', subjectId: 'subject-pmp', sections: [] }], releases: [] });
        return Promise.resolve(shared);
      },
    },
    location: { search: '' }, dispatchEvent() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  };
  vm.runInContext(
    readRepo('frontend/scripts/new-legacy-assets/teaching-content-adapter.js'),
    vm.createContext({ window, URL, URLSearchParams, structuredClone, Promise, console }),
  );
  await window.KGTeachingContentApi.bootstrap('subject-pmp', { relationships: true });
  assert.equal(window.KGTeachingContentApi.readResource('courseDrafts')[0].id, 'draft-1');
  assert.equal(window.KGTeachingContentApi.readResource('tasks')[0].sourceActivityIds[0], 'a-1');
  assert.equal(window.KGTeachingContentApi.readResource('papers')[0].id, 'paper-1');

  let settled = false;
  const saving = window.KGTeachingContentApi.saveSubjects([{ id: 'subject-pmp', code: 'PMP', name: { zh: '新名称' } }]).then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  const put = calls.find(call => call.method === 'PUT');
  assert.equal(put.body.contentRevision, 8);
  assert.equal(put.body.subjects[0].name.zh, '新名称');
  resolvePut();
  await saving;
  assert.equal(settled, true);
  assert.equal(window.KGTeachingContentApi.readResource('subjects')[0].name.zh, '新名称');
});

test('catalog replacement refreshes after conflict without blindly overwriting the winner', async () => {
  let gets = 0;
  let puts = 0;
  const initial = { subjectId: 'subject-pmp', contentRevision: 3, subjects: [{ id: 'subject-pmp', name: { zh: '初始' } }], taxonomies: [], activityOverrides: [], activityTags: [], activityCollections: [] };
  const winner = { ...initial, contentRevision: 4, subjects: [{ id: 'subject-pmp', name: { zh: '其他教师已保存' } }] };
  const window = {
    KGDomainApi: {
      async request(input) {
        if (input.method === 'PUT') {
          puts += 1;
          const error = new Error('内容已更新');
          error.status = 409;
          throw error;
        }
        gets += 1;
        return structuredClone(gets === 1 ? initial : winner);
      },
    },
    addEventListener() {}, dispatchEvent() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  };
  vm.runInContext(readRepo('frontend/scripts/new-legacy-assets/teaching-content-adapter.js'), vm.createContext({ window, structuredClone, Promise, console, setTimeout, clearTimeout }));
  await window.KGTeachingContentApi.bootstrap('subject-pmp');
  await assert.rejects(window.KGTeachingContentApi.saveSubjects([{ id: 'subject-pmp', name: { zh: '陈旧覆盖' } }]), /内容已更新/);
  assert.equal(puts, 1);
  assert.equal(gets, 2);
  assert.equal(window.KGTeachingContentApi.readResource('subjects')[0].name.zh, '其他教师已保存');
});

test('all recall authoring entry points await the relational save before success feedback', () => {
  const library = readSource('src/95-recall-association-library.js');
  assert.doesNotMatch(library, /SharedRuntimeState|localStorage|kg_recall_association_library_v1/);
  for (const source of [
    library,
    readSource('src/96-recall-association-admin.js'),
    readSource('src/admin/53-recall-association-management.js'),
    readSource('src/65-question-bank-admin.js'),
    readRepo('frontend/scripts/new-legacy-assets/teaching-content-adapter.js'),
  ]) assert.doesNotMatch(source, /\/api\/v1\/content-prep\/recall-libraries\//);
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

test('taxonomy lifecycle has one catalog writer and no blind-retry gateway', () => {
  const adapter = readRepo('frontend/scripts/new-legacy-assets/teaching-content-adapter.js');
  const gateway = readSource('src/admin/42-teaching-content-server-gateway.js');
  assert.doesNotMatch(adapter, /function saveTaxonomy|function releaseTaxonomy|retryConflict/);
  assert.doesNotMatch(gateway, /publishTaxonomy|publishCurrentTaxonomyFromStore|Api\.saveTaxonomy/);
  assert.match(adapter, /saveTaxonomies: value => saveCatalogResource\('taxonomies', value\)/);
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

test('an explicit save uses its cached subject instead of the active cached subject', async () => {
  const calls = [];
  const payload = subjectId => ({
    subjectId, contentRevision: subjectId === 'subject-a' ? 3 : 9,
    recallLibrary: { subjectId, nodes: [{ id: subjectId }], edges: [] },
    principles: { schemaVersion: 1, items: [] },
    synthesisPresets: { schemaVersion: 1, items: [] },
  });
  const window = {
    KGDomainApi: {
      async request(input) {
        calls.push(structuredClone(input));
        if (input.method === 'PUT') {
          return { ...payload(input.body.subjectId), contentRevision: input.body.contentRevision + 1, recallLibrary: input.body.recallLibrary };
        }
        const subject = new URL(input.path, 'http://local').searchParams.get('subjectId');
        return payload(subject);
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
  await window.KGTeachingContentApi.bootstrap('subject-b');
  await window.KGTeachingContentApi.saveRecallLibrary('subject-a', { nodes: [{ id: 'saved-a' }], edges: [] });

  const put = calls.find(call => call.method === 'PUT');
  assert.equal(put.path, '/api/v1/content-prep/shared-content');
  assert.equal(put.body.subjectId, 'subject-a');
  assert.equal(put.body.contentRevision, 3);
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
      async saveCatalogResource(_name, rows) {
        return this.importActivities(rows);
      },
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

test('Task 5B repository writes await authoritative catalog persistence', async () => {
  let resolveSave;
  const window = {
    KGAdminCore: { clone: structuredClone, nowIso: () => '2026-08-30T00:00:00Z' },
    KGAppStorage: { writeJSON() { return true; }, readJSON(_key, fallback) { return fallback; } },
    KGContentRepository: { assertRepository() {} },
    KGTeachingContentApi: {
      saveCatalogResource() {
        return new Promise(resolve => { resolveSave = resolve; });
      },
    },
  };
  const context = vm.createContext({ window, structuredClone, Promise });
  vm.runInContext(readSource('src/admin/11-local-content-repository.js'), context);
  const repository = new window.KGLocalContentRepository();
  const result = repository.write('taxonomies', [{ id: 'tax-v2' }]);
  assert.equal(typeof result?.then, 'function');
  let settled = false;
  result.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  resolveSave({ taxonomies: [{ id: 'tax-v2' }] });
  assert.equal(await result, true);
});

test('Task 5B removes all three teaching pages from Runtime policy', () => {
  for (const relative of [
    'frontend/scripts/runtime-page-policy.json',
    'backend/app/web/runtime_page_policy.json',
  ]) {
    const policy = JSON.parse(readRepo(relative));
    for (const page of ['admin-subjects.html', 'content-prep.html', 'content-center.html']) {
      assert.equal(policy.runtimePages.includes(page), false, `${relative}:${page}`);
    }
  }
  const template = readSource('content-prep-studio/src/index.template.html');
  assert.doesNotMatch(template, /server-state-bootstrap\.js/);
  assert.match(template, /kg-direct-bootstrap-anchor/);
});

test('content center retains required read helpers after the admin facade replaces its core', () => {
  const registry = readSource('src/admin/40-admin-service-registry.js');
  for (const method of ['currentUser', 'pathLabel', 'searchNodes', 'normalizeCourse']) {
    assert.match(registry, new RegExp(`${method}:\\(\\.\\.\\.args\\)=>legacy\\.${method}`));
  }
});
