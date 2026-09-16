import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule, loadPage } from './helpers/page-harness.mjs';
import { invalidateLearningPages } from '../domain/page-freshness.ts';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const user = { username: 'learner', display_name: '学员', role: 'student' };
const growth = { date: '2026-09-16', today: { answered: 2, goal: 10 }, configuredGoal: 10, week: [], milestones: [] };
const common = { validateSession: async () => user, messageOf: e => e.message, selectPrimaryTab() {}, avatarLetterOf: () => '学' };

test('home renders completed sections while growth is still pending', async () => {
  const slow = deferred();
  const { page } = await loadPage('home', { ...common, listPublishedPapers: async () => ({ items: [{ releaseId: 'r1' }] }),
    getActiveSessions: async () => [{ id: 'saved', stats: {} }], getRevengeSummary: async () => ({ stats: { active: 3 } }), getGrowthSummary: () => slow.promise });
  const pending = page.loadHome();
  await tick();
  try {
    assert.equal(page.data.activeSession?.id, 'saved');
    assert.equal(page.data.papers[0]?.releaseId, 'r1');
    assert.equal(page.data.revengeCount, 3);
  } finally { slow.resolve(growth); await pending; }
});

test('profile renders identity and experience before slow membership, and does not duplicate refresh', async () => {
  const slow = deferred(); let validations = 0;
  const { page } = await loadPage('profile', { ...common, validateSession: async () => { validations++; return user; },
    getExperienceSummary: async () => ({ totalExperience: 125 }), listSessions: async () => [{ status: 'completed' }], getMySubscription: () => slow.promise });
  const pending = page.loadProfile();
  await tick();
  try {
    assert.equal(page.data.user.username, 'learner');
    assert.equal(page.data.totalExperience, 125);
    assert.equal(page.data.completedCount, 1);
    await page.loadProfile({ silent: true });
    assert.equal(validations, 1);
  } finally { slow.resolve({}); await pending; }
});

test('growth reuses recent panel state but refreshes after learning changes', async () => {
  const { page } = await loadPage('growth', { ...common, getGrowthSummary: async () => growth });
  await page.loadGrowth();
  let reads = 0; page.loadGrowth = async () => { reads++; };
  page.onShow(); page.onShow();
  assert.equal(reads, 0);
  page.setData({ lastLoadedAt: Date.now() - 31_000 });
  page.onShow(); assert.equal(reads, 1);
  page.setData({ lastLoadedAt: Date.now() });
  invalidateLearningPages();
  page.onShow(); assert.equal(reads, 2);
});

test('catalog loads a small first page and keeps pagination complete', async () => {
  const calls = [];
  const { page } = await loadPage('papers', { ...common, listPublishedPapers: async (page, size) => {
    calls.push([page, size]); return { items: Array.from({ length: page === 1 ? 20 : 1 }, (_, i) => ({ releaseId: `r${page}-${i}`, title: '试卷', subject: 'PMP', accessLevel: 'free' })), total: 21 };
  } });
  await page.loadPapers(); assert.deepEqual(calls[0], [1, 20]); assert.equal(page.data.hasMore, true);
  await page.loadMore(); assert.deepEqual(calls[1], [2, 20]); assert.equal(page.data.papers.length, 21); assert.equal(page.data.hasMore, false);
});

async function transport() {
  let token = 'account-a'; const sent = [], routes = []; let clears = 0;
  const http = await loadModule('services/http.ts', {
    getApiBaseUrl: () => 'https://example.test', getSessionToken: () => token,
    clearSession: () => { clears++; token = ''; }, getCurrentPages: () => [{ route: 'pages/tabs/index' }],
    wx: { request: options => sent.push(options), reLaunch: options => routes.push(options) },
  }, ['request']);
  return { ...http, sent, routes, setToken: value => { token = value; }, token: () => token, clears: () => clears };
}

test('concurrent identical GETs share transport, success is not persisted and failure can retry', async () => {
  const h = await transport();
  const first = h.request({ path: '/summary' }), second = h.request({ path: '/summary' });
  assert.equal(h.sent.length, 1);
  h.sent[0].success({ statusCode: 200, data: { count: 2 } });
  assert.deepEqual(await first, { count: 2 }); assert.deepEqual(await second, { count: 2 });
  const retry = h.request({ path: '/summary' }); assert.equal(h.sent.length, 2);
  const failed = assert.rejects(retry, /网络/); h.sent[1].fail({ errMsg: 'offline' }); await failed;
  const recovered = h.request({ path: '/summary' }); assert.equal(h.sent.length, 3);
  h.sent[2].success({ statusCode: 200, data: { count: 3 } }); assert.deepEqual(await recovered, { count: 3 });
});

test('pending GETs are separated by account and an old 401 cannot clear the new login', async () => {
  const h = await transport();
  const old = h.request({ path: '/summary' }); const oldRejected = assert.rejects(old);
  h.setToken('account-b');
  const current = h.request({ path: '/summary' });
  assert.equal(h.sent.length, 2);
  h.sent[0].success({ statusCode: 401, data: { detail: 'expired' } }); await oldRejected;
  assert.equal(h.token(), 'account-b'); assert.equal(h.clears(), 0); assert.equal(h.routes.length, 0);
  h.sent[1].success({ statusCode: 200, data: { owner: 'b' } }); assert.deepEqual(await current, { owner: 'b' });
});

test('an old successful response cannot supply another account with data', async () => {
  const h = await transport(); const pending = h.request({ path: '/summary' });
  const rejected = assert.rejects(pending, error => error.code === 'SESSION_CHANGED');
  h.setToken('account-b'); h.sent[0].success({ statusCode: 200, data: { owner: 'a' } }); await rejected;
});

test('writes never coalesce and a current unauthorized response still expires the session', async () => {
  const h = await transport();
  const writes = [h.request({ path: '/goal', method: 'PUT', data: { goal: 10 } }), h.request({ path: '/goal', method: 'PUT', data: { goal: 20 } })];
  assert.equal(h.sent.length, 2); h.sent.forEach(x => x.success({ statusCode: 200, data: {} })); await Promise.all(writes);
  const pending = h.request({ path: '/summary' }), rejected = assert.rejects(pending);
  h.sent[2].success({ statusCode: 401, data: {} }); await rejected;
  assert.equal(h.token(), ''); assert.equal(h.clears(), 1); assert.equal(h.routes.length, 1);
});

test('obsolete session validation cannot send a newly logged-in user back to login', async () => {
  class ApiError extends Error { constructor() { super('changed'); this.statusCode = 401; this.code = 'SESSION_CHANGED'; } }
  const auth = await loadModule('services/auth.ts', { ApiError, getSessionToken: () => 'new-account', request: async () => { throw new ApiError(); } }, ['validateSession']);
  await assert.rejects(auth.validateSession(), error => error.code === 'SESSION_CHANGED');
});
