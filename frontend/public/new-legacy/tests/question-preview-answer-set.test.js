'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'src/65-question-bank-admin.js'), 'utf8');
const previewFunctions = [
  ['  function openLibraryQuestionPreview(', '  function closeLibraryQuestionPreview('],
  ['  async function openPaperQuestionPreview(', '  function closePaperQuestionPreview('],
].map(([start, end]) => admin.slice(admin.indexOf(start), admin.indexOf(end))).join('\n');

function previewContext(question) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: true, innerHTML: '', textContent: '',
      insertAdjacentHTML(_position, html) { this.innerHTML = html + this.innerHTML; },
    });
    return elements.get(id);
  };
  const bank = { id: 'import-bank', name: '导入题库', questions: [question] };
  const noop = () => {};
  const context = {
    console, $: element, state: { banks: [bank] }, Catalog: {},
    document: { querySelectorAll: () => [] },
    currentBank: () => bank, paperQuestionLookup: () => ({ bank, question }),
    isLibraryQuestionPreviewOpen: () => false, isPaperQuestionPreviewOpen: () => false,
    libraryPreviewKey: () => '', paperPreviewKey: () => '',
    paperRefKey: ref => `${ref.bankId}::${ref.questionId}`,
    fillQuestionForm: noop, renderRecallConfig: noop, renderStatusCard: noop, renderCompletion: noop,
    questionKnowledgeLabel: () => '', questionDomainKey: () => '',
    questionTypeLabel: type => type, difficultyDisplay: () => '', isQuestionDeleted: () => false,
    markLibraryQuestionPreviewAnchor: noop, markPaperPreviewAnchor: noop,
    requestAnimationFrame: noop, positionLibraryQuestionPreview: noop, positionPaperQuestionPreview: noop,
    stemText: q => q.stemParts.map(part => part.text).join(''),
    escapeHTML: value => String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char])),
    toast: message => { throw new Error(message); },
  };
  context.window = context;
  vm.createContext(context);
  // Match page script order: the preview module loads before the answer-set module.
  for (const file of ['teacher/question-bank/question-preview.js', '117-question-answer-set.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), context);
  }
  context.AnswerSet = context.KGQuestionAnswerSet;
  context.teacherDomainServices = () => ({ questionPreview: context.KGTeacherDomains.QuestionBank.QuestionPreview });
  vm.runInContext(previewFunctions, context);
  return { context, element };
}

const choice = (id, ids, answer) => ({
  id, title: id, type: 'multiple_choice', correctAnswer: '', correctOptionIds: [...answer],
  stemParts: [{ text: '请选择所有正确做法。' }], analysis: '解析',
  options: [...ids].map(optionId => ({ id: optionId, text: `选项 ${optionId}`, correct: answer.includes(optionId) })),
});
const matching = {
  id: 'matching', title: '匹配题', type: 'matching', correctAnswer: 'A',
  stemParts: [{ text: '请配对。' }], analysis: '解析',
  options: [{ id: 'A', text: '旧占位 A', correct: true }, { id: 'B', text: '旧占位 B' }],
  matching: {
    left: [{ id: 'l1', text: '一' }, { id: 'l2', text: '二' }],
    right: [{ id: 'r1', text: '甲' }, { id: 'r2', text: '乙' }],
    correctPairs: { l1: 'r2', l2: 'r1' },
  },
};
const fixtures = [
  { name: 'Q90 six-option multiple choice', question: choice('Q90', 'ABCDEF', 'ACD'), answer: 'A、C、D', correct: ['A', 'C', 'D'] },
  { name: 'mini136 five-option multiple choice', question: choice('mini136', 'ABCDE', 'BE'), answer: 'B、E', correct: ['B', 'E'] },
  { name: 'single choice', question: { ...choice('single', 'ABCD', ''), type: 'single_choice', correctAnswer: 'B' }, answer: 'B', correct: ['B'] },
  { name: 'matching ignores stale A/B fallback', question: matching, answer: '1 → 乙；2 → 甲', correct: [] },
  { name: 'unset multiple choice has no invented answer', question: choice('unset', 'ABCDE', ''), answer: '未设置', correct: [] },
];

for (const surface of [
  { name: 'library', open: 'openLibraryQuestionPreview', content: 'qbLibraryQuestionPreviewContent', prefix: 'qb-library-preview' },
  { name: 'paper', open: 'openPaperQuestionPreview', content: 'qbQuestionPreviewContent', prefix: 'pm-preview' },
]) {
  for (const fixture of fixtures) {
    test(`${surface.name} preview displays full answer and canonical highlights: ${fixture.name}`, async () => {
      const { context, element } = previewContext(fixture.question);
      await context[surface.open](surface.name === 'library' ? fixture.question.id : `import-bank::${fixture.question.id}`);
      const html = element(surface.content).innerHTML;
      const answerHtml = html.match(new RegExp(`class="${surface.prefix}-answer">([\\s\\S]*?)</div>`))?.[1];
      assert.equal(answerHtml?.replace(/<[^>]*>/g, ''), fixture.answer);
      const highlighted = [...html.matchAll(new RegExp(`class="${surface.prefix}-option correct"><b>([^<]+)</b>`, 'g'))].map(match => match[1]);
      assert.deepEqual(highlighted, fixture.correct);
      const model = context.KGTeacherDomains.QuestionBank.QuestionPreview.viewModel(fixture.question);
      assert.deepEqual(Array.from(model.options.filter(option => option.correct), option => option.id), fixture.correct);
    });
  }
}
