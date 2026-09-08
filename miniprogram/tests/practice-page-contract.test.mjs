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
  for (const action of ['onMark', 'onPrevious', 'onNext', 'onOpenSheet']) {
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
  assert.match(read('components/question-view/index.wxss'), /min-height:\s*var\(--option-min\)/);
});

test('question component uses the shared reading scale', () => {
  const styles = read('components/question-view/index.wxss');
  assert.match(styles, /font-size:\s*var\(--font-question\)/);
  assert.match(styles, /font-size:\s*var\(--font-option\)/);
  assert.match(styles, /min-height:\s*var\(--option-min\)/);
  assert.match(styles, /padding:\s*var\(--space-3\)/);
  assert.match(styles, /\.options\s+\.option\s*\{[^}]*width:\s*100%;[^}]*margin:\s*0;/s);
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

test('completion is wired to the shared session API', () => {
  const source = read('pages/practice/index.ts');
  assert.match(source, /completeSession/);
  assert.match(source, /requestId/);
});

test('practice action dock shares the page gutter and touch size', () => {
  const styles = read('pages/practice/index.wxss');
  assert.match(styles, /padding:\s*var\(--space-3\) var\(--page-gutter\)/);
  assert.match(styles, /min-height:\s*var\(--touch-min\)/);
});

test('answer sheet is a labeled bottom action before previous and next, not a top navigation action', () => {
  const wxml = read('pages/practice/index.wxml');
  const navigation = wxml.slice(wxml.indexOf('class="practice-nav"'), wxml.indexOf('class="progress-track"'));
  const dock = wxml.slice(wxml.indexOf('class="answer-actions"'));
  assert.doesNotMatch(navigation, /bindtap="onOpenSheet"/);
  const controls = [...dock.matchAll(/<button\b[^>]*bindtap="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.deepEqual(controls.map(match => match[1]), ['onOpenSheet', 'onPrevious', 'onNext']);
  assert.match(controls[0][2], /<text>答题卡<\/text>/);
  assert.match(controls[0][2], /<ui-icon\b/);
});

test('practice header labels stay on one line at phone widths', () => {
  const styles = read('pages/practice/index.wxss');
  assert.match(styles, /\.progress-copy\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(styles, /\.progress-mode\s*\{[^}]*flex-shrink:\s*0;/s);
});

test('answer visibility and marking share the metadata row without a standalone settings row', () => {
  const wxml = read('pages/practice/index.wxml');
  const meta = wxml.slice(wxml.indexOf('class="practice-meta"'), wxml.indexOf('<view wx:if="{{draftError}}"'));
  assert.match(meta, /bindchange="onShowAnswers"/);
  assert.match(meta, /bindtap="onMark"/);
  assert.ok(meta.indexOf('save-status') < meta.indexOf('bindchange="onShowAnswers"'));
  assert.ok(meta.indexOf('bindchange="onShowAnswers"') < meta.indexOf('bindtap="onMark"'));
  assert.match(meta, /wx:if="\{\{session.mode === 'practice'\}\}"/);
  assert.doesNotMatch(wxml, /class="practice-settings"/);
  assert.equal([...wxml.matchAll(/bindchange="onShowAnswers"/g)].length, 1);
});

test('local draft status is quiet without hiding synchronization or storage failure states', () => {
  const wxml = read('pages/practice/index.wxml');
  const saveStatus = wxml.match(/<save-status\b[^>]*\/>/)?.[0];
  const condition = saveStatus?.match(/wx:if="\{\{([^}]+)\}\}"/)?.[1];
  assert.ok(condition, 'the status component needs a visibility condition for local-only saves');
  const visible = new Function('saveState', `return (${condition});`);
  for (const [state, expected] of [
    ['local', false], ['saving', true], ['saved', true],
    ['memory', true], ['offline', true], ['conflict', true],
  ]) assert.equal(visible(state), expected, state);
});

test('metadata actions fill the available row instead of leaving a hidden-status-sized blank', () => {
  const styles = read('pages/practice/index.wxss');
  const actions = styles.match(/\.practice-meta-actions\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(actions, /flex:\s*1;/);
  assert.match(actions, /justify-content:\s*space-between;/);
  assert.doesNotMatch(actions, /margin-left:\s*auto;/);
});

test('answer switch has compact visual bounds while its label retains the shared touch height', () => {
  const styles = read('pages/practice/index.wxss');
  const wxml = read('pages/practice/index.wxml');
  assert.match(wxml, /class="setting-switch-slot"><switch class="setting-switch"[^>]*bindchange="onShowAnswers"/);
  assert.match(styles, /\.setting-switch-slot\s*\{[^}]*width:\s*38px;[^}]*height:\s*24px;/);
  assert.match(styles, /\.setting-switch\s*\{[^}]*scale\(0\.7\)/);
  assert.match(styles, /\.setting-toggle\s*\{[^}]*min-height:\s*var\(--touch-min\)/);
});
