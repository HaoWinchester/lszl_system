'use strict';

// 契约：答题卡 render 第 4 参接收标记集合（Set），标记题号加 is-marked，
// legend 出现「已标记」；未传集合时保持原行为。

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const context = { window: {}, console };
context.window.window = context.window;
vm.createContext(context);
for (const script of ['src/115-practice-mode-policy.js', 'src/111-practice-session-core.js', 'src/112-practice-answer-sheet.js']) {
  vm.runInContext(
    fs.readFileSync(path.join(root, script), 'utf8'),
    context,
    { filename: script },
  );
}

const Sheet = context.window.KGPracticeAnswerSheet;
assert(Sheet, 'answer sheet should load');

const rootElement = {
  innerHTML: '',
  addEventListener() {},
};

const sheet = Sheet.mount(rootElement, {});
const session = {
  mode: 'practice',
  questions: [
    { questionId: 'q1' },
    { questionId: 'q2' },
    { questionId: 'q3' },
  ],
  answers: {
    q1: { selectedAnswer: 'A', correctAnswer: 'A', correct: true },
  },
};

sheet.render(session, 'q2', 'all', new Set(['q2', 'q3']));

assert(rootElement.innerHTML.includes('is-marked'), 'marked numbers must have is-marked class');
assert(rootElement.innerHTML.includes('已标记'), 'legend must include marked entry');
assert(
  /data-question-id="q2"[^>]*is-marked|is-marked[^>]*data-question-id="q2"/.test(rootElement.innerHTML),
  'q2 button must be marked',
);
assert(
  /data-question-id="q3"[^>]*is-marked|is-marked[^>]*data-question-id="q3"/.test(rootElement.innerHTML),
  'q3 button must be marked',
);
assert(
  !/data-question-id="q1"[^>]*is-marked|is-marked[^>]*data-question-id="q1"/.test(rootElement.innerHTML),
  'q1 button must not be marked',
);

// 不传标记集合：legend 不出现「已标记」
sheet.render(session, 'q2');
assert(!rootElement.innerHTML.includes('已标记'), 'legend must omit marked entry without marks');

// 筛选切换（闭包重渲染）仍保留标记：通过源码契约验证闭包保存
const componentSource = fs.readFileSync(path.join(root, 'src/112-practice-answer-sheet.js'), 'utf8');
assert(/let markedIds = null/.test(componentSource), 'markedIds must be kept in closure for filter re-render');
assert(/markedIds\.has\(id\)/.test(componentSource), 'render must consult markedIds per question');

console.log('practice-marked-answer-sheet-ok');
