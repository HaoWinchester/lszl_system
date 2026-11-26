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

test('question language toggle cycles three modes with a persisted shared preference', async () => {
  const storage = new Map();
  const wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value) };
  const { loadModule } = await import('./helpers/page-harness.mjs');
  const language = await loadModule('domain/question-language.ts', { wx },
    ['normalizeLanguageMode', 'getLanguageMode', 'setLanguageMode', 'cycleLanguageMode', 'languageLabel']);
  assert.equal(language.getLanguageMode(), 'zh');
  assert.equal(language.normalizeLanguageMode('weird'), 'zh');
  assert.deepEqual([language.cycleLanguageMode('zh'), language.cycleLanguageMode('en'), language.cycleLanguageMode('bilingual')], ['en', 'bilingual', 'zh']);
  assert.equal(language.setLanguageMode('bilingual'), 'bilingual');
  assert.equal(language.getLanguageMode(), 'bilingual');
  assert.deepEqual([language.languageLabel('zh'), language.languageLabel('en'), language.languageLabel('bilingual')], ['中', 'EN', '双']);
});

test('question component renders stem, options, and analysis following the language mode', async () => {
  const { loadModule } = await import('./helpers/page-harness.mjs');
  const { sanitizeRichText } = await import('../domain/rich-text.ts');
  const wx = { getStorageSync: () => '', setStorageSync: () => {} };
  let definition;
  await loadModule('components/question-view/index.ts', { wx, sanitizeRichText, Component: value => { definition = value; } }, []);
  const component = { properties: {}, data: { languageMode: 'zh', questionKey: '' },
    setData(values) { Object.assign(this.data, values); }, triggerEvent() {}, loadAssets() {} };
  const question = { id: 'q1', type: 'single_choice', stem: '中文题干', stemNodes: [{ type: 'text', text: '中文题干' }],
    stemEn: 'English stem', analysis: '中文解析', analysisEn: 'English analysis',
    options: [{ id: 'A', text: '中文A', textEn: 'English A' }, { id: 'B', text: '中文B' }] };
  const call = () => definition.methods.computeView.call(component, question, [], false, false, {});

  call();
  assert.equal(component.data.languageHasEnglish, true);
  assert.equal(component.data.displayOptions[0].text, '中文A');
  assert.equal(component.data.displayOptions[0].textEn, '');
  assert.equal(component.data.analysisMain, '中文解析');
  assert.equal(component.data.analysisEnNote, '');
  assert.deepEqual(component.data.stemEnNodes, []);

  component.data.languageMode = 'en';
  call();
  assert.equal(component.data.displayOptions[0].text, 'English A');
  assert.equal(component.data.displayOptions[0].textEn, '');
  assert.ok(component.data.stemEnNodes.length > 0);
  assert.equal(component.data.analysisMain, 'English analysis');

  component.data.languageMode = 'bilingual';
  call();
  assert.equal(component.data.displayOptions[0].text, '中文A');
  assert.equal(component.data.displayOptions[0].textEn, 'English A');
  assert.equal(component.data.analysisMain, '中文解析');
  assert.equal(component.data.analysisEnNote, 'English analysis');

  definition.methods.computeView.call(component, { id: 'q2', type: 'single_choice', stem: '只有中文', stemNodes: [], options: [{ id: 'A', text: '甲' }] }, [], false, false, {});
  assert.equal(component.data.languageHasEnglish, false);
});

test('question markup wires the language toggle to the shared mode module', () => {
  const wxml = read('components/question-view/index.wxml');
  const source = read('components/question-view/index.ts');
  assert.match(wxml, /class="language-toggle"[\s\S]*?bindtap="onLanguageToggle"/);
  assert.match(wxml, /wx:if="\{\{languageMode === 'bilingual' && displayQuestion\.stemEn\}\}"/);
  assert.match(wxml, /nodes="\{\{stemEnNodes\}\}"/);
  assert.match(wxml, /\{\{analysisMain\}\}/);
  assert.match(wxml, /\{\{analysisEnNote\}\}/);
  assert.match(source, /onLanguageToggle\(\)/);
  assert.match(read('domain/question-language.ts'), /kg_mini_language_mode/);
});
