import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');

test('practice page composes question, answer sheet, and save state', () => {
  const wxml = read('pages/practice/index.wxml');
  assert.match(wxml, /question-view/);
  assert.match(wxml, /answer-sheet/);
  assert.match(wxml, /save-status/);
  for (const action of ['onMark', 'onPrevious', 'submitCurrent', 'onNext', 'onOpenSheet']) {
    assert.match(wxml, new RegExp(`bindtap="${action}"`));
  }
  assert.match(wxml, /bind:complete="onComplete"/);
});

test('question component is accessible, bilingual, image-aware, and touch sized', () => {
  const wxml = read('components/question-view/index.wxml');
  assert.match(wxml, /aria-label/);
  assert.match(wxml, /aria-checked/);
  assert.match(wxml, /stemEn/);
  assert.match(wxml, /previewImage/);
  assert.match(read('components/question-view/index.wxss'), /min-height:\s*122rpx/);
});

test('practice components avoid unsupported tag selectors', () => {
  const questionStyles = read('components/question-view/index.wxss');
  const sheetStyles = read('components/answer-sheet/index.wxss');
  assert.doesNotMatch(questionStyles, /\.question-kind text/);
  assert.doesNotMatch(sheetStyles, /\.sheet-head button|\.legend\s*>\s*view/);
});

test('practice markup never binds hidden scoring facts directly', () => {
  const wxml = `${read('pages/practice/index.wxml')}\n${read('components/question-view/index.wxml')}`;
  assert.doesNotMatch(wxml, /correctAnswer|correctOptionIds|option\.correct/);
});

test('saving has explicit saving, saved, offline, and conflict states', () => {
  const view = read('components/save-status/index.wxml');
  for (const label of ['正在保存', '已保存', '离线草稿', '进度冲突']) assert.match(view, new RegExp(label));
  const source = read('pages/practice/index.ts');
  assert.match(source, /saveLocalDraft/);
  assert.match(source, /REVISION_CONFLICT|PRACTICE_REVISION_CONFLICT/);
});

test('completion shows answered and unanswered counts before submission', () => {
  const source = read('pages/practice/index.ts');
  assert.match(source, /已答.*未答/);
  assert.match(source, /completeSession/);
  assert.match(source, /requestId/);
});
