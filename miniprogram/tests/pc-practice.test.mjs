import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createPracticeRun } from '../domain/pc-practice.ts';

const questions = Array.from({ length: 10 }, (_, i) => ({ questionId: `q${i}`, question: {
  id: `q${i}`, type: i === 1 ? 'multiple_choice' : 'single_choice',
  options: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], correctAnswer: 'A', correctOptionIds: ['A', 'C'],
} }));
const session = (mode = 'practice', runtimeState = {}) => ({ mode, questions, answers: {}, runtimeState });

test('local selections match PC locking, timeout and submission whitelist', () => {
  const context = vm.createContext({ window: {} });
  for (const file of ['117-question-answer-set.js', '114-practice-draft-state.js']) {
    vm.runInContext(readFileSync(new URL(`../../new-legacy/src/${file}`, import.meta.url), 'utf8'), context);
  }
  const pc = context.window.KGPracticeDraftState.create({ questions });
  const mini = createPracticeRun(session('scholar'));
  for (const [id, answer, timedOut] of [['q0', 'B', false], ['q0', 'A', false], ['q1', ['C', 'A'], false], ['q2', '', true]]) {
    assert.equal(mini.select(id, Array.isArray(answer) ? answer : [answer], timedOut), pc.select(id, answer, { timedOut }).accepted);
  }
  assert.deepEqual(mini.submission(), JSON.parse(JSON.stringify(pc.submission())));
  assert.equal(mini.stats().answered, 3);
  assert.equal(mini.stats().correct, 1);
  assert.equal(JSON.stringify(mini.submission()).includes('correct'), false);
});

test('challenge zero health fails but does not end before all questions are answered', () => {
  const run = createPracticeRun(session('challenge'));
  for (const id of ['q0', 'q2', 'q3']) run.select(id, ['B']);
  assert.equal(run.runtime().health, 0); assert.equal(run.shouldComplete(), false);
});

test('scholar adds capped time, subtracts time, resets depleted time and heals on five correct', () => {
  const run = createPracticeRun(session('scholar', { health: 2, remainingMs: 30000 }));
  run.select('q0', ['A']); assert.equal(run.runtime().remainingMs, 50000);
  run.select('q1', ['A', 'C']); assert.equal(run.runtime().remainingMs, 60000);
  for (const id of ['q2', 'q3', 'q4']) run.select(id, ['A']);
  assert.equal(run.runtime().health, 3); assert.equal(run.runtime().streak, 5);
  assert.equal(run.runtime().experience, 59);
  run.patchRuntime({ remainingMs: 10000 }); run.select('q5', ['B']);
  assert.equal(run.runtime().remainingMs, 40000); assert.equal(run.runtime().health, 2);
  assert.equal(run.runtime().streak, 0);
  run.select('q6', [], true); run.select('q7', [], true);
  assert.equal(run.shouldComplete(), true); assert.equal(run.runtime().health, 0);
});

test('restoring local locked answers preserves sequence without reapplying game rewards', () => {
  const source = session('scholar'); const run = createPracticeRun(source); run.select('q0', ['A']);
  const restored = createPracticeRun(source, { lockedAnswers: run.submission(), runtimeState: run.runtime() });
  assert.equal(restored.select('q0', ['B']), false);
  assert.equal(restored.runtime().experience, 10);
  restored.select('q1', ['A', 'C']); assert.equal(restored.submission().q1.selectionIndex, 2);
});

test('server internal runtime metadata never goes back in writable runtime', () => {
  const run = createPracticeRun(session('practice', { gradedAnswers: ['q1'], revengeState: { phase: 'old' }, durationMs: 1000 }));
  assert.equal(run.runtime().gradedAnswers, undefined);
  assert.equal(run.runtime().durationMs, 1000);
});
