'use strict';

// 保留已有测试入口；随机题序由服务端生成，前端恢复时必须原样使用。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/100-practice-mode.js'), 'utf8');
const context = {
  window: {},
  state: { order: 'paper' },
  dom: { timer: {}, timeRow: {}, health: {} },
  document: { body: { dataset: {} } },
  $: () => ({}),
  clone: value => JSON.parse(JSON.stringify(value)),
  text: value => String(value || ''),
  sessionQuestions: session => session.questions.map(row => ({ id: row.questionId })),
  createDraft: () => {},
  challengeInitialHealth: () => 3,
  scholarInitialHealth: () => 3,
  MAX_HEALTH: 3,
  SCHOLAR_MAX_SECONDS: 60,
  setConflictVisible: () => {},
  modePolicy: () => ({ showHealth: true }),
  setView: () => {},
  renderQuestion: () => {},
  startTimer: () => {},
  showToast: () => {},
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'src/111-practice-session-core.js'), 'utf8'), context);
context.normalizedSession = context.window.KGPracticeSessionCore.normalizeSession;
vm.runInContext(source.slice(source.indexOf('  function restoreServerSession('), source.indexOf('  function practiceEntryInput(')), context);

const ids = ['q7', 'q2', 'q9', 'q1', 'q8', 'q3', 'q10', 'q4', 'q6', 'q5'];
for (const mode of ['challenge', 'scholar', 'practice']) {
  for (const currentIndex of [0, 7]) {
    const session = {
      id: `ps-random-${mode}`, paperId: 'paper-1', mode,
      questions: ids.map(questionId => ({ questionId })),
      runtimeState: { order: 'random', currentIndex },
    };
    const before = JSON.stringify(session);
    context.restoreServerSession(session, { id: 'paper-1' });
    assert.deepEqual(Array.from(context.state.questions, question => question.id), ids);
    assert.equal(context.state.index, currentIndex);
    assert.equal(context.state.questions[context.state.index].id, ids[currentIndex]);
    assert.equal(context.state.order, 'random');
    assert.equal(JSON.stringify(session), before, '恢复不能改变服务端冻结快照');
  }
}
console.log('practice-server-frozen-order-ok');
