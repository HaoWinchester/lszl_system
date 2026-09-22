// Pytest supplies a disposable DB and simulated WeChat provider; app/API code is real.
import assert from 'node:assert/strict';
import { loadModule, loadPage } from '../helpers/page-harness.mjs';
import { sanitizeRichText } from '../../domain/rich-text.ts';
import { createPracticeRun, normalizePairs } from '../../domain/pc-practice.ts';
import { getModePolicy, MODE_CHOICES, formatTimer } from '../../domain/mode-policy.ts';
import { mergeDraft, moveQuestion, toggleAnswer, toggleMarked } from '../../domain/practice-state.ts';
import { createSyncCoordinator, classifyFailure, resolveConflict } from '../../domain/sync-coordinator.ts';
import { invalidateLearningPages } from '../../domain/page-freshness.ts';
const base = process.env.MINI_LOGIN_TEST_BASE;
assert.match(base || '', /^http:\/\/127\.0\.0\.1:\d+$/);
const username = `flow_${process.env.MINI_LOGIN_TEST_PREFIX}`;
const storage = new Map(), sent = [];
const redirects = [];
let currentRoute = 'pages/tabs/index';
const wx = {
  getStorageSync: k => storage.get(k), setStorageSync: (k,v) => storage.set(k,v), removeStorageSync: k => storage.delete(k),
  login: async () => ({ code: 'new-person' }), getDeviceInfo: () => ({}), getAppBaseInfo: () => ({}),
  request(options) {
    fetch(options.url, { method: options.method, headers: options.header,
      body: options.method === 'GET' ? undefined : JSON.stringify(options.data) })
      .then(async response => { sent.push([new URL(options.url).pathname,response.status]); options.success({ statusCode: response.status, data: await response.json() }); })
      .catch(error => options.fail(error));
  },
  reLaunch(options) { redirects.push(options.url); },
};
const identity = await loadModule('services/session.ts', { wx }, ['getSessionToken','getCurrentUser','setSession','clearSession']);
const http = await loadModule('services/http.ts', { wx, ...identity, getApiBaseUrl: () => base, getCurrentPages: () => [{route:currentRoute}] }, ['request','ApiError','messageOf']);
const auth = await loadModule('services/auth.ts', { wx,...identity,...http,LEGAL_CONSENT_VERSION:'2026-08-13-v1' }, ['loginWithWechat','registerAccount','bindExistingAccount','validateSession','logout']);
const deps = { ...auth,...identity,...http };
identity.setSession('expired-test-token',{username:'old-user',role:'student'});
assert.equal(await auth.validateSession(),null);
assert.equal(identity.getSessionToken(),'');
assert.deepEqual(redirects,['/pages/login/index']);
currentRoute = 'pages/login/index';
const { page, navigation } = await loadPage('login', deps);
page.setData({accepted:true});
await page.onWechatLogin();
assert.equal(page.data.stage,'binding');
page.setData({formMode:'register',username,password:'test-password-0917',displayName:'隔离联测学员'});
await page.onSubmitAccount();
assert.equal(page.data.error,'');
assert.equal(navigation.at(-1).url,'/pages/tabs/index?tab=home');
assert.equal((await auth.validateSession()).username,username);
const papers = await loadModule('services/papers.ts', http, ['listPublishedPapers']);
const catalog = await papers.listPublishedPapers(1,100);
const paper = catalog.items.find(item => item.releaseId === process.env.MINI_LOGIN_TEST_RELEASE);
assert.ok(paper, 'the newly registered student must see the seeded free paper');
assert.equal(paper.contentRestricted,false);
const { normalizeQuestion } = await loadModule('domain/question.ts', {sanitizeRichText}, ['normalizeQuestion']);
const practice = await loadModule('services/practice.ts', {...http,normalizeQuestion,invalidateLearningPages},
  ['startSession','getSession','getActiveSessions','getRevengeSummary','pauseSession','saveState','completeSession','abandonSession','getReport','listSessions']);
const drafts = await loadModule('domain/draft-store.ts',{wx},['loadLocalDraft','saveLocalDraft','clearLocalDraft']);
const growth = await loadModule('services/growth.ts',{...http,invalidateLearningPages},['getGrowthSummary']);
const learning = {...deps,...papers,...practice,...drafts,...growth,createPracticeRun,normalizePairs,getModePolicy,MODE_CHOICES,formatTimer,
  mergeDraft,moveQuestion,toggleAnswer,toggleMarked,createSyncCoordinator,classifyFailure,resolveConflict,selectPrimaryTab() {}};
