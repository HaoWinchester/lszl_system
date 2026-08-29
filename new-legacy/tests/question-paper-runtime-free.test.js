'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repo = path.resolve(__dirname, '..', '..');
const source = relative => fs.readFileSync(path.resolve(repo, relative), 'utf8');

const questionBank = source('new-legacy/src/60-question-bank.js');
const questionAdmin = source('new-legacy/src/65-question-bank-admin.js');
const safeDelete = source('new-legacy/src/teacher/question-bank/safe-delete-service.js');
const referenceIndex = source('new-legacy/src/admin/30-reference-index-service.js');
const referenceRegistry = source('new-legacy/src/admin/40-admin-service-registry.js');
const subjectService = source('new-legacy/src/admin/31-subject-service.js');
const taxonomyService = source('new-legacy/src/admin/32-taxonomy-service.js');
const learningContentCompat = source('new-legacy/src/admin/41-learning-content-compat.js');
const adminShell = source('new-legacy/src/admin/50-admin-shell-app.js');
const adminSubjects = source('new-legacy/src/admin/51-admin-subjects-app.js');
const adminSettings = source('new-legacy/src/admin/53-admin-settings-app.js');
const backendPolicySource = source('backend/app/web/runtime_page_policy.json');
const frontendPolicySource = source('frontend/scripts/runtime-page-policy.json');
const backendPolicy = JSON.parse(backendPolicySource);

test('formal question and paper modules have no compatibility persistence keys', () => {
  const forbiddenFormalKey = /kg_(?:question_banks|exam_papers|exam_paper_categories|exam_papers_published|exam_paper_release_history)/;
  for (const moduleSource of [questionBank, questionAdmin, safeDelete, referenceIndex]) {
    assert.doesNotMatch(moduleSource, forbiddenFormalKey);
  }
  assert.doesNotMatch(questionAdmin, /localStorage/);
});

test('question and paper management are absent from byte-equivalent Runtime policies', () => {
  assert.equal(frontendPolicySource, backendPolicySource);
  assert.equal(backendPolicy.runtimePages.includes('question-bank.html'), false);
  assert.equal(backendPolicy.runtimePages.includes('paper-management.html'), false);
});

test('safe delete counts only caller-supplied API reference snapshots', () => {
  const runtime = { KGTeacherDomains: { Core: {
    createId: () => 'batch-1',
    clone: value => JSON.parse(JSON.stringify(value)),
    nowIso: () => '2026-08-29T00:00:00Z',
    result: (ok, value, errors = [], warnings = [], meta = {}) => ({ ok, value, errors, warnings, meta }),
  } } };
  runtime.globalThis = runtime;
  vm.runInNewContext(safeDelete, runtime, { filename: 'safe-delete-service.js' });
  const service = runtime.KGTeacherDomains.QuestionBank.SafeDeleteService.create({
    references: () => ({
      papers: [{ id: 'paper-1', questions: [{ bankId: 'bank-1', questionId: 'question-1' }] }],
      releases: [{ releaseId: 'release-1', questions: [{ bankId: 'bank-1', questionId: 'question-1' }] }],
    }),
  });
  const refs = service.inspect({ id: 'question-1' }, { id: 'bank-1' });
  assert.equal(refs.paperRefs, 2);
  assert.equal(refs.protected, true);
  assert.deepEqual(Array.from(refs.locations, row => row.id), ['paper-1', 'release-1']);
});

