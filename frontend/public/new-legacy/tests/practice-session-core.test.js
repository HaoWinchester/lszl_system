'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = { window: {}, console };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(root, 'src/111-practice-session-core.js'), 'utf8'),
  context,
  { filename: 'src/111-practice-session-core.js' },
);

const Core = context.window.KGPracticeSessionCore;
assert(Core, 'practice session core should load');

const source = {
  id: 'ps-1',
  revision: 3,
  questions: [
    { questionId: 'q1', question: { title: '题目 1' } },
    { questionId: 'q2', question: { title: '题目 2' } },
    { questionId: 'q3', question: { title: '题目 3' } },
  ],
  answers: {
    q1: { selectedAnswer: 'B', correctAnswer: 'A', correct: false },
    q2: { selectedAnswer: 'A', correctAnswer: 'A', correct: true },
  },
  runtimeState: {
    currentIndex: 2,
    health: 2,
    streak: 3,
    maxStreak: 4,
    experience: 42,
    remainingMs: 48321,
    durationMs: 12000,
    languageMode: 'bilingual',
    autoExplain: false,
    answers: { forged: true },
  },
};
const session = Core.normalizeSession(source);

assert.equal(Core.questionStatus(session, 'q1'), 'wrong');
assert.equal(Core.questionStatus(session, 'q2'), 'correct');
assert.equal(Core.questionStatus(session, 'q3'), 'unanswered');
assert.equal(Core.questionStatus(session, 'missing'), 'missing');
assert.deepEqual(
  JSON.parse(JSON.stringify(Core.answerSheetStats(session))),
  { total: 3, answered: 2, correct: 1, wrong: 1, unanswered: 1 },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(Core.resumableRuntime(session))),
  {
    currentIndex: 2,
    health: 2,
    streak: 3,
    maxStreak: 4,
    experience: 42,
    remainingMs: 48321,
    durationMs: 12000,
    languageMode: 'bilingual',
    autoExplain: false,
  },
);

session.answers.q1.selectedAnswer = 'A';
session.questions[0].question.title = '修改';
assert.equal(source.answers.q1.selectedAnswer, 'B', 'normalization must clone answers');
assert.equal(source.questions[0].question.title, '题目 1', 'normalization must clone questions');

const invalid = Core.normalizeSession({ questions: [], answers: null, runtimeState: { currentIndex: 99 } });
assert.equal(invalid.runtimeState.currentIndex, 0);
assert.deepEqual(JSON.parse(JSON.stringify(Core.answerSheetStats(invalid))), {
  total: 0,
  answered: 0,
  correct: 0,
  wrong: 0,
  unanswered: 0,
});

console.log('practice-session-core-ok');
