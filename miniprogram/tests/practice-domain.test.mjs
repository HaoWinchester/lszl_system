import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeDraft, moveQuestion, toggleAnswer } from '../domain/practice-state.ts';
import { sanitizeRichText } from '../domain/rich-text.ts';

test('single choice replaces the previous option', () => {
  assert.deepEqual(toggleAnswer(['A'], 'B', false), ['B']);
});

test('multiple choice toggles without duplicates', () => {
  assert.deepEqual(toggleAnswer(['A'], 'B', true), ['A', 'B']);
  assert.deepEqual(toggleAnswer(['A', 'B'], 'A', true), ['B']);
  assert.deepEqual(toggleAnswer(['B', 'B'], 'B', true), []);
});

test('question navigation clamps to the available range', () => {
  assert.equal(moveQuestion(0, 10, -1), 0);
  assert.equal(moveQuestion(4, 10, 1), 5);
  assert.equal(moveQuestion(9, 10, 1), 9);
  assert.equal(moveQuestion(0, 0, 1), 0);
});

test('newer server revision wins and reports a conflict', () => {
  const result = mergeDraft(
    { sessionId: 's', username: 'u', revision: 5, currentIndex: 0, answers: {}, markedQuestionIds: [], savedAt: 5 },
    { sessionId: 's', username: 'u', revision: 4, currentIndex: 1, answers: { q1: ['A'] }, markedQuestionIds: [], savedAt: 4 },
  );
  assert.equal(result.conflict, true);
  assert.equal(result.state.revision, 5);
});

test('a newer local draft remains pending without pretending it is saved', () => {
  const result = mergeDraft(
    { sessionId: 's', username: 'u', revision: 2, currentIndex: 0, answers: {}, markedQuestionIds: [], savedAt: 2 },
    { sessionId: 's', username: 'u', revision: 3, currentIndex: 1, answers: { q1: ['C'] }, markedQuestionIds: ['q1'], savedAt: 3 },
  );
  assert.equal(result.conflict, false);
  assert.equal(result.pendingLocal, true);
  assert.deepEqual(result.state.answers, { q1: ['C'] });
});

test('rich text removes scripts, event handlers, and unsafe images', () => {
  assert.deepEqual(
    sanitizeRichText([
      { name: 'script', children: [{ type: 'text', text: 'bad' }] },
      { name: 'p', attrs: { onclick: 'bad', class: 'lead' }, children: [{ type: 'text', text: '题干' }] },
      { name: 'img', attrs: { src: 'http://unsafe.example/a.png' } },
      { name: 'img', attrs: { src: 'https://safe.example/a.png', alt: '题图' } },
    ]),
    [
      { name: 'p', attrs: { class: 'lead' }, children: [{ type: 'text', text: '题干' }] },
      { name: 'img', attrs: { src: 'https://safe.example/a.png', alt: '题图' }, children: [] },
    ],
  );
});
