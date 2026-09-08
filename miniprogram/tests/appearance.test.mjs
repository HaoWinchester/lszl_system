import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { loadModule, loadPage } from './helpers/page-harness.mjs';

async function appearance(stored = undefined) {
  assert.ok(existsSync(new URL('../domain/appearance.ts', import.meta.url)), 'appearance module must exist');
  let value = stored;
  let failWrite = false;
  const chrome = [];
  const wx = {
    getStorageSync: () => value,
    setStorageSync: (key, next) => { if (failWrite) throw new Error('storage full'); value = next; },
    setBackgroundColor: options => chrome.push(options),
    setNavigationBarColor: options => chrome.push(options),
    setBackgroundTextStyle() {},
  };
  const api = await loadModule('domain/appearance.ts', { wx }, ['THEMES', 'READING_SIZES', 'readAppearance', 'saveAppearance', 'subscribeAppearance', 'appearanceData', 'updateAppearanceChrome', 'resolveIconColor']);
  return { ...api, wx, chrome, stored: () => value, fail: () => { failWrite = true; } };
}

test('missing or corrupted device preferences use safe defaults, preserving valid fields', async () => {
  assert.deepEqual((await appearance()).readAppearance(), { theme: 'paper', readingSize: 'standard' });
  assert.deepEqual((await appearance({ theme: 'injected;color:red', readingSize: 'large' })).readAppearance(), { theme: 'paper', readingSize: 'large' });
  assert.deepEqual((await appearance('broken')).readAppearance(), { theme: 'paper', readingSize: 'standard' });
});

test('successful choices persist across restarts and notify mounted surfaces; failed writes do neither', async () => {
  const api = await appearance();
  const seen = [];
  const stop = api.subscribeAppearance(value => seen.push(value));
  api.saveAppearance({ theme: 'night', readingSize: 'large' });
  assert.deepEqual(api.stored(), { theme: 'night', readingSize: 'large' });
  assert.deepEqual((await appearance(api.stored())).readAppearance(), { theme: 'night', readingSize: 'large' });
  assert.equal(seen.length, 1);
  api.fail();
  assert.throws(() => api.saveAppearance({ theme: 'white', readingSize: 'standard' }), /storage full/);
  assert.equal(api.readAppearance().theme, 'night'); assert.equal(seen.length, 1);
  stop();
});

test('large reading changes stem, option and explanation sizes without scaling navigation', async () => {
  const api = await appearance();
  const value = api.appearanceData({ theme: 'white', readingSize: 'large' });
  assert.match(value.appearanceStyle, /--font-question:44rpx/);
  assert.match(value.appearanceStyle, /--font-option:39rpx/);
  assert.match(value.appearanceStyle, /--font-reading-body:38rpx/);
  assert.doesNotMatch(value.appearanceStyle, /--font-nav:|--font-heading:|--font-body:/);
  assert.equal(api.resolveIconColor('muted', { theme: 'night' }), '#adb9b1');
});

function luminance(hex) {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
test('all theme body, action and answer-state text meets 4.5:1 contrast', async () => {
  const { THEMES } = await appearance();
  assert.equal(THEMES.length, 3);
  for (const theme of THEMES) {
    for (const [fg, bg] of [['ink','paper'], ['text','surface'], ['muted','paper'], ['muted','surface'], ['muted','green-soft'], ['muted','surface-quiet'], ['ink','surface-quiet'], ['clay','paper'], ['on-accent','ink'], ['on-danger','danger'], ['text','danger-soft'], ['danger','danger-soft'], ['success','success-soft']]) {
      const a = luminance(theme.colors[fg]), b = luminance(theme.colors[bg]);
      assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05) >= 4.5, `${theme.id} ${fg}/${bg}`);
    }
  }
});

test('page decoration preserves business lifecycle and updates cached views without navigation', async () => {
  const api = await appearance();
  const { withAppearance } = await loadModule('domain/appearance-page.ts', api, ['withAppearance']);
  const calls = [];
  const tabState = {};
  const page = withAppearance({ data: { answers: ['B'] }, onLoad(query) { calls.push(query.id); }, onShow() { calls.push('show'); }, onUnload() { calls.push('unload'); } });
  page.setData = values => Object.assign(page.data, values);
  page.getTabBar = () => ({ setData: values => Object.assign(tabState, values) });
  page.onLoad({ id: 's1' }); page.onShow();
  api.saveAppearance({ theme: 'night', readingSize: 'large' });
  assert.equal(page.data.appearanceTheme, 'night'); assert.equal(tabState.appearanceTheme, 'night');
  assert.deepEqual(page.data.answers, ['B']);
  page.onUnload();
  api.saveAppearance({ theme: 'white', readingSize: 'standard' });
  assert.equal(page.data.appearanceTheme, 'night');
  assert.deepEqual(calls, ['s1','show','unload']);
});

test('profile exposes a real appearance route', async () => {
  const { page, navigation } = await loadPage('profile');
  assert.equal(typeof page.onAppearance, 'function');
  page.onAppearance(); assert.equal(navigation[0].url, '/pages/appearance/index');
});

