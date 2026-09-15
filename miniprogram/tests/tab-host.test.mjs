import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/page-harness.mjs';

test('switching primary tabs on the mounted host never invokes a native page route', async () => {
  const selected = [], routes = [];
  const host = { route: 'pages/tabs/index', switchPrimaryTab: index => selected.push(index) };
  const wx = Object.fromEntries(['switchTab', 'navigateTo', 'redirectTo', 'reLaunch', 'navigateBack'].map(method => [method, options => routes.push([method, options])]));
  const { navigation } = await loadModule('domain/navigation.ts', { wx, getCurrentPages: () => [host] }, ['navigation']);
  let successes = 0;
  navigation.switchTab({ url: '/pages/growth/index', success: () => successes++ });
  navigation.switchTab({ url: '/pages/papers/index', success: () => successes++ });
  assert.deepEqual(routes, []);
  assert.deepEqual(selected, [2, 1]);
  assert.equal(successes, 2);
});

test('mounted panels initialize once, preserve drafts and refresh only while visible', async () => {
  const { withPrimaryPanel } = await loadModule('domain/primary-panel.ts', { navigation: {} }, ['withPrimaryPanel']);
  let loads = 0, shows = 0, hides = 0, unloads = 0;
  const definition = withPrimaryPanel('papers', {
    fetching: false, data: { search: '' },
    onLoad() { loads++; assert.equal(this.fetching, false); },
    onShow() { shows++; }, onHide() { hides++; }, onUnload() { unloads++; },
  });
  const panel = { properties: { active: false }, data: { ...definition.data }, ...definition.methods };
  const select = active => { panel.properties.active = active; definition.observers.active.call(panel, active); };
  definition.lifetimes.attached.call(panel);
  assert.equal(loads, 0);
  assert.ok(Object.values(definition.methods).every(value => typeof value === 'function'));
  select(true); definition.pageLifetimes.show.call(panel);
  assert.equal(loads, 1); assert.equal(shows, 1);
  panel.data.search = 'PMP';
  select(false); select(true);
  assert.equal(loads, 1); assert.equal(shows, 2); assert.equal(panel.data.search, 'PMP');
  definition.pageLifetimes.hide.call(panel);
  select(false); select(true);
  assert.equal(shows, 2, 'hidden host must not start another visible-panel refresh');
  definition.pageLifetimes.show.call(panel);
  assert.equal(shows, 3);
  definition.lifetimes.detached.call(panel);
  assert.equal(unloads, 1); assert.equal(hides, 3);
});

test('returning from secondary pages reuses the host and rolls selection back on failure', async () => {
  const host = { route: 'pages/tabs/index', data: { activeTab: 1 }, switchPrimaryTab(index) { this.data.activeTab = index; } };
  let back, failures = 0, completes = 0;
  const { navigation } = await loadModule('domain/navigation.ts', {
    getCurrentPages: () => [host, { route: 'pages/practice-setup/index' }, { route: 'pages/practice/index' }],
    wx: { navigateBack: options => { back = options; } },
  }, ['navigation']);
  navigation.switchTab({ url: '/pages/home/index', fail: () => failures++, complete: () => completes++ });
  assert.equal(back.delta, 2); assert.equal(host.data.activeTab, 0);
  back.fail(new Error('native route unavailable')); back.complete();
  assert.equal(host.data.activeTab, 1); assert.equal(failures, 1); assert.equal(completes, 1);
  navigation.switchTab({ url: '/pages/growth/index' });
  assert.equal(host.data.activeTab, 2); assert.equal(back.delta, 2);
});

test('fresh login recreates the tab host instead of retaining another account panels', async () => {
  let launched;
  const { navigation } = await loadModule('domain/navigation.ts', {
    getCurrentPages: () => [{ route: 'pages/tabs/index', switchPrimaryTab() { assert.fail('must replace account state'); } }],
    wx: { reLaunch: options => { launched = options.url; } },
  }, ['navigation']);
  navigation.reLaunch({ url: '/pages/home/index' });
  assert.equal(launched, '/pages/tabs/index?tab=home');
});

test('host retains scroll per tab and delegates refresh and pagination only to active panel', async () => {
  const { loadPage } = await import('./helpers/page-harness.mjs');
  const scrolls = [], refreshes = [], bottom = [], tabState = {};
  const { page } = await loadPage('tabs', {}, { pageScrollTo: options => { scrolls.push(options); options.complete?.(); } });
  page.selectComponent = id => id === '#primary-tab-bar' ? { setData: values => Object.assign(tabState, values) }
    : { onPullDownRefresh: () => refreshes.push(id), onReachBottom: () => bottom.push(id) };
  page.onLoad({});
  page.onPageScroll({ scrollTop: 170 });
  page.switchPrimaryTab(1); page.onPageScroll({ scrollTop: 420 });
  page.switchPrimaryTab(2); page.switchPrimaryTab(1);
  assert.equal(page.data.activeTab, 1); assert.equal(tabState.selected, 1);
  assert.equal(scrolls.at(-1).scrollTop, 420); assert.equal(scrolls.at(-1).duration, 0);
  page.onPullDownRefresh(); page.onReachBottom();
  assert.deepEqual(refreshes, ['#panel-1']); assert.deepEqual(bottom, ['#panel-1']);
  page.switchPrimaryTab(0); assert.equal(scrolls.at(-1).scrollTop, 170);
  page.switchPrimaryTab(99); assert.equal(page.data.activeTab, 0);
});


test('hidden host defers scroll restoration until shown and ignores obsolete render callbacks', async () => {
  const { loadPage } = await import('./helpers/page-harness.mjs');
  const scrolls = [], renders = [];
  const { page } = await loadPage('tabs', {}, { pageScrollTo: options => scrolls.push(options) });
  page.selectComponent = () => null;
  page.onLoad({});
  page.onPageScroll({ scrollTop: 320 });
  page.onHide();
  page.switchPrimaryTab(1);
  assert.equal(scrolls.length, 0, 'must not scroll the secondary page');
  page.onPageScroll({ scrollTop: 0 });
  page.onShow();
  assert.equal(scrolls.at(-1).scrollTop, 0);
  scrolls.at(-1).complete();
  page.setData = (values, callback) => { Object.assign(page.data, values); if (callback) renders.push(callback); };
  page.switchPrimaryTab(0);
  page.onPageScroll({ scrollTop: 0 });
  page.switchPrimaryTab(2);
  renders.shift()();
  assert.equal(scrolls.length, 1, 'stale render must not move the newly selected tab');
  renders.shift()();
  page.onPageScroll({ scrollTop: 25 });
  assert.equal(page.scrollPositions[0], 320, 'layout clamping must not overwrite the saved offset');
  scrolls.at(-1).complete();
  page.switchPrimaryTab(0); renders.shift()();
  assert.equal(scrolls.at(-1).scrollTop, 320);
});
