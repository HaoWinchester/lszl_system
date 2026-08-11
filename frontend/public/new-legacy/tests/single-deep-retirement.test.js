'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const policyPath = path.resolve(__dirname, '../src/59c-active-learning-mode-policy.js');
const practicePath = path.resolve(__dirname, '../src/100-practice-mode.js');
const questionTrainingPath = path.resolve(__dirname, '../question-training.html');

function loadPolicy() {
  delete require.cache[policyPath];
  global.KGPaperLearningModes = { stale: true };
  return require(policyPath);
}

function loadPracticeModule() {
  delete require.cache[practicePath];
  return require(practicePath);
}

function redirectFrom(search) {
  const html = fs.readFileSync(questionTrainingPath, 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(source => source.includes('location.replace'));
  assert.ok(script, 'the retirement shell must execute a location.replace redirect');
  let target = '';
  const fallbackLink = { href: '' };
  vm.runInNewContext(script, { URL, URLSearchParams, location: {
    href: `https://study.example/question-training.html${search}`, origin: 'https://study.example', replace(value) { target = value; },
  }, document: { getElementById(id) { return id === 'practiceRedirectFallback' ? fallbackLink : null; } } });
  assert.equal(fallbackLink.href, target, 'the visible fallback uses the redirect target');
  return new URL(target);
}

function createPracticeElement() {
  return { addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, closest() { return null; }, dataset: {}, hidden: false, innerHTML: '', querySelector() { return null; }, querySelectorAll() { return []; }, setAttribute() {}, style: { setProperty() {} }, textContent: '' };
}

test('active learning mode registry exposes only the three supported choices', () => {
  const policy = loadPolicy();

  assert.deepEqual(policy.listActive(), [
    { id: 'practice_mode', label: '刷题', retired: false },
    { id: 'deep_recall', label: '深度回忆', retired: false },
    { id: 'multi_question_canvas', label: '归纳', retired: false },
  ]);
  assert.deepEqual(policy.list(), policy.listActive());
  assert.deepEqual(policy.IDS, ['practice_mode', 'deep_recall', 'multi_question_canvas']);
  assert.deepEqual(policy.LABELS, {
    practice_mode: '刷题',
    deep_recall: '深度回忆',
    multi_question_canvas: '归纳',
  });
  assert.equal(Object.hasOwn(policy.LABELS, 'single_deep_study'), false);
  assert.equal(global.KGPaperLearningModes, policy);
});

test('active registry and its mode records cannot be mutated by callers', () => {
  const policy = loadPolicy();
  const active = policy.listActive();

  assert.equal(Object.isFrozen(policy.ACTIVE_MODES), true);
  assert.equal(Object.isFrozen(active), true);
  assert.equal(Object.isFrozen(active[0]), true);
  assert.equal(Object.isFrozen(policy.IDS), true);
  assert.equal(Object.isFrozen(policy.LABELS), true);
  assert.throws(() => active.push({ id: 'single_deep_study', label: '单题深学' }), TypeError);
  assert.throws(() => { active[0].label = '做题模式'; }, TypeError);
  assert.deepEqual(policy.listActive().map(item => item.label), ['刷题', '深度回忆', '归纳']);
});

test('historical resolver recognizes the canonical retired id and both aliases', () => {
  const policy = loadPolicy();
  const expected = {
    id: 'single_deep_study',
    label: '单题深学（已停用）',
    retired: true,
    fallbackId: 'practice_mode',
  };

  for (const id of ['single_deep_study', 'single_deep', 'single-deep']) {
    const resolved = policy.resolveHistorical(id);
    assert.deepEqual(resolved, expected);
    assert.equal(Object.isFrozen(resolved), true);
  }
  assert.equal(Object.isFrozen(policy.HISTORICAL_MODE_ALIASES), true);
  assert.equal(policy.resolveHistorical('practice_mode'), null);
  assert.equal(policy.resolveHistorical('unknown-mode'), null);
});

test('launch normalization falls back from retired aliases and preserves the original id', () => {
  const policy = loadPolicy();

  assert.deepEqual(policy.normalizeForLaunch('single_deep_study'), {
    id: 'practice_mode',
    label: '刷题',
    retired: false,
    retiredFrom: 'single_deep_study',
  });
  assert.deepEqual(policy.normalizeForLaunch('single-deep'), {
    id: 'practice_mode',
    label: '刷题',
    retired: false,
    retiredFrom: 'single-deep',
  });
  assert.equal(Object.isFrozen(policy.normalizeForLaunch('single_deep')), true);
});

test('launch normalization accepts active aliases and safely defaults unknown ids to practice', () => {
  const policy = loadPolicy();

  assert.deepEqual(policy.normalizeForLaunch('deep-recall'), {
    id: 'deep_recall',
    label: '深度回忆',
    retired: false,
  });
  assert.deepEqual(policy.normalizeForLaunch('unknown-mode'), {
    id: 'practice_mode',
    label: '刷题',
    retired: false,
  });
  assert.deepEqual(policy.normalizeForLaunch(''), {
    id: 'practice_mode',
    label: '刷题',
    retired: false,
  });
});

test('legacy read-only normalization surfaces stay active-only', () => {
  const policy = loadPolicy();
  const historicalPaper = Object.freeze({
    enabledModes: Object.freeze(['canvas', 'single-deep']),
    modeConfigVersion: 2,
  });

  assert.equal(policy.canonical('single-deep'), 'single_deep_study');
  assert.deepEqual(policy.normalize(undefined), ['practice_mode', 'deep_recall', 'multi_question_canvas']);
  assert.deepEqual(policy.normalize(['single_deep_study', 'deep-recall'], 2), ['deep_recall']);
  assert.deepEqual(policy.normalize(['single_deep'], 0), []);
  assert.deepEqual(policy.normalizePaper(historicalPaper), ['multi_question_canvas']);
  assert.deepEqual(historicalPaper.enabledModes, ['canvas', 'single-deep']);
  assert.equal(policy.supports({ enabledModes: ['single_deep_study'], modeConfigVersion: 2 }, 'single_deep_study'), false);
  assert.equal(policy.supports({ enabledModes: ['practice'], modeConfigVersion: 2 }, 'practice_mode'), true);
  assert.deepEqual(policy.validate({ enabledModes: ['single_deep_study'], modeConfigVersion: 2 }), {
    ok: false,
    modes: [],
    error: '请至少选择一种学习模式后再发布。',
  });
});

test('retired single-deep links redirect to practice with only encoded allow-listed parameters', () => {
  const target = redirectFrom('?paperId=paper%20%26%20one&releaseId=release%2F2&questionId=q%3F3&bankId=bank%234&courseId=course%3D5&taskId=task%2B6&subject=%E9%A1%B9%E7%9B%AE%26%E7%AE%A1%E7%90%86&returnTo=%2Flearning-path.html%3Fignored%3D1&unknown=discard#fragment');
  assert.equal(target.origin, 'https://study.example');
  assert.equal(target.pathname, '/practice-mode.html');
  assert.deepEqual([...target.searchParams.entries()], [['paperId', 'paper & one'], ['releaseId', 'release/2'], ['questionId', 'q?3'], ['bankId', 'bank#4'], ['courseId', 'course=5'], ['taskId', 'task+6'], ['subject', '项目&管理'], ['returnTo', '/learning-path.html'], ['retiredMode', 'single_deep_study']]);
  assert.equal(target.hash, '');
});

test('retired single-deep redirect rejects cross-origin return targets and never boots retired scripts', () => {
  for (const value of ['https://evil.example/steal', '//evil.example/steal', 'javascript:alert(1)']) {
    assert.equal(redirectFrom(`?returnTo=${encodeURIComponent(value)}`).searchParams.has('returnTo'), false, `must reject ${value}`);
  }
  const html = fs.readFileSync(questionTrainingPath, 'utf8');
  assert.deepEqual([...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]), [], 'the redirect shell must not load the retired application');
});

