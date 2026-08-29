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

test('reference index loads formal data through typed domain endpoints', async () => {
  const calls = [];
  const runtime = {
    KGAdminCore: { nowIso: () => '2026-08-29T00:00:00Z', clone: value => JSON.parse(JSON.stringify(value)) },
    KGDomainApi: { request: async request => {
      calls.push(request.path);
      if (request.path === '/api/v1/banks') return { banks: [{ id: 'bank-1', subject: 'PMP', questions: [] }] };
      if (request.path === '/api/v1/papers') return { papers: [{ id: 'paper-1', subjectId: 'PMP', sections: [] }] };
      if (request.path === '/api/v1/paper-releases/management-catalog?page=1&pageSize=100') return { papers: [{ releaseId: 'release-1', paperId: 'paper-1' }] };
      throw new Error(`unexpected path ${request.path}`);
    } },
  };
  runtime.window = runtime;
  vm.runInNewContext(referenceIndex, runtime, { filename: '30-reference-index-service.js' });
  const snapshot = await runtime.KGReferenceIndexService.loadReferenceSnapshot();
  assert.deepEqual(calls, ['/api/v1/banks', '/api/v1/papers', '/api/v1/paper-releases/management-catalog?page=1&pageSize=100']);
  assert.equal(snapshot.banks[0].id, 'bank-1');
  assert.equal(snapshot.papers[0].id, 'paper-1');
  assert.equal(snapshot.releases[0].releaseId, 'release-1');
});
