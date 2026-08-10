'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const policyPath = path.resolve(__dirname, '../src/59c-active-learning-mode-policy.js');

function loadPolicy() {
  delete require.cache[policyPath];
  global.KGPaperLearningModes = { stale: true };
  return require(policyPath);
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
