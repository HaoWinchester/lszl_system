'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const policyPath = path.resolve(__dirname, '../src/59a-paper-learning-modes.js');
delete require.cache[policyPath];
const policy = require(policyPath);

assert.deepEqual(policy.normalize(undefined), [
  'practice_mode',
  'deep_recall',
  'multi_question_canvas',
  'single_deep_study',
]);
assert.deepEqual(policy.normalize(['deep-recall'], 0).sort(), ['deep_recall', 'practice_mode']);
assert.deepEqual(policy.normalize([], 2), []);
assert.equal(policy.supports({ enabledModes: ['practice'], modeConfigVersion: 2 }, 'practice_mode'), true);
assert.equal(policy.supports({ enabledModes: ['deep_recall'], modeConfigVersion: 2 }, 'practice_mode'), false);
assert.deepEqual(policy.validate({ enabledModes: [], modeConfigVersion: 2 }), {
  ok: false,
  modes: [],
  error: '请至少选择一种学习模式后再发布。',
});
assert.equal(policy.isPublishedStatus('ACTIVE'), true);
assert.equal(policy.isWithdrawnStatus('revoked'), true);

console.log('v90-p4325 paper mode policy tests passed');
