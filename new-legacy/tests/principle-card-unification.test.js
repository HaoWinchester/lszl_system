'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(ROOT, 'src/principles/question-principle-binding.js'),
  'utf8',
);
const window = {};
vm.runInNewContext(source, { window, globalThis: window, Set, String, Array, Object });
const Binding = window.KGQuestionPrincipleBinding;

const normalized = Binding.normalize({
  principleIds: ['legacy-stem', 'legacy-stem'],
  optionPrincipleMap: { A: ['trap', 'trap'], B: ['answer'], Z: ['stale'] },
}, ['A', 'B']);
assert.deepEqual(JSON.parse(JSON.stringify(normalized)), {
  stemPrincipleIds: ['legacy-stem'],
  optionPrincipleMap: { A: ['trap'], B: ['answer'] },
  principleIds: ['legacy-stem', 'trap', 'answer'],
});

assert.deepEqual(
  JSON.parse(JSON.stringify(Binding.correctOptionPrinciple({
    correctAnswer: 'B',
    options: [{ id: 'A' }, { id: 'B', correct: true }],
    metadata: { optionPrincipleMap: { B: ['answer'] } },
  }))),
  { ok: true, correctOptionId: 'B', principleId: 'answer' },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(Binding.correctOptionPrinciple({
    correctAnswer: 'B', metadata: { optionPrincipleMap: { B: ['one', 'two'] } },
  }))),
  { ok: false, reason: 'multiple', correctOptionId: 'B', principleIds: ['one', 'two'] },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(Binding.correctOptionPrinciple({
    correctAnswer: 'B', metadata: { principleIds: ['must-not-fallback'] },
  }))),
  { ok: false, reason: 'missing', correctOptionId: 'B', principleIds: [] },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(Binding.selectionPrinciple([
    { correctAnswer: 'B', metadata: { optionPrincipleMap: { B: ['answer'] } } },
    { correctAnswer: 'A', metadata: { optionPrincipleMap: { A: ['answer'] } } },
  ]))),
  { ok: true, principleId: 'answer' },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(Binding.selectionPrinciple([
    { correctAnswer: 'B', metadata: { optionPrincipleMap: { B: ['answer'] } } },
    { correctAnswer: 'A', metadata: { optionPrincipleMap: { A: ['different'] } } },
  ]))),
  { ok: false, reason: 'mismatch', principleIds: ['answer', 'different'] },
);

console.log('principle-card-unification-ok');
