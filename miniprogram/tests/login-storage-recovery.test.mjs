import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule, loadPage } from './helpers/page-harness.mjs';

async function identity(wx) {
 return loadModule('services/session.ts', { wx }, ['getCurrentUser','getSessionToken','setSession','clearSession']);
}

test('unavailable device storage cannot crash homepage initialization before login', async () => {
 const session = await identity({ getStorageSync() { throw Error('storage unavailable'); } });
 const auth = await loadModule('services/auth.ts', session, ['validateSession']);
 const { page, navigation } = await loadPage('home', { ...session, ...auth });
 assert.doesNotThrow(() => page.onLoad({}));
 await page.loadHome();
 assert.equal(navigation.at(-1).url, '/pages/login/index');
});

test('partial session write rolls back and gives a recoverable storage error', async () => {
 const data = new Map();
 const session = await identity({ getStorageSync: k=>data.get(k), removeStorageSync: k=>data.delete(k),
  setStorageSync(k,v) { if(k==='kg_mini_current_user') throw Error('storage full'); data.set(k,v); } });
 assert.throws(()=>session.setSession('new-token',{username:'new-user'}),e=>e.code==='SESSION_STORAGE_FAILED');
 assert.equal(session.getSessionToken(),'');
 assert.equal(session.getCurrentUser(),null);
});

test('storage cleanup failure cannot leave a rejected login request pending forever', async () => {
 let callback;
 const removed = [];
 const wx = {
  getStorageSync: () => '',
  removeStorageSync(key) { removed.push(key); throw Error('storage unavailable'); },
  request(options) { callback = options.success; },
 };
 const session = await identity(wx);
 const http = await loadModule('services/http.ts', { wx, ...session,
  getApiBaseUrl: () => 'https://example.invalid', getCurrentPages: () => [{route:'pages/login/index'}],
 }, ['request','ApiError']);
 const pending = http.request({path:'/api/v1/auth/mini/bind',method:'POST',auth:false});
 const rejected = assert.rejects(pending, error => error.code === 'BINDING_TICKET_INVALID');
 assert.doesNotThrow(() => callback({statusCode:401,data:{detail:{code:'BINDING_TICKET_INVALID',message:'请重新登录'}}}));
 await rejected;
 assert.deepEqual(removed,['kg_mini_session_token','kg_mini_current_user']);
});

test('failed cache deletion cannot reuse the cleared session in the current process', async () => {
 const data = new Map([['kg_mini_session_token','old-token'],['kg_mini_current_user',{username:'old-user'}]]);
 const session = await identity({getStorageSync:key=>data.get(key),setStorageSync:(key,value)=>data.set(key,value),
  removeStorageSync() { throw Error('storage unavailable'); }});
 session.clearSession();
 assert.equal(session.getSessionToken(),'');
 assert.equal(session.getCurrentUser(),null);
 session.setSession('new-token',{username:'new-user'});
 assert.equal(session.getSessionToken(),'new-token');
 assert.equal(session.getCurrentUser().username,'new-user');
});

for (const code of ['BINDING_TICKET_INVALID','SESSION_STORAGE_FAILED']) {
 test(`${code}: recover via a new WeChat login instead of reusing the unusable ticket`, async()=>{
  let attempts=0;
  const {page}=await loadPage('login',{
   bindExistingAccount:async()=>{if(++attempts===1)throw Object.assign(Error('请重新登录'),{code});},
   loginWithWechat:async()=>({status:'binding_required',bindingTicket:'fresh-ticket'}),messageOf:e=>e.message,
  });
  page.setData({accepted:true,stage:'binding',bindingTicket:'old-ticket',username:'learner',password:'test-pass'});
  await page.onSubmitAccount();
  assert.equal(page.data.stage,'wechat'); assert.equal(page.data.submitting,false);
  assert.equal(page.data.bindingTicket,''); assert.equal(page.data.username,'learner');
  await page.onWechatLogin(); assert.equal(page.data.bindingTicket,'fresh-ticket');
  await page.onSubmitAccount(); assert.equal(page.data.authenticated,true);
 });
}
