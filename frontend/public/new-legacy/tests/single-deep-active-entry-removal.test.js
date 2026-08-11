'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const RETIRED_ERROR = '单题深学已停用，请选择刷题、深度回忆或归纳';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { writes.push([String(key), String(value)]); values.set(String(key), String(value)); },
    removeItem(key) { writes.push([String(key), null]); values.delete(String(key)); },
    value(key) { return values.get(key); },
  };
}

function loadOrganization(storage, options = {}) {
  let nextId = 0;
  const context = {
    console,
    Date,
    JSON,
    Math,
    Object,
    Set,
    URL,
    URLSearchParams,
    localStorage: storage,
    KGLearningContent: {
      clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); },
      currentUser() { return { id: 'teacher-a', name: '教师 A' }; },
      safeId(prefix) { nextId += 1; return `${prefix}-${nextId}`; },
      getActivityLibrary() { return {}; },
      getActivities() { return []; },
      subjectById(id) { return id === 'subject-pmp' ? { id, name: { zh: 'PMP' } } : null; },
      activityUsage() { return []; },
      activityTitle(activity) { return activity?.title || '未命名'; },
      getSubjects() { return [{ id: 'subject-pmp', name: { zh: 'PMP' } }]; },
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  if (options.loadPolicy !== false) {
    vm.runInContext(read('src/59c-active-learning-mode-policy.js'), context, { filename: '59c-active-learning-mode-policy.js' });
  }
  vm.runInContext(read('src/93-content-organization-core.js'), context, { filename: '93-content-organization-core.js' });
  return context;
}