test('practice reads the retirement marker once and prioritizes a valid target question', () => {
  const practice = loadPracticeModule();
  const navigation = practice.readRetiredModeNavigation('?retiredMode=single_deep_study&questionId=question-2');
  assert.deepEqual(navigation, { retired: true, paperId: '', releaseId: '', questionId: 'question-2', notice: '单题深学已停用，已为你切换到刷题' });
  assert.equal(practice.readRetiredModeNavigation('?retiredMode=another_mode&questionId=question-2'), null);
  assert.deepEqual(practice.prioritizeRetiredQuestion([{ id: 'question-1' }, { id: 'question-2' }, { id: 'question-3' }], navigation.questionId).map(question => question.id), ['question-2', 'question-1', 'question-3']);
  assert.deepEqual(practice.prioritizeRetiredQuestion([{ id: 'question-1' }, { id: 'question-2' }], 'missing').map(question => question.id), ['question-1', 'question-2']);
});

test('practice displays the retirement notice once during the redirected navigation', async () => {
  const original = { KGQuestionCatalogAdapter: global.KGQuestionCatalogAdapter, addEventListener: global.addEventListener, document: global.document, location: global.location };
  const elements = new Map(), elementFor = id => elements.get(id) || (elements.set(id, createPracticeElement()), elements.get(id)), listeners = new Map();
  try {
    global.document = { addEventListener(type, listener) { listeners.set(type, listener); }, body: createPracticeElement(), getElementById: elementFor, querySelector() { return createPracticeElement(); }, querySelectorAll() { return []; } };
    global.location = { search: '?retiredMode=single_deep_study&questionId=question-2' }; global.addEventListener = () => {}; global.KGQuestionCatalogAdapter = { ready: Promise.resolve() };
    delete require.cache[practicePath]; require(practicePath);
    await listeners.get('DOMContentLoaded')();
    const notice = elementFor('practiceRetiredModeNotice');
    assert.equal(notice.hidden, false); assert.equal(notice.textContent, '单题深学已停用，已为你切换到刷题');
    await listeners.get('DOMContentLoaded')(); assert.equal(notice.textContent, '单题深学已停用，已为你切换到刷题');
  } finally { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete global[key]; else global[key] = value; } delete require.cache[practicePath]; }
});

