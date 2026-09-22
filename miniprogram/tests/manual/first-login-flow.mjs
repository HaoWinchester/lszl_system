// Pytest supplies a disposable DB and simulated WeChat provider; app/API code is real.
import assert from 'node:assert/strict';
import { loadModule, loadPage } from '../helpers/page-harness.mjs';
const base = process.env.MINI_LOGIN_TEST_BASE;
assert.match(base || '', /^http:\/\/127\.0\.0\.1:\d+$/);
const username = `flow_${process.env.MINI_LOGIN_TEST_PREFIX}`;
const storage = new Map(), sent = [];
const wx = {
  getStorageSync: k => storage.get(k), setStorageSync: (k,v) => storage.set(k,v), removeStorageSync: k => storage.delete(k),
  login: async () => ({ code: 'new-person' }), getDeviceInfo: () => ({}), getAppBaseInfo: () => ({}),
  request(options) {
    fetch(options.url, { method: options.method, headers: options.header,
      body: options.method === 'GET' ? undefined : JSON.stringify(options.data) })
      .then(async response => { sent.push([new URL(options.url).pathname,response.status]); options.success({ statusCode: response.status, data: await response.json() }); })
      .catch(error => options.fail(error));
  },
  reLaunch() { assert.fail('auth form errors must not issue an unsolicited navigation'); },
};
const identity = await loadModule('services/session.ts', { wx }, ['getSessionToken','getCurrentUser','setSession','clearSession']);
const http = await loadModule('services/http.ts', { wx, ...identity, getApiBaseUrl: () => base, getCurrentPages: () => [{route:'pages/login/index'}] }, ['request','ApiError','messageOf']);
const auth = await loadModule('services/auth.ts', { wx,...identity,...http,LEGAL_CONSENT_VERSION:'2026-08-13-v1' }, ['loginWithWechat','registerAccount','bindExistingAccount','validateSession','logout']);
const deps = { ...auth,...identity,...http };
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
assert.ok(Array.isArray((await papers.listPublishedPapers(1,20)).items));
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
console.log('FIRST_LOGIN_FLOW_OK: register, catalog, logout, bound login, wrong password, ticket renewal, partial storage write recovery');