const home = await loadPage('home',learning);
home.page.onLoad(); await home.page.loadHome();
assert.equal(home.page.data.error,'');
assert.equal(home.page.data.growthError,'');
assert.equal(home.page.data.loading,false);
const setup = await loadPage('practice-setup',learning);
setup.page.onLoad({paperId:paper.paperId,releaseId:paper.releaseId,title:encodeURIComponent(paper.title),count:'3',mode:'normal'});
await setup.page.start();
assert.equal(setup.page.data.error,'');
const sessionId = new URL(setup.navigation.at(-1).url,'https://example.invalid').searchParams.get('sessionId');
assert.ok(sessionId);
async function openPractice() {
  const {page} = await loadPage('practice',learning);
  page.data.sessionId = sessionId;
  page.syncCoordinator = createSyncCoordinator(job => page.executeSyncJob(job));
  await page.loadSession();
  assert.equal(page.data.loadError,'');
  assert.equal(page.data.session.questions.length,3);
  for (const {question} of page.data.session.questions) {
    assert.match(question.stem,/[\u4e00-\u9fff]/); assert.match(question.stemEn,/Review question/);
    assert.ok(question.options.every(option => option.text && option.textEn));
  }
  return page;
}
let exercise = await openPractice();
exercise.onAnswerChange({detail:{optionId:'B'}});
await exercise.onNext();
await exercise.onExit();
assert.equal(exercise.data.writeError,'');
assert.equal(exercise.data.session.status,'paused');
drafts.clearLocalDraft(username,sessionId);
exercise = await openPractice();
assert.equal(exercise.data.currentIndex,1);
assert.equal(exercise.run.stats().answered,1);
exercise.onAnswerChange({detail:{optionId:'A'}}); await exercise.onNext();
exercise.onAnswerChange({detail:{optionId:'A'}}); await exercise.onComplete();
const completionDeadline = Date.now() + 15000;
while (!exercise.leaving && !exercise.data.writeError) {
  assert.ok(Date.now() < completionDeadline,'automatic submission did not finish');
  await new Promise(resolve => setTimeout(resolve,10));
}
assert.equal(exercise.data.writeError,'');
assert.equal((await practice.getSession(sessionId)).status,'completed');
const result = await loadPage('result',learning);
result.page.data.sessionId = sessionId; await result.page.loadResult();
assert.equal(result.page.data.error,'');
assert.equal(result.page.data.report.counts.correct,2);
assert.equal(result.page.data.report.counts.wrong,1);
assert.ok((await practice.listSessions()).some(item => item.sessionId === sessionId && item.reportAvailable));
assert.equal((await growth.getGrowthSummary()).today.answered,3);
await auth.logout();
assert.equal(await auth.validateSession(),null);
const existing = await auth.loginWithWechat();
assert.equal(existing.status,'authenticated');
assert.equal(existing.user.username,username);
await auth.logout();
wx.login = async () => ({code:'another-person'});
const bound = await loadPage('login',deps);
bound.page.setData({accepted:true});
await bound.page.onWechatLogin();
bound.page.setData({username,password:'wrong-password'});
await bound.page.onSubmitAccount();
assert.equal(bound.page.data.submitting,false);
assert.match(bound.page.data.error,/密码/);
assert.equal(identity.getSessionToken(),'');
bound.page.setData({password:'test-password-0917'});
// A lost/expired ticket is rejected by the real API, then replaced before retry.
bound.page.setData({bindingTicket:'expired-binding-ticket-for-test'});
await bound.page.onSubmitAccount();
assert.equal(bound.page.data.stage,'wechat');
assert.equal(bound.page.data.bindingTicket,'');
assert.equal(bound.page.data.username,username);
await bound.page.onWechatLogin();
assert.equal(bound.page.data.stage,'binding');
await bound.page.onSubmitAccount();
assert.equal(bound.page.data.authenticated,true);
assert.equal((await auth.validateSession()).username,username);
assert.ok(sent.some(([path,status])=>path.endsWith('/bind')&&status===401));
assert.ok(sent.some(([path,status])=>path.endsWith('/bind')&&status===200));
assert.equal(redirects.length,1,'login form failures must not relaunch and discard entered fields');
await auth.logout();
// Registration commits on the server before device storage fails. Recovery must
// log into that same account, not register again with its already-consumed ticket.
wx.login = async () => ({code:'storage-person'});
const storageFailure = await loadPage('login',deps);
storageFailure.page.setData({accepted:true});
await storageFailure.page.onWechatLogin();
storageFailure.page.setData({formMode:'register',username:`store_${process.env.MINI_LOGIN_TEST_PREFIX}`,password:'test-password-0917'});
wx.setStorageSync = (key,value) => {
  if (key === 'kg_mini_current_user') throw Error('device storage full');
  storage.set(key,value);
};
await storageFailure.page.onSubmitAccount();
assert.equal(storageFailure.page.data.stage,'wechat');
assert.equal(storageFailure.page.data.submitting,false);
assert.match(storageFailure.page.data.error,/保存登录状态/);
assert.equal(identity.getSessionToken(),'');
const registrations = sent.filter(([path])=>path.endsWith('/register')).length;
wx.setStorageSync = (key,value) => storage.set(key,value);
await storageFailure.page.onWechatLogin();
assert.equal(storageFailure.page.data.authenticated,true);
assert.equal((await auth.validateSession()).username,`store_${process.env.MINI_LOGIN_TEST_PREFIX}`);
assert.equal(sent.filter(([path])=>path.endsWith('/register')).length,registrations);
await assert.rejects(practice.getSession(sessionId),error=>error.statusCode===404);
await assert.rejects(practice.getReport(sessionId),error=>error.statusCode===404);
assert.ok((await practice.listSessions()).every(item=>item.sessionId!==sessionId));
console.log('FIRST_LOGIN_FLOW_OK: register, nonempty bilingual catalog, home, practice setup, answer/pause/resume/complete, report/history/growth, logout, bound login, wrong password, ticket renewal, partial storage write recovery');
