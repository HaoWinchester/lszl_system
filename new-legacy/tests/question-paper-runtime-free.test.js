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
  for (const productionConsumer of [adminShell, adminSubjects, adminSettings]) {
    assert.match(productionConsumer, /await Services\.referenceSnapshotReady/);
  }
});
