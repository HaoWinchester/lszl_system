import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadModule, loadPage } from './helpers/page-harness.mjs';
import { MODE_POLICIES } from '../domain/mode-policy.ts';

const access = (planId, expiresAt, entitled = true, status = 'active') => ({ subscription: { planId, expiresAt, status }, entitlements: { allExamPapers: entitled } });
const view = () => loadModule('domain/subscription-view.ts', {}, ['subscriptionView']);

test('paused membership retains expiry and explains its unavailable entitlement', async () => {
  const { subscriptionView } = await view();
  const paused = subscriptionView('student', access('monthly', '2030-09-05T16:30:00Z', false, 'paused'));
  assert.equal(paused.statusLabel, '已暂停');
  assert.equal(paused.expiryLabel, '2030.09.06 00:30');
  assert.match(paused.description, /暂停/);
});

test('profile exposes membership expiry independently from descriptive copy', async () => {
  const { page } = await loadPage('profile', { ...await view(), validateSession: async () => ({ username: 'u', role: 'student' }),
    getExperienceSummary: async () => ({}), listSessions: async () => [], avatarLetterOf: () => 'U', messageOf: e => e.message,
    getMySubscription: async () => access('monthly', '2030-09-05T16:30:00Z') });
  await page.loadProfile();
  assert.equal(page.data.membership?.expiryLabel, '2030.09.06 00:30');
});

test('membership dates use China time and expired accounts retain the expiry', async () => {
  const { subscriptionView } = await view();
  const expired = subscriptionView('student', access('monthly', '2020-09-05T16:30:00', false));
  assert.equal(expired.statusLabel, '已到期'); assert.equal(expired.expiryLabel, '2020.09.06 00:30');
  assert.equal(subscriptionView('student', access('monthly', '2030-09-05T16:30:00Z')).statusLabel, '生效中');
});

test('free, lifetime, privileged and missing data are distinct', async () => {
  const { subscriptionView } = await view();
  assert.equal(subscriptionView('student', access('free', null, false)).statusLabel, '未开通');
  assert.equal(subscriptionView('student', access('lifetime', null)).expiryLabel, '长期有效');
  assert.equal(subscriptionView('admin', access('free', null, true)).title, '教学账号');
  assert.equal(subscriptionView('admin', access('free', null, true)).expiryLabel, '不受会员期限限制');
  assert.equal(subscriptionView('student', access('monthly', null, false)).expiryLabel, '待确认');
  assert.equal(subscriptionView('student').statusLabel, '待确认');
});

test('disabled or malformed subscriptions never display an active membership', async () => {
  const { subscriptionView } = await view();
  assert.equal(subscriptionView('student', access('monthly', '2030-01-01', false, 'disabled')).statusLabel, '已停用');
  assert.equal(subscriptionView('student', access('monthly', 'invalid', false)).statusLabel, '待确认');
  assert.equal(subscriptionView('viewer', access('lifetime', null, false)).statusLabel, '访客权限');
});

test('membership surfaces contain status and expiry but no purchase or external payment prompts', () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const membership = read('pages/membership/index.wxml');
  assert.match(membership, /membership.statusLabel/);
  assert.match(membership, /membership.expiryLabel/);
  const surfaces = membership + read('pages/profile/index.wxml') + read('domain/membership-navigation.ts') + read('domain/subscription-view.ts');
  assert.doesNotMatch(surfaces, /选择会员套餐|查看套餐|套餐金额|支付|购买|续费|会员可解锁|priceLabel|onSelectPlan/);
});

