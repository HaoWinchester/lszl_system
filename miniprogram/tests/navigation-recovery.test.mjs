import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPage, loadModule } from './helpers/page-harness.mjs';
import { MODE_POLICIES } from '../domain/mode-policy.ts';
import { PRIMARY_TABS } from '../domain/primary-tabs.ts';

test('home navigation failure gives feedback and allows another attempt', async () => {
  const notices = []; let attempts = 0;
  const { page } = await loadPage('home', { MODE_POLICIES }, {
    navigateTo: options => { attempts++; options.fail?.({ errMsg: 'navigateTo:fail webview count limit exceed' }); },
    showToast: value => notices.push(value.title),
  });
  page.onBrowsePapers(); page.onBrowsePapers();
  assert.equal(attempts, 2);
  assert.equal(notices.length, 2);
  assert.ok(notices.every(title => /返回|重试/.test(title)));
});

for (const [name, destination] of [['papers', '/pages/home/index'], ['practice-setup', '/pages/home/index'], ['membership', '/pages/profile/index']]) {
  test(`${name}: a directly opened page can return even without a previous page`, async () => {
    const { page, navigation } = await loadPage(name, { MODE_CHOICES: [] }, {
      navigateBack: options => options?.fail?.({ errMsg: 'navigateBack:fail cannot navigate back at first page' }),
    });
    page.onBack();
    assert.equal(navigation.at(-1)?.url, destination);
  });
}

test('created practice remains resumable and start unlocks when opening the page fails', async () => {
  const { page } = await loadPage('practice-setup', {
    MODE_CHOICES: [], ApiError: class extends Error {}, messageOf: e => e.message,
    startSession: async () => ({ id: 'created-session' }),
  }, { redirectTo: options => options.fail?.({ errMsg: 'redirectTo:fail page is not ready' }) });
  await page.start();
  assert.equal(page.data.starting, false);
  assert.equal(page.data.existingSessionId, 'created-session');
  assert.ok(page.data.error, 'failure must remain visible and actionable');
});

test('resume navigation failure releases the start guard without discarding the saved session', async () => {
  const { page } = await loadPage('practice-setup', { MODE_CHOICES: [] }, {
    redirectTo: options => options.fail?.({ errMsg: 'redirectTo:fail page is not ready' }),
  });
  page.data.starting = true;
  await page.resolveExistingSession({ detail: { detail: { sessionId: 'saved-session' } } });
  assert.equal(page.data.starting, false);
  assert.equal(page.data.existingSessionId, 'saved-session');
  assert.ok(page.data.error);
});

test('authenticated login releases the submit guard if opening home fails', async () => {
  const { page } = await loadPage('login', {
    loginWithWechat: async () => ({ status: 'authenticated' }), messageOf: e => e.message,
  }, { reLaunch: options => options.fail?.({ errMsg: 'reLaunch:fail page is not ready' }) });
  page.data.accepted = true;
  await page.onWechatLogin();
  assert.equal(page.data.submitting, false);
  assert.ok(page.data.error);
});

test('binding success followed by navigation failure retries home, not the consumed binding ticket', async () => {
  let binds = 0, opens = 0;
  const { page } = await loadPage('login', {
    bindExistingAccount: async () => { binds++; }, messageOf: e => e.message,
  }, { reLaunch: options => { opens++; if (opens === 1) options.fail?.({ errMsg: 'reLaunch:fail' }); else options.success?.(); } });
  Object.assign(page.data, { accepted: true, stage: 'binding', username: 'student', password: 'test-only', bindingTicket: 'one-use' });
  await page.onSubmitAccount(); await page.onSubmitAccount();
  assert.equal(opens, 2); assert.equal(binds, 1);
});

test('retrying a created practice opens its retained ID without creating a duplicate', async () => {
  let creates = 0, opens = [];
  const { page } = await loadPage('practice-setup', {
    MODE_CHOICES: [], ApiError: class extends Error {}, messageOf: e => e.message,
    startSession: async () => { creates++; return { id: 'retained' }; },
  }, { redirectTo: options => { opens.push(options.url); if (opens.length === 1) options.fail?.({ errMsg: 'redirectTo:fail' }); } });
  await page.start(); await page.start();
  assert.equal(creates, 1); assert.equal(opens.length, 2);
  assert.ok(opens.every(url => url.endsWith('sessionId=retained')));
});

test('failed tab switching restores selection, provides feedback and can be retried', async () => {
  let definition, attempts = 0; const notices = [];
  const wx = { showToast: value => notices.push(value.title), switchTab: options => {
    attempts++;
    if (attempts === 1) options.fail?.({ errMsg: 'switchTab:fail' });
    else options.success?.();
    options.complete?.();
  } };
  const routing = await loadModule('domain/navigation.ts', { wx }, ['navigation']);
  await loadModule('custom-tab-bar/index.ts', { ...routing, wx, PRIMARY_TABS,
    appearanceData: () => ({}), Component: value => { definition = value; },
  }, []);
  const tab = { ...definition.methods, data: { ...definition.data }, setData: function(value) { Object.assign(this.data, value); } };
  const event = { currentTarget: { dataset: { index: 1 } } };
  tab.switchTab(event);
  assert.equal(tab.data.selected, 0); assert.equal(tab.data.switching, false); assert.equal(notices.length, 1);
  tab.switchTab(event);
  assert.equal(tab.data.selected, 1); assert.equal(tab.data.switching, false); assert.equal(attempts, 2);
});

test('logout navigation failure can reopen login without another logout or draft deletion', async () => {
  let logouts = 0, deletes = 0, opens = 0;
  const { page } = await loadPage('profile', {
    getCurrentUser: () => ({ username: 'student' }), logout: async () => { logouts++; },
    clearUserDrafts: () => { deletes++; },
  }, { reLaunch: options => { opens++; if (opens === 1) options.fail?.({ errMsg: 'reLaunch:fail' }); else options.success?.(); } });
  await page.onLogout();
  assert.equal(page.data.loggingOut, false);
  assert.equal(page.data.loggedOut, true);
  assert.ok(page.data.error);
  await page.onLogout();
  assert.equal(opens, 2); assert.equal(logouts, 1); assert.equal(deletes, 1);
});