test('reference index loads one complete typed snapshot without Runtime pagination gaps', async () => {
  const calls = [];
  const completeSnapshot = {
    banks: [{ id: 'bank-unselected', subject: 'PMP', questions: [{ id: 'question-unselected', metadata: { knowledge: { primaryNodeId: 'node-1' } } }] }],
    papers: [{ id: 'paper-unselected', subjectId: 'PMP', sections: [{ id: 'questions', items: [{ questionId: 'question-unselected' }] }] }],
    releases: [{ id: 'release-unselected', paperId: 'paper-unselected', sections: [{ id: 'questions', items: [{ questionId: 'question-unselected' }] }] }],
  };
  const runtime = {
    KGAdminCore: { nowIso: () => '2026-08-29T00:00:00Z', clone: value => JSON.parse(JSON.stringify(value)) },
    KGDomainApi: { request: async request => {
      calls.push(request.path);
      if (request.path === '/api/v1/questions/reference-snapshot') return completeSnapshot;
      throw new Error(`unexpected path ${request.path}`);
    } },
  };
  runtime.window = runtime;
  vm.runInNewContext(referenceIndex, runtime, { filename: '30-reference-index-service.js' });
  assert.equal(runtime.KGReferenceIndexService.permanentDeleteAuthority(null).valid, false);
  const snapshot = await runtime.KGReferenceIndexService.loadReferenceSnapshot();
  assert.deepEqual(calls, ['/api/v1/questions/reference-snapshot']);
  assert.equal(snapshot.banks[0].questions[0].id, 'question-unselected');
  assert.equal(snapshot.papers[0].sections[0].items[0].questionId, 'question-unselected');
  assert.equal(snapshot.releases[0].sections[0].items[0].questionId, 'question-unselected');
  assert.equal(calls.some(path => /runtime|SharedRuntime/i.test(path)), false);
});

test('production admin registry hydrates unselected draft and release references', async () => {
  const calls = [];
  const snapshot = {
    banks: [{ id: 'bank-complete', subject: 'PMP', questions: [{ id: 'question-complete', title: '完整题目' }] }],
    papers: [{ id: 'paper-unselected', title: '未选中草稿', subjectId: 'PMP', status: 'draft', sections: [{ items: [{ questionId: 'question-complete' }] }] }],
    releases: [{ id: 'release-unselected', title: '历史发布', subjectId: 'PMP', status: 'withdrawn', sections: [{ items: [{ questionId: 'question-complete' }] }] }],
  };
  class EmptyService { constructor() {} }
  const runtime = {
    KGAdminCore: { VERSION: 'test', nowIso: () => '2026-08-29T00:00:00Z', clone: value => JSON.parse(JSON.stringify(value)) },
    KGDomainApi: { request: async request => {
      calls.push(request.path);
      if (request.path === '/api/v1/questions/reference-snapshot') return snapshot;
      throw new Error(`unexpected path ${request.path}`);
    } },
    KGLearningContent: {
      storageKeys: {}, getSubjects: () => [], getTaxonomies: () => [], getActivityLibrary: () => ({}),
      getCourseDrafts: () => [], getCourseReleases: () => [],
      subjectById: id => id === 'PMP' ? { id: 'subject-pmp', code: 'PMP' } : null,
    },
    KGContentOrganization: { storageKeys: {}, getPapers: () => [], getLearningTasks: () => [], getCollections: () => [] },
    KGLocalContentRepository: EmptyService,
    KGAdminPermissionService: EmptyService,
    KGAdminAuditService: EmptyService,
    KGAdminTransactionService: EmptyService,
    KGSubjectService: EmptyService,
    KGTaxonomyService: EmptyService,
    KGActivityService: EmptyService,
    KGCourseService: EmptyService,
    KGReleaseService: EmptyService,
  };
  runtime.window = runtime;
  vm.runInNewContext(referenceIndex, runtime, { filename: '30-reference-index-service.js' });
  vm.runInNewContext(referenceRegistry, runtime, { filename: '40-admin-service-registry.js' });

  for (const method of ['saveSubjects', 'saveTaxonomies', 'deleteKnowledgeNode', 'resetTaxonomies']) {
    assert.equal(runtime.KGAdminServices.legacyContent[method], undefined, `public legacyContent exposes ${method}`);
  }

  assert.throws(
    () => runtime.KGAdminServices.references.ensure(),
    /引用索引.*(?:加载|就绪)/,
  );
  await runtime.KGAdminServices.referenceSnapshotReady;
  assert.deepEqual(calls, ['/api/v1/questions/reference-snapshot']);
  assert.equal(runtime.KGAdminServices.references.questionBanks()[0].questions[0].id, 'question-complete');
  assert.equal(runtime.KGAdminServices.references.ensure().papers.some(row => row.id === 'paper-unselected'), true);
  assert.equal(runtime.KGAdminServices.references.ensure().papers.some(row => row.id === 'release-unselected'), true);
  const subjectPaperRefs = runtime.KGAdminServices.references
    .referencesForSubject('subject-pmp')
    .filter(row => row.kind === 'paper');
  assert.deepEqual(Array.from(subjectPaperRefs, row => row.id).sort(), ['paper-unselected', 'release-unselected']);
  assert.equal(calls.some(path => /runtime|SharedRuntime/i.test(path)), false);
});