test('membership reads only current account rights without depending on a sales catalog', async () => {
  const helpers = await view();
  const requests = [];
  const service = await loadModule('services/subscription.ts', { request: async input => {
    requests.push(input);
    if(input.path !== '/api/v1/subscriptions/me') throw new Error('sales catalog must not be requested');
    return access('monthly', '2030-09-05T16:30:00Z');
  } }, ['getMySubscription']);
  const { page, navigation } = await loadPage('membership', { ...helpers, ...service, getCurrentUser: () => ({ username: 'u', role: 'student' }), messageOf: e => e.message });
  await page.loadMembership();
  assert.equal(page.data.error, '');
  assert.equal(page.data.membership.statusLabel, '生效中');
  assert.equal(page.data.membership.expiryLabel, '2030.09.06 00:30');
  assert.deepEqual(requests.map(item => item.path), ['/api/v1/subscriptions/me']);
  assert.ok(requests.every(item => !item.method || item.method === 'GET'));
  page.onBack(); assert.equal(navigation.length, 1);
});

test('membership network failure is recoverable and does not replace status with free', async () => {
  const helpers = await view(); let failed = true;
  const { page } = await loadPage('membership', { ...helpers, getCurrentUser: () => ({ username: 'u', role: 'student' }), messageOf: e => e.message,
    getMySubscription: async () => { if (failed) throw new Error('offline'); return access('lifetime', null); } });
  await page.loadMembership(); assert.equal(page.data.error, 'offline'); assert.equal(page.data.loading, false);
  failed = false; await page.loadMembership();
  assert.equal(page.data.error, ''); assert.equal(page.data.membership.expiryLabel, '长期有效');
});

test('free accounts display current access without an upsell', async () => {
  const { page } = await loadPage('membership', { ...await view(), getCurrentUser: () => ({ username: 'u', role: 'student' }), messageOf: e => e.message,
    getMySubscription: async () => access('free', null, false) });
  await page.loadMembership();
  assert.equal(page.data.error, '');
  assert.equal(page.data.membership.statusLabel, '未开通');
  assert.equal(page.data.membership.description, '当前账号可练习免费试卷，学习记录正常保留。');
});

test('membership requires login before requesting personal or plan data', async () => {
  let requests = 0;
  const { page, navigation } = await loadPage('membership', { getCurrentUser: () => null, getMySubscription: async () => { requests++; }, listSubscriptionPlans: async () => { requests++; } });
  await page.loadMembership();
  assert.equal(requests, 0); assert.equal(navigation[0].url, '/pages/login/index');
});

test('profile subscription refresh failure preserves last expiry and exposes retry state', async () => {
  let failed = false;
  const { page, navigation } = await loadPage('profile', { ...await view(), validateSession: async () => ({ username: 'u', role: 'student' }),
    getExperienceSummary: async () => ({}), listSessions: async () => [], avatarLetterOf: () => 'U', messageOf: e => e.message,
    getMySubscription: async () => { if (failed) throw new Error('offline'); return access('monthly', '2030-09-05T16:30:00Z'); } });
  await page.loadProfile(); failed = true; await page.loadProfile({ silent: true });
  assert.equal(page.data.membership.expiryLabel, '2030.09.06 00:30'); assert.ok(page.data.syncError);
  page.onMembership(); assert.equal(navigation[0].url, '/pages/membership/index');
});

test('both restricted paper entries open membership; cancel never navigates', async () => {
  const navigation = []; let confirm = true;
  const wx = { showModal: async () => ({ confirm }), navigateTo: item => navigation.push(item) };
  const routing = await loadModule('domain/navigation.ts', { wx }, ['navigation']);
  const { openMembershipOffer } = await loadModule('domain/membership-navigation.ts', { ...routing, wx, showDialog: options => wx.showModal(options) }, ['openMembershipOffer']);
  for (const name of ['papers', 'home']) {
    const { page } = await loadPage(name, { openMembershipOffer, MODE_POLICIES });
    if (name === 'papers') await page.onSelectPaper({ detail: { item: { contentRestricted: true } } });
    else { page.data.papers = [{ paperId: 'p1', releaseId: 'r1', contentRestricted: true }]; await page.onPaper({ currentTarget: { dataset: { releaseId: 'r1' } } }); }
  }
  assert.equal(navigation.length, 2); assert.ok(navigation.every(item => item.url === '/pages/membership/index'));
  confirm = false; await openMembershipOffer(); assert.equal(navigation.length, 2);
});