test('appearance controls save valid changes and expose recoverable storage errors', async () => {
  assert.ok(existsSync(new URL('../pages/appearance/index.ts', import.meta.url)), 'appearance settings page must exist');
  const api = await appearance();
  const { page } = await loadPage('appearance', { ...api });
  page.onLoad();
  page.onSelectTheme({ currentTarget: { dataset: { id: 'night' } } });
  assert.equal(api.readAppearance().theme, 'night'); assert.match(page.data.saveMessage, /夜读灰/);
  assert.equal(page.data.appearanceTheme, 'night');
  page.onSelectSize({ currentTarget: { dataset: { id: 'large' } } });
  assert.equal(api.readAppearance().readingSize, 'large');
  assert.match(page.data.appearanceStyle, /--font-question:44rpx/);
  page.onSelectTheme({ currentTarget: { dataset: { id: 'unsupported' } } });
  assert.equal(api.readAppearance().theme, 'night');
  api.fail(); page.onSelectTheme({ currentTarget: { dataset: { id: 'white' } } });
  assert.equal(api.readAppearance().theme, 'night'); assert.match(page.data.saveError, /重试/);
  assert.equal(page.data.appearanceTheme, 'night');
  page.onUnload();
});

test('every page and its dialog bind the shared palette, including cached primary tabs', () => {
  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  assert.ok(app.pages.includes('pages/appearance/index'));
  for (const page of app.pages) {
    const markup = readFileSync(new URL(`../${page}.wxml`, import.meta.url), 'utf8');
    assert.match(markup.split('\n')[0], /style="\{\{appearanceStyle\}\}/, page);
    assert.match(markup, /<app-dialog[^>]+style="\{\{appearanceStyle\}\}"/, page);
    assert.match(readFileSync(new URL(`../${page}.ts`, import.meta.url), 'utf8'), /Page\(withAppearance\(/, page);
  }
  assert.match(readFileSync(new URL('../custom-tab-bar/index.wxml', import.meta.url), 'utf8'), /style="\{\{appearanceStyle\}\}"/);
});

for (const theme of ['paper', 'white', 'night']) {
  for (const [readingSize, questionSize] of [['standard', 36], ['comfortable', 40], ['large', 44]]) {
    test(`appearance ${theme}/${readingSize} survives re-entry and can be changed again`, async () => {
      const api = await appearance({ theme: 'night', readingSize: 'large' });
      const first = (await loadPage('appearance', api)).page;
      first.onLoad();
      first.onSelectTheme({ currentTarget: { dataset: { id: theme } } });
      first.onSelectSize({ currentTarget: { dataset: { id: readingSize } } });
      assert.equal(first.data.saveError, '');
      assert.equal(first.data.appearanceTheme, theme);
      assert.match(first.data.appearanceStyle, new RegExp(`--font-question:${questionSize}rpx`));
      assert.deepEqual(api.stored(), { theme, readingSize });
      first.onUnload();
      const second = (await loadPage('appearance', api)).page;
      second.onLoad(); second.onShow();
      assert.equal(second.data.appearanceTheme, theme);
      assert.equal(second.data.appearanceReadingSize, readingSize);
      const nextTheme = theme === 'white' ? 'night' : 'white';
      second.onSelectTheme({ currentTarget: { dataset: { id: nextTheme } } });
      assert.equal(second.data.appearanceTheme, nextTheme);
      assert.equal(second.data.appearanceReadingSize, readingSize);
      assert.equal(first.data.appearanceTheme, theme, 'unloaded page must not receive later updates');
      const restarted = await appearance(api.stored());
      assert.deepEqual(restarted.readAppearance(), { theme: nextTheme, readingSize });
      second.onUnload();
    });
  }
}

test('icon strokes update with the palette and unsubscribe on removal', async () => {
  const api = await appearance();
  let definition;
  await loadModule('components/ui-icon/index.ts', { ...api, Component: value => { definition = value; } }, []);
  const icon = { properties: { name: 'back', color: 'muted' }, data: {}, ...definition.methods,
    setData(value) { Object.assign(this.data, value); } };
  definition.lifetimes.attached.call(icon);
  assert.match(decodeURIComponent(icon.data.source), /stroke="#58685f"/);
  api.saveAppearance({ theme: 'night', readingSize: 'standard' });
  assert.match(decodeURIComponent(icon.data.source), /stroke="#adb9b1"/);
  definition.lifetimes.detached.call(icon);
  api.saveAppearance({ theme: 'white', readingSize: 'standard' });
  assert.match(decodeURIComponent(icon.data.source), /stroke="#adb9b1"/);
});

test('practice and report overlays inherit the selected theme outside the page shell', () => {
  const practice = readFileSync(new URL('../pages/practice/index.wxml', import.meta.url), 'utf8');
  const result = readFileSync(new URL('../pages/result/index.wxml', import.meta.url), 'utf8');
  assert.match(practice, /<answer-sheet[^>]*style="\{\{appearanceStyle\}\}"/);
  assert.match(result, /<view[^>]*class="review-mask"[^>]*style="\{\{appearanceStyle\}\}"/);
});

test('directly opened appearance preview has a working return path', async () => {
  const { wx: platform, ...api } = await appearance();
  const { page, navigation } = await loadPage('appearance', api, { navigateBack: options => options?.fail?.() });
  page.onBack();
  assert.equal(navigation[0]?.url, '/pages/profile/index');
});