test('production subject and taxonomy permanent deletes fail closed after snapshot hydration', async () => {
  let subjectSaves = 0;
  let taxonomySaves = 0;
  let nodeDeletes = 0;
  let taxonomyResets = 0;
  let serverSnapshot = { banks: [], papers: [], releases: [] };
  const subject = { id: 'subject-empty', code: 'EMPTY', name: { zh: '空科目' }, status: 'active' };
  const taxonomy = {
    id: 'taxonomy-draft', subjectId: subject.id, name: { zh: '草稿知识树' },
    version: 2, versionLabel: 'v2', status: 'draft', isDefault: false,
    nodes: [{ id: 'node-empty', taxonomyId: 'taxonomy-draft', parentId: null, level: 1, title: { zh: '空知识点' }, status: 'active' }],
  };
  const taxonomyOther = {
    id: 'taxonomy-other', subjectId: subject.id, name: { zh: '历史知识树' },
    version: 1, versionLabel: 'v1', status: 'archived', isDefault: false, nodes: [],
  };
  class Repository { constructor() {} read() { return []; } write() { return true; } }
  class Permissions { can() { return true; } require() { return { valid: true }; } }
  class Audit { constructor() {} }
  class Transactions {
    constructor() {}
    execute({ commit, validate }) {
      const checked = validate?.() || { valid: true, errors: [] };
      if (!checked.valid) return checked;
      return { valid: true, value: commit(), transactionId: 'tx-1' };
    }
  }
  class EmptyService { constructor() {} }
  const legacy = {
    storageKeys: {},
    getSubjects: () => [subject],
    subjectById: id => id === subject.id ? subject : null,
    saveSubjects: () => { subjectSaves += 1; return true; },
    getTaxonomies: () => [taxonomy, taxonomyOther],
    taxonomyById: id => [taxonomy, taxonomyOther].find(row => row.id === id) || null,
    defaultTaxonomyForSubject: () => null,
    nodesForTaxonomy: id => id === taxonomy.id ? taxonomy.nodes : [],
    nodeById: (taxonomyId, nodeId) => taxonomyId === taxonomy.id ? taxonomy.nodes.find(row => row.id === nodeId) : null,
    validateTaxonomy: () => ({ valid: true, errors: [], warnings: [] }),
    saveTaxonomies: () => { taxonomySaves += 1; return { valid: true }; },
    deleteKnowledgeNode: () => { nodeDeletes += 1; return { valid: true, deletedIds: ['node-empty'] }; },
    resetTaxonomies: () => { taxonomyResets += 1; return { subjects: [], taxonomies: [] }; },
    getActivityLibrary: () => ({}), getCourseDrafts: () => [], getCourseReleases: () => [],
  };
  const runtime = {
    KGAdminCore: {
      VERSION: 'test', clean: value => String(value || '').trim(), clone: value => JSON.parse(JSON.stringify(value)),
      nowIso: () => '2026-08-29T00:00:00Z', actor: () => ({ id: 'admin' }), safeId: prefix => `${prefix}-1`,
      unique: values => [...new Set(values || [])], hash: value => String(value).length,
    },
    KGDomainApi: { request: async () => JSON.parse(JSON.stringify(serverSnapshot)) },
    KGLearningContent: legacy,
    KGContentOrganization: { storageKeys: {}, getPapers: () => [], getLearningTasks: () => [], getCollections: () => [] },
    KGLocalContentRepository: Repository,
    KGAdminPermissionService: Permissions,
    KGAdminAuditService: Audit,
    KGAdminTransactionService: Transactions,
    KGActivityService: EmptyService, KGCourseService: EmptyService, KGReleaseService: EmptyService,
  };
  runtime.window = runtime;
  vm.runInNewContext(referenceIndex, runtime, { filename: '30-reference-index-service.js' });
  vm.runInNewContext(subjectService, runtime, { filename: '31-subject-service.js' });
  vm.runInNewContext(taxonomyService, runtime, { filename: '32-taxonomy-service.js' });
  vm.runInNewContext(referenceRegistry, runtime, { filename: '40-admin-service-registry.js' });
  for (const method of ['saveSubjects', 'saveTaxonomies', 'deleteKnowledgeNode', 'resetTaxonomies']) {
    assert.equal(runtime.KGAdminServices.legacyContent[method], undefined, `public legacyContent exposes ${method}`);
  }
  await runtime.KGAdminServices.referenceSnapshotReady;

  // Simulate another teacher creating a formal reference after this tab's
  // initially empty hydration. The local destructive transaction must remain
  // blocked even though it has not fetched the newer server state.
  serverSnapshot = {
    banks: [],
    papers: [{ id: 'paper-created-later', subjectId: subject.code, sections: [] }],
    releases: [],
  };
  const subjectResult = runtime.KGAdminServices.subjects.delete(subject.id);
  const taxonomyResult = runtime.KGAdminServices.taxonomies.deleteVersion(taxonomy.id);
  assert.equal(subjectResult.valid, false);
  assert.equal(taxonomyResult.valid, false);
  assert.match(subjectResult.errors.join(' '), /服务器.*事务|永久删除.*暂停/);
  assert.match(taxonomyResult.errors.join(' '), /服务器.*事务|永久删除.*暂停/);
  assert.equal(subjectSaves, 0);
  assert.equal(taxonomySaves, 0);

  const subjectBulkResult = runtime.KGAdminServices.subjects.saveAll([]);
  const taxonomyBulkResult = runtime.KGAdminServices.taxonomies.saveAll([{ ...taxonomy, nodes: [] }, taxonomyOther]);
  const duplicateTaxonomyBulkResult = runtime.KGAdminServices.taxonomies.saveAll([taxonomy, taxonomy]);
  const nodeCheck = runtime.KGAdminServices.taxonomies.nodeDeletionCheck(taxonomy.id, 'node-empty');
  const nodeDelete = runtime.KGAdminServices.taxonomies.deleteNode(taxonomy.id, 'node-empty');
  assert.equal(subjectBulkResult.valid, false);
  assert.equal(taxonomyBulkResult.valid, false);
  assert.equal(duplicateTaxonomyBulkResult.valid, false);
  assert.equal(nodeCheck.valid, false);
  assert.equal(nodeDelete.valid, false);
  assert.equal(subjectSaves, 0);
  assert.equal(taxonomySaves, 0);
  assert.equal(nodeDeletes, 0);

  vm.runInNewContext(learningContentCompat, runtime, { filename: '41-learning-content-compat.js' });
  const compatSubjects = runtime.KGLearningContent.saveSubjects([]);
  const compatTaxonomies = runtime.KGLearningContent.saveTaxonomies([{ ...taxonomy, nodes: [] }, taxonomyOther]);
  const compatNodeDelete = runtime.KGLearningContent.deleteKnowledgeNode(taxonomy.id, 'node-empty');
  const compatReset = runtime.KGLearningContent.resetTaxonomies();
  assert.equal(compatSubjects.length, 1);
  assert.equal(compatTaxonomies.valid, false);
  assert.equal(compatNodeDelete.valid, false);
  assert.equal(compatReset.valid, false);
  assert.equal(subjectSaves, 0);
  assert.equal(taxonomySaves, 0);
  assert.equal(nodeDeletes, 0);
  assert.equal(taxonomyResets, 0);
});

