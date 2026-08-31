'use strict';

const { test } = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = { window: {}, console };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(root, 'src/117-question-answer-set.js'), 'utf8'),
  context,
  { filename: 'src/117-question-answer-set.js' },
);

const Answers = context.window.KGQuestionAnswerSet;
const plain = value => JSON.parse(JSON.stringify(value));

test('normalizes canonical arrays without duplicates and in option order', () => {
  const question = {
    type: 'multiple_choice',
    options: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
    correctOptionIds: ['C', 'A', 'C'],
  };
  assert.deepEqual(plain(Answers.correctIds(question)), ['A', 'C']);
});

test('reads legacy correct flags and unambiguous joined answers', () => {
  assert.deepEqual(plain(Answers.correctIds({
    type: 'multiple_choice',
    options: [{ id: 'A', correct: true }, { id: 'B' }, { id: 'C', correct: true }],
  })), ['A', 'C']);
  assert.deepEqual(plain(Answers.normalizeIds('AC', ['A', 'B', 'C'])), ['A', 'C']);
  assert.deepEqual(plain(Answers.normalizeIds('A，C', ['A', 'B', 'C'])), ['A', 'C']);
});

test('exact-set grading gives zero for fewer, extra, or wrong choices', () => {
  assert.equal(Answers.grade(['A', 'C'], ['C', 'A']), true);
  assert.equal(Answers.grade(['A'], ['A', 'C']), false);
  assert.equal(Answers.grade(['A', 'B', 'C'], ['A', 'C']), false);
  assert.equal(Answers.grade(['A', 'D'], ['A', 'C']), false);
});

test('multiple-choice release validation requires 3-8 options, 2 correct, a distractor, and analysis', () => {
  const base = {
    type: 'multiple_choice', analysis: '因为 A、C 同时成立。',
    options: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], correctOptionIds: ['A', 'C'],
  };
  assert.deepEqual(plain(Answers.validate(base, { release: true })), []);
  assert.ok(Answers.validate({ ...base, correctOptionIds: ['A'] }).length);
  assert.ok(Answers.validate({ ...base, correctOptionIds: ['A', 'B', 'C'] }).length);
  assert.ok(Answers.validate({ ...base, analysis: '' }, { release: true }).length);
  assert.deepEqual(plain(Answers.validate({ ...base, analysis: '' })), []);
});
