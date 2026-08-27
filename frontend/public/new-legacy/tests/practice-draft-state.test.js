'use strict';

const { test } = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const MODULE_PATH = path.join(root, 'src/114-practice-draft-state.js');
const context = { window: {}, console };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(MODULE_PATH, 'utf8'),
  context,
  { filename: 'src/114-practice-draft-state.js' },
);

const Core = context.window.KGPracticeDraftState;
assert(Core, 'practice draft state should load');

// 模块运行在 vm context（另一 realm），严格深度相等前需先过 JSON 还原
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function buildQuestions() {
  return [
    { questionId: 'q1', question: { title: '题目 1', correctAnswer: 'A', options: [{ id: 'A' }, { id: 'B' }] } },
    { questionId: 'q2', question: { title: '题目 2', correctAnswer: 'C', options: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] } },
  ];
}

test('draft selects and locks locally while stripping client truth from submission', () => {
  const draft = Core.create({
    questions: [{questionId:'q1', question:{correctAnswer:'A', options:[{id:'A'},{id:'B'}]}}],
    answers: {},
  })
  assert.equal(draft.select('q1', 'B').answer.correct, false)
  assert.equal(draft.select('q1', 'A').accepted, false)
  assert.deepEqual(plain(draft.submission()), {
    q1: {selectedAnswer:'B', selectionIndex:1},
  })
  assert.equal(draft.isDirty(), true)
  draft.markSaved()
  assert.equal(draft.isDirty(), false)
})

test('rehydrated server drafts rederive local correctness without trusting client truth', () => {
  const answers = {
    q1: { selectedAnswer: 'B', selectionIndex: 4 },
    q2: { selectedAnswer: '__timeout__', selectionIndex: 9, timedOut: true },
  }
  const draft = Core.create({ questions: buildQuestions(), answers })
  assert.equal(draft.select('q1', 'A').accepted, false)
  assert.deepEqual(plain(draft.viewAnswers()), {
    q1: { selectedAnswer: 'B', selectionIndex: 4, correct: false, correctAnswer: 'A' },
    q2: { selectedAnswer: '__timeout__', selectionIndex: 9, timedOut: true, correct: false, correctAnswer: 'C' },
  })
  // 提交载荷不带本地派生字段，保留服务器已知的 timedOut/selectionIndex
  assert.deepEqual(plain(draft.submission()), {
    q1: { selectedAnswer: 'B', selectionIndex: 4 },
    q2: { selectedAnswer: '__timeout__', selectionIndex: 9, timedOut: true },
  })
})

test('rehydrated legacy timedOut draft with a real option value normalizes to the backend placeholder', () => {
  // 后端保存草稿只做白名单剥离（保留真实选项值 + timedOut），但终局判分把
  // timedOut 一律按 '__timeout__' 判 false；前端恢复时必须与判分口径同构。
  const answers = { q1: { selectedAnswer: 'A', selectionIndex: 1, timedOut: true } }
  const draft = Core.create({ questions: buildQuestions(), answers })
  assert.equal(draft.select('q1', 'A').accepted, false)
  assert.deepEqual(plain(draft.viewAnswers()), {
    q1: { selectedAnswer: '__timeout__', selectionIndex: 1, timedOut: true, correct: false, correctAnswer: 'A' },
  })
  assert.deepEqual(plain(draft.submission()), {
    q1: { selectedAnswer: '__timeout__', selectionIndex: 1, timedOut: true },
  })
  assert.deepEqual(plain(draft.stats()), {
    total: 2,
    answered: 1,
    correct: 0,
    wrong: 1,
    unanswered: 1,
  })
})

test('timeout accepts an answer without a legal option and keeps the submission shape', () => {
  const draft = Core.create({ questions: buildQuestions(), answers: {} })
  const result = draft.select('q2', '', { timedOut: true })
  assert.equal(result.accepted, true)
  assert.equal(result.answer.selectedAnswer, '__timeout__')
  assert.equal(result.answer.timedOut, true)
  assert.equal(result.answer.correct, false)
  assert.equal(result.answer.correctAnswer, 'C')
  assert.deepEqual(plain(draft.submission()), {
    q2: { selectedAnswer: '__timeout__', selectionIndex: 1, timedOut: true },
  })
  // 超时后同样锁定
  assert.equal(draft.select('q2', 'C').accepted, false)
})

test('unknown question ids and illegal options are rejected', () => {
  const draft = Core.create({ questions: buildQuestions(), answers: {} })
  assert.equal(draft.select('missing', 'A').accepted, false)
  assert.equal(draft.answer('missing'), null)
  assert.equal(draft.select('q1', 'Z').accepted, false)
  assert.equal(draft.answer('q1'), null)
  assert.equal(draft.isDirty(), false)
})

test('stats mirror answer sheet totals', () => {
  const draft = Core.create({
    questions: buildQuestions(),
    answers: { q1: { selectedAnswer: 'A', selectionIndex: 1 } },
  })
  assert.deepEqual(plain(draft.stats()), {
    total: 2,
    answered: 1,
    correct: 1,
    wrong: 0,
    unanswered: 1,
  })
  draft.select('q2', 'A')
  assert.deepEqual(plain(draft.stats()), {
    total: 2,
    answered: 2,
    correct: 1,
    wrong: 1,
    unanswered: 0,
  })
})

test('selectionIndex stays stable across reads and later answers', () => {
  const draft = Core.create({ questions: buildQuestions(), answers: {} })
  draft.select('q2', 'C')
  draft.select('q1', 'A')
  assert.deepEqual(plain(draft.submission()), {
    q1: { selectedAnswer: 'A', selectionIndex: 2 },
    q2: { selectedAnswer: 'C', selectionIndex: 1 },
  })
  // 读两次结果一致（selectionIndex 稳定）
  assert.deepEqual(plain(draft.submission()), plain(draft.submission()))
  assert.equal(draft.answer('q2').selectionIndex, 1)
})

test('create, select and readers never mutate the provided inputs', () => {
  const questions = buildQuestions()
  const answers = { q1: { selectedAnswer: 'B', selectionIndex: 2 } }
  const questionsSnapshot = JSON.parse(JSON.stringify(questions))
  const answersSnapshot = JSON.parse(JSON.stringify(answers))
  const draft = Core.create({ questions, answers })
  draft.select('q2', 'C')
  const viewed = draft.viewAnswers()
  viewed.q2.correct = true
  viewed.q2.selectedAnswer = 'A'
  const submitted = draft.submission()
  submitted.q1.selectedAnswer = 'A'
  assert.deepEqual(questions, questionsSnapshot, 'questions input must stay untouched')
  assert.deepEqual(answers, answersSnapshot, 'answers input must stay untouched')
  assert.equal(draft.viewAnswers().q2.selectedAnswer, 'C', 'viewAnswers must hand out clones')
  assert.equal(draft.submission().q1.selectedAnswer, 'B', 'submission must hand out clones')
})

test('module stays pure: no fetch, DOM or storage access', () => {
  const source = fs.readFileSync(MODULE_PATH, 'utf8')
  const forbidden = [
    /\bfetch\s*\(/,
    /XMLHttpRequest/,
    /\bdocument\b/,
    /\bwindow\.document\b/,
    /\belement\b/i,
    /localStorage/,
    /sessionStorage/,
    /indexedDB/i,
  ]
  forbidden.forEach((pattern) => {
    assert.doesNotMatch(source, pattern)
  })
})
