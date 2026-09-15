'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/77-multi-question-workspace.js'), 'utf8');
// Exercise the real payload builder and queue/retry functions with UI/timers stubbed.
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const sent = [];
let fail = true;
const state = { papers: [], answerQueue: [], answerSync: new Map(), cards: new Map() };
const context = vm.createContext({
  global: { crypto: webcrypto, clearTimeout() {}, setTimeout() {} }, state,
  ANSWER_FLUSH_DELAY: 2500, selectedPaper: () => ({}), languageMode: () => 'zh',
  resolvedQuestionForNode: () => ({ id: 'question-one' }), notify() {},
  refreshSingleCardMarkup() {}, refreshSingleCardMarkupById() {},
  PracticeLearning: { async answer(payload) { sent.push(JSON.parse(JSON.stringify(payload))); if (fail) throw Error('response lost'); }, async refresh() {} },
});
vm.runInContext(section('  function practiceAnswerPayload(', '  function markQuestionCompleted(') +
  section('  function enqueueAnswer(', '  function refreshSingleCardMarkupById('), context);
(async () => {
  const record = { node: { questionId: 'question-one' } };
  const first = context.practiceAnswerPayload(record, 'B');
  assert.ok(first.requestId, 'a new canvas answer needs an immutable attempt ID');
  context.enqueueAnswer(first, 'node-one');
  await context.flushAnswerQueue();
  assert.equal(state.answerQueue.length, 1);
  assert.equal(state.answerSync.get('node-one').payload.requestId, first.requestId);
  fail = false;
  await context.flushAnswerQueue();
  assert.deepEqual(sent[0], sent[1], 'retry sends the identical logical request');
  const next = context.practiceAnswerPayload(record, 'B');
  assert.notEqual(next.requestId, first.requestId, 'the same selection in a new attempt gets a new ID');
  assert.equal(next.questionId, first.questionId);
  assert.match(source, /options\.retryPayload\?\{\.\.\.options\.retryPayload\}:practiceAnswerPayload\(record,key\)/);
  console.log('practice-answer-attempt-ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