test('retired navigation does not restore an older active practice session', async () => {
  const original = { KGQuestionCatalogAdapter: global.KGQuestionCatalogAdapter, KGPracticeMode: global.KGPracticeMode, addEventListener: global.addEventListener, document: global.document, localStorage: global.localStorage, location: global.location, sessionStorage: global.sessionStorage };
  const elements = new Map(), elementFor = id => elements.get(id) || (elements.set(id, createPracticeElement()), elements.get(id)), listeners = new Map();
  const questions = Array.from({ length: 10 }, (_, index) => ({ id: `question-${index + 1}`, stem: `题目 ${index + 1}`, options: [{ id: 'A', text: '答案 A', correct: true }, { id: 'B', text: '答案 B' }], correctAnswer: 'A' }));
  const published = [{ id: 'release-1', paperId: 'paper-1', version: 1, status: 'published', questions: questions.map((question, index) => ({ bankId: 'bank-1', questionId: question.id, order: index })), questionSnapshots: questions.map(question => ({ bankId: 'bank-1', questionId: question.id, question })) }];
  const staleAttempt = { savedAt: Date.now(), paperId: 'paper-1', releaseId: 'release-1', paperVersion: 1, selectedCount: 10, order: 'paper', mode: 'challenge', questions, index: 4, health: 3, streak: 0, experience: 0, correct: 0, answered: 4, startedAt: Date.now(), deadline: 0 };
  try {
    global.document = { addEventListener(type, listener) { listeners.set(type, listener); }, body: createPracticeElement(), getElementById: elementFor, querySelector() { return createPracticeElement(); }, querySelectorAll() { return []; } };
    global.location = { search: '?retiredMode=single_deep_study&paperId=paper-1&questionId=question-2' }; global.addEventListener = () => {}; global.KGQuestionCatalogAdapter = { ready: Promise.resolve() };
    global.localStorage = { getItem(key) { return key === 'kg_exam_papers_published_v1' ? JSON.stringify(published) : null; } }; global.sessionStorage = { getItem() { return JSON.stringify(staleAttempt); }, removeItem() {} };
    delete require.cache[practicePath]; require(practicePath); await listeners.get('DOMContentLoaded')();
    assert.equal(global.KGPracticeMode.snapshot().active, false); assert.equal(global.document.body.dataset.practiceView, 'lobby'); assert.equal(elementFor('practiceRetiredModeNotice').hidden, false);
  } finally { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete global[key]; else global[key] = value; } delete require.cache[practicePath]; }
});
