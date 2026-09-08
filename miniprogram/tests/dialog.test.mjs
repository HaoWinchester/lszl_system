import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { loadModule, loadPage } from './helpers/page-harness.mjs';
import { getModePolicy } from '../domain/mode-policy.ts';

const modulePath = new URL('../domain/dialog.ts', import.meta.url);
async function controller(render = () => {}) {
  assert.ok(existsSync(modulePath), 'shared dialog controller must exist');
  const { createDialogController } = await import(modulePath);
  return createDialogController(render);
}

test('confirmation and cancellation settle only the matching request once', async () => {
  let view;
  const dialog = await controller(state => { view = state; });
  const first = dialog.open({ title: '退出登录', content: '确认退出？' });
  const oldId = view.id;
  dialog.settle(oldId, true);
  assert.deepEqual(await first, { confirm: true, cancel: false, dismissed: false });
  const second = dialog.open({ title: '结束练习' });
  dialog.settle(oldId, true);
  assert.equal(view.visible, true);
  dialog.settle(view.id, false);
  assert.deepEqual(await second, { confirm: false, cancel: true, dismissed: false });
  assert.equal(view.visible, false);
});

test('read-only notice cannot be cancelled and applies safe labels', async () => {
  let view;
  const dialog = await controller(state => { view = state; });
  const pending = dialog.open({ title: '隐私政策', showCancel: false });
  assert.equal(view.confirmText, '知道了');
  dialog.settle(view.id, false);
  assert.equal(view.visible, true);
  dialog.settle(view.id, true);
  assert.equal((await pending).confirm, true);
});

test('queued dialogs preserve messages and hiding dismisses all without choosing a business action', async () => {
  let view;
  const dialog = await controller(state => { view = state; });
  const first = dialog.open({ title: '第一条' });
  const second = dialog.open({ title: '第二条' });
  assert.equal(view.title, '第一条');
  dialog.settle(view.id, true);
  assert.equal((await first).confirm, true);
  assert.equal(view.title, '第二条');
  const third = dialog.open({ title: '第三条' });
  dialog.dismiss();
  for (const result of await Promise.all([second, third])) {
    assert.deepEqual(result, { confirm: false, cancel: false, dismissed: true });
  }
  assert.equal(view.visible, false);
  const reopened = dialog.open({ title: '再次打开' });
  assert.equal(view.title, '再次打开');
  dialog.settle(view.id, false);
  assert.equal((await reopened).cancel, true);
});

test('public entry selects only the visible page and fails closed without a host', async () => {
  assert.ok(existsSync(modulePath), 'shared dialog entry must exist');
  let pages = [];
  let notice = '';
  const { showDialog } = await loadModule('domain/dialog.ts', {
    getCurrentPages: () => pages,
    wx: { showToast: options => { notice = options.title; } },
  }, ['showDialog']);
  assert.equal((await showDialog({ title: '结束练习' })).dismissed, true);
  assert.ok(notice);
  let view;
  const dialog = await controller(state => { view = state; });
  pages = [{ selectComponent: () => { throw new Error('background page must not receive dialog'); } }, {
    selectComponent: selector => { assert.equal(selector, '#app-dialog'); return { show: options => dialog.open(options) }; },
  }];
  const result = showDialog({ title: '当前页面' });
  assert.equal(view.title, '当前页面');
  dialog.settle(view.id, true);
  assert.equal((await result).confirm, true);
});

test('profile removes the redundant refresh row but retains failed-sync recovery', () => {
  const markup = readFileSync(new URL('../pages/profile/index.wxml', import.meta.url), 'utf8');
  assert.doesNotMatch(markup, /刷新学习数据/);
  assert.match(markup, /bindtap="onRefresh">重新同步/);
});

test('dismissing the practice exit dialog never pauses or abandons a session', async () => {
  let writes = 0;
  let prompts = 0;
  const dismiss = async () => { prompts++; return { confirm: false, cancel: false, dismissed: true }; };
  const { page, navigation } = await loadPage('practice', {
    getModePolicy,
    showDialog: dismiss,
  }, { showModal: dismiss });
  page.data.loading = false;
  page.syncCoordinator = { pendingCount: () => 0, enqueueWrite: async () => { writes++; } };
  await page.onExit();
  assert.equal(writes, 0);
  assert.equal(navigation.length, 0);
  assert.equal(page.confirming, false);
  assert.equal(prompts, 1, 'page hide must not open a second destructive confirmation');
});

test('dialog blocks the separate custom tab layer and restores it on hide', async () => {
  const { createDialogController } = await import(modulePath);
  let component;
  const tabState = {};
  await loadModule('components/app-dialog/index.ts', {
    createDialogController,
    getCurrentPages: () => [{ getTabBar: () => ({ setData: value => Object.assign(tabState, value) }) }],
    Component: options => { component = options; },
  }, []);
  const instance = { data: { ...component.data }, ...component.methods, setData(value) { Object.assign(this.data, value); } };
  component.lifetimes.attached.call(instance);
  const pending = instance.show({ title: '退出登录' });
  assert.equal(tabState.dialogOpen, true);
  component.pageLifetimes.hide.call(instance);
  assert.equal((await pending).dismissed, true);
  assert.equal(tabState.dialogOpen, false);
});

test('logout cancel preserves the account; confirmation logs out and clears only its drafts', async () => {
  let confirm = false;
  let logouts = 0;
  const cleared = [];
  const { page, navigation } = await loadPage('profile', {
    showDialog: async () => ({ confirm, cancel: !confirm, dismissed: false }),
    getCurrentUser: () => ({ username: '学生' }),
    logout: async () => { logouts++; }, clearUserDrafts: username => cleared.push(username),
  });
  await page.onLogout();
  assert.equal(logouts, 0); assert.deepEqual(cleared, []); assert.deepEqual(navigation, []);
  confirm = true; await page.onLogout();
  assert.equal(logouts, 1); assert.deepEqual(cleared, ['学生']);
  assert.equal(navigation[0].url, '/pages/login/index');
});

test('rapid logout taps request only one confirmation and one logout', async () => {
  let finish;
  let prompts = 0;
  let logouts = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const { page } = await loadPage('profile', {
    showDialog: () => { prompts++; return pending; },
    getCurrentUser: () => ({ username: '学生' }),
    logout: async () => { logouts++; }, clearUserDrafts() {},
  });
  const attempts = [page.onLogout(), page.onLogout()];
  finish({ confirm: true, cancel: false, dismissed: false });
  await Promise.all(attempts);
  assert.equal(prompts, 1);
  assert.equal(logouts, 1);
});

test('all registered pages host the shared dialog and no business flow bypasses it', () => {
  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  assert.equal(app.usingComponents['app-dialog'], '/components/app-dialog/index');
  for (const page of app.pages) {
    const markup = readFileSync(new URL(`../${page}.wxml`, import.meta.url), 'utf8');
    assert.equal((markup.match(/<app-dialog id="app-dialog"/g) || []).length, 1, page);
    const script = readFileSync(new URL(`../${page}.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(script, /wx\.showModal\(/, page);
  }
});