test('reference failure blocks destructive index actions but keeps safe subjects and settings controls usable', async () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  };
  const fakeDocument = () => {
    const elements = new Map();
    const element = id => {
      if (!elements.has(id)) elements.set(id, {
        id, textContent: '', innerHTML: '', value: '', disabled: false, hidden: false, dataset: {}, listeners: {},
        classList: { toggle() {}, add() {}, remove() {} },
        addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); },
        async trigger(type, event = {}) { for (const handler of this.listeners[type] || []) await handler({ currentTarget: this, target: this, preventDefault() {}, ...event }); },
        removeAttribute(name) { delete this[name]; }, setAttribute(name, value) { this[name] = value; },
        querySelectorAll() { return []; }, focus() {},
      });
      return elements.get(id);
    };
    return {
      readyState: 'complete', elements, element,
      querySelector(selector) { return element(selector); }, querySelectorAll() { return []; },
      addEventListener() {}, dispatchEvent() {},
    };
  };
  const makeRuntime = (document, ready, overrides = {}) => {
    let fetchCalls = 0;
    const services = {
      referenceSnapshotReady: ready.promise,
      permissions: { can: () => true, summary: () => ({ role: 'admin', allowed: ['manageSnapshots'], labels: { manageSnapshots: '快照' } }) },
      subjects: { list: () => [], get: () => null, isInactive: () => false },
      taxonomies: { list: () => [], currentForSubject: () => null, get: () => null, versionLabel: value => `v${value}` },
      legacyContent: { getActivities: () => [] },
      references: { build: () => { throw new Error('index built before hydration'); }, invalidate() {} },
      transactions: { snapshots: () => [], createSnapshot: () => ({ id: 'snapshot-1' }) },
      audit: { list: () => [], record() {} },
      ...overrides,
    };
    const runtime = {
      document, console, setTimeout, clearTimeout, URL, URLSearchParams,
      location: { search: '', pathname: '/admin-subjects.html', href: 'http://test/admin-subjects.html' }, history: { replaceState() {} },
      CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
      fetch: async () => { fetchCalls += 1; return { ok: true, json: async () => ({ status: 'ok' }) }; },
      KGAdminServices: services,
      KGAdminUI: {
        init() {}, byId: id => document.element(id), escapeHtml: value => String(value || ''),
        formatTime: value => String(value || ''), toast() {},
      },
      KGAdminTeachingContentGateway: { hydrateSubject: async () => null, publishTaxonomy: async () => null },
    };
    runtime.window = runtime;
    runtime.fetchCalls = () => fetchCalls;
    return runtime;
  };

  const shellReady = deferred();
  const shellDocument = fakeDocument();
  const shellRuntime = makeRuntime(shellDocument, shellReady);
  vm.runInNewContext(adminShell, shellRuntime, { filename: '50-admin-shell-app.js' });

  const subjectsReady = deferred();
  const subjectsDocument = fakeDocument();
  const subjectsRuntime = makeRuntime(subjectsDocument, subjectsReady);
  vm.runInNewContext(adminSubjects, subjectsRuntime, { filename: '51-admin-subjects-app.js' });

  const settingsReady = deferred();
  const settingsDocument = fakeDocument();
  let snapshotsCreated = 0;
  const settingsRuntime = makeRuntime(settingsDocument, settingsReady, {
    transactions: { snapshots: () => [], createSnapshot: () => { snapshotsCreated += 1; return { id: 'snapshot-1' }; } },
  });
  vm.runInNewContext(adminSettings, settingsRuntime, { filename: '53-admin-settings-app.js' });

  await Promise.resolve();
  assert.equal((subjectsDocument.element('adminAddSubjectBtn').listeners.click || []).length, 1);
  await subjectsDocument.element('adminAddSubjectBtn').trigger('click');
  assert.equal(subjectsDocument.element('adminSubjectDialog').open, '');
  assert.equal(subjectsDocument.element('adminDeleteSubjectBtn').disabled, true);
  assert.equal((settingsDocument.element('adminHealthBtn').listeners.click || []).length, 1);
  assert.equal((settingsDocument.element('adminSnapshotBtn').listeners.click || []).length, 1);
  await settingsDocument.element('adminSnapshotBtn').trigger('click');
  assert.equal(snapshotsCreated, 1);
  assert.equal((settingsDocument.element('adminRebuildIndexBtn').listeners.click || []).length, 0);

  shellReady.resolve(null);
  subjectsReady.resolve(null);
  settingsReady.resolve(null);
  await new Promise(resolve => setImmediate(resolve));

  assert.match(shellDocument.element('.admin-main').innerHTML, /引用索引加载失败/);
  assert.equal(subjectsDocument.element('adminDeleteSubjectBtn').disabled, true);
  assert.equal((subjectsDocument.element('adminAddSubjectBtn').listeners.click || []).length, 1);
  await subjectsDocument.element('adminAddSubjectBtn').trigger('click');
  assert.equal(settingsDocument.element('adminRebuildIndexBtn').disabled, true);
  assert.equal((settingsDocument.element('adminRebuildIndexBtn').listeners.click || []).length, 0);
  await settingsDocument.element('adminHealthBtn').trigger('click');
  await settingsDocument.element('adminSnapshotBtn').trigger('click');
  assert.equal(settingsRuntime.fetchCalls() >= 2, true);
  assert.equal(snapshotsCreated, 2);
});