function historicalTask(id, type) {
  return {
    id,
    title: `历史任务 ${id}`,
    type,
    subjectId: 'subject-pmp',
    status: 'published',
    sourceActivityIds: [],
    config: { legacyQuestionRefs: [{ questionId: 'q-1' }] },
    authorship: {
      createdByUserId: 'teacher-a', createdByName: '教师 A', createdAt: '2026-01-01T00:00:00.000Z',
      updatedByUserId: 'teacher-a', updatedByName: '教师 A', updatedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

test('active selectors expose only practice, recall, and induction without changing adjacent control structure', () => {
  const paper = read('paper-management.html');
  const course = read('course-admin.html');
  const workspace = read('question-workspace.html');
  const questionBank = read('question-bank.html');
  const home = read('index.html');
  const taskSchema = JSON.parse(read('schemas/learning-task-schema-v1.json'));
  const paperModes = [...paper.matchAll(/data-paper-mode="([^"]+)"/g)].map(match => match[1]);
  const filter = course.match(/<select id="caTaskTypeFilter">([\s\S]*?)<\/select>/)?.[1] || '';
  const taskModes = [...filter.matchAll(/<option value="([^"]+)">/g)].map(match => match[1]).filter(Boolean);

  assert.deepEqual(paperModes, ['practice_mode', 'deep_recall', 'multi_question_canvas']);
  assert.match(paper, /data-paper-mode="practice_mode"[^>]*checked\s*\/>\s*<span>刷题<\/span>/);
  assert.match(paper, /data-paper-mode="deep_recall"[^>]*checked\s*\/>\s*<span>深度回忆<\/span>/);
  assert.match(paper, /data-paper-mode="multi_question_canvas"[^>]*checked\s*\/>\s*<span>归纳<\/span>/);
  assert.deepEqual(taskModes, ['practice_mode', 'deep_recall', 'multi_question_canvas']);
  assert.deepEqual(taskSchema.properties.type.enum, ['practice_mode', 'deep_recall', 'multi_question_canvas']);
  assert.equal(workspace.includes('id="qwOpenSingleDeepBtn"'), false);
  assert.match(workspace, /id="qwFontScaleBtn"[\s\S]*?<span class="qw-overlay-divider"/);
  assert.equal(questionBank.includes('id="qbSetCurrentBtn"'), false);
  assert.match(questionBank, /id="qbTemplateBtn"[^>]*>下载模板<\/button>\s*<button class="accent" id="qbPreviewRecallBtn"/);
  assert.equal(home.includes('id="qbSetCurrentBtn"'), false);
  assert.match(home, /id="qbTemplateBtn"[^>]*>下载题库模板<\/button>\s*<input[^>]+id="qbImportFile"/);
});

test('active pages load the committed policy exactly once before each consumer', () => {
  const pages = [
    ['paper-management.html', 'src/65-question-bank-admin.js'],
    ['question-workspace.html', 'src/77-multi-question-workspace.js'],
    ['course-admin.html', 'src/93-content-organization-core.js'],
    ['knowledge-recall.html', 'src/96-recall-question-source.js'],
    ['practice-mode.html', 'src/100-practice-mode.js'],
    ['question-bank.html', 'src/65-question-bank-admin.js'],
    ['admin-console.html', 'src/93-content-organization-core.js'],
    ['admin-operations.html', 'src/93-content-organization-core.js'],
    ['admin-settings.html', 'src/93-content-organization-core.js'],
    ['admin-subjects.html', 'src/93-content-organization-core.js'],
    ['content-center.html', 'src/93-content-organization-core.js'],
    ['teacher-workbench.html', 'src/93-content-organization-core.js'],
  ];
  for (const [page, consumer] of pages) {
    const html = read(page);
    assert.equal((html.match(/src\/59c-active-learning-mode-policy\.js/g) || []).length, 1, `${page} policy count`);
    assert.equal(html.includes('src/59a-paper-learning-modes.js'), false, `${page} still loads retired policy asset`);
    assert.ok(html.indexOf('src/59c-active-learning-mode-policy.js') < html.indexOf(consumer), `${page} policy order`);
  }
});

test('release generation replaces legacy policy tags idempotently before the course task consumer', () => {
  const syncSource = fs.readFileSync(path.resolve(root, '../frontend/scripts/sync-new-legacy.js'), 'utf8');
  const start = syncSource.indexOf('function versionPageAssets(');
  const end = syncSource.indexOf('\nfunction diffFiles(', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${syncSource.slice(start, end)}\nglobalThis.injectPage = injectPage;`, context);
  const input = '<html><head></head><body>\n<script defer src="src/59a-paper-learning-modes.js"></script>\n<script src="src/93-content-organization-core.js"></script>\n</body></html>';

  const generated = context.injectPage(input, 'course-admin.html', 'test-version');
  const regenerated = context.injectPage(generated, 'course-admin.html', 'test-version');
  assert.equal(regenerated, generated);
  for (const html of [generated, regenerated]) {
    assert.equal((html.match(/src\/59c-active-learning-mode-policy\.js/g) || []).length, 1);
    assert.equal((html.match(/kg-learning-mode-policy:generated/g) || []).length, 1);
    assert.equal(html.includes('src/59a-paper-learning-modes.js'), false);
    assert.ok(html.indexOf('src/59c-active-learning-mode-policy.js') < html.indexOf('src/93-content-organization-core.js'));
  }
  for (const page of [
    'paper-management.html', 'question-workspace.html', 'course-admin.html', 'knowledge-recall.html',
    'practice-mode.html', 'question-bank.html', 'admin-console.html', 'admin-operations.html',
    'admin-settings.html', 'admin-subjects.html', 'content-center.html', 'teacher-workbench.html',
  ]) {
    const once = context.injectPage(read(page), page, 'test-version');
    const twice = context.injectPage(once, page, 'test-version');
    assert.equal(twice, once, `${page} must be byte-idempotent`);
    assert.equal((once.match(/kg-learning-mode-policy:generated/g) || []).length, 1, `${page} marker count`);
  }
});

test('new task create and update reject the canonical retired id and both aliases without writing state', () => {
  const taskKey = 'kg_learning_tasks_v1';
  const storage = createStorage({
    [taskKey]: JSON.stringify([{ ...historicalTask('existing', 'deep_recall'), status: 'draft' }]),
  });
  const { KGContentOrganization: organization } = loadOrganization(storage);

  for (const type of ['single_deep_study', 'single_deep', 'single-deep']) {
    const before = storage.value(taskKey);
    const writesBefore = storage.writes.length;
    const create = organization.saveLearningTask({ title: '新任务', type, subjectId: 'subject-pmp' });
    const update = organization.saveLearningTask({ ...historicalTask('existing', type), status: 'draft' });
    assert.deepEqual(Array.from(create.errors || []), [RETIRED_ERROR]);
    assert.deepEqual(Array.from(update.errors || []), [RETIRED_ERROR]);
    assert.equal(create.valid, false);
    assert.equal(update.valid, false);
    assert.equal(storage.writes.length, writesBefore);
    assert.equal(storage.value(taskKey), before);
  }
});

test('task service fails closed for retired ids when the shared policy is unavailable', () => {
  const taskKey = 'kg_learning_tasks_v1';
  const original = JSON.stringify([{ ...historicalTask('existing', 'deep_recall'), status: 'draft' }]);
  const storage = createStorage({ [taskKey]: original });
  const { KGContentOrganization: organization } = loadOrganization(storage, { loadPolicy: false });

  for (const type of ['single_deep_study', 'single_deep', 'single-deep']) {
    storage.writes.length = 0;
    const created = organization.saveLearningTask({ ...historicalTask(`new-${type}`, type), status: 'draft' });
    assert.equal(created.valid, false);
    assert.deepEqual(Array.from(created.errors), [RETIRED_ERROR]);
    assert.equal(storage.value(taskKey), original);
    assert.deepEqual(storage.writes, []);

    const updated = organization.saveLearningTask({ ...historicalTask('existing', type), status: 'draft' });
    assert.equal(updated.valid, false);
    assert.deepEqual(Array.from(updated.errors), [RETIRED_ERROR]);
    assert.equal(storage.value(taskKey), original);
    assert.deepEqual(storage.writes, []);
  }
});

test('all three active task modes can be created and updated through the real service boundary', () => {
  const taskKey = 'kg_learning_tasks_v1';
  const storage = createStorage({ [taskKey]: '[]' });
  const { KGContentOrganization: organization } = loadOrganization(storage);

  assert.deepEqual(Array.from(organization.TASK_TYPES), ['practice_mode', 'deep_recall', 'multi_question_canvas']);
  for (const type of organization.TASK_TYPES) {
    const created = organization.saveLearningTask({ id: `task-${type}`, title: type, type, subjectId: 'subject-pmp' });
    assert.equal(created.valid, true);
    assert.equal(created.task.type, type);
    const updated = organization.saveLearningTask({ ...created.task, description: '已更新' });
    assert.equal(updated.valid, true);
    assert.equal(updated.task.description, '已更新');
  }
});

test('historical task reads surface retired metadata and practice fallback without rewriting storage', () => {
  const taskKey = 'kg_learning_tasks_v1';
  const records = [
    historicalTask('canonical', 'single_deep_study'),
    historicalTask('underscore-alias', 'single_deep'),
    historicalTask('dash-alias', 'single-deep'),
  ];
  const serialized = JSON.stringify(records);
  const storage = createStorage({ [taskKey]: serialized });
  const { KGContentOrganization: organization } = loadOrganization(storage);

  const result = organization.getLearningTasks();
  assert.equal(result.length, 3);
  for (const task of result) {
    assert.equal(task.type, 'single_deep_study');
    assert.equal(task.typeLabel, '单题深学（已停用）');
    assert.equal(task.retired, true);
    assert.equal(task.fallbackId, 'practice_mode');
  }
  assert.equal(storage.value(taskKey), serialized);
  assert.deepEqual(storage.writes, []);
  for (const task of result) {
    const deleted = organization.deleteLearningTask(task.id);
    assert.equal(deleted.valid, false);
    assert.deepEqual(Array.from(deleted.errors), [RETIRED_ERROR]);
    const archived = organization.archiveLearningTask(task.id);
    assert.equal(archived.valid, false);
    assert.deepEqual(Array.from(archived.errors), [RETIRED_ERROR]);
    assert.equal(storage.value(taskKey), serialized);
    assert.deepEqual(storage.writes, []);
  }
});

test('historical task UI renders a retired label and practice fallback without an active retired option', () => {
  const taskKey = 'kg_learning_tasks_v1';
  const storage = createStorage({
    [taskKey]: JSON.stringify([historicalTask('historical', 'single_deep_study')]),
    kg_content_organization_migration_v1: JSON.stringify({ legacyTasks: true }),
  });
  const context = loadOrganization(storage);
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id, innerHTML: '', textContent: '', className: '', hidden: false, disabled: false, title: '', value: '', checked: false,
      listeners: new Map(),
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); },
      dispatch(type, target = this) {
        if (type === 'click' && this.disabled) return false;
        for (const callback of this.listeners.get(type) || []) callback({ target });
        return true;
      },
      querySelectorAll() { return []; },
    });
    return elements.get(id);
  };
  context.document = {
    body: { dataset: {} },
    getElementById: element,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, callback) { if (type === 'DOMContentLoaded') callback(); },
  };
  context.location = { search: '?view=tasks', href: 'https://example.test/course-admin.html?view=tasks' };
  context.history = { replaceState() {} };
  context.confirm = () => true;
  context.setTimeout = () => 1;
  context.clearTimeout = () => {};

  vm.runInContext(read('src/93-assessment-config-app.js'), context, { filename: '93-assessment-config-app.js' });

  assert.match(element('caTaskList').innerHTML, /单题深学（已停用）/);
  assert.match(element('caTaskEditor').innerHTML, /已停用/);
  assert.match(element('caTaskEditor').innerHTML, /刷题/);
  assert.doesNotMatch(element('caTaskEditor').innerHTML, /<option[^>]+single_deep/);
  assert.doesNotMatch(read('src/93-assessment-config-app.js'), /aria-disabled/);
  for (const id of ['caSaveTaskBtn', 'caDeleteTaskBtn', 'caPublishTaskBtn', 'caArchiveTaskBtn']) {
    assert.equal(element(id).disabled, false, `${id} must stay clickable to explain the retired state`);
    assert.equal(element(id).title, RETIRED_ERROR);
    storage.writes.length = 0;
    element('caToast').textContent = 'sentinel';
    assert.equal(element(id).dispatch('click'), true);
    assert.equal(element('caToast').textContent, RETIRED_ERROR);
    assert.doesNotMatch(element('caToast').textContent, /已保存|已删除|已发布|已归档/);
    assert.deepEqual(storage.writes, []);
  }
  for (const mutation of [
    ['caTaskActivityPicker', 'click', { closest: selector => selector === '[data-add-task-activity]' ? { dataset: { addTaskActivity: 'activity-new' } } : null }],
    ['caTaskEditor', 'click', { closest: selector => selector === '[data-remove-task-activity]' ? { dataset: { removeTaskActivity: 'activity-old' } } : null }],
    ['caTaskEditor', 'change', { id: 'caTaskSubject' }],
  ]) {
    storage.writes.length = 0;
    element('caToast').textContent = 'sentinel';
    element(mutation[0]).dispatch(mutation[1], mutation[2]);
    assert.equal(element('caToast').textContent, RETIRED_ERROR);
    assert.deepEqual(storage.writes, []);
  }
  assert.deepEqual(storage.writes, []);
});

test('active entry sources contain no retired route, action, payload, or help copy', () => {
  const files = [
    'index.html',
    'paper-management.html',
    'question-bank.html',
    'question-workspace.html',
    'course-admin.html',
    'src/77-multi-question-workspace.js',
    'src/91-course-admin-app.js',
    'src/93-assessment-config-app.js',
    'src/65-question-bank-admin.js',
    'src/19-home-toolbar-registry.js',
    'src/20-flashcards-toolbar.js',
    'src/30-auth-guards.js',
    'src/34-role-permissions.js',
    'src/40-guided-tour.js',
    'src/41-account-menu.js',
    'src/70-question-trainer.js',
    'src/102-help-content.js',
    'src/admin/module-help-content.js',
    'styles/question-workspace-p2218.css',
  ];
  const forbidden = /single_deep_study|single_deep|single-deep|单题深学|question-training\.html|questionTrainBtn|openQuestionTraining|forceOpenQuestionTrainer|qbSetCurrentBtn|setCurrentTrainingQuestion/;
  const violations = files.filter(file => fs.existsSync(path.join(root, file))).flatMap(file => read(file).split(/\r?\n/).flatMap((line, index) => (
    forbidden.test(line) ? [`${file}:${index + 1}:${line.trim()}`] : []
  )));
  const sharedQuestionBankViolations = read('src/60-question-bank.js').split(/\r?\n/).flatMap((line, index) => (
    /question-training\.html|questionTrainBtn|qbSetCurrentBtn|enabledModes:.*(?:single_deep_study|single_deep|single-deep)/.test(line)
      ? [`src/60-question-bank.js:${index + 1}:${line.trim()}`]
      : []
  ));
  const activeCopyViolations = ['src/34-role-permissions.js','src/35-user-management.js','src/37-subscription-plans.js','src/40-guided-tour.js','src/65-question-bank-admin.js'].flatMap(file => (
    read(file).split(/\r?\n/).flatMap((line, index) => (
      /考题/.test(line) ? [`${file}:${index + 1}:${line.trim()}`] : []
    ))
  ));
  assert.deepEqual([...violations, ...sharedQuestionBankViolations, ...activeCopyViolations], []);
});

test('current user documentation lists only the three active learning modes', () => {
  const quickStart = read('V9.0_P4.1_QUICK_START.md');
  const readme = read('README.md');
  const currentReadme = readme.slice(0, readme.indexOf('## V9.0-P4.0.3'));
  for (const source of [quickStart, currentReadme]) {
    assert.doesNotMatch(source, /单题深学/);
    assert.match(source, /多题(?:画布|归纳)/);
    assert.match(source, /深度回忆/);
    assert.match(source, /刷题/);
  }
});
