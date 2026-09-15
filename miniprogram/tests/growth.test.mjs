import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule, loadPage } from './helpers/page-harness.mjs';
import { MODE_POLICIES } from '../domain/mode-policy.ts';
import { PRIMARY_TABS } from '../domain/primary-tabs.ts';

const summary = () => ({ date: '2026-09-15', timezone: 'Asia/Shanghai', today: { answered: 1, goal: 10, completed: false }, configuredGoal: 10, goalEffectiveDate: '2026-09-15', currentStreak: 6, longestStreak: 7, totalCompletedDays: 8, week: Array.from({length: 7}, (_, i) => ({ date: `2026-09-${14+i}`, answered: i === 0 ? 10 : i === 1 ? 1 : 0, goal: 10, completed: i === 0, isToday: i === 1 })), milestones: [7,30,100].map(days => ({ days, unlocked: days === 7 })) });
const dependencies = async extras => ({ ...(await loadModule('domain/growth-view.ts', {}, ['growthView', 'GROWTH_GOALS'])), validateSession: async () => ({ username: 'learner' }), messageOf: e => e.message, selectPrimaryTab() {}, ...extras });

test('four tabs promote catalog and growth, keeping history secondary', () => {
  assert.deepEqual(PRIMARY_TABS.map(x => x.label), ['首页', '练习', '成长', '我的']);
});
test('weekly and milestone formatting uses server dates and thresholds', async () => {
  const { growthView } = await dependencies();
  const view = growthView(summary());
  assert.equal(view.percent, 10); assert.equal(view.remaining, 9);
  assert.equal(view.weekCompleted, 1); assert.equal(view.week[1].weekday, '二');
  assert.equal(view.week[2].future, true); assert.equal(view.week[1].future, false);
  assert.equal(view.milestones[0].label, '已达成'); assert.equal(view.milestones[1].label, '还差 23 天');
});
test('growth loading failure clears loading and retry obtains authoritative state', async () => {
  let fail = true;
  const { page } = await loadPage('growth', await dependencies({ getGrowthSummary: async () => { if (fail) throw Error('网络暂不可用'); return summary(); } }));
  await page.loadGrowth(); assert.equal(page.data.loading, false); assert.equal(page.data.summary, null); assert.equal(page.data.error, '网络暂不可用');
  fail = false; await page.loadGrowth(); assert.equal(page.data.summary.today.answered, 1); assert.equal(page.data.error, '');
});
test('failed goal save preserves summary and selection, retry displays server effective date', async () => {
  let fail = true, calls = [];
  const { page } = await loadPage('growth', await dependencies({ getGrowthSummary: async () => summary(), updateGrowthGoal: async goal => { calls.push(goal); if (fail) throw Error('保存失败'); return { ...summary(), configuredGoal: goal, goalEffectiveDate: '2026-09-16' }; } }));
  await page.loadGrowth(); page.onGoal({ currentTarget: { dataset: { goal: 20 } } }); await page.onSaveGoal();
  assert.equal(page.data.summary.configuredGoal, 10); assert.equal(page.data.selectedGoal, 20); assert.equal(page.data.saving, false); assert.equal(page.data.goalError, '保存失败');
  fail = false; await page.onSaveGoal(); assert.deepEqual(calls, [20,20]); assert.equal(page.data.summary.today.goal, 10); assert.match(page.data.view.goalNotice, /2026-09-16.*生效/); assert.equal(page.data.goalError, '');
});
test('invalid and concurrent goals cannot write; logged-out growth redirects before reads', async () => {
  let reads = 0, writes = 0;
  const { page, navigation } = await loadPage('growth', await dependencies({ validateSession: async () => null, getGrowthSummary: async () => { reads++; }, updateGrowthGoal: async () => { writes++; } }));
  await page.loadGrowth(); assert.equal(reads, 0); assert.equal(navigation.at(-1).url, '/pages/login/index');
  page.onGoal({ currentTarget: { dataset: { goal: 9 } } }); await page.onSaveGoal(); assert.equal(writes, 0);
});
test('home keeps saved practice visible when growth fails and resumes exact session', async () => {
  const active = { id: 'saved-session', stats: { answered: 1, total: 10 } };
  const { page, navigation } = await loadPage('home', await dependencies({ MODE_POLICIES, listPublishedPapers: async () => ({ items: [] }), getRevengeSummary: async () => ({ stats: { active: 1 } }), getActiveSessions: async () => [active], getGrowthSummary: async () => { throw Error('成长暂不可用'); }, getSession: async () => ({ id: active.id, status: 'paused' }) }));
  await page.loadHome(); assert.equal(page.data.activeSession.id, active.id); assert.equal(page.data.loading, false); assert.equal(page.data.growthError, '成长暂不可用');
  await page.onContinue(); assert.equal(navigation.at(-1).url, '/pages/practice/index?sessionId=saved-session');
  page.setData({ activeSession: null }); page.onBrowsePapers(); assert.equal(navigation.at(-1).url, '/pages/papers/index');
});
test('paper mode transient intent is consumed once after switchTab, failure clears intent', async () => {
  let failed = false, moves = [];
  const mod = await loadModule('domain/navigation.ts', { wx: { switchTab: o => { moves.push(o); if (failed) o.fail(Error('fail')); }, showToast() {} } }, ['navigation', 'openPaperCatalog', 'consumePaperMode']);
  mod.openPaperCatalog('scholar'); assert.equal(moves[0].url, '/pages/papers/index'); assert.equal(mod.consumePaperMode(), 'scholar'); assert.equal(mod.consumePaperMode(), null);
  failed = true; mod.openPaperCatalog('challenge'); assert.equal(mod.consumePaperMode(), null);
});
test('catalog onShow consumes mode and search filters real paper data without changing access', async () => {
  let intent = 'challenge';
  const { page, navigation } = await loadPage('papers', { MODE_POLICIES, selectPrimaryTab() {}, consumePaperMode: () => { const value = intent; intent = null; return value; }, messageOf: e => e.message });
  page.onShow(); assert.equal(page.data.mode, 'challenge'); page.onShow(); assert.equal(page.data.mode, 'challenge');
  page.setData({ papers: [{ title: '项目管理', subject: 'PMP', accessLevel: 'free' }, { title: '敏捷实践', subject: 'ACP', accessLevel: 'member' }] });
  page.onSearch({ detail: { value: '敏捷' } }); assert.equal(page.data.filtered.length, 1); assert.equal(page.data.filtered[0].accessLevel, 'member');
  page.onMode({ currentTarget: { dataset: { mode: 'revenge' } } }); assert.equal(navigation.at(-1).url, '/pages/revenge/index');
});

