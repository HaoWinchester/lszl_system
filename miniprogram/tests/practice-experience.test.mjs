import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPage, loadModule } from './helpers/page-harness.mjs';
import { createPracticeRun } from '../domain/pc-practice.ts';
import { getModePolicy } from '../domain/mode-policy.ts';

test('next unanswered action navigates without creating a replacement session', async () => {
  const { page } = await loadPage('practice', { getModePolicy });
  page.data.session = { id:'s', mode:'practice', questions: ['a','b','c'].map(questionId => ({questionId,question:{id:questionId,type:'single_choice',options:[]}})), answers:{b:{selectedAnswer:'A'}}, runtimeState:{} };
  page.run = createPracticeRun(page.data.session);
  page.data.currentIndex = 1;
  let target = null;
  page.goTo = index => { target = index; };
  assert.equal(typeof page.onNextUnanswered, 'function');
  page.onNextUnanswered();
  assert.equal(target, 2);
  assert.equal(page.data.session.id, 's');
});

test('question feedback submits the frozen release references through the existing endpoint', async () => {
  const sent = [];
  const { reportQuestionContent } = await loadModule('services/question-feedback.ts', {
    showDialog: async () => ({confirm:true}), messageOf: e=>e.message,
    request: async input => sent.push(input),
  }, ['reportQuestionContent']);
  const result = await reportQuestionContent({questionId:'q',paperId:'p',releaseId:'r',sessionId:'s'}, true);
  assert.equal(result, true);
  assert.equal(sent[0].path, '/api/v1/engagement/feedback');
  assert.equal(sent[0].data.type, 'content');
  for (const marker of ['题目 ID：q','试卷 ID：p','发布版本 ID：r','练习 ID：s']) assert.ok(sent[0].data.detail.includes(marker));
});

test('canceled and failed feedback never displays success or discards retry context', async () => {
  const dialogs = []; let writes = 0; let confirm = false;
  const { reportQuestionContent } = await loadModule('services/question-feedback.ts', {
    showDialog: async input => { dialogs.push(input); return {confirm}; }, messageOf:e=>e.message,
    request: async () => { writes++; throw new Error('离线，请重试'); },
  }, ['reportQuestionContent']);
  const context = {questionId:'q',paperId:'p',releaseId:'r'};
  assert.equal(await reportQuestionContent(context, true), false); assert.equal(writes, 0);
  confirm = true;
  assert.equal(await reportQuestionContent(context, true), false); assert.equal(writes, 1);
  assert.equal(dialogs.at(-1).title, '反馈未提交');
  assert.equal(context.releaseId, 'r');
});
