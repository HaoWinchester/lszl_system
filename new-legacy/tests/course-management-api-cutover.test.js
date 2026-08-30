'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..');
const readSource = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const readRepo = relative => fs.readFileSync(path.join(REPO, relative), 'utf8');

const courseSources = [
  'src/91-learning-content-core.js',
  'src/91-course-admin-app.js',
  'src/91-teacher-workbench-app.js',
  'src/93-content-organization-core.js',
  'src/admin/34-course-service.js',
  'src/admin/35-release-service.js',
  'src/admin/11-local-content-repository.js',
  'src/admin/50-admin-shell-app.js',
  'src/admin/52-admin-operations-app.js',
];

test('course and task consumers have no browser business-state fallback', () => {
  const retiredKeys = /kg_(?:course_config|learning_tasks|assessment_papers)/;
  for (const relative of courseSources) {
    const source = readSource(relative);
    assert.doesNotMatch(source, /localStorage/, relative);
    assert.doesNotMatch(source, retiredKeys, relative);
    assert.doesNotMatch(source, /KGServerStateStorage/, relative);
  }
});

test('both Runtime page policies are byte-identical and empty', () => {
  const backend = readRepo('backend/app/web/runtime_page_policy.json');
  const frontend = readRepo('frontend/scripts/runtime-page-policy.json');
  assert.equal(frontend, backend);
  assert.deepEqual(JSON.parse(backend), { runtimePages: [] });
});

test('course adapter maps typed API results and waits for authoritative mutations', async () => {
  const calls = [];
  let draft = {
    id: 'course-1', name: 'API 课程', revision: 1, status: 'draft',
    structure: { subjectId: 'subject-pmp', taxonomyId: 'taxonomy-pmp-main', stages: [], parts: [], nodes: [] },
  };
  const release = { id: 'release-1', courseId: 'course-1', version: 1, status: 'published', revision: 1, course: { id: 'course-1', name: 'API 课程' } };
  const task = { id: 'task-1', releaseId: 'release-1', title: '任务', status: 'draft', revision: 1, content: { subjectId: 'subject-pmp', sourceActivityIds: [] }, audience: {} };
  let resolveUpdate;
  const window = {
    KGDomainApi: {
      request(input) {
        calls.push(structuredClone(input));
        if (input.path === '/api/v1/course-management/drafts' && (!input.method || input.method === 'GET')) return Promise.resolve({ drafts: [draft] });
        if (input.path === '/api/v1/course-management/releases') return Promise.resolve({ releases: [release] });
        if (input.path === '/api/v1/course-management/tasks' && (!input.method || input.method === 'GET')) return Promise.resolve({ tasks: [task] });
        if (input.path === '/api/v1/course-management/drafts/course-1' && input.method === 'PUT') {
          return new Promise(resolve => { resolveUpdate = () => { draft = { ...draft, name: input.body.name, revision: 2 }; resolve({ draft }); }; });
        }
        throw new Error(`unexpected ${input.method || 'GET'} ${input.path}`);
      },
    },
    dispatchEvent() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  };
  vm.runInContext(
    readRepo('frontend/scripts/new-legacy-assets/course-management-adapter.js'),
    vm.createContext({ window, structuredClone, Promise, console }),
  );

  const initial = await window.KGCourseManagementApi.ready();
  assert.equal(initial.drafts[0].name, 'API 课程');
  assert.equal(initial.tasks[0].content.subjectId, 'subject-pmp');

  let settled = false;
  const saving = window.KGCourseManagementApi.updateDraft('course-1', { name: '已保存' }, 1).then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  resolveUpdate();
  const saved = await saving;
  assert.equal(saved.name, '已保存');
  assert.equal(saved.revision, 2);
  assert.equal(window.KGCourseManagementApi.snapshot().drafts[0].name, '已保存');
  const update = calls.find(call => call.method === 'PUT');
  assert.deepEqual(update.body, { name: '已保存', revision: 1 });
});

test('409 refreshes the course snapshot once and never retries the stale mutation', async () => {
  let listCalls = 0;
  let updateCalls = 0;
  const stale = { id: 'course-1', name: '陈旧值', revision: 1, structure: {} };
  const winner = { id: 'course-1', name: '其他教师已保存', revision: 2, structure: {} };
  const window = {
    KGDomainApi: {
      async request(input) {
        if (input.path === '/api/v1/course-management/drafts' && (!input.method || input.method === 'GET')) return { drafts: [++listCalls === 1 ? stale : winner] };
        if (input.path === '/api/v1/course-management/releases') return { releases: [] };
        if (input.path === '/api/v1/course-management/tasks') return { tasks: [] };
        if (input.method === 'PUT') {
          updateCalls += 1;
          const error = new Error('课程已被更新');
          error.status = 409;
          throw error;
        }
        throw new Error(`unexpected ${input.method || 'GET'} ${input.path}`);
      },
    },
    dispatchEvent() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  };
  vm.runInContext(
    readRepo('frontend/scripts/new-legacy-assets/course-management-adapter.js'),
    vm.createContext({ window, structuredClone, Promise, console }),
  );
  await window.KGCourseManagementApi.ready();
  await assert.rejects(window.KGCourseManagementApi.updateDraft('course-1', { name: '不应覆盖' }, 1), /课程已被更新/);
  assert.equal(updateCalls, 1);
  assert.equal(listCalls, 2);
  assert.equal(window.KGCourseManagementApi.snapshot().drafts[0].name, '其他教师已保存');
});

