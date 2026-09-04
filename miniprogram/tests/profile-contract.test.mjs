import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('shared bottom navigation connects home, history, and profile', () => {
  const app = JSON.parse(read('app.json'));
  assert.ok(app.pages.includes('pages/profile/index'));
  const nav = read('components/bottom-nav/index.wxml');
  for (const label of ['首页', '记录', '我的']) assert.match(nav, new RegExp(label));
  for (const page of ['home', 'history', 'profile']) {
    assert.match(read(`pages/${page}/index.wxml`), /bottom-nav/);
  }
});

test('bottom navigation component styles use class selectors only', () => {
  const styles = read('components/bottom-nav/index.wxss');
  assert.doesNotMatch(styles, /\.bottom-nav button/);
  assert.doesNotMatch(styles, /\.home-icon view/);
});

test('bottom navigation uses readable shared metadata sizing', () => {
  const styles = read('components/bottom-nav/index.wxss');
  assert.match(styles, /font-size:\s*var\(--font-meta\)/);
  assert.match(styles, /min-height:\s*var\(--touch-min\)/);
});

test('profile identity and rows share the approved scale', () => {
  const styles = read('pages/profile/index.wxss');
  assert.doesNotMatch(styles, /font-family/);
  assert.match(styles, /font-size:\s*var\(--font-display\)/);
  assert.match(styles, /min-height:\s*var\(--touch-min\)/);
});