test('growth service uses the real API routes and invalidates home only after successful persistence', async () => {
  let fail = false, invalidations = 0; const requests = [];
  const service = await loadModule('services/growth.ts', { request: async options => { requests.push(options); if (fail) throw Error('offline'); return summary(); }, invalidateLearningPages: () => { invalidations++; } }, ['getGrowthSummary','updateGrowthGoal']);
  const loaded = await service.getGrowthSummary(); assert.equal(loaded.today.answered, 1);
  assert.deepEqual(requests[0], { path: '/api/v1/learning/practice/growth' });
  await service.updateGrowthGoal(30); assert.deepEqual(requests[1], { path: '/api/v1/learning/practice/growth/goal', method: 'PUT', data: { goal: 30 } }); assert.equal(invalidations, 1);
  fail = true; await assert.rejects(service.updateGrowthGoal(5), /offline/); assert.equal(invalidations, 1);
});
test('stale growth remains visible after refresh failure and recovery fetch replaces it', async () => {
  let response = summary();
  const { page } = await loadPage('growth', await dependencies({ getGrowthSummary: async () => { if (!response) throw Error('offline'); return response; } }));
  await page.loadGrowth(); response = null; await page.loadGrowth(); assert.equal(page.data.summary.today.answered, 1); assert.equal(page.data.loading, false); assert.ok(page.data.error);
  response = { ...summary(), today: { answered: 12, goal: 10, completed: true } }; await page.loadGrowth(); assert.equal(page.data.view.percent, 100); assert.equal(page.data.view.remaining, 0); assert.equal(page.data.error, '');
});
test('saving goal guards double taps and selection until the single server write completes', async () => {
  let release, writes = 0;
  const { page } = await loadPage('growth', await dependencies({ getGrowthSummary: async () => summary(), updateGrowthGoal: async goal => { writes++; return new Promise(resolve => { release = () => resolve({ ...summary(), configuredGoal: goal, goalEffectiveDate: '2026-09-16' }); }); } }));
  await page.loadGrowth(); page.onGoal({ currentTarget: { dataset: { goal: 30 } } });
  const saving = page.onSaveGoal(); await page.onSaveGoal(); page.onGoal({ currentTarget: { dataset: { goal: 5 } } });
  assert.equal(writes, 1); assert.equal(page.data.selectedGoal, 30); assert.equal(page.data.saving, true); assert.equal(page.data.summary.configuredGoal, 10);
  release(); await saving; assert.equal(page.data.summary.configuredGoal, 30); assert.equal(page.data.saving, false);
});
test('home resumes report for completed session, refreshes abandoned session and recovers a failed resume', async () => {
  let status = 'completed', failure = false, dialogs = 0, refreshes = 0;
  const { page, navigation } = await loadPage('home', { getSession: async () => { if (failure) throw Error('network'); return { id: 'existing', status }; }, showDialog: () => { dialogs++; } });
  page.setData({ activeSession: { id: 'existing' } }); await page.onContinue(); assert.equal(navigation.at(-1).url, '/pages/result/index?sessionId=existing');
  page.loadHome = async () => { refreshes++; }; status = 'abandoned'; await page.onContinue(); assert.equal(refreshes, 1);
  failure = true; await page.onContinue(); assert.equal(dialogs, 1); assert.equal(page.data.continuing, false); failure = false; status = 'paused'; await page.onContinue(); assert.equal(navigation.at(-1).url, '/pages/practice/index?sessionId=existing');
});
test('catalog forwards selected mode to setup and keeps membership gating', async () => {
  let offers = 0;
  const { page, navigation } = await loadPage('papers', { MODE_POLICIES, openMembershipOffer: async () => { offers++; } });
  const item = { paperId: 'p1', releaseId: 'r1', title: '试卷', questionCount: 10, contentRestricted: false };
  for (const mode of ['normal', 'challenge', 'scholar']) { page.onMode({ currentTarget: { dataset: { mode } } }); await page.onSelectPaper({ detail: { item } }); assert.match(navigation.at(-1).url, new RegExp(`mode=${mode}$`)); }
  await page.onSelectPaper({ detail: { item: { ...item, contentRestricted: true } } }); assert.equal(offers, 1); assert.equal(navigation.length, 3);
  page.onMode({ currentTarget: { dataset: { mode: 'unknown' } } }); assert.equal(page.data.mode, 'scholar');
});
test('secondary history opens via navigateTo/redirectTo and back has a home fallback', async () => {
  const calls = [];
  for (const name of ['profile', 'growth', 'result']) {
    const { page } = await loadPage(name, await dependencies(), { navigateTo: o => calls.push(['push',o.url]), redirectTo: o => calls.push(['replace',o.url]) });
    if (name === 'result') page.onBack(); else page.onHistory();
  }
  assert.deepEqual(calls, [['push','/pages/history/index'],['push','/pages/history/index'],['replace','/pages/history/index']]);
  const { page, navigation } = await loadPage('history', {}, { navigateBack: o => o.fail() }); page.onBack(); assert.equal(navigation.at(-1).url, '/pages/home/index'); page.onBrowse(); assert.equal(navigation.at(-1).url, '/pages/papers/index');
});

test('new learning controls bind real page handlers and expose recovery and accessible states', async () => {
  const { readFileSync } = await import('node:fs');
  for (const name of ['home', 'papers', 'growth', 'profile']) {
    const { page } = await loadPage(name, await dependencies());
    const markup = readFileSync(new URL(`../pages/${name}/index.wxml`, import.meta.url), 'utf8');
    for (const match of markup.matchAll(/bind(?:tap|input|:action|:select)="([^"]+)"/g)) assert.equal(typeof page[match[1]], 'function', `${name}: ${match[1]}`);
  }
  const growth = readFileSync(new URL('../pages/growth/index.wxml', import.meta.url), 'utf8');
  for (const item of ['role="radiogroup"','aria-checked','goalError','savedNotice','loading="{{saving}}"','bindtap="onHistory"','summary.today.answered','view.week','view.milestones']) assert.ok(growth.includes(item), item);
  const home = readFileSync(new URL('../pages/home/index.wxml', import.meta.url), 'utf8');
  for (const item of ['learning-pair','path-art','review-art','activeSession','summary.today.answered','revengeCount','growthError']) assert.ok(home.includes(item), item);
});
