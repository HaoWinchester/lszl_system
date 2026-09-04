import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');

test('profile exposes identity, legal links, and logout without payment', () => {
  const page = read('pages/profile/index.wxml');
  for (const label of ['学习数据', '隐私政策', '用户协议', '退出登录']) assert.match(page, new RegExp(label));
  const allSource = [
    read('pages/profile/index.wxml'), read('pages/profile/index.ts'), read('services/subscription.ts'),
  ].join('\n');
  assert.doesNotMatch(allSource, /requestPayment|支付开通/);
});

test('profile reads server-owned learning and access state', () => {
  const source = read('pages/profile/index.ts');
  for (const call of ['validateSession', 'getExperienceSummary', 'listSessions', 'getMySubscription']) {
    assert.match(source, new RegExp(call));
  }
  assert.match(source, /logout/);
  assert.match(source, /clearUserDrafts/);
});

test('native custom tab bar declares the three persistent primary pages', () => {
  const app = JSON.parse(read('app.json'));
  assert.equal(app.tabBar?.custom, true);
  assert.deepEqual(app.tabBar.list.map(item => item.pagePath), [
    'pages/home/index',
    'pages/history/index',
    'pages/profile/index',
  ]);
});

test('custom tab bar switches without relaunching page instances', () => {
  assert.ok(existsSync(join(root, 'custom-tab-bar/index.ts')));
  const source = read('custom-tab-bar/index.ts');
  assert.match(source, /wx\.switchTab/);
  assert.doesNotMatch(source, /wx\.reLaunch/);
});

test('primary pages delegate navigation to the native tab bar', () => {
  for (const page of ['home', 'history', 'profile']) {
    assert.doesNotMatch(read(`pages/${page}/index.wxml`), /bottom-nav/);
    assert.match(read(`pages/${page}/index.ts`), /selectPrimaryTab/);
  }
});

test('custom tab bar styles use component-safe class selectors', () => {
  assert.ok(existsSync(join(root, 'custom-tab-bar/index.wxss')));
  const styles = read('custom-tab-bar/index.wxss');
  assert.doesNotMatch(styles, /\.tab-bar button/);
  assert.doesNotMatch(styles, /\.home-icon view/);
});

test('custom tab bar keeps readable metadata and touch sizing', () => {
  assert.ok(existsSync(join(root, 'custom-tab-bar/index.wxss')));
  const styles = read('custom-tab-bar/index.wxss');
  assert.match(styles, /font-size:\s*var\(--font-meta\)/);
  assert.match(styles, /min-height:\s*var\(--touch-min\)/);
});

test('profile identity and rows share the approved scale', () => {
  const styles = read('pages/profile/index.wxss');
  assert.doesNotMatch(styles, /font-family/);
  assert.match(styles, /font-size:\s*var\(--font-display\)/);
  assert.match(styles, /min-height:\s*var\(--touch-min\)/);
});
